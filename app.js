// FieldPro — field team attendance, live tracking and service reports.
// Plain ES modules, no build step. Preact + htm for UI, Supabase for data.
import { h, render } from 'https://esm.sh/preact@10.24.3';
import { useState, useEffect, useRef, useCallback, useMemo } from 'https://esm.sh/preact@10.24.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const html = htm.bind(h);
const CFG = window.FIELDPRO_CONFIG || {};
const CONFIGURED = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !/PASTE_/.test(CFG.SUPABASE_ANON_KEY));
const sb = CONFIGURED
  ? createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, storageKey: 'fieldpro-auth' } })
  : null;
const BUCKET = 'fieldpro';
const DOMAIN = CFG.LOGIN_EMAIL_DOMAIN || 'fieldpro.app';
const emailFor = (loginId) => `${String(loginId).trim().toLowerCase()}@${DOMAIN}`;

// ---------------------------------------------------------------- helpers
const C = { navy: '#13233A', orange: '#C2410C', green: '#15803D', grey: '#5B6675', red: '#B91C1C' };
const TONE = {
  'On site': [C.green, '#E3F4E8'],
  'Travelling': [C.orange, '#FDEDE3'],
  'No signal': ['#B45309', '#FEF3C7'],
  'Punched out': [C.grey, '#ECEFF3'],
  'Not punched in': [C.grey, '#ECEFF3'],
  'Access removed': [C.red, '#FDE8E8'],
};
const TYPE_TONE = { Service: ['#1D4ED8', '#E6EEFF'], Inspection: ['#6D28D9', '#F1EAFE'] };
const DEFAULT_CHECKS = ['Fire safety equipment', 'Emergency exits clear', 'Electrical panel', 'Structural / rack condition'];

const initialsOf = (n) => (n || '').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '—';
const firstName = (n) => (n || '').split(' ')[0];
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDateTime = (d) => `${fmtDay(d)} · ${fmtTime(d)}`;
const todayLabel = () => new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtGps = (lat, lng) => (lat == null ? '—' : `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`);
const fmtDur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}h ${m % 60}m`; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mapsLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

function distM(a, b) {
  const R = 6371000, t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device has no GPS / location support'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, speed: p.coords.speed }),
      (e) => reject(new Error(e.code === 1 ? 'Location permission denied. Allow location for this app and try again.' : 'Could not get GPS location. Move to open sky and retry.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
    );
  });
}

const geoCache = new Map();
async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`);
    const j = await r.json();
    const a = j.address || {};
    const parts = (j.display_name || '').split(',').map((s) => s.trim()).filter(Boolean);
    const areaParts = [a.suburb || a.neighbourhood || a.quarter || a.village || a.city_district, a.city || a.town || a.county || a.state_district];
    const area = areaParts.filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');
    const res = { address: parts.slice(0, 5).join(', ') || fmtGps(lat, lng), area: area || parts.slice(1, 3).join(', ') };
    geoCache.set(key, res);
    return res;
  } catch {
    return { address: fmtGps(lat, lng), area: '' };
  }
}

async function locate() {
  const p = await getPosition();
  const g = await reverseGeocode(p.lat, p.lng);
  return { ...p, ...g };
}

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

async function compressImage(file, { max = 1600, stamp = null, type = 'image/jpeg' } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * k), hgt = Math.round(img.height * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = hgt;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, hgt);
    x.drawImage(img, 0, 0, w, hgt);
    if (stamp && stamp.length) {
      const fs = Math.max(14, Math.round(w / 48)), lh = fs * 1.35, bh = lh * stamp.length + fs * 0.8;
      x.fillStyle = 'rgba(19,35,58,0.72)'; x.fillRect(0, hgt - bh, w, bh);
      x.fillStyle = '#fff'; x.font = `600 ${fs}px Manrope, sans-serif`; x.textBaseline = 'top';
      stamp.forEach((t, i) => x.fillText(t, fs * 0.7, hgt - bh + fs * 0.4 + lh * i, w - fs * 1.4));
    }
    return await new Promise((r) => c.toBlob(r, type, 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const blobToDataURL = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
async function storageDataURL(path) {
  if (!path) return '';
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  return error ? '' : blobToDataURL(data);
}
async function signedUrls(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return {};
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(list, 3600);
  const out = {};
  (data || []).forEach((d) => { if (d.signedUrl) out[d.path] = d.signedUrl; });
  return out;
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function toCSV(rows) {
  return rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
function attendanceCSV(att, nameById) {
  const rows = [['Date', 'Employee', 'User ID', 'Punch in', 'In location', 'Punch out', 'Out location', 'Hours']];
  att.forEach((a) => {
    const p = nameById[a.user_id] || {};
    rows.push([a.day, p.name, p.login_id, fmtTime(a.in_at), a.in_addr, a.out_at ? fmtTime(a.out_at) : '', a.out_addr,
      a.out_at ? ((new Date(a.out_at) - new Date(a.in_at)) / 3600000).toFixed(2) : '']);
  });
  return new Blob(['﻿' + toCSV(rows)], { type: 'text/csv;charset=utf-8' });
}

function friendlyError(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e || 'Something went wrong');
  if (/Invalid login credentials/i.test(m)) return 'Wrong login or password';
  if (/already registered|already exists/i.test(m)) return 'An account with this mobile / User ID already exists';
  if (/Email not confirmed/i.test(m)) return 'Login not active: turn off “Confirm email” in Supabase Auth settings';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'No internet connection. Try again.';
  if (/Password should be/i.test(m)) return 'Password must be at least 6 characters';
  if (/Database error saving new user/i.test(m)) return 'Could not create login — has supabase/schema.sql been run?';
  if (/relation .* does not exist|schema cache/i.test(m)) return 'Database not set up — run supabase/schema.sql in Supabase';
  return m;
}

// ---------------------------------------------------------------- icons
const P = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  building: '<path d="M4 21V5l8-2v18"/><path d="M12 9h8v12"/><path d="M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2"/><path d="M2 21h20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  doc: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h6"/>',
  docPlain: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7"/><path d="M18 14.8c1.8.7 3 2.5 3.5 5.2"/>',
  target: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  newDoc: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  upload: '<path d="M12 16V5"/><path d="M7 10l5-5 5 5"/><path d="M5 20h14"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  gallery: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 16l-5-5-9 9"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/>',
  csv: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="M12 11v6M9 14l3 3 3-3"/>',
};
function Icon({ n, s = 20, w = 2, style }) {
  return html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${w}
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style=${style} dangerouslySetInnerHTML=${{ __html: P[n] }}></svg>`;
}
const Spinner = () => html`<span class="spinner" aria-hidden="true"></span>`;

// ---------------------------------------------------------------- small components
function TopBar({ title, eyebrow, onBack, right }) {
  return html`<div class="topbar">
    ${onBack && html`<button type="button" class="icon-btn" aria-label="Back" onClick=${onBack}><${Icon} n="back" /></button>`}
    <div style="min-width:0;flex:1">
      ${eyebrow && html`<div class="eyebrow">${eyebrow}</div>`}
      <h1 class="h2" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</h1>
    </div>
    ${right}
  </div>`;
}

function Logo({ company, logoUrl, size = 44, radius = 12, font = 15 }) {
  return html`<div class="logo-box" style=${`width:${size}px;height:${size}px;border-radius:${radius}px;font-size:${font}px`}>
    ${logoUrl ? html`<img src=${logoUrl} alt="" />` : initialsOf(company?.name || 'Co')}
  </div>`;
}

function Chip({ label, tone }) {
  const t = tone || TONE[label] || TONE['Not punched in'];
  return html`<span class="chip" style=${`background:${t[1]};color:${t[0]}`}>${label}</span>`;
}

function BusyBtn({ busy, class: cls, children, ...rest }) {
  return html`<button type="button" class=${cls} disabled=${busy} ...${rest}>${busy ? html`<${Spinner} />` : children}</button>`;
}

function Field({ label, area, rows = 3, ...rest }) {
  return html`<label>${label}${area ? html`<textarea rows=${rows} ...${rest}></textarea>` : html`<input ...${rest} />`}</label>`;
}

// ---------------------------------------------------------------- map
function MapView({ pins, height = 190, labels = false }) {
  const el = useRef(null), map = useRef(null), layer = useRef(null), fitKey = useRef('');
  useEffect(() => {
    if (!window.L || !el.current) return;
    const m = window.L.map(el.current, { zoomControl: labels, attributionControl: true }).setView([22.6, 79.0], 4);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    layer.current = window.L.layerGroup().addTo(m);
    map.current = m;
    const t = setTimeout(() => m.invalidateSize(), 250);
    return () => { clearTimeout(t); m.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const m = map.current; if (!m) return;
    layer.current.clearLayers();
    const pts = [];
    pins.forEach((p) => {
      const hgt = labels ? 72 : 48;
      const icon = window.L.divIcon({
        className: '',
        html: `<div class="pin">${labels ? `<div class="tag">${esc(p.first)}</div>` : ''}<div class="dot" style="border-color:${p.color}">${esc(p.initials)}</div><div class="stem" style="background:${p.color}"></div></div>`,
        iconSize: [80, hgt], iconAnchor: [40, hgt],
      });
      window.L.marker([p.lat, p.lng], { icon }).addTo(layer.current)
        .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.status)} · ${esc(p.place)}<br><span style="color:#5B6675">${esc(p.time)}</span>`);
      pts.push([p.lat, p.lng]);
    });
    const key = pins.map((p) => p.id).sort().join('|');
    if (key !== fitKey.current) {
      fitKey.current = key;
      if (pts.length === 1) m.setView(pts[0], 14);
      else if (pts.length > 1) m.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
    }
  }, [pins]);
  if (!window.L) return html`<div class="map" style=${`height:${height}px;display:flex;align-items:center;justify-content:center`}><span class="muted">Map unavailable offline</span></div>`;
  return html`<div ref=${el} class="map" style=${`height:${height}px`}></div>`;
}

