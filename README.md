# FieldPro

Attendance with GPS, live team tracking, and service / inspection reports with
photos, customer signature and branded PDF. Admin and employee apps in one
installable web app (PWA), backed by Supabase.

## One-time setup (about 5 minutes)

1. **Create the database.** Open your Supabase project
   (`https://supabase.com/dashboard/project/eovvibmbrbludgialzqd`) →
   **SQL Editor** → **New query**, paste the whole of `supabase/schema.sql`, click **Run**.
2. **Turn off email confirmation.** Logins are mobile numbers / User IDs, not
   real emails, so: **Authentication → Sign In / Providers → Email** → switch
   **Confirm email** off → Save. (Leave "Allow new users to sign up" on.)
3. **Add your key.** **Project Settings → API Keys** → copy the **anon / publishable**
   key and paste it into `config.js` as `SUPABASE_ANON_KEY`.
   (Never put the `service_role` / secret key in this app.)

## Run it on this PC

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open http://localhost:8080. GPS and camera work on `localhost`.

## Put it on phones

Phones need the app on **HTTPS** (browsers block GPS/camera on plain http).
Upload this folder to any static host — e.g. drag the folder onto
https://app.netlify.com/drop, or use GitHub Pages / Vercel / Cloudflare Pages.
Then open the link on the phone and choose **Add to Home screen / Install app**.

## How it works

| Who | Can do |
|---|---|
| **Admin** (registers with mobile + password) | Company profile & logo, add employees (User ID + password), live map, today's activity, attendance history + CSV export, all reports, PDF download/share, remove/restore an employee's access |
| **Employee** (logs in with User ID from admin) | Punch in / out with GPS + address, location shared while on duty, create Service or Inspection reports with GPS tag, up to 4 GPS-stamped photos, customer signature, PDF |

- Data: Supabase Postgres with row-level security — each company only sees its
  own data; employees only see their own attendance and reports.
- Files: private Supabase Storage bucket `fieldpro` (photos, signatures, logo).
- Live tracking: Supabase Realtime + 60-second refresh.
- Addresses: OpenStreetMap Nominatim reverse geocoding. Maps: OpenStreetMap tiles.

## Known limits

- **Background tracking:** a web app can only send location while FieldPro is
  open (in the foreground or with the screen locked on most Android phones).
  If an employee closes the app, the admin sees "No signal" after 20 minutes.
  Continuous background tracking needs a native Android/iOS app.
- **Password reset:** employees can't reset their own password. The admin can
  remove access and create a new User ID, or reset it in the Supabase
  dashboard (Authentication → Users).
- User IDs are unique across all companies using this Supabase project.
- OpenStreetMap's free tile and address services are for light use; for a large
  team, switch to a paid map provider.

## Files

- `index.html`, `styles.css`, `app.js` — the app (Preact + htm, no build step)
- `config.js` — Supabase URL and anon key
- `supabase/schema.sql` — tables, security policies, storage, realtime
- `manifest.webmanifest`, `sw.js`, `icon.svg` — installable app
- `serve.ps1` — local test server
