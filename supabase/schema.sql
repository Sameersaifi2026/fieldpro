-- ============================================================
-- FieldPro database schema
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Safe to re-run: tables are created only if missing (data is kept);
-- functions, policies and the trigger are replaced.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------
create table if not exists public.companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  address       text not null default '',
  phone         text not null default '',
  email         text not null default '',
  gstin         text not null default '',
  logo_path     text,
  admin_mobile  text,
  report_seq    integer not null default 1000,
  created_at    timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  role        text not null check (role in ('admin','employee')),
  name        text not null,
  phone       text not null default '',
  login_id    text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists profiles_company_idx on public.profiles(company_id);

-- One-time invites the admin creates just before creating an employee login.
create table if not exists public.employee_invites (
  login_id    text primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  phone       text not null default '',
  token       text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  day         date not null,
  in_at       timestamptz not null default now(),
  in_lat      double precision,
  in_lng      double precision,
  in_acc      double precision,
  in_addr     text not null default '',
  out_at      timestamptz,
  out_lat     double precision,
  out_lng     double precision,
  out_acc     double precision,
  out_addr    text not null default '',
  unique (user_id, day)
);
create index if not exists attendance_company_day_idx on public.attendance(company_id, day);

-- Latest known position of each employee (one row per employee).
create table if not exists public.locations (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy    double precision,
  address     text not null default '',
  moving      boolean not null default false,
  on_duty     boolean not null default true,
  updated_at  timestamptz not null default now()
);
create index if not exists locations_company_idx on public.locations(company_id);

create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  code           text not null,
  type           text not null check (type in ('Service','Inspection')),
  customer       text not null,
  contact        text not null default '',
  issue          text not null default '',
  work           text not null default '',
  notes          text not null default '',
  items          jsonb not null default '[]'::jsonb,
  photos         text[] not null default '{}',
  signature_path text,
  lat            double precision,
  lng            double precision,
  accuracy       double precision,
  address        text not null default '',
  area           text not null default '',
  employee_id    uuid not null references public.profiles(id) on delete cascade,
  employee_name  text not null,
  status         text not null default 'Submitted',
  created_at     timestamptz not null default now(),
  unique (company_id, code)
);
create index if not exists reports_company_created_idx on public.reports(company_id, created_at desc);

-- ---------- Helper functions ----------
create or replace function public.my_company()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active)
$$;

create or replace function public.login_id_available(p_login_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where login_id = lower(p_login_id))
     and not exists (select 1 from public.employee_invites where login_id = lower(p_login_id)
                     and created_at > now() - interval '10 minutes')
$$;

create or replace function public.next_report_code(p_type text)
returns text language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_company(); n integer;
begin
  if cid is null then raise exception 'not allowed'; end if;
  update public.companies set report_seq = report_seq + 1 where id = cid returning report_seq into n;
  return (case when p_type = 'Inspection' then 'IR-' else 'SR-' end) || n;
end $$;

-- Creates company/profile rows when a login is created.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  cid uuid;
  inv public.employee_invites;
begin
  if m->>'role' = 'admin' then
    insert into public.companies (name, address, phone, email, gstin, admin_mobile)
    values (coalesce(nullif(m->>'company_name',''), 'My Company'),
            coalesce(m->>'company_address',''), coalesce(m->>'company_phone',''),
            coalesce(m->>'company_email',''), upper(coalesce(m->>'company_gstin','')),
            m->>'login_id')
    returning id into cid;
    insert into public.profiles (id, company_id, role, name, phone, login_id)
    values (new.id, cid, 'admin', coalesce(nullif(m->>'name',''), 'Admin'),
            coalesce(m->>'login_id',''), lower(m->>'login_id'));
  elsif m->>'role' = 'employee' then
    select * into inv from public.employee_invites
     where login_id = lower(m->>'login_id') and token = m->>'invite_token';
    if not found then
      raise exception 'No valid invite for this user id';
    end if;
    insert into public.profiles (id, company_id, role, name, phone, login_id)
    values (new.id, inv.company_id, 'employee', inv.name, inv.phone, inv.login_id);
    delete from public.employee_invites where login_id = inv.login_id;
  end if;
  return new;