// ---------------------------------------------------------------- data hooks
function useCompanyData(me) {
  const [d, setD] = useState({ members: [], att: [], locs: [], reports: [], loaded: false });
  const timer = useRef(null);
  const load = useCallback(async () => {
    if (!me) return;
    const cid = me.company_id;
    const [p, a, l, r] = await Promise.all([
      sb.from('profiles').select('*').eq('company_id', cid).order('name'),
      sb.from('attendance').select('*').eq('company_id', cid).eq('day', dayKey()),
      sb.from('locations').select('*').eq('company_id', cid),
      sb.from('reports').select('*').eq('company_id', cid).order('created_at', { ascending: false }).limit(500),
    ]);
    setD({
      members: p.data || [], att: a.data || [], locs: l.data || [], reports: r.data || [], loaded: true,
      error: p.error || a.error || l.error || r.error, at: new Date(),
    });
  }, [me?.id]);

  useEffect(() => {
    if (!me) return;
    load();
    const soon = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 400); };
    const filter = `company_id=eq.${me.company_id}`;
    const ch = sb.channel(`fieldpro-${me.company_id}-${me.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations', filter }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', filter }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports', filter }, soon)
      .subscribe();
    const iv = setInterval(load, 60000);
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { sb.removeChannel(ch); clearInterval(iv); clearTimeout(timer.current); document.removeEventListener('visibilitychange', vis); };
  }, [me?.id]);
  return [d, load];
}

function memberView(m, att, loc) {
  let status;
  if (!m.active) status = 'Access removed';
  else if (!att) status = 'Not punched in';
  else if (att.out_at) status = 'Punched out';
  else if (!loc || Date.now() - new Date(loc.updated_at).getTime() > 20 * 60000) status = loc ? 'No signal' : 'On site';
  else status = loc.moving ? 'Travelling' : 'On site';
  const onDuty = att && !att.out_at && m.active;
  const place = onDuty ? (loc?.address || att?.in_addr || '—') : att?.out_at ? (att.out_addr || att.in_addr || '—') : '—';
  const time = onDuty ? (loc ? fmtTime(loc.updated_at) : fmtTime(att.in_at)) : att?.out_at ? fmtTime(att.out_at) : '—';
  const t = TONE[status];
  const lat = onDuty ? (loc?.lat ?? att.in_lat) : null, lng = onDuty ? (loc?.lng ?? att.in_lng) : null;
  return {
    ...m, att, loc, status, place, time, color: t[0], bg: t[1], live: !!onDuty,
    initials: initialsOf(m.name), first: firstName(m.name), lat, lng,
  };
}

function useTeam(d) {
  return useMemo(() => {
    const attBy = Object.fromEntries(d.att.map((a) => [a.user_id, a]));
    const locBy = Object.fromEntries(d.locs.map((l) => [l.user_id, l]));
    return d.members.filter((m) => m.role === 'employee').map((m) => memberView(m, attBy[m.id], locBy[m.id]));
  }, [d]);
}

// Sends the employee's position while they are on duty and the app is open.
function useTracker(me, active) {
  useEffect(() => {
    if (!active || !navigator.geolocation) return;
    let last = null, lastSent = 0, lastGeo = null, lastAddr = '';
    const send = async (c, force) => {
      const now = Date.now();
      const moved = last ? distM(last, c) : Infinity;
      if (!force && now - lastSent < 30000 && moved < 50) return;
      const moving = (c.speed != null && c.speed > 1.5) || (last && moved > 80 && now - lastSent < 180000);
      lastSent = now;
      if (!lastGeo || distM(lastGeo, c) > 150) {
        const g = await reverseGeocode(c.lat, c.lng);
        lastAddr = g.address || lastAddr; lastGeo = c;
      }
      last = c;
      await sb.from('locations').upsert({
        user_id: me.id, company_id: me.company_id, lat: c.lat, lng: c.lng, accuracy: c.acc,
        address: lastAddr, moving: !!moving, on_duty: true, updated_at: new Date().toISOString(),
      });
    };
    const toC = (p) => ({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, speed: p.coords.speed });
    const id = navigator.geolocation.watchPosition((p) => send(toC(p), false), () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
    const beat = setInterval(() => navigator.geolocation.getCurrentPosition((p) => send(toC(p), true), () => {}, { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 }), 5 * 60000);
    return () => { navigator.geolocation.clearWatch(id); clearInterval(beat); };
  }, [active, me?.id]);
}

// ================================================================ SCREENS

// ---------- Config missing
function NotConfigured() {
  return html`<div class="app"><div class="scroll pad" style="padding-top:64px">
    <h1 class="h1">FieldPro setup needed</h1>
    <div class="banner warn">Open <b>config.js</b> and paste your Supabase project's <b>anon / publishable key</b> into <code>SUPABASE_ANON_KEY</code>, then reload. See README.md for the full steps.</div>
  </div></div>`;
}

// ---------- Login
function Login({ ctx }) {
  const [tab, setTab] = useState('admin');
  const [mobile, setMobile] = useState('');
  const [userId, setUserId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e && e.preventDefault();
    const login = tab === 'admin' ? mobile.replace(/\D/g, '').slice(-10) : userId.trim().toLowerCase();
    if (!login || !pw) return ctx.flash(tab === 'admin' ? 'Enter mobile number and password' : 'Enter User ID and password', true);
    setBusy(true);
    const { error } = await sb.auth.signInWithPassword({ email: emailFor(login), password: pw });
    setBusy(false);
    if (error) ctx.flash(friendlyError(error), true);
  };
  return html`<div class="scroll" style="padding:64px 24px 32px;display:flex;flex-direction:column;gap:30px">
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="logo-box" style="width:56px;height:56px;border-radius:16px"><${Icon} n="pin" s=${28} /></div>
      <div>
        <h1 style="font-size:30px;font-weight:800;letter-spacing:-.02em">FieldPro</h1>
        <p class="muted" style="margin-top:6px;font-size:15px;line-height:1.5">Attendance, live tracking and service reports for your field team.</p>
      </div>
    </div>
    <div class="seg">
      <button type="button" class=${tab === 'admin' ? 'on' : ''} onClick=${() => setTab('admin')}>Admin / Owner</button>
      <button type="button" class=${tab === 'employee' ? 'on' : ''} onClick=${() => setTab('employee')}>Employee</button>
    </div>
    <form onSubmit=${submit} style="display:flex;flex-direction:column;gap:16px">
      ${tab === 'admin' ? html`
        <label>Mobile number
          <span class="row" style="gap:8px">
            <span style="min-height:48px;padding:0 14px;border:1px solid #D5DBE3;border-radius:12px;background:#fff;display:flex;align-items:center;font-weight:700">+91</span>
            <input type="tel" inputmode="numeric" autocomplete="username" value=${mobile} onInput=${(e) => setMobile(e.target.value)} placeholder="10-digit mobile number" />
          </span>
        </label>` : html`
        <${Field} label="User ID" type="text" autocapitalize="none" autocomplete="username" value=${userId} onInput=${(e) => setUserId(e.target.value)} placeholder="e.g. rahul.v" />`}
      <${Field} label="Password" type="password" autocomplete="current-password" value=${pw} onInput=${(e) => setPw(e.target.value)} placeholder=${tab === 'admin' ? 'Your password' : 'Password from your admin'} />
      <button type="submit" class="btn btn-dark" disabled=${busy}>${busy ? html`<${Spinner} />` : 'Log in'}</button>
      ${tab === 'admin'
        ? html`<button type="button" class="btn btn-line" onClick=${() => ctx.go('setup')}>New company? Register</button>`
        : html`<p class="muted" style="font-size:13px;line-height:1.5;text-align:center">Your User ID and password are created by your company admin.</p>`}
    </form>
  </div>`;
}

// ---------- Company setup (register or edit)
function CompanySetup({ ctx, editing }) {
  const c = editing ? ctx.company : {};
  const [f, setF] = useState({
    adminName: '', mobile: '', pw: '',
    name: c.name || '', address: c.address || '', phone: c.phone || '', email: c.email || '', gstin: c.gstin || '',
  });
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(editing ? ctx.logoUrl : '');
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsConfirmOff, setNeedsConfirmOff] = useState(false);
  const fileRef = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const pickLogo = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setLogoFile(file); setRemoveLogo(false);
    setLogoPreview(URL.createObjectURL(file));
  };

  const uploadLogo = async (cid) => {
    if (!logoFile) return null;
    const blob = await compressImage(logoFile, { max: 512, type: 'image/png' });
    const path = `${cid}/logo-${Date.now()}.png`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/png', upsert: true });
    if (error) throw error;
    return path;
  };

  const save = async () => {
    if (!f.name.trim()) return ctx.flash('Enter the business name', true);
    setBusy(true);
    try {
      if (editing) {
        const patch = { name: f.name.trim(), address: f.address.trim(), phone: f.phone.trim(), email: f.email.trim(), gstin: f.gstin.trim().toUpperCase() };
        const p = await uploadLogo(ctx.company.id);
        if (p) patch.logo_path = p;
        else if (removeLogo) patch.logo_path = null;
        const { error } = await sb.from('companies').update(patch).eq('id', ctx.company.id);
        if (error) throw error;
        await ctx.reloadMe();
        ctx.flash('Company profile saved');
        ctx.go('company', null, true);
      } else {
        const mobile = f.mobile.replace(/\D/g, '').slice(-10);
        if (!f.adminName.trim()) throw new Error('Enter your name');
        if (mobile.length !== 10) throw new Error('Enter a valid 10-digit mobile number');
        if (f.pw.length < 6) throw new Error('Password must be at least 6 characters');
        const { data, error } = await sb.auth.signUp({
          email: emailFor(mobile), password: f.pw,
          options: { data: {
            role: 'admin', login_id: mobile, name: f.adminName.trim(),
            company_name: f.name.trim(), company_address: f.address.trim(), company_phone: f.phone.trim(),
            company_email: f.email.trim(), company_gstin: f.gstin.trim().toUpperCase(),
          } },
        });
        if (error) throw error;
        if (!data.session) { setNeedsConfirmOff(true); throw new Error('Account created but not active yet — see the note above'); }
        if (logoFile) {
          const { data: prof } = await sb.from('profiles').select('company_id').eq('id', data.user.id).single();
          if (prof) {
            const p = await uploadLogo(prof.company_id);
            if (p) await sb.from('companies').update({ logo_path: p }).eq('id', prof.company_id);
          }
        }
        await ctx.reloadMe();
        ctx.flash('Company registered');
      }
    } catch (e) {
      ctx.flash(friendlyError(e), true);
    } finally {
      setBusy(false);
    }
  };

  return html`
    <${TopBar} eyebrow=${editing ? 'Edit details' : 'New company registration'} title="Company profile" onBack=${() => ctx.back()} />
    <div class="scroll pad-top">
      <p class="muted" style="font-size:14px;line-height:1.5">These details print in the header and footer of every PDF report.</p>
      ${needsConfirmOff && html`<div class="banner warn"><b>One-time Supabase setting needed:</b> Authentication → Sign In / Providers → Email → turn <b>off</b> “Confirm email”, then log in with your mobile and password.</div>`}
      <div class="card" style="padding:16px;display:flex;gap:16px;align-items:center">
        ${logoPreview && !removeLogo
          ? html`<div class="logo-box" style="width:72px;height:72px;border-radius:16px"><img src=${logoPreview} alt="Logo" /></div>`
          : html`<div style="width:72px;height:72px;border-radius:16px;border:2px dashed #B8C2CE;color:#5B6675;display:flex;align-items:center;justify-content:center;flex:none"><${Icon} n="upload" s=${24} /></div>`}
        <div style="display:flex;flex-direction:column;gap:2px">
          <div style="font-weight:700;font-size:15px">Company logo</div>
          <div class="muted" style="font-size:13px">PNG or JPG, square works best</div>
          <div class="row" style="gap:16px">
            <button type="button" class="link" onClick=${() => fileRef.current.click()}>${logoPreview && !removeLogo ? 'Change logo' : 'Upload logo'}</button>
            ${logoPreview && !removeLogo && html`<button type="button" class="link" style="color:#5B6675 !important" onClick=${() => { setRemoveLogo(true); setLogoFile(null); }}>Remove</button>`}
          </div>
          <input ref=${fileRef} type="file" accept="image/*" style="display:none" onChange=${pickLogo} />
        </div>
      </div>
      ${!editing && html`<div style="display:flex;flex-direction:column;gap:14px">
        <div class="eyebrow">Admin login</div>
        <${Field} label="Your name (admin)" value=${f.adminName} onInput=${set('adminName')} placeholder="Owner / admin name" />
        <${Field} label="Mobile number (for login)" type="tel" inputmode="numeric" value=${f.mobile} onInput=${set('mobile')} placeholder="10-digit mobile" />
        <${Field} label="Create password" type="password" autocomplete="new-password" value=${f.pw} onInput=${set('pw')} placeholder="At least 6 characters" />
        <div class="eyebrow" style="margin-top:8px">Company details</div>
      </div>`}
      <${Field} label="Business name" value=${f.name} onInput=${set('name')} placeholder="e.g. Apex Field Services" />
      <${Field} label="Address" area rows=${3} value=${f.address} onInput=${set('address')} placeholder="Office address" />
      <div class="grid2">
        <${Field} label="Contact number" type="tel" value=${f.phone} onInput=${set('phone')} />
        <${Field} label="Email" type="email" value=${f.email} onInput=${set('email')} />
      </div>
      <${Field} label="GSTIN / Tax ID" value=${f.gstin} onInput=${set('gstin')} style="text-transform:uppercase;letter-spacing:.04em" />
      <${BusyBtn} busy=${busy} class="btn btn-dark" onClick=${save}>${editing ? 'Save company profile' : 'Register company'}<//>
    </div>`;
}

// ---------- Admin home
function AdminHome({ ctx }) {
  const { d, team, company, logoUrl } = ctx;
  const pins = team.filter((m) => m.live && m.lat != null);
  const activity = team.filter((m) => m.att);
  return html`<div class="scroll pad" style="gap:18px">
    <div class="row between">
      <div class="row" style="min-width:0">
        <${Logo} company=${company} logoUrl=${logoUrl} />
        <div style="min-width:0">
          <div class="eyebrow">${todayLabel()}</div>
          <div style="font-size:18px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${company.name}</div>
        </div>
      </div>
      <button type="button" class="icon-btn" aria-label="Company profile" onClick=${() => ctx.go('company')}><${Icon} n="building" /></button>
    </div>
    ${d.error && html`<div class="banner err">Could not load data: ${d.error.message}. Did you run supabase/schema.sql?</div>`}
    <div class="grid2">
      <div class="card stat"><div class="muted l">Employees</div><div class="n">${team.length}</div></div>
      <div class="card stat"><div class="row l" style="gap:6px;color:${C.green}"><span style="width:8px;height:8px;border-radius:50%;background:${C.green}"></span>On duty</div><div class="n">${team.filter((m) => m.live).length}</div></div>
      <div class="card stat"><div class="muted l">Punched out</div><div class="n">${team.filter((m) => m.status === 'Punched out').length}</div></div>
      <div class="card stat"><div class="muted l">Reports today</div><div class="n">${d.reports.filter((r) => dayKey(new Date(r.created_at)) === dayKey()).length}</div></div>
    </div>
    ${d.loaded && team.length === 0 && html`<div class="banner ok">Welcome! Start by adding your first employee — they'll get a User ID and password to log in from their phone.</div>`}
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:12px">
      <div class="row between">
        <div style="font-size:16px;font-weight:800">Live team map</div>
        <button type="button" class="link" onClick=${() => ctx.go('track')}>Open tracking</button>
      </div>
      <${MapView} pins=${pins} height=${190} />
      <div class="row" style="gap:16px;font-size:12px;font-weight:600">
        <span class="row" style="gap:6px;color:${C.green}"><span style="width:10px;height:10px;border-radius:50%;border:3px solid ${C.green}"></span>On site</span>
        <span class="row" style="gap:6px;color:${C.orange}"><span style="width:10px;height:10px;border-radius:50%;border:3px solid ${C.orange}"></span>Travelling</span>
        <span class="muted" style="margin-left:auto">${pins.length} live</span>
      </div>
    </div>
    <div class="card" style="padding:6px 16px">
      <div style="font-size:16px;font-weight:800;padding:12px 0 8px">Today’s activity</div>
      ${activity.length === 0 && html`<div class="empty" style="border-top:1px solid #EEF1F5">No one has punched in yet today</div>`}
      ${activity.map((a) => html`<button type="button" key=${a.id} class="list-btn" onClick=${() => ctx.go('empDetail', { id: a.id })}>
        <div class="avatar" style="width:36px;height:36px;background:${a.bg};color:${a.color};font-size:12px">${a.initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700">${a.name}</div>
          <div class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.status} · ${a.place}</div>
        </div>
        <div class="muted" style="font-size:12px;font-weight:600">${a.time}</div>
      </button>`)}
    </div>
    <div class="grid2">
      <button type="button" class="btn btn-line" onClick=${() => ctx.go('addEmp')}><${Icon} n="plus" s=${18} w=${2.2} />Add employee</button>
      <button type="button" class="btn btn-line" onClick=${() => ctx.go('reports')}><${Icon} n="doc" s=${18} />All reports</button>
    </div>
  </div>`;
}

// ---------- Team
function Team({ ctx }) {
  const { team, d } = ctx;
  const [busy, setBusy] = useState(false);
  const exportMonth = async () => {
    setBusy(true);
    const now = new Date();
    const from = dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const { data, error } = await sb.from('attendance').select('*').eq('company_id', ctx.me.company_id).gte('day', from).order('day').order('in_at');
    setBusy(false);
    if (error) return ctx.flash(friendlyError(error), true);
    const byId = Object.fromEntries(d.members.map((m) => [m.id, m]));
    downloadBlob(attendanceCSV(data || [], byId), `attendance-${from.slice(0, 7)}.csv`);
    ctx.flash('Attendance exported');
  };
  return html`<div class="scroll pad" style="gap:14px">
    <div class="row between">
      <div>
        <h1 class="h1">Team</h1>
        <div class="muted" style="font-size:13px;font-weight:600">${team.length} employees · ${team.filter((m) => m.live).length} on duty</div>
      </div>
      <button type="button" class="btn btn-dark btn-sm" onClick=${() => ctx.go('addEmp')}><${Icon} n="plus" s=${16} w=${2.4} />Add</button>
    </div>
    <${BusyBtn} busy=${busy} class="btn btn-line btn-sm" style="width:100%" onClick=${exportMonth}><${Icon} n="csv" s=${18} />Export this month’s attendance (CSV)<//>
    ${d.loaded && team.length === 0 && html`<div class="empty">No employees yet. Tap “Add” to create a login.</div>`}
    ${team.map((m) => html`<button type="button" key=${m.id} class="card row" style="padding:14px 16px;width:100%;text-align:left" onClick=${() => ctx.go('empDetail', { id: m.id })}>
      <div class="avatar" style="width:44px;height:44px;background:#ECEFF3;font-size:14px">${m.initials}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:700">${m.name}</div>
        <div class="muted" style="font-size:12px">User ID: ${m.login_id}</div>
      </div>
      <${Chip} label=${m.status} />
    </button>`)}
  </div>`;
}

// ---------- Add employee
function AddEmployee({ ctx }) {
  const [f, setF] = useState({ name: '', phone: '', id: '', pw: '' });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const gen = () => setF({ ...f, pw: 'FP-' + Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('') + Math.floor(10 + Math.random() * 89) });

  const save = async () => {
    const name = f.name.trim();
    if (!name) return ctx.flash('Enter the employee’s name', true);
    const parts = name.toLowerCase().split(/\s+/);
    const id = (f.id.trim() || `${parts[0]}.${(parts[1] || 'x')[0]}`).toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!/^[a-z0-9._-]{3,30}$/.test(id) || /^\d+$/.test(id)) return ctx.flash('User ID: 3–30 letters/numbers, dots or dashes, not only digits', true);
    if (f.pw.length < 6) return ctx.flash('Password must be at least 6 characters', true);
    setBusy(true);
    try {
      const { data: free, error: e1 } = await sb.rpc('login_id_available', { p_login_id: id });
      if (e1) throw e1;
      if (!free) throw new Error(`User ID “${id}” is already taken — try another`);
      const token = crypto.randomUUID();
      const { error: e2 } = await sb.from('employee_invites').upsert({ login_id: id, company_id: ctx.me.company_id, name, phone: f.phone.trim(), token });
      if (e2) throw e2;
      // A second client so the admin stays logged in while creating the employee login.
      const tmp = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'fieldpro-tmp' } });
      const { data, error: e3 } = await tmp.auth.signUp({ email: emailFor(id), password: f.pw, options: { data: { role: 'employee', login_id: id, invite_token: token } } });
      if (e3) { await sb.from('employee_invites').delete().eq('login_id', id); throw e3; }
      if (data.session) await tmp.auth.signOut();
      setCreated({ id, pw: f.pw, name, confirmOn: !data.session });
      ctx.refresh();
    } catch (e) {
      ctx.flash(friendlyError(e), true);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const msg = `Hi ${firstName(created.name)}, your FieldPro login for ${ctx.company.name}:\nUser ID: ${created.id}\nPassword: ${created.pw}\nOpen ${location.origin + location.pathname} and choose the Employee tab.`;
    return html`<${TopBar} title="Login created" onBack=${() => ctx.go('team', null, true)} />
      <div class="scroll pad-top">
        ${created.confirmOn && html`<div class="banner warn">Supabase “Confirm email” is ON, so this login can’t sign in yet. Turn it off under Authentication → Sign In / Providers → Email.</div>`}
        <div class="card" style="padding:16px 16px 6px">
          <div style="font-size:18px;font-weight:800;margin-bottom:8px">${created.name}</div>
          <div class="kv"><span class="muted">User ID</span><span style="font-weight:800">${created.id}</span></div>
          <div class="kv"><span class="muted">Password</span><span style="font-weight:800;font-family:ui-monospace,monospace">${created.pw}</span></div>
        </div>
        <p class="muted" style="font-size:13px;line-height:1.5">Share these with the employee now — the password is not shown again.</p>
        <a class="btn btn-orange" style="text-decoration:none" href=${`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener"><${Icon} n="share" s=${18} />Share on WhatsApp</a>
        <button type="button" class="btn btn-line" onClick=${() => navigator.clipboard?.writeText(msg).then(() => ctx.flash('Copied'))}>Copy login details</button>
        <button type="button" class="btn btn-line" onClick=${() => { setCreated(null); setF({ name: '', phone: '', id: '', pw: '' }); }}>Add another employee</button>
      </div>`;
  }

  return html`<${TopBar} title="New employee login" onBack=${() => ctx.back()} />
    <div class="scroll pad-top">
      <${Field} label="Full name" value=${f.name} onInput=${set('name')} placeholder="Employee’s full name" />
      <${Field} label="Mobile number" type="tel" value=${f.phone} onInput=${set('phone')} placeholder="+91" />
      <${Field} label="User ID" autocapitalize="none" value=${f.id} onInput=${set('id')} placeholder="e.g. suresh.k (auto if empty)" />
      <label>Password
        <span class="row" style="gap:8px">
          <input type="text" value=${f.pw} onInput=${set('pw')} placeholder="Set a password" autocomplete="off" />
          <button type="button" class="btn btn-line" style="width:auto;padding:0 14px;min-height:48px;font-size:13px;flex:none" onClick=${gen}>Generate</button>
        </span>
      </label>
      <div class="card" style="padding:14px 16px;display:flex;flex-direction:column;gap:8px">
        <div class="eyebrow">Role & access</div>
        <div class="row between">
          <div>
            <div style="font-size:15px;font-weight:700">Field employee</div>
            <div class="muted" style="font-size:13px;line-height:1.45">Punch in/out, create & submit reports only</div>
          </div>
          <span class="avatar" style="width:26px;height:26px;background:${C.navy};color:#fff"><${Icon} n="check" s=${14} w=${3} /></span>
        </div>
      </div>
      <${BusyBtn} busy=${busy} class="btn btn-dark" onClick=${save}>Create login<//>
      <p class="muted" style="font-size:13px;text-align:center;line-height:1.5">Share the User ID and password with the employee. They log in from the Employee tab.</p>
    </div>`;
}

// ---------- Employee detail (admin)
function EmployeeDetail({ ctx, id }) {
  const m = ctx.team.find((t) => t.id === id);
  const [hist, setHist] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const from = new Date(); from.setDate(from.getDate() - 30);
    sb.from('attendance').select('*').eq('user_id', id).gte('day', dayKey(from)).order('day', { ascending: false })
      .then(({ data }) => setHist(data || []));
  }, [id, ctx.d.at]);
  if (!m) return html`<${TopBar} title="Employee" onBack=${() => ctx.back()} /><div class="empty">Employee not found</div>`;
  const reports = ctx.d.reports.filter((r) => r.employee_id === id);
  const toggleAccess = async () => {
    if (m.active && !confirm(`Remove ${m.name}'s access? They will no longer be able to use the app. You can restore it later.`)) return;
    setBusy(true);
    const { error } = await sb.from('profiles').update({ active: !m.active }).eq('id', id);
    setBusy(false);
    if (error) return ctx.flash(friendlyError(error), true);
    ctx.flash(m.active ? 'Access removed' : 'Access restored');
    ctx.refresh();
  };
  return html`<${TopBar} title=${m.name} onBack=${() => ctx.back()} right=${html`<${Chip} label=${m.status} />`} />
    <div class="scroll pad-top" style="gap:14px">
      <div class="card" style="padding:16px 16px 6px">
        <div class="kv" style="border-top:0"><span class="muted">User ID</span><span style="font-weight:700">${m.login_id}</span></div>
        <div class="kv"><span class="muted">Mobile</span><span style="font-weight:700">${m.phone ? html`<a href=${`tel:${m.phone}`}>${m.phone}</a>` : '—'}</span></div>
        <div class="kv"><span class="muted">Current place</span><span style="font-weight:700">${m.place}</span></div>
        <div class="kv"><span class="muted">Last update</span><span style="font-weight:700">${m.time}</span></div>
        <div class="kv"><span class="muted">Reports submitted</span><span style="font-weight:700">${reports.length}</span></div>
      </div>
      ${m.live && m.lat != null && html`<${MapView} pins=${[m]} height=${200} labels />`}
      <div class="card" style="padding:6px 16px">
        <div class="row between" style="padding:12px 0 8px">
          <div style="font-size:16px;font-weight:800">Attendance · last 30 days</div>
          ${hist && hist.length > 0 && html`<button type="button" class="link" onClick=${() => downloadBlob(attendanceCSV(hist, { [m.id]: m }), `attendance-${m.login_id}.csv`)}>CSV</button>`}
        </div>
        ${!hist && html`<div class="empty"><${Spinner} /></div>`}
        ${hist && hist.length === 0 && html`<div class="empty" style="border-top:1px solid #EEF1F5">No attendance yet</div>`}
        ${hist && hist.map((a) => html`<div key=${a.id} style="border-top:1px solid #EEF1F5;padding:10px 0">
          <div class="row between"><span style="font-weight:700;font-size:14px">${fmtDay(a.day + 'T00:00')}</span>
            <span class="muted" style="font-size:13px;font-weight:700">${fmtTime(a.in_at)} – ${a.out_at ? fmtTime(a.out_at) : 'on duty'}${a.out_at ? ` · ${fmtDur(new Date(a.out_at) - new Date(a.in_at))}` : ''}</span></div>
          <div class="muted" style="font-size:12px;margin-top:2px">${a.in_addr || fmtGps(a.in_lat, a.in_lng)}</div>
        </div>`)}
      </div>
      ${reports.length > 0 && html`<div class="card" style="padding:6px 16px">
        <div style="font-size:16px;font-weight:800;padding:12px 0 8px">Recent reports</div>
        ${reports.slice(0, 5).map((r) => html`<${ReportRow} key=${r.id} r=${r} onOpen=${() => ctx.go('detail', { id: r.id })} />`)}
      </div>`}
      <${BusyBtn} busy=${busy} class=${`btn btn-line ${m.active ? 'btn-danger' : ''}`} onClick=${toggleAccess}>${m.active ? 'Remove access' : 'Restore access'}<//>
    </div>`;
}

// ---------- Live tracking
function Track({ ctx }) {
  const { team, d } = ctx;
  const pins = team.filter((m) => m.live && m.lat != null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); await ctx.refresh(); setBusy(false); ctx.flash('Locations refreshed'); };
  return html`
    <div class="row between" style="padding:20px 20px 10px;flex:none">
      <div>
        <h1 class="h1">Live tracking</h1>
        <div class="muted" style="font-size:13px;font-weight:600">Last update ${d.at ? fmtTime(d.at) : '—'} · auto-refreshes</div>
      </div>
      <button type="button" class="icon-btn" aria-label="Refresh locations" onClick=${refresh} disabled=${busy}>${busy ? html`<${Spinner} />` : html`<${Icon} n="target" />`}</button>
    </div>
    <div class="scroll" style="padding:0 20px 24px;display:flex;flex-direction:column;gap:12px">
      <div style="flex:none"><${MapView} pins=${pins} height=${300} labels /></div>
      ${team.length === 0 && html`<div class="empty">No employees yet</div>`}
      ${team.map((m) => html`<button type="button" key=${m.id} class="card row" style="padding:12px 14px;align-items:flex-start;width:100%;text-align:left" onClick=${() => ctx.go('empDetail', { id: m.id })}>
        <span style="width:10px;height:10px;border-radius:50%;background:${m.color};margin-top:6px;flex:none"></span>
        <div style="flex:1;min-width:0">
          <div class="row between" style="gap:8px"><div style="font-size:15px;font-weight:700">${m.name}</div><div class="muted" style="font-size:12px;font-weight:600">${m.time}</div></div>
          <div style="font-size:13px;font-weight:700;color:${m.color}">${m.status}</div>
          <div class="muted" style="font-size:13px">${m.place}</div>
        </div>
      </button>`)}
      <p class="muted" style="font-size:12px;line-height:1.5;text-align:center">Locations update while employees have FieldPro open and are punched in.</p>
    </div>`;
}