end $$;

drop trigger if exists fieldpro_on_auth_user_created on auth.users;
create trigger fieldpro_on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- Row level security ----------
alter table public.companies        enable row level security;
alter table public.profiles         enable row level security;
alter table public.employee_invites enable row level security;
alter table public.attendance       enable row level security;
alter table public.locations        enable row level security;
alter table public.reports          enable row level security;

drop policy if exists companies_read   on public.companies;
drop policy if exists companies_update on public.companies;
create policy companies_read   on public.companies for select to authenticated using (id = public.my_company());
create policy companies_update on public.companies for update to authenticated
  using (id = public.my_company() and public.is_admin()) with check (id = public.my_company());

drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (company_id = public.my_company() or id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (company_id = public.my_company() and public.is_admin())
  with check (company_id = public.my_company());

drop policy if exists invites_admin on public.employee_invites;
create policy invites_admin on public.employee_invites for all to authenticated
  using (company_id = public.my_company() and public.is_admin())
  with check (company_id = public.my_company() and public.is_admin());

drop policy if exists attendance_read   on public.attendance;
drop policy if exists attendance_insert on public.attendance;
drop policy if exists attendance_update on public.attendance;
create policy attendance_read on public.attendance for select to authenticated
  using (company_id = public.my_company() and (public.is_admin() or user_id = auth.uid()));
create policy attendance_insert on public.attendance for insert to authenticated
  with check (company_id = public.my_company() and user_id = auth.uid());
create policy attendance_update on public.attendance for update to authenticated
  using (company_id = public.my_company() and user_id = auth.uid())
  with check (company_id = public.my_company() and user_id = auth.uid());

drop policy if exists locations_read   on public.locations;
drop policy if exists locations_insert on public.locations;
drop policy if exists locations_update on public.locations;
create policy locations_read on public.locations for select to authenticated
  using (company_id = public.my_company() and (public.is_admin() or user_id = auth.uid()));
create policy locations_insert on public.locations for insert to authenticated
  with check (company_id = public.my_company() and user_id = auth.uid());
create policy locations_update on public.locations for update to authenticated
  using (company_id = public.my_company() and user_id = auth.uid())
  with check (company_id = public.my_company() and user_id = auth.uid());

drop policy if exists reports_read   on public.reports;
drop policy if exists reports_insert on public.reports;
create policy reports_read on public.reports for select to authenticated
  using (company_id = public.my_company() and (public.is_admin() or employee_id = auth.uid()));
create policy reports_insert on public.reports for insert to authenticated
  with check (company_id = public.my_company() and employee_id = auth.uid());

-- ---------- Grants ----------
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.companies, public.profiles, public.employee_invites,
  public.attendance, public.locations, public.reports to authenticated;
revoke all on public.companies, public.profiles, public.employee_invites,
  public.attendance, public.locations, public.reports from anon;
grant execute on function public.my_company(), public.is_admin(),
  public.login_id_available(text), public.next_report_code(text) to authenticated;

-- ---------- Storage (photos, signatures, logos) ----------
insert into storage.buckets (id, name, public)
values ('fieldpro', 'fieldpro', false)
on conflict (id) do nothing;

drop policy if exists fieldpro_files_read   on storage.objects;
drop policy if exists fieldpro_files_insert on storage.objects;
drop policy if exists fieldpro_files_update on storage.objects;
drop policy if exists fieldpro_files_delete on storage.objects;
create policy fieldpro_files_read on storage.objects for select to authenticated
  using (bucket_id = 'fieldpro' and (storage.foldername(name))[1] = public.my_company()::text);
create policy fieldpro_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fieldpro' and (storage.foldername(name))[1] = public.my_company()::text);
create policy fieldpro_files_update on storage.objects for update to authenticated
  using (bucket_id = 'fieldpro' and (storage.foldername(name))[1] = public.my_company()::text);
create policy fieldpro_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fieldpro' and (storage.foldername(name))[1] = public.my_company()::text and public.is_admin());

-- ---------- Realtime (live tracking) ----------
do $$
begin
  begin alter publication supabase_realtime add table public.locations;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.attendance; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.reports;    exception when duplicate_object then null; end;
end $$;