// ---------- Reports list
function ReportRow({ r, onOpen }) {
  const t = TYPE_TONE[r.type];
  return html`<button type="button" class="list-btn" onClick=${onOpen}>
    <${Chip} label=${r.type} tone=${t} />
    <span style="flex:1;min-width:0;font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.customer}</span>
    <span class="muted" style="font-size:12px;font-weight:700">${r.code}</span>
  </button>`;
}

function Reports({ ctx, mine }) {
  const [filter, setFilter] = useState('All');
  const [q, setQ] = useState('');
  let list = ctx.d.reports;
  if (mine) list = list.filter((r) => r.employee_id === ctx.me.id);
  if (filter !== 'All') list = list.filter((r) => r.type === filter);
  if (q.trim()) {
    const s = q.trim().toLowerCase();
    list = list.filter((r) => [r.customer, r.code, r.employee_name, r.area, r.contact].some((v) => (v || '').toLowerCase().includes(s)));
  }
  return html`<div class="scroll pad" style="gap:14px">
    <div class="row between">
      <div>
        <div class="eyebrow">Service & inspection</div>
        <h1 class="h1">${mine ? 'My reports' : 'Reports'}</h1>
      </div>
      ${mine && html`<button type="button" class="btn btn-dark btn-sm" style="padding:0 16px" onClick=${() => ctx.go('newReport')}>New</button>`}
    </div>
    <div class="search"><${Icon} n="search" s=${18} /><input type="search" placeholder="Search customer, ID, employee…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
    <div class="chips">
      ${['All', 'Service', 'Inspection'].map((f) => html`<button type="button" key=${f} class=${filter === f ? 'on' : ''} onClick=${() => setFilter(f)}>${f}</button>`)}
    </div>
    ${ctx.d.loaded && list.length === 0 && html`<div class="empty">No reports ${q || filter !== 'All' ? 'match' : 'yet'}</div>`}
    ${list.map((r) => {
      const t = TYPE_TONE[r.type];
      return html`<button type="button" key=${r.id} class="card" style="text-align:left;padding:14px 16px;display:flex;flex-direction:column;gap:8px;width:100%" onClick=${() => ctx.go('detail', { id: r.id })}>
        <span class="row" style="gap:8px;width:100%">
          <${Chip} label=${r.type} tone=${t} />
          <span class="muted" style="font-size:12px;font-weight:700">${r.code}</span>
          <span class="muted" style="font-size:12px;margin-left:auto">${fmtDateTime(r.created_at)}</span>
        </span>
        <span style="font-size:16px;font-weight:800">${r.customer}</span>
        <span class="muted" style="font-size:13px">${mine ? r.area || r.address : `${r.employee_name} · ${r.area || r.address}`}</span>
      </button>`;
    })}
  </div>`;
}

// ---------- Report detail
function ReportDetail({ ctx, id }) {
  const r = ctx.d.reports.find((x) => x.id === id);
  const [urls, setUrls] = useState({});
  const [viewer, setViewer] = useState(null);
  useEffect(() => {
    if (r) signedUrls([...(r.photos || []), r.signature_path]).then(setUrls);
  }, [r?.id]);
  if (!r) return html`<${TopBar} title="Report" onBack=${() => ctx.back()} /><div class="empty">${ctx.d.loaded ? 'Report not found' : html`<${Spinner} />`}</div>`;
  const t = TYPE_TONE[r.type];
  return html`<${TopBar} title=${r.code} onBack=${() => ctx.back()} right=${html`<${Chip} label=${r.type} tone=${t} />`} />
    <div class="scroll pad-top" style="gap:14px">
      <div class="card" style="padding:16px 16px 6px">
        <div style="font-size:20px;font-weight:800">${r.customer}</div>
        <div class="muted" style="font-size:13px;margin-bottom:8px">Contact: ${r.contact || '—'}</div>
        <div class="kv"><span class="muted">Employee</span><span style="font-weight:700">${r.employee_name}</span></div>
        <div class="kv"><span class="muted">Submitted</span><span style="font-weight:700">${fmtDateTime(r.created_at)}</span></div>
        <div class="kv"><span class="muted">Status</span><${Chip} label=${r.status} tone=${TONE['On site']} /></div>
      </div>
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <div class="eyebrow">GPS location tag</div>
        <div class="row" style="align-items:flex-start">
          <span style="width:36px;height:36px;border-radius:10px;background:#FDEDE3;color:${C.orange};display:flex;align-items:center;justify-content:center;flex:none"><${Icon} n="pin" s=${18} /></span>
          <div style="min-width:0">
            <div style="font-size:14px;font-weight:700;line-height:1.4">${r.address || '—'}</div>
            <div class="muted" style="font-size:12px;font-family:ui-monospace,monospace;margin-top:2px">${fmtGps(r.lat, r.lng)}${r.accuracy ? ` · ±${Math.round(r.accuracy)} m` : ''}</div>
            ${r.lat != null && html`<a href=${mapsLink(r.lat, r.lng)} target="_blank" rel="noopener" style="font-size:13px;font-weight:700">Open in Maps</a>`}
          </div>
        </div>
      </div>
      ${r.type === 'Service' ? html`<div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="eyebrow">Service details</div>
        <div><div class="muted" style="font-size:12px;font-weight:700">Problem reported</div><div style="font-size:14px;line-height:1.5;white-space:pre-wrap">${r.issue || '—'}</div></div>
        <div><div class="muted" style="font-size:12px;font-weight:700">Work done</div><div style="font-size:14px;line-height:1.5;white-space:pre-wrap">${r.work || '—'}</div></div>
        <div><div class="muted" style="font-size:12px;font-weight:700">Notes</div><div style="font-size:14px;line-height:1.5;white-space:pre-wrap">${r.notes || '—'}</div></div>
      </div>` : html`<div class="card" style="padding:16px 16px 6px">
        <div class="eyebrow" style="margin-bottom:6px">Inspection checklist</div>
        ${(r.items || []).map((it, i) => html`<div class="kv" key=${i}><span>${it.label}</span><span style="font-weight:800;color:${it.ok ? C.green : C.red}">${it.ok ? 'OK' : 'Issue'}</span></div>`)}
        <div class="kv"><span class="muted">Notes</span><span style="white-space:pre-wrap">${r.notes || '—'}</span></div>
      </div>`}
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <div class="eyebrow">Site photos (${(r.photos || []).length})</div>
        ${(r.photos || []).length === 0 && html`<div class="muted" style="font-size:14px">No photos attached</div>`}
        <div class="photo-grid three">
          ${(r.photos || []).map((p) => html`<button type="button" key=${p} class="tile" style="border:0;padding:0" onClick=${() => urls[p] && setViewer(urls[p])}>${urls[p] ? html`<img src=${urls[p]} alt="Site photo" />` : ''}</button>`)}
        </div>
      </div>
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <div class="eyebrow">Customer signature</div>
        ${r.signature_path
          ? html`<div style="height:100px;border-radius:10px;background:#F7F9FB;border:1px solid #EEF1F5;display:flex;align-items:center;justify-content:center">${urls[r.signature_path] && html`<img src=${urls[r.signature_path]} alt="Customer signature" style="max-height:90px;max-width:100%" />`}</div>`
          : html`<div class="muted" style="font-size:14px">Not signed</div>`}
      </div>
      <button type="button" class="btn btn-dark" onClick=${() => ctx.go('pdf', { id: r.id })}><${Icon} n="docPlain" s=${18} />Generate PDF</button>
    </div>
    ${viewer && html`<div class="overlay" style="align-items:center;justify-content:center;background:rgba(0,0,0,.85)" onClick=${() => setViewer(null)}>
      <img src=${viewer} alt="Site photo" style="max-width:100%;max-height:100%" />
    </div>`}`;
}

// ---------- PDF
function PdfDoc({ r, company, logo, photos, sig, docRef }) {
  const cell = (k, v) => html`<div><div class="muted">${k}</div><div style="font-weight:700">${v || '—'}</div></div>`;
  return html`<div class="pdf-doc" ref=${docRef}>
    <div style="display:flex;align-items:flex-start;gap:16px">
      <div class="logo-box" style="width:64px;height:64px;border-radius:12px;font-size:22px">${logo ? html`<img src=${logo} alt="" />` : initialsOf(company.name)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:22px;font-weight:800">${company.name}</div>
        <div class="muted">${company.address}</div>
        <div class="muted">${[company.phone, company.email].filter(Boolean).join(' · ')}</div>
      </div>
      ${company.gstin && html`<div style="text-align:right"><div class="muted" style="font-weight:700">GSTIN</div><div style="font-weight:800">${company.gstin}</div></div>`}
    </div>
    <div style="height:3px;background:#13233A;margin:18px 0"></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
      <div style="font-size:18px;font-weight:800;text-transform:uppercase;letter-spacing:.04em">${r.type} Report</div>
      <div style="text-align:right"><div style="font-weight:800;font-size:15px">${r.code}</div><div class="muted">${fmtDateTime(r.created_at)}</div></div>
    </div>
    <div class="grid">
      ${cell('Customer', r.customer)}${cell('Contact', r.contact)}
      ${cell('Technician', r.employee_name)}${cell('Status', r.status)}
      ${cell('Site address', r.address)}${cell('GPS', fmtGps(r.lat, r.lng))}
    </div>
    ${r.type === 'Service' ? html`<div style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
      <div><b>Problem reported: </b><span style="white-space:pre-wrap">${r.issue || '—'}</span></div>
      <div><b>Work done: </b><span style="white-space:pre-wrap">${r.work || '—'}</span></div>
      <div><b>Notes: </b><span style="white-space:pre-wrap">${r.notes || '—'}</span></div>
    </div>` : html`<div style="margin-top:16px">
      <div style="font-weight:800;margin-bottom:6px">Inspection checklist</div>
      ${(r.items || []).map((it, i) => html`<div class="ck" key=${i}><span>${it.label}</span><span style="font-weight:800;color:${it.ok ? C.green : C.red}">${it.ok ? 'OK' : 'Issue'}</span></div>`)}
      <div style="margin-top:8px"><b>Notes: </b><span style="white-space:pre-wrap">${r.notes || '—'}</span></div>
    </div>`}
    ${photos.length > 0 && html`<div class="photos">${photos.map((p, i) => html`<img key=${i} src=${p} alt="" />`)}</div>`}
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px">
      <div class="muted">Report generated on FieldPro</div>
      <div style="text-align:center">
        ${sig ? html`<img src=${sig} alt="" style="height:60px;max-width:200px;display:block;margin:0 auto 2px" />` : html`<div style="height:60px"></div>`}
        <div style="border-top:1px solid #13233A;padding-top:3px;width:200px;font-weight:700">Customer signature</div>
      </div>
    </div>
    <div class="muted" style="border-top:1px solid #E3E8EE;margin-top:20px;padding-top:8px;display:flex;justify-content:space-between;font-size:11px">
      <span>${company.name}${company.gstin ? ` · GSTIN ${company.gstin}` : ''}</span><span>${r.code}</span>
    </div>
  </div>`;
}

async function makePdfBlob(srcEl) {
  const clone = srcEl.cloneNode(true);
  clone.style.transform = 'none';
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#fff';
  holder.appendChild(clone);
  document.body.appendChild(holder);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    return await window.html2pdf().set({
      margin: [8, 8, 8, 8], image: { type: 'jpeg', quality: 0.92 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(clone).outputPdf('blob');
  } finally {
    holder.remove();
  }
}

function PdfView({ ctx, id }) {
  const r = ctx.d.reports.find((x) => x.id === id);
  const [assets, setAssets] = useState(null);
  const [busy, setBusy] = useState('');
  const wrap = useRef(null), doc = useRef(null);
  const [scale, setScale] = useState(0.45), [hgt, setHgt] = useState(500);
  useEffect(() => {
    if (!r) return;
    (async () => {
      const [logo, sig, ...photos] = await Promise.all([
        storageDataURL(ctx.company.logo_path), storageDataURL(r.signature_path), ...(r.photos || []).map(storageDataURL),
      ]);
      setAssets({ logo, sig, photos: photos.filter(Boolean) });
    })();
  }, [r?.id]);
  useEffect(() => {
    if (!assets || !wrap.current || !doc.current) return;
    const fit = () => {
      if (!wrap.current || !doc.current) return;
      const s = wrap.current.clientWidth / 760;
      setScale(s); setHgt(doc.current.offsetHeight * s);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(wrap.current); ro.observe(doc.current); fit();
    return () => ro.disconnect();
  }, [assets]);
  if (!r) return html`<${TopBar} title="PDF preview" onBack=${() => ctx.back()} /><div class="empty">Report not found</div>`;
  const name = `${r.code}.pdf`;
  const download = async () => {
    if (!window.html2pdf) return ctx.flash('PDF tool not loaded — check internet', true);
    setBusy('dl');
    try { downloadBlob(await makePdfBlob(doc.current), name); ctx.flash(`${name} downloaded`); }
    catch (e) { ctx.flash(friendlyError(e), true); }
    setBusy('');
  };
  const share = async () => {
    setBusy('share');
    try {
      const blob = window.html2pdf ? await makePdfBlob(doc.current) : null;
      const file = blob && new File([blob], name, { type: 'application/pdf' });
      const text = `${r.type} report ${r.code} — ${r.customer} (${ctx.company.name})`;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name, text });
      } else {
        if (blob) downloadBlob(blob, name);
        window.open(`https://wa.me/?text=${encodeURIComponent(text + ' — PDF downloaded on this device, attach it in the chat.')}`, '_blank');
      }
    } catch (e) {
      if (e && e.name !== 'AbortError') ctx.flash(friendlyError(e), true);
    }
    setBusy('');
  };
  return html`<${TopBar} title="PDF preview" onBack=${() => ctx.back()} right=${html`<span class="muted" style="font-size:13px;font-weight:700">${name}</span>`} />
    <div class="scroll" style="padding:8px 16px 20px;display:flex;flex-direction:column;gap:14px">
      <div ref=${wrap} class="pdf-wrap" style=${`height:${assets ? hgt : 300}px`}>
        ${assets
          ? html`<div style=${`transform:scale(${scale});transform-origin:top left;width:760px`}><${PdfDoc} r=${r} company=${ctx.company} logo=${assets.logo} photos=${assets.photos} sig=${assets.sig} docRef=${doc} /></div>`
          : html`<div class="empty" style="padding-top:120px"><${Spinner} /></div>`}
      </div>
      <${BusyBtn} busy=${busy === 'dl'} class="btn btn-orange" onClick=${download} disabled=${!assets || !!busy}><${Icon} n="download" s=${18} />Download PDF<//>
      <${BusyBtn} busy=${busy === 'share'} class="btn btn-line" onClick=${share} disabled=${!assets || !!busy}><${Icon} n="share" s=${18} />Share on WhatsApp / Email<//>
    </div>`;
}

// ---------- Company (admin)
function Company({ ctx }) {
  const { company, logoUrl, me } = ctx;
  const latest = ctx.d.reports[0];
  return html`<div class="scroll pad" style="gap:14px">
    <h1 class="h1">Company</h1>
    <div class="card" style="padding:18px 16px 6px">
      <div class="row" style="align-items:flex-start;margin-bottom:10px">
        <${Logo} company=${company} logoUrl=${logoUrl} size=${60} radius=${14} font=${20} />
        <div><div style="font-size:18px;font-weight:800">${company.name}</div><div class="muted" style="font-size:13px;line-height:1.45">${company.address || '—'}</div></div>
      </div>
      <div class="kv"><span class="muted">Contact</span><span style="font-weight:700">${company.phone || '—'}</span></div>
      <div class="kv"><span class="muted">Email</span><span style="font-weight:700">${company.email || '—'}</span></div>
      <div class="kv"><span class="muted">GSTIN</span><span style="font-weight:700">${company.gstin || '—'}</span></div>
      <div class="kv"><span class="muted">Admin</span><span style="font-weight:700">${me.name}</span></div>
      <div class="kv"><span class="muted">Admin login</span><span style="font-weight:700">+91 ${me.login_id}</span></div>
    </div>
    <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:6px">
      <div style="font-size:15px;font-weight:800">Branding on PDF reports</div>
      <div class="muted" style="font-size:13px;line-height:1.5">Logo, name and address print in the header. GSTIN and contact print in the footer of every report.</div>
      <button type="button" class="link" style="align-self:flex-start" onClick=${() => (latest ? ctx.go('pdf', { id: latest.id }) : ctx.flash('No reports yet — preview appears after the first report', true))}>Preview latest report PDF</button>
    </div>
    <button type="button" class="btn btn-line" onClick=${() => ctx.go('editCompany')}>Edit company profile</button>
    <button type="button" class="btn btn-line btn-danger" onClick=${ctx.logout}><${Icon} n="logout" s=${18} />Log out</button>
  </div>`;
}

// ---------- Employee home
function EmpHome({ ctx }) {
  const { me, d } = ctx;
  const att = d.att.find((a) => a.user_id === me.id);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  const mine = d.reports.filter((r) => r.employee_id === me.id);
  const loc = d.locs.find((l) => l.user_id === me.id);

  const punchIn = async () => {
    setBusy(true);
    try {
      const p = await locate();
      const { error } = await sb.from('attendance').insert({
        company_id: me.company_id, user_id: me.id, day: dayKey(),
        in_lat: p.lat, in_lng: p.lng, in_acc: p.acc, in_addr: p.address,
      });
      if (error) throw error;
      await sb.from('locations').upsert({ user_id: me.id, company_id: me.company_id, lat: p.lat, lng: p.lng, accuracy: p.acc, address: p.address, moving: false, on_duty: true, updated_at: new Date().toISOString() });
      await ctx.refresh();
      ctx.flash('Punched in · GPS location captured');
    } catch (e) { ctx.flash(friendlyError(e), true); }
    setBusy(false);
  };
  const punchOut = async () => {
    if (!confirm('Punch out for today?')) return;
    setBusy(true);
    try {
      const p = await locate();
      const { error } = await sb.from('attendance').update({ out_at: new Date().toISOString(), out_lat: p.lat, out_lng: p.lng, out_acc: p.acc, out_addr: p.address }).eq('id', att.id);
      if (error) throw error;
      await sb.from('locations').upsert({ user_id: me.id, company_id: me.company_id, lat: p.lat, lng: p.lng, accuracy: p.acc, address: p.address, moving: false, on_duty: false, updated_at: new Date().toISOString() });
      await ctx.refresh();
      ctx.flash('Punched out · location saved');
    } catch (e) { ctx.flash(friendlyError(e), true); }
    setBusy(false);
  };

  const duty = !att ? ['Not punched in', C.orange, '#FDEDE3'] : att.out_at ? ['Day complete', C.grey, '#ECEFF3'] : ['On duty', C.green, '#E3F4E8'];
  const here = loc && att && !att.out_at ? loc : att ? { address: att.in_addr, lat: att.in_lat, lng: att.in_lng, accuracy: att.in_acc } : null;
  return html`<div class="scroll pad">
    <div class="row between">
      <div class="row">
        <div class="avatar" style="width:44px;height:44px;background:${C.navy};color:#fff;font-size:14px">${initialsOf(me.name)}</div>
        <div><div class="eyebrow">${todayLabel()}</div><div style="font-size:20px;font-weight:800">Hi, ${firstName(me.name)}</div></div>
      </div>
      <${Chip} label=${duty[0]} tone=${[duty[1], duty[2]]} />
    </div>
    <div class="card" style="padding:20px;display:flex;flex-direction:column;gap:14px">
      ${!d.loaded ? html`<div class="empty"><${Spinner} /></div>` : !att ? html`
        <div style="display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center">
          <div class="eyebrow">Attendance</div>
          <div style="font-size:16px;font-weight:700">You haven’t punched in today</div>
          <button type="button" class="punch" onClick=${punchIn} disabled=${busy}>
            ${busy ? html`<${Spinner} />` : html`<${Icon} n="clock" s=${30} w=${2.2} />`}${busy ? 'Locating…' : 'Punch In'}
          </button>
          <div class="muted" style="font-size:13px;line-height:1.5">GPS location, address and time are captured automatically.</div>
        </div>` : !att.out_at ? html`
        <div class="row between">
          <div><div class="eyebrow">Punched in at</div><div style="font-size:30px;font-weight:800;letter-spacing:-.02em">${fmtTime(att.in_at)}</div>
            <div class="muted" style="font-size:13px;font-weight:600">On duty ${fmtDur(Date.now() - new Date(att.in_at))}</div></div>
          <span class="row" style="gap:6px;font-size:13px;font-weight:700;color:${C.green}"><span style="width:8px;height:8px;border-radius:50%;background:${C.green}"></span>Live tracking on</span>
        </div>
        <div class="row" style="align-items:flex-start;background:#F7F9FB;border-radius:12px;padding:12px">
          <span style="width:34px;height:34px;border-radius:10px;background:#FDEDE3;color:${C.orange};display:flex;align-items:center;justify-content:center;flex:none"><${Icon} n="pin" s=${18} /></span>
          <div style="min-width:0"><div style="font-size:14px;font-weight:700;line-height:1.4">${here?.address || '—'}</div>
            <div class="muted" style="font-size:12px;font-family:ui-monospace,monospace">${fmtGps(here?.lat, here?.lng)}${here?.accuracy ? ` · ±${Math.round(here.accuracy)} m` : ''}</div></div>
        </div>
        <div class="muted" style="font-size:12px;line-height:1.45">Keep FieldPro open (screen can be off on most phones) so your admin sees your live location.</div>
        <${BusyBtn} busy=${busy} class="btn btn-line" style="color:${C.orange};border-color:#F3C7AE" onClick=${punchOut}>Punch Out<//>` : html`
        <div class="eyebrow">Today’s attendance</div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
          <div class="mini"><div class="muted" style="font-size:12px;font-weight:700">In</div><div style="font-size:16px;font-weight:800">${fmtTime(att.in_at)}</div></div>
          <div class="mini"><div class="muted" style="font-size:12px;font-weight:700">Out</div><div style="font-size:16px;font-weight:800">${fmtTime(att.out_at)}</div></div>
          <div class="mini"><div class="muted" style="font-size:12px;font-weight:700">Duration</div><div style="font-size:16px;font-weight:800">${fmtDur(new Date(att.out_at) - new Date(att.in_at))}</div></div>
        </div>
        <div class="muted" style="font-size:13px">Both punches saved with GPS location.</div>`}
    </div>
    <div class="grid2">
      <button type="button" class="btn btn-dark" onClick=${() => ctx.go('newReport')}><${Icon} n="plus" s=${18} w=${2.4} />New report</button>
      <button type="button" class="btn btn-line" onClick=${() => ctx.go('myReports')}>My reports</button>
    </div>
    <div class="card" style="padding:6px 16px">
      <div style="font-size:16px;font-weight:800;padding:12px 0 8px">Recent reports</div>
      ${mine.length === 0 && html`<div class="empty" style="border-top:1px solid #EEF1F5">No reports yet</div>`}
      ${mine.slice(0, 3).map((r) => html`<${ReportRow} key=${r.id} r=${r} onOpen=${() => ctx.go('detail', { id: r.id })} />`)}
    </div>
  </div>`;
}

// ---------- Signature pad
function SignaturePad({ api, onInk }) {
  const cv = useRef(null);
  useEffect(() => {
    const c = cv.current;
    const ratio = window.devicePixelRatio || 1;
    let drawing = false, ink = false, last = null;
    const setup = () => {
      const r = c.getBoundingClientRect();
      c.width = Math.round(r.width * ratio); c.height = Math.round(r.height * ratio);
      const x = c.getContext('2d');
      x.setTransform(ratio, 0, 0, ratio, 0, 0);
      x.lineWidth = 2.4; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#13233A';
    };
    setup();
    const pt = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const down = (e) => { e.preventDefault(); c.setPointerCapture(e.pointerId); drawing = true; last = pt(e); };
    const move = (e) => {
      if (!drawing) return;
      e.preventDefault();
      const p = pt(e), x = c.getContext('2d');
      x.beginPath(); x.moveTo(last[0], last[1]); x.lineTo(p[0], p[1]); x.stroke();
      last = p;
      if (!ink) { ink = true; onInk(true); }
    };
    const up = () => { drawing = false; };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    api.current = {
      clear() { c.getContext('2d').clearRect(0, 0, c.width, c.height); ink = false; onInk(false); },
      blob() { return new Promise((res) => c.toBlob(res, 'image/png')); },
    };
    return () => {
      c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
    };
  }, []);
  return html`<canvas ref=${cv} class="sig" aria-label="Signature area"></canvas>`;
}

// ---------- New report
function NewReport({ ctx }) {
  const { me } = ctx;
  const [type, setType] = useState('Service');
  const [f, setF] = useState({ customer: '', contact: '', issue: '', work: '', notes: '' });
  const [checks, setChecks] = useState(DEFAULT_CHECKS.map((label) => ({ label, ok: true })));
  const [newCheck, setNewCheck] = useState('');
  const [photos, setPhotos] = useState([]); // {blob, url}
  const [hasSig, setHasSig] = useState(false);
  const [loc, setLoc] = useState(null);
  const [locErr, setLocErr] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const sig = useRef(null), camRef = useRef(null), galRef = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const refreshLoc = async () => {
    setLocBusy(true); setLocErr('');
    try { setLoc(await locate()); } catch (e) { setLocErr(e.message); }
    setLocBusy(false);
  };
  useEffect(() => { refreshLoc(); return () => photos.forEach((p) => URL.revokeObjectURL(p.url)); }, []);

  const addPhotos = (fromGallery) => async (e) => {
    const files = Array.from(e.target.files || []).filter((f) => /^image\//.test(f.type) || !f.type).slice(0, 4 - photos.length);
    e.target.value = '';
    if (!files.length) return;
    const now = new Date().toLocaleString('en-IN');
    const where = [loc ? fmtGps(loc.lat, loc.lng) : 'GPS unavailable', loc?.area || ''].filter(Boolean);
    const next = [];
    try {
      for (const file of files) {
        // Gallery photos are marked as such, so the stamp never claims they were taken on site just now.
        const stamp = fromGallery ? [`From gallery · added ${now}`, ...where] : [now, ...where];
        const blob = await compressImage(file, { max: 1600, stamp });
        if (blob) next.push({ blob, url: URL.createObjectURL(blob) });
      }
    } catch {
      ctx.flash('Could not read that photo. Try another one.', true);
    }
    if (!next.length) return;
    setPhotos((p) => p.concat(next).slice(0, 4));
    ctx.flash(fromGallery
      ? `${next.length} photo${next.length > 1 ? 's' : ''} added from gallery`
      : next.length > 1 ? `${next.length} photos added with GPS stamp` : 'Photo captured with GPS stamp');
  };

  const submit = async () => {
    if (!f.customer.trim()) return ctx.flash('Add the customer / site name', true);
    if (!loc && !confirm('GPS location is not available. Submit without a location tag?')) return;
    setBusy(true);
    try {
      const rid = crypto.randomUUID();
      const base = `${me.company_id}/reports/${rid}`;
      const { data: code, error: ce } = await sb.rpc('next_report_code', { p_type: type });
      if (ce) throw ce;
      const paths = [];
      for (let i = 0; i < photos.length; i++) {
        const path = `${base}/photo-${i + 1}.jpg`;
        const { error } = await sb.storage.from(BUCKET).upload(path, photos[i].blob, { contentType: 'image/jpeg' });
        if (error) throw error;
        paths.push(path);
      }
      let sigPath = null;
      if (hasSig && sig.current) {
        const b = await sig.current.blob();
        sigPath = `${base}/signature.png`;
        const { error } = await sb.storage.from(BUCKET).upload(sigPath, b, { contentType: 'image/png' });
        if (error) throw error;
      }
      const { error } = await sb.from('reports').insert({
        id: rid, company_id: me.company_id, code, type,
        customer: f.customer.trim(), contact: f.contact.trim(),
        issue: type === 'Service' ? f.issue.trim() : '', work: type === 'Service' ? f.work.trim() : '', notes: f.notes.trim(),
        items: type === 'Inspection' ? checks : [], photos: paths, signature_path: sigPath,
        lat: loc?.lat ?? null, lng: loc?.lng ?? null, accuracy: loc?.acc ?? null, address: loc?.address || '', area: loc?.area || '',
        employee_id: me.id, employee_name: me.name,
      });
      if (error) throw error;
      await ctx.refresh();
      ctx.go('success', { id: rid }, true);
    } catch (e) {
      ctx.flash(friendlyError(e), true);
    }
    setBusy(false);
  };

  return html`<${TopBar} title="New report" onBack=${() => ctx.back()} />
    <div class="scroll pad-top">
      <div class="seg">
        <button type="button" class=${type === 'Service' ? 'on' : ''} onClick=${() => setType('Service')}>Service</button>
        <button type="button" class=${type === 'Inspection' ? 'on' : ''} onClick=${() => setType('Inspection')}>Inspection</button>
      </div>
      <div class=${`row banner ${loc ? 'ok' : locErr ? 'err' : 'warn'}`} style="align-items:flex-start">
        <${Icon} n="pin" s=${20} style="flex:none;margin-top:2px" />
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:800">${locBusy ? 'Getting location…' : loc ? 'Location tagged' : 'Location not available'}</div>
          <div style="font-size:12px;line-height:1.45">${loc ? `${loc.address} · ${fmtGps(loc.lat, loc.lng)}` : locErr || 'Waiting for GPS…'}</div>
        </div>
        <button type="button" onClick=${refreshLoc} disabled=${locBusy} style="background:none;border:0;font-weight:800;font-size:13px;min-height:36px;text-decoration:underline">Refresh</button>
      </div>
      <${Field} label="Customer / site name" value=${f.customer} onInput=${set('customer')} placeholder="e.g. Metro Cold Storage" />
      <${Field} label="Customer contact" value=${f.contact} onInput=${set('contact')} placeholder="Name or phone number" />
      ${type === 'Service' ? html`<div style="display:flex;flex-direction:column;gap:16px">
        <${Field} label="Problem reported" area rows=${2} value=${f.issue} onInput=${set('issue')} placeholder="What did the customer report?" />
        <${Field} label="Work done" area rows=${3} value=${f.work} onInput=${set('work')} placeholder="Parts replaced, tests done…" />
      </div>` : html`<div class="card" style="padding:6px 14px 12px">
        <div class="eyebrow" style="padding:10px 0 4px">Checklist · tap to mark</div>
        ${checks.map((c, i) => html`<div class="row between" key=${i} style="border-top:1px solid #EEF1F5;padding:6px 0">
          <span style="font-size:14px;font-weight:600">${c.label}</span>
          <button type="button" onClick=${() => setChecks(checks.map((x, j) => (j === i ? { ...x, ok: !x.ok } : x)))}
            style=${`min-width:72px;min-height:40px;border-radius:10px;border:0;font-weight:800;font-size:13px;background:${c.ok ? '#E3F4E8' : '#FDE8E8'};color:${c.ok ? C.green : C.red}`}>${c.ok ? 'OK' : 'Issue'}</button>
        </div>`)}
        <div class="row" style="gap:8px;border-top:1px solid #EEF1F5;padding-top:10px">
          <input value=${newCheck} onInput=${(e) => setNewCheck(e.target.value)} placeholder="Add checklist item" />
          <button type="button" class="btn btn-line" style="width:auto;flex:none;min-height:48px" onClick=${() => { if (newCheck.trim()) { setChecks(checks.concat([{ label: newCheck.trim(), ok: true }])); setNewCheck(''); } }}>Add</button>
        </div>
      </div>`}
      <${Field} label="Notes" area rows=${2} value=${f.notes} onInput=${set('notes')} placeholder="Anything else for the report" />
      <div style="display:flex;flex-direction:column;gap:8px">
        <div class="eyebrow">Site photos (${photos.length}/4)</div>
        <div class="photo-grid">
          ${photos.map((p, i) => html`<div class="tile" key=${p.url}><img src=${p.url} alt=${`Photo ${i + 1}`} />
            <button type="button" class="x" aria-label="Remove photo" onClick=${() => { URL.revokeObjectURL(p.url); setPhotos(photos.filter((_, j) => j !== i)); }}>×</button></div>`)}
          ${photos.length < 4 && html`
            <button type="button" class="add-tile" aria-label="Take photo with camera" onClick=${() => camRef.current.click()}><span class="add-in"><${Icon} n="camera" s=${22} />Camera</span></button>
            <button type="button" class="add-tile" aria-label="Choose photos from gallery" onClick=${() => galRef.current.click()}><span class="add-in"><${Icon} n="gallery" s=${22} />Gallery</span></button>`}
        </div>
        <input ref=${camRef} type="file" accept="image/*" capture="environment" style="display:none" onChange=${addPhotos(false)} />
        <input ref=${galRef} type="file" accept="image/*" multiple style="display:none" onChange=${addPhotos(true)} />
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div class="row between">
          <div class="eyebrow">Customer signature</div>
          ${hasSig && html`<button type="button" class="link" style="min-height:32px;font-size:13px" onClick=${() => sig.current && sig.current.clear()}>Clear</button>`}
        </div>
        <${SignaturePad} api=${sig} onInk=${setHasSig} />
        <div class="muted" style="font-size:12px">Ask the customer to sign inside the box with a finger.</div>
      </div>
      <${BusyBtn} busy=${busy} class="btn btn-orange" onClick=${submit}>Submit report<//>
    </div>`;
}

// ---------- Submitted
function Success({ ctx, id }) {
  const r = ctx.d.reports.find((x) => x.id === id);
  return html`<div class="scroll" style="padding:80px 24px 32px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center">
    <div class="avatar" style="width:88px;height:88px;background:#E3F4E8;color:${C.green}"><${Icon} n="check" s=${44} w=${2.6} /></div>
    <h1 style="font-size:26px;font-weight:800">Report submitted</h1>
    ${r && html`<div style="font-size:15px;font-weight:700">${r.code} · ${r.customer}</div>`}
    <p class="muted" style="font-size:14px;line-height:1.5">GPS location and time were attached. Your admin can see this report now.</p>
    <div style="width:100%;display:flex;flex-direction:column;gap:10px;margin-top:12px">
      <button type="button" class="btn btn-dark" onClick=${() => ctx.go('pdf', { id })}>View PDF</button>
      <button type="button" class="btn btn-line" onClick=${() => ctx.go('empHome', null, true)}>Back to home</button>
    </div>
  </div>`;
}

// ---------- Employee profile
function EmpProfile({ ctx }) {
  const { me, d } = ctx;
  const att = d.att.find((a) => a.user_id === me.id);
  const duty = !att ? 'Not punched in' : att.out_at ? 'Day complete' : 'On duty';
  return html`<div class="scroll pad" style="gap:14px">
    <h1 class="h1">Profile</h1>
    <div class="card" style="padding:18px 16px 6px">
      <div class="row" style="margin-bottom:10px">
        <div class="avatar" style="width:56px;height:56px;background:${C.navy};color:#fff;font-size:18px">${initialsOf(me.name)}</div>
        <div><div style="font-size:18px;font-weight:800">${me.name}</div><div class="muted" style="font-size:13px">Field employee · ${ctx.company.name}</div></div>
      </div>
      <div class="kv"><span class="muted">User ID</span><span style="font-weight:700">${me.login_id}</span></div>
      <div class="kv"><span class="muted">Today</span><span style="font-weight:700">${duty}</span></div>
      <div class="kv"><span class="muted">Reports submitted</span><span style="font-weight:700">${d.reports.filter((r) => r.employee_id === me.id).length}</span></div>
    </div>
    <div class="card" style="padding:14px 16px;display:flex;flex-direction:column;gap:4px">
      <div style="font-size:15px;font-weight:800">Access</div>
      <div class="muted" style="font-size:13px;line-height:1.5">You can punch attendance and create & submit reports. Team and company settings are managed by your admin. Forgot your password? Ask your admin.</div>
    </div>
    <button type="button" class="btn btn-line btn-danger" onClick=${ctx.logout}><${Icon} n="logout" s=${18} />Log out</button>
  </div>`;
}

// ---------- Nav bars
function NavBar({ items, route, go }) {
  return html`<nav class="nav">
    ${items.map(([name, label, icon, also = []]) => {
      const on = route === name || also.includes(route);
      return html`<button type="button" key=${name} onClick=${() => go(name, null, true)} style=${`color:${on ? C.orange : C.grey}`} aria-current=${on ? 'page' : undefined}>
        <${Icon} n=${icon} s=${22} />${label}
      </button>`;
    })}
  </nav>`;
}
const ADMIN_NAV = [
  ['adminHome', 'Home', 'home'], ['team', 'Team', 'team', ['addEmp', 'empDetail']], ['track', 'Tracking', 'pin'],
  ['reports', 'Reports', 'doc', ['detail', 'pdf']], ['company', 'Company', 'building', ['editCompany']],
];
const EMP_NAV = [
  ['empHome', 'Home', 'home'], ['newReport', 'New report', 'newDoc'], ['myReports', 'My reports', 'doc', ['detail', 'pdf']], ['empProfile', 'Profile', 'user'],
];
const ADMIN_SCREENS = ['adminHome', 'team', 'addEmp', 'empDetail', 'track', 'reports', 'detail', 'pdf', 'company', 'editCompany'];
const EMP_SCREENS = ['empHome', 'newReport', 'myReports', 'empProfile', 'detail', 'pdf', 'success'];

// ================================================================ APP
function Signed({ me, company, logoUrl, reloadMe, logout, flash, route, go, back }) {
  const [d, refresh] = useCompanyData(me);
  const team = useTeam(d);
  const isAdmin = me.role === 'admin';
  const myAtt = d.att.find((a) => a.user_id === me.id);
  useTracker(me, !isAdmin && !!myAtt && !myAtt.out_at);

  const allowed = isAdmin ? ADMIN_SCREENS : EMP_SCREENS;
  const name = allowed.includes(route.name) ? route.name : isAdmin ? 'adminHome' : 'empHome';
  const params = route.params || {};
  const ctx = { me, company, logoUrl, reloadMe, logout, flash, go, back, d, refresh, team };

  let screen;
  switch (name) {
    case 'adminHome': screen = html`<${AdminHome} ctx=${ctx} />`; break;
    case 'team': screen = html`<${Team} ctx=${ctx} />`; break;
    case 'addEmp': screen = html`<${AddEmployee} ctx=${ctx} />`; break;
    case 'empDetail': screen = html`<${EmployeeDetail} ctx=${ctx} id=${params.id} />`; break;
    case 'track': screen = html`<${Track} ctx=${ctx} />`; break;
    case 'reports': screen = html`<${Reports} ctx=${ctx} />`; break;
    case 'myReports': screen = html`<${Reports} ctx=${ctx} mine />`; break;
    case 'detail': screen = html`<${ReportDetail} ctx=${ctx} id=${params.id} />`; break;
    case 'pdf': screen = html`<${PdfView} ctx=${ctx} id=${params.id} />`; break;
    case 'company': screen = html`<${Company} ctx=${ctx} />`; break;
    case 'editCompany': screen = html`<${CompanySetup} ctx=${ctx} editing />`; break;
    case 'empHome': screen = html`<${EmpHome} ctx=${ctx} />`; break;
    case 'newReport': screen = html`<${NewReport} ctx=${ctx} key=${route.key} />`; break;
    case 'success': screen = html`<${Success} ctx=${ctx} id=${params.id} />`; break;
    case 'empProfile': screen = html`<${EmpProfile} ctx=${ctx} />`; break;
  }
  const showNav = name !== 'success';
  return html`${screen}${showNav && html`<${NavBar} items=${isAdmin ? ADMIN_NAV : EMP_NAV} route=${name} go=${go} />`}`;
}

function App() {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(null);
  const [company, setCompany] = useState(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [meState, setMeState] = useState('idle'); // idle | loading | ok | missing
  const [route, setRoute] = useState(() => history.state || { name: 'home' });
  const [toast, setToast] = useState(null);
  const toastT = useRef(null);

  const flash = useCallback((msg, err = false) => {
    setToast({ msg, err });
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(null), err ? 3600 : 2200);
  }, []);

  const go = useCallback((name, params = null, replace = false) => {
    const st = { name, params, key: Date.now() };
    if (replace) history.replaceState(st, ''); else history.pushState(st, '');
    setRoute(st);
    const sc = document.querySelector('.app .scroll'); if (sc) sc.scrollTop = 0;
  }, []);
  const back = useCallback(() => {
    if (history.state && history.length > 1) history.back(); else go('home', null, true);
  }, [go]);
  useEffect(() => {
    const onPop = (e) => setRoute(e.state || { name: 'home' });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const loadMe = useCallback(async (uid) => {
    if (!uid) { setMe(null); setCompany(null); setMeState('idle'); return; }
    setMeState((s) => (s === 'ok' ? s : 'loading'));
    const { data: prof } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (!prof || !prof.active) { setMe(prof || null); setMeState('missing'); return; }
    const { data: comp } = await sb.from('companies').select('*').eq('id', prof.company_id).maybeSingle();
    if (!comp) { setMeState('missing'); return; }
    setMe(prof); setCompany(comp); setMeState('ok');
    if (comp.logo_path) {
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(comp.logo_path, 60 * 60 * 24);
      setLogoUrl(data?.signedUrl || '');
    } else setLogoUrl('');
  }, []);

  const uidRef = useRef(null);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      uidRef.current = data.session?.user?.id || null;
      setSession(data.session); loadMe(uidRef.current);
    });
    const { data: sub } = sb.auth.onAuthStateChange((evt, s) => {
      const uid = s?.user?.id || null;
      setSession(s);
      if (uid !== uidRef.current) {
        const wasOut = !uidRef.current;
        uidRef.current = uid;
        // Defer: Supabase recommends not awaiting queries inside this callback.
        setTimeout(() => loadMe(uid), 0);
        if (wasOut && uid) go('home', null, true);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  const reloadCurrent = useCallback(() => loadMe(uidRef.current), [loadMe]);

  const logout = useCallback(async () => {
    await sb.auth.signOut();
    setMe(null); setCompany(null); setLogoUrl('');
    go('login', null, true);
  }, [go]);

  let body;
  if (session === undefined || (session && (meState === 'loading' || meState === 'idle'))) {
    body = html`<div class="scroll" style="display:flex;align-items:center;justify-content:center"><${Spinner} /></div>`;
  } else if (!session) {
    body = route.name === 'setup'
      ? html`<${CompanySetup} ctx=${{ flash, go, back, reloadMe: reloadCurrent }} />`
      : html`<${Login} ctx=${{ flash, go }} />`;
  } else if (meState === 'missing') {
    body = html`<div class="scroll pad" style="padding-top:64px">
      <h1 class="h1">No access</h1>
      <div class="banner err">${me && !me.active ? 'Your access has been removed by your company admin.' : 'This login is not linked to a company. If you just ran the database setup, log out and register again.'}</div>
      <button type="button" class="btn btn-line" onClick=${logout}>Log out</button>
    </div>`;
  } else {
    body = html`<${Signed} me=${me} company=${company} logoUrl=${logoUrl} reloadMe=${reloadCurrent}
      logout=${logout} flash=${flash} route=${route} go=${go} back=${back} />`;
  }

  return html`<div class="app">
    ${body}
    ${toast && html`<div role="status" class=${`toast ${toast.err ? 'err' : ''}`}>
      <${Icon} n=${toast.err ? 'target' : 'check'} s=${18} w=${2.6} style=${`color:${toast.err ? '#FCA5A5' : '#4ADE80'};flex:none`} />${toast.msg}
    </div>`}
  </div>`;
}

render(CONFIGURED ? html`<${App} />` : html`<${NotConfigured} />`, document.getElementById('root'));
