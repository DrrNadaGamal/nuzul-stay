// Nuzul single-page app. Every action goes to /api/data; the server is the authority.
import * as L from './logic.js';
import { STR, SRV } from './i18n.js';

const LS = { get: (k, d) => { try { const v = localStorage.getItem('nz-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => localStorage.setItem('nz-' + k, JSON.stringify(v)), del: (k) => localStorage.removeItem('nz-' + k) };
const S = { lang: new URLSearchParams(location.search).get('lang') || LS.get('lang', 'en'), token: LS.get('token', null), me: LS.get('me', null), data: null, busy: false, modal: null, filter: 'open', folio: '' };
const ar = () => S.lang === 'ar';
const t = (k) => (STR[S.lang] && STR[S.lang][k]) ?? STR.en[k] ?? k;
const srvErr = (m) => { const map = SRV[S.lang]; if (map && m) for (const [re, ar2] of map) { const x = m.match(re); if (x) return ar2.replace('$1', x[1] || ''); } return m || ''; };
const nf = (n, d = 0) => Number(n).toLocaleString(ar() ? 'ar-EG' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const egp = (n) => `${nf(n)} ${t('cur')}`;
const dF = (k) => k ? new Date(k + 'T12:00:00Z').toLocaleDateString(ar() ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' }) : '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.querySelector(id);
const D = () => S.data;
const role = () => S.me?.role;
const nm = (o) => (ar() && o?.nameAr ? o.nameAr : o?.name) || '';

const NAV = {
  owner: ['dashboard', 'calendar', 'reservations', 'rooms', 'guests', 'folios', 'rates', 'maintenance', 'reports', 'audit'],
  front: ['dashboard', 'calendar', 'reservations', 'rooms', 'guests', 'folios', 'maintenance'],
  housekeeping: ['dashboard', 'rooms', 'maintenance'],
  accountant: ['dashboard', 'reservations', 'folios', 'reports'],
};
const route = () => {
  const r = (location.hash.replace(/^#\//, '') || '').split('?')[0];
  if (!S.token || !S.me) return 'login';
  const allowed = NAV[role()] || [];
  return allowed.includes(r) ? r : allowed[0];
};
const canFront = () => ['owner', 'front'].includes(role());
const canMoney = () => ['owner', 'front', 'accountant'].includes(role());

// ---------- api ----------
async function api(method, op) {
  let r;
  try { r = await fetch('/api/data', { method, headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) }, body: op ? JSON.stringify({ op }) : undefined }); }
  catch { throw new Error('Network error'); }
  const j = await r.json().catch(() => null);
  if (r.status === 401 && !(op && op.type === 'login')) { logout(false); throw new Error(srvErr('Sign in again')); }
  if (!r.ok) { const e = new Error(srvErr(j?.error) || 'Server error'); e.status = r.status; throw e; }
  return j;
}
async function refresh() { S.data = await api('GET'); }
async function doOp(op, msg) {
  if (S.busy) return null;
  S.busy = true;
  try { const j = await api('POST', op); S.data = j; if (msg) toast(msg); return j.result || {}; }
  catch (e) { toast(e.message, true); return null; } finally { S.busy = false; }
}
function toast(msg, bad) {
  const el = $('#toast'); el.innerHTML = `<div class="${bad ? 'err' : ''}">${esc(msg)}</div>`;
  clearTimeout(toast._t); toast._t = setTimeout(() => (el.innerHTML = ''), 4500);
}
function logout(reload = true) {
  LS.del('token'); LS.del('me'); S.token = null; S.me = null; S.data = null; S.modal = null;
  if (reload) { location.hash = '#/'; render(); }
}

// ---------- small views ----------
const pill = (txt, cls = '') => `<span class="pill ${cls}">${esc(txt)}</span>`;
const sel = (id, list, cur, extra = '') => `<select id="${id}" ${extra}>${list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const field = (id, label, inner) => `<div class="f"><label for="${id}">${esc(label)}</label>${inner}</div>`;
const inp = (id, label, v = '', attrs = '') => field(id, label, `<input id="${id}" value="${esc(v)}" ${attrs}>`);
const chk = (id, label, on) => `<label class="chk"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${esc(label)}</label>`;
const val = (id) => $(id)?.value?.trim() ?? '';
const num = (id) => (val(id) === '' ? NaN : Number(val(id)));
const checked = (id) => !!$(id)?.checked;
const tbl = (head, rows, empty) => `<div class="tw"><table><thead><tr>${head.map((h) => `<th${h[1] ? ' class="num"' : ''}>${esc(Array.isArray(h) ? h[0] : h)}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="empty">${esc(empty || t('noRows'))}</td></tr>`}</tbody></table></div>`;
const modalBg = (inner, wide) => `<div class="modal-bg" data-act="bg"><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${inner}</div></div>`;
const mhead = (title) => `<div class="mhead"><h3>${esc(title)}</h3><button class="btn sm ghost2" data-act="bg" aria-label="Close">✕</button></div>`;

const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="rgba(255,255,255,.12)"/><path d="M10 38V16a14 14 0 0 1 28 0v22" stroke="#b7862e" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M17 38v-9h14v9" fill="#b7862e"/><circle cx="24" cy="16" r="3" fill="#b7862e"/></svg>`;
function shell(inner) {
  const tt = D().reports.totals;
  const nav = NAV[role()].map((r) => `<a href="#/${r}" class="${route() === r ? 'on' : ''}">${esc(t('nav.' + r))}${r === 'maintenance' && tt.openTickets ? ` <b class="dot">${tt.openTickets}</b>` : ''}</a>`).join('');
  return `<div class="top"><a class="brand" href="#/${NAV[role()][0]}">${LOGO}<span>Nuzul<small>${esc(t('app.tag'))}</small></span></a>
    <nav class="nav">${nav}</nav><div class="tools"><span class="pill">${esc(t('role.' + role()))} · ${esc(nm(S.me))}</span>
    <button class="btn ghost sm" data-act="lang">${ar() ? 'English' : 'العربية'}</button><button class="btn ghost sm" data-act="logout">${esc(t('signin.out'))}</button></div></div><main>${inner}</main>${modalHtml()}`;
}
function loginPage() {
  return `<main class="login"><div class="card login-card"><div class="brand big">${LOGO}<span>Nuzul<small>${esc(t('app.tag'))}</small></span></div>
    <h1>${esc(t('signin.title'))}</h1><p class="muted">${esc(t('signin.pick'))}</p>
    <div class="demo-users">${L.DEMO_USERS.map((u) => `<button class="btn" data-act="pin" data-pin="${u.pin}"><span>${esc(ar() ? u.labelAr : u.label)}</span><b>${u.pin}</b></button>`).join('')}</div>
    <div class="f"><label for="pin">${esc(t('signin.pin'))}</label><input id="pin" class="big" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="••••"></div>
    <button class="btn pri big" data-act="login" style="width:100%">${esc(t('signin.go'))}</button>
    <div class="row" style="margin-top:.4rem"><button class="btn sm" data-act="lang">${ar() ? 'English' : 'العربية'}</button></div></div></main>`;
}

// ---------- insights ----------
function insightText(i) {
  const d = D();
  const rname = (id) => { const r = d.reservations.find((x) => x.id === id); return r ? esc(r.guestName) + ' · ' + esc(r.confNo) : ''; };
  if (i.kind === 'arrival_today') return rname(i.resId) + ': ' + t('ins.arrival') + (i.unassigned ? ' (' + t('ins.unassigned') + ')' : '');
  if (i.kind === 'noshow_risk') return rname(i.resId) + ': ' + t('ins.noshow').replace('{d}', nf(i.days));
  if (i.kind === 'departure_due') return rname(i.resId) + ': ' + t(i.late ? 'ins.departure_late' : 'ins.departure');
  if (i.kind === 'dirty_rooms') return t('ins.dirty').replace('{n}', nf(i.count));
  if (i.kind === 'ticket_urgent') return t('ins.ticket').replace('{r}', esc(i.roomNumber));
  return i.kind;
}
const insPill = (k) => pill(t(k === 'ticket_urgent' || k === 'departure_due' ? 'pr.urgent' : 'pr.medium'), k === 'ticket_urgent' ? 'bad' : 'off');

// ---------- dashboard ----------
const kpi = (n, l, s = '', cls = '') => `<div class="card kpi ${cls}"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`;
function pgDashboard() {
  const d = D(), tt = d.reports.totals;
  if (role() === 'housekeeping') {
    return `<div class="bar"><h1>${esc(t('nav.dashboard'))}</h1></div>
    <div class="grid kpis">${kpi(nf(tt.dirty), t('k.dirty'), '', tt.dirty ? 'warn' : 'good')}${kpi(nf(tt.openTickets), t('k.tickets'), '', tt.openTickets ? 'warn' : 'good')}${kpi(nf(tt.inHouse), t('k.inHouse'))}${kpi(nf(tt.departures), t('k.departures'))}</div>
    <section class="card" style="margin-top:1rem"><h2>${esc(t('insights'))}</h2>
    ${d.insights.length ? d.insights.map((i) => `<div class="att-row"><span>${insPill(i.kind)} ${esc(insightText(i))}</span></div>`).join('') : `<p class="empty">${esc(t('none'))}</p>`}</section>`;
  }
  const money = role() !== 'housekeeping';
  const resToday = (list) => list.map((r) => `<div class="mrow"><div><b>${esc(r.guestName)}</b> <span class="small muted">${esc(r.confNo)} · ${esc(nm(d.roomTypes.find((x) => x.id === r.typeId)))} · ${r.roomNumber ? esc(t('f.room')) + ' ' + esc(r.roomNumber) : t('ins.unassigned')}</span></div>
    <div class="row">${r.status === 'confirmed' && canFront() ? `<button class="btn sm pri" data-act="checkin" data-id="${r.id}">${esc(t('b.checkin'))}</button>` : ''}${r.status === 'checked_in' && canFront() ? `<button class="btn sm" data-act="checkout" data-id="${r.id}">${esc(t('b.checkout'))}</button>` : ''}</div></div>`).join('');
  const arrivals = d.reservations.filter((r) => r.status === 'confirmed' && r.checkIn === d.today);
  const departures = d.reservations.filter((r) => r.status === 'checked_in' && r.checkOut <= d.today);
  return `<div class="bar"><h1>${esc(t('nav.dashboard'))}</h1></div>
  <div class="grid kpis">${kpi(nf(tt.inHouse), t('k.inHouse'))}${kpi(nf(tt.arrivals), t('k.arrivals'), '', tt.arrivals ? 'warn' : '')}${kpi(nf(tt.departures), t('k.departures'))}${kpi(tt.occupancyTonight + '%', t('k.tonight'))}${money ? kpi(egp(tt.monthRevenue), t('k.monthRev')) : ''}${kpi(tt.occupancy + '%', t('k.occ'))}${money ? kpi(egp(tt.adr), t('k.adr')) + kpi(egp(tt.revpar), t('k.revpar')) : ''}${kpi(nf(tt.dirty), t('k.dirty'), '', tt.dirty ? 'warn' : 'good')}</div>
  <div class="grid two" style="margin-top:1rem">
  <section class="card"><h2>${esc(t('k.arrivals'))}</h2>${arrivals.length ? resToday(arrivals) : `<p class="empty">${esc(t('none'))}</p>`}
  <h2 style="margin-top:1rem">${esc(t('k.departures'))}</h2>${departures.length ? resToday(departures) : `<p class="empty">${esc(t('none'))}</p>`}</section>
  <section class="card"><h2>${esc(t('insights'))}</h2>
  ${d.insights.length ? d.insights.map((i) => `<div class="att-row"><span>${insPill(i.kind)} ${esc(insightText(i))}</span></div>`).join('') : `<p class="empty">${esc(t('none'))}</p>`}</section></div>`;
}

// ---------- calendar ----------
function pgCalendar() {
  const d = D();
  const days = []; for (let i = 0; i < 14; i++) days.push(L.addDays(d.today, i));
  const head = [`<div class="h">${esc(t('f.type'))}</div>`, ...days.map((x) => `<div class="h">${esc(dF(x))}</div>`)].join('');
  const rows = d.roomTypes.map((tp) => {
    const cells = days.map((x) => {
      const free = L.typeAvailable({ ...d, rooms: d.rooms, reservations: d.reservations, tickets: d.tickets }, tp.id, x, L.addDays(x, 1));
      const cls = free === 0 ? 'full' : free <= 1 ? 'low' : '';
      return `<div class="cell ${cls}" title="${esc(nm(tp))} · ${x}: ${free}">${nf(free)}</div>`;
    }).join('');
    return `<div class="tn">${esc(nm(tp))}</div>${cells}`;
  }).join('');
  return `<div class="bar"><h1>${esc(t('cal.title'))}</h1><span class="sp"></span>${canFront() ? `<button class="btn pri" data-act="newres">${esc(t('b.book'))}</button>` : ''}</div>
  <div class="card"><div class="cal">${head}${rows}</div><p class="muted small" style="margin-top:.6rem">${esc(t('cal.free'))} · 0 = ${esc(t('rs.occupied'))}</p></div>`;
}

// ---------- reservations ----------
const resPill = (r) => pill(t('st.' + r.status), r.status === 'checked_in' ? 'ok' : r.status === 'confirmed' ? 'ice' : r.status === 'cancelled' || r.status === 'no_show' ? 'bad' : 'gray');
function resRow(r) {
  const d = D();
  const tp = d.roomTypes.find((x) => x.id === r.typeId);
  const nights = L.nightsOf(r);
  const acts = [];
  if (canFront()) {
    if (r.status === 'confirmed' && !r.roomId) acts.push(`<button class="btn sm" data-act="assign" data-id="${r.id}">${esc(t('b.assign'))}</button>`);
    if (r.status === 'confirmed') acts.push(`<button class="btn sm pri" data-act="checkin" data-id="${r.id}">${esc(t('b.checkin'))}</button>`);
    if (r.status === 'confirmed') acts.push(`<button class="btn sm danger" data-act="cancelres" data-id="${r.id}">${esc(t('b.cancelRes'))}</button>`);
    if (r.status === 'confirmed' && r.checkIn < d.today) acts.push(`<button class="btn sm" data-act="noshow" data-id="${r.id}">${esc(t('b.noshow'))}</button>`);
    if (r.status === 'checked_in') acts.push(`<button class="btn sm" data-act="checkout" data-id="${r.id}">${esc(t('b.checkout'))}</button>`);
  }
  if (canMoney() && r.status === 'checked_in') acts.push(`<button class="btn sm" data-act="folio" data-id="${r.id}">${esc(t('nav.folios'))}</button>`);
  return `<tr><td><b>${esc(r.confNo)}</b><div class="small muted">${esc(r.guestName)}${r.vip ? ' ★' : ''}</div></td>
    <td>${resPill(r)}</td><td>${esc(nm(tp))}${r.roomNumber ? ` · <b>${esc(r.roomNumber)}</b>` : ''}</td>
    <td>${esc(dF(r.checkIn))} → ${esc(dF(r.checkOut))}<div class="small muted">${nf(nights)} ${esc(t('r.nights'))}</div></td>
    <td>${esc(t('so.' + r.source))}</td>
    ${canMoney() ? `<td class="num">${r.status === 'cancelled' || r.status === 'no_show' ? '—' : egp(r.total)}</td><td class="num">${r.balance > 0 ? `<b class="neg">${egp(r.balance)}</b>` : egp(0)}</td>` : ''}
    <td class="acts1"><div class="row">${acts.join('')}</div></td></tr>`;
}
function pgReservations() {
  const d = D();
  const f = S.filter;
  const lists = {
    open: d.reservations.filter((r) => r.status === 'confirmed' || r.status === 'checked_in'),
    inhouse: d.reservations.filter((r) => r.status === 'checked_in'),
    upcoming: d.reservations.filter((r) => r.status === 'confirmed'),
    past: d.reservations.filter((r) => r.status === 'checked_out' || r.status === 'cancelled' || r.status === 'no_show'),
  };
  const rows = (lists[f] || lists.open).slice(0, 120);
  const tabs = ['open', 'inhouse', 'upcoming', 'past'].map((x) => `<button class="btn sm ${f === x ? 'pri' : ''}" data-act="filter" data-f="${x}">${esc(t('rs.filter.' + x) !== 'rs.filter.' + x ? t('rs.filter.' + x) : x)} <span class="muted">${nf(lists[x].length)}</span></button>`).join('');
  return `<div class="bar"><h1>${esc(t('nav.reservations'))}</h1><span class="sp"></span>${canFront() ? `<button class="btn pri" data-act="newres">${esc(t('b.book'))}</button>` : ''}</div>
  <div class="bar">${tabs}</div>
  ${tbl([[t('r.conf')], [t('f.status')], [t('f.type')], [t('f.checkin')], [t('f.source')], ...(canMoney() ? [[t('f.total'), 1], [t('f.balance'), 1]] : []), ['']], rows.map(resRow))}`;
}

// ---------- rooms board ----------
function roomCard(x) {
  const d = D();
  const tp = d.roomTypes.find((y) => y.id === x.typeId);
  const cls = x.openTickets ? 'maint' : x.occupied ? 'occupied' : x.hkStatus === 'dirty' ? 'dirty' : '';
  const st = x.occupied ? pill(t('rs.occupied'), 'ice') : pill(t('rs.' + x.hkStatus), x.hkStatus === 'dirty' ? 'off' : x.hkStatus === 'inspected' ? 'ok' : '');
  const canHk = ['owner', 'housekeeping'].includes(role());
  const btns = [];
  if (canHk && !x.occupied) {
    if (x.hkStatus === 'dirty') btns.push(`<button class="btn xs" data-act="roomst" data-id="${x.id}" data-st="clean">${esc(t('b.clean'))}</button>`);
    if (x.hkStatus === 'clean') btns.push(`<button class="btn xs" data-act="roomst" data-id="${x.id}" data-st="inspected">${esc(t('b.inspect'))}</button>`);
    if (x.hkStatus === 'inspected') btns.push(`<button class="btn xs" data-act="roomst" data-id="${x.id}" data-st="dirty">${esc(t('b.dirty'))}</button>`);
  }
  if (['owner', 'front', 'housekeeping'].includes(role())) btns.push(`<button class="btn xs" data-act="newticket" data-id="${x.id}">${esc(t('b.ticket'))}</button>`);
  return `<div class="room-card ${cls}"><div class="num2">${esc(x.number)} ${x.openTickets ? pill('!', 'bad') : ''}</div>
  <div class="small muted">${esc(nm(tp))}</div><div style="margin-top:.3rem">${st}</div>
  ${btns.length ? `<div class="btns">${btns.join('')}</div>` : ''}</div>`;
}
function pgRooms() {
  const d = D();
  const floors = [...new Set(d.rooms.map((x) => x.floor))].sort();
  return `<div class="bar"><h1>${esc(t(role() === 'housekeeping' ? 'hk.board' : 'nav.rooms'))}</h1><span class="sp"></span>${role() === 'owner' ? `<button class="btn" data-act="newroom">${esc(t('b.addRoom'))}</button>` : ''}</div>
  ${floors.map((f) => `<h2 style="margin:.8rem 0 .4rem">${esc(t('f.floor'))} ${nf(f)}</h2><div class="rooms-board">${d.rooms.filter((x) => x.floor === f).map(roomCard).join('')}</div>`).join('')}`;
}

// ---------- guests ----------
function pgGuests() {
  const d = D();
  const stays = (g) => d.reservations.filter((r) => r.guestId === g.id && r.status === 'checked_out').length;
  return `<div class="bar"><h1>${esc(t('gs.title'))}</h1><span class="sp"></span>${canFront() ? `<button class="btn pri" data-act="newguest">${esc(t('b.addGuest'))}</button>` : ''}</div>
  ${tbl([[t('f.name')], [t('f.phone')], [t('f.notes')], [t('gs.stays'), 1], ['']],
    d.guests.map((g) => `<tr><td><b>${esc(nm(g))}</b>${g.vip ? ' ' + pill('VIP', 'ice') : ''}</td><td>${esc(g.phone || '—')}</td><td class="small">${esc(g.notes || '')}</td><td class="num">${nf(stays(g))}</td>
      <td>${canFront() ? `<button class="btn sm" data-act="editguest" data-id="${g.id}">${esc(t('b.edit'))}</button>` : ''}</td></tr>`))}`;
}

// ---------- folios ----------
function pgFolios() {
  const d = D();
  const open = d.reservations.filter((r) => r.status === 'checked_in');
  const cur = open.find((r) => r.id === S.folio) || open[0];
  const list = open.map((r) => `<button class="btn sm ${cur && r.id === cur.id ? 'pri' : ''}" data-act="foliosel" data-id="${r.id}">${esc(r.guestName)} <b>${esc(r.roomNumber)}</b>${r.balance > 0 ? ` · ${egp(r.balance)}` : ''}</button>`).join('');
  if (!cur) return `<div class="bar"><h1>${esc(t('nav.folios'))}</h1></div><p class="empty">${esc(t('noRows'))}</p>`;
  const charges = d.charges.filter((c) => c.resId === cur.id);
  const payments = d.payments.filter((p) => p.resId === cur.id);
  return `<div class="bar"><h1>${esc(t('nav.folios'))}</h1><span class="sp"></span></div>
  <div class="bar">${list}</div>
  <section class="card"><div class="folio-head"><h2 style="margin:0">${esc(cur.guestName)} · ${esc(t('f.room'))} ${esc(cur.roomNumber)}</h2><span class="muted small">${esc(cur.confNo)} · ${esc(dF(cur.checkIn))} → ${esc(dF(cur.checkOut))}</span><span class="sp"></span><h2 style="margin:0" class="${cur.balance > 0 ? 'neg' : ''}">${esc(t('fl.balance'))}: ${egp(cur.balance)}</h2></div>
  <div class="acts">${canMoney() ? `<button class="btn" data-act="newcharge" data-id="${cur.id}">${esc(t('b.charge'))}</button><button class="btn pri" data-act="newpay" data-id="${cur.id}">${esc(t('b.pay'))}</button>` : ''}${canFront() ? `<button class="btn" data-act="checkout" data-id="${cur.id}">${esc(t('b.checkout'))}</button>` : ''}</div>
  <div class="grid two" style="margin-top:.8rem">
  <div><h3>${esc(t('fl.charges'))}</h3>${tbl([[t('f.date')], [t('f.kind')], [t('f.desc')], [t('f.amount'), 1]], charges.map((c) => `<tr><td>${esc(dF(c.date))}</td><td>${esc(t('ck.' + c.kind))}</td><td class="small">${esc(c.desc)}</td><td class="num">${egp(c.amount)}</td></tr>`))}</div>
  <div><h3>${esc(t('fl.payments'))}</h3>${tbl([[t('f.date')], [t('f.method')], [t('f.amount'), 1]], payments.map((p) => `<tr><td>${esc(dF(p.date))}</td><td>${esc(t('pm.' + p.method))}</td><td class="num">${egp(p.amount)}</td></tr>`))}</div></div></section>`;
}

// ---------- rates ----------
function pgRates() {
  const d = D();
  const own = role() === 'owner';
  return `<div class="bar"><h1>${esc(t('nav.rates'))}</h1><span class="sp"></span>${own ? `<button class="btn" data-act="newtype">${esc(t('b.addType'))}</button><button class="btn" data-act="newroom">${esc(t('b.addRoom'))}</button><button class="btn pri" data-act="newplan">${esc(t('b.addPlan'))}</button>` : ''}</div>
  <h2>${esc(t('rt.types'))}</h2>
  ${tbl([[t('f.name')], [t('f.capacity'), 1], [t('rt.base'), 1], [t('nav.rooms'), 1]],
    d.roomTypes.map((tp) => `<tr><td><b>${esc(nm(tp))}</b></td><td class="num">${nf(tp.capacity)}</td><td class="num">${egp(tp.baseRate)}</td><td class="num">${nf(d.rooms.filter((x) => x.typeId === tp.id).length)}</td></tr>`))}
  <h2 style="margin-top:1rem">${esc(t('rt.plans'))}</h2>
  ${tbl([[t('f.name')], [t('f.type')], [t('f.start')], [t('f.end')], [t('f.rate'), 1], ...(own ? [['']] : [])],
    d.ratePlans.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(nm(d.roomTypes.find((x) => x.id === p.typeId)))}</td><td>${esc(p.start)}</td><td>${esc(p.end)}</td><td class="num">${egp(p.rate)}</td>${own ? `<td><button class="btn sm danger" data-act="delplan" data-id="${p.id}">${esc(t('b.del'))}</button></td>` : ''}</tr>`))}`;
}

// ---------- maintenance ----------
function pgMaintenance() {
  const d = D();
  const own = d.tickets.filter((x) => x.status !== 'done'), done = d.tickets.filter((x) => x.status === 'done');
  const row = (x) => `<tr><td><b>${esc(x.roomNumber)}</b></td><td>${esc(x.title)}<div class="small muted">${esc(x.desc || '')}</div></td>
    <td>${pill(t('pr.' + x.priority), x.priority === 'urgent' ? 'bad' : x.priority === 'high' ? 'off' : '')}</td>
    <td>${pill(t('ts.' + x.status), x.status === 'done' ? 'ok' : x.status === 'in_progress' ? 'ice' : 'off')}</td>
    <td><div class="row">${canFront() && x.status === 'open' ? `<button class="btn sm" data-act="startticket" data-id="${x.id}">${esc(t('b.start'))}</button>` : ''}${canFront() && x.status !== 'done' ? `<button class="btn sm pri" data-act="closeticket" data-id="${x.id}">${esc(t('b.done'))}</button>` : ''}</div></td></tr>`;
  return `<div class="bar"><h1>${esc(t('mt.board'))}</h1></div>
  ${tbl([[t('f.room')], [t('f.title')], [t('f.priority')], [t('f.status')], ['']], own.map(row))}
  ${done.length ? `<h2 style="margin-top:1rem">${esc(t('ts.done'))}</h2>${tbl([[t('f.room')], [t('f.title')], [t('f.priority')], [t('f.status')], ['']], done.map(row))}` : ''}`;
}

// ---------- reports ----------
function bars(rows, get) {
  const mx = Math.max(1, ...rows.map(get));
  return `<div class="bars2" role="img"><div style="display:flex;gap:4px;align-items:flex-end;height:140px">${rows.map((r) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px"><div title="${esc(r.month)}: ${nf(get(r))}" style="width:100%;max-width:42px;background:var(--acc);border-radius:4px 4px 0 0;height:${Math.max(2, Math.round((get(r) / mx) * 100))}%"></div><small class="muted">${esc(r.month.slice(5))}</small></div>`).join('')}</div></div>`;
}
function pgReports() {
  const d = D(), bm = d.reports.byMonth;
  return `<div class="bar"><h1>${esc(t('nav.reports'))}</h1></div>
  <section class="card"><h2>${esc(t('rep.byMonth'))}</h2>${bars(bm, (r) => r.revenue)}</section>
  <div style="margin-top:1rem">${tbl([[t('rep.byMonth')], [t('rep.sold'), 1], [t('rep.avail'), 1], [t('rep.occ'), 1], ['ADR', 1], ['RevPAR', 1], [t('rep.revenue'), 1]],
    [...bm].reverse().map((r) => `<tr><td><b>${esc(r.month)}</b></td><td class="num">${nf(r.sold)}</td><td class="num">${nf(r.available)}</td><td class="num">${nf(r.occupancy)}%</td><td class="num">${egp(r.adr)}</td><td class="num">${egp(r.revpar)}</td><td class="num">${egp(r.revenue)}</td></tr>`))}</div>`;
}

// ---------- audit ----------
function pgAudit() {
  const d = D();
  return `<div class="bar"><h1>${esc(t('nav.audit'))}</h1></div>
  ${tbl([[t('audit.when')], [t('audit.who')], [t('audit.what')]],
    d.audit.map((a) => `<tr><td class="small">${new Date(a.ts).toLocaleString(ar() ? 'ar-EG' : 'en-GB')}</td><td>${esc(a.name)}</td><td><b>${esc(a.action)}</b> <span class="small muted">${esc(a.detail)}</span></td></tr>`))}`;
}


// ---------- modals ----------
function modalHtml() {
  const m = S.modal;
  if (!m) return '';
  const d = D();
  const k = m.kind, c = m.ctx || {};
  const save = `<div class="acts"><button class="btn pri" data-act="msave">${esc(t('b.save'))}</button><button class="btn" data-act="bg">${esc(t('b.back'))}</button></div>`;
  if (k === 'book') {
    const types = d.roomTypes.map((x) => [x.id, nm(x) + ' · ' + egp(x.baseRate)]);
    const guests = [['', '—'], ...d.guests.map((g) => [g.id, nm(g) + (g.vip ? ' ★' : '')])];
    const body = mhead(t('b.book'))
      + field('m-guest', t('f.guest'), sel('m-guest', guests, c.guestId || ''))
      + field('m-guestName', t('f.guest') + ' (' + t('b.addGuest') + ')', `<input id="m-guestName" maxlength="80" placeholder="">`)
      + field('m-type', t('f.type'), sel('m-type', types, c.typeId || d.roomTypes[0].id))
      + `<div class="grid two">${field('m-in', t('f.checkin'), `<input id="m-in" type="date" value="${esc(c.checkIn || d.today)}">`)}${field('m-out', t('f.checkout'), `<input id="m-out" type="date" value="${esc(c.checkOut || L.addDays(d.today, 2))}">`)}</div>`
      + `<div class="grid two">${field('m-adults', t('f.adults'), `<input id="m-adults" type="number" min="1" max="6" value="2">`)}${field('m-children', t('f.children'), `<input id="m-children" type="number" min="0" max="4" value="0">`)}</div>`
      + field('m-source', t('f.source'), sel('m-source', L.SOURCES.map((x) => [x, t('so.' + x)]), 'direct'))
      + save;
    return modalBg(body);
  }
  if (k === 'assign') {
    const r = d.reservations.find((x) => x.id === c.resId);
    if (!r) return '';
    const rooms = d.rooms.filter((x) => x.typeId === r.typeId && x.hkStatus !== 'dirty' && L.roomFree(d, x.id, r.checkIn, r.checkOut, r.id));
    const body = mhead(t('b.assign'))
      + `<p class="small muted">${esc(r.guestName)} · ${esc(nm(d.roomTypes.find((x) => x.id === r.typeId)))} · ${esc(dF(r.checkIn))} → ${esc(dF(r.checkOut))}</p>`
      + field('m-room', t('f.room'), sel('m-room', rooms.map((x) => [x.id, x.number]), rooms[0] && rooms[0].id))
      + save;
    return modalBg(body);
  }
  if (k === 'charge') {
    const body = mhead(t('b.charge'))
      + field('m-kind', t('f.kind'), sel('m-kind', L.CHARGE_KINDS.filter((x) => x !== 'room').map((x) => [x, t('ck.' + x)]), 'restaurant'))
      + field('m-desc', t('f.desc'), `<input id="m-desc" maxlength="120">`)
      + field('m-amount', t('f.amount'), `<input id="m-amount" type="number" min="1" max="5000000">`)
      + save;
    return modalBg(body);
  }
  if (k === 'pay') {
    const r = d.reservations.find((x) => x.id === c.resId);
    const bal = r ? r.balance : 0;
    const body = mhead(t('b.pay'))
      + field('m-method', t('f.method'), sel('m-method', L.PAY_METHODS.map((x) => [x, t('pm.' + x)]), 'cash'))
      + field('m-amount', t('f.amount'), `<input id="m-amount" type="number" min="1" max="${bal}" value="${bal}">`)
      + save;
    return modalBg(body);
  }
  if (k === 'guest') {
    const g = c.id ? d.guests.find((x) => x.id === c.id) : null;
    const body = mhead(g ? t('b.edit') : t('b.addGuest'))
      + inp('m-name', t('f.name'), g ? g.name : '', 'maxlength="80"')
      + inp('m-phone', t('f.phone'), g ? g.phone : '', 'maxlength="30"')
      + inp('m-email', t('f.email'), g ? g.email : '', 'maxlength="80"')
      + inp('m-notes', t('f.notes'), g ? g.notes : '', 'maxlength="200"')
      + chk('m-vip', t('f.vip'), !!(g && g.vip))
      + save;
    return modalBg(body);
  }
  if (k === 'room') {
    const body = mhead(t('b.addRoom'))
      + inp('m-number', t('f.number'), '', 'maxlength="8"')
      + field('m-type', t('f.type'), sel('m-type', d.roomTypes.map((x) => [x.id, nm(x)]), d.roomTypes[0].id))
      + field('m-floor', t('f.floor'), `<input id="m-floor" type="number" min="1" max="8" value="1">`)
      + save;
    return modalBg(body);
  }
  if (k === 'type') {
    const body = mhead(t('b.addType'))
      + inp('m-name', t('f.name'), '', 'maxlength="60"')
      + inp('m-nameAr', t('f.nameAr'), '', 'maxlength="60" dir="rtl"')
      + field('m-cap', t('f.capacity'), `<input id="m-cap" type="number" min="1" max="8" value="2">`)
      + field('m-rate', t('rt.base'), `<input id="m-rate" type="number" min="100" max="1000000" value="1000">`)
      + save;
    return modalBg(body);
  }
  if (k === 'plan') {
    const body = mhead(t('b.addPlan'))
      + inp('m-name', t('f.name'), '', 'maxlength="60"')
      + field('m-type', t('f.type'), sel('m-type', d.roomTypes.map((x) => [x.id, nm(x)]), d.roomTypes[0].id))
      + `<div class="grid two">${field('m-start', t('f.start'), `<input id="m-start" type="date" value="${d.today}">`)}${field('m-end', t('f.end'), `<input id="m-end" type="date" value="${L.addDays(d.today, 30)}">`)}</div>`
      + field('m-rate', t('f.rate'), `<input id="m-rate" type="number" min="100" max="1000000">`)
      + save;
    return modalBg(body);
  }
  if (k === 'ticket') {
    const room = d.rooms.find((x) => x.id === c.roomId);
    const body = mhead(t('b.ticket') + (room ? ' · ' + esc(room.number) : ''))
      + field('m-room', t('f.room'), sel('m-room', d.rooms.map((x) => [x.id, x.number]), c.roomId || d.rooms[0].id))
      + inp('m-title', t('f.title'), '', 'maxlength="80"')
      + inp('m-desc', t('f.desc'), '', 'maxlength="200"')
      + field('m-pr', t('f.priority'), sel('m-pr', L.PRIORITIES.map((x) => [x, t('pr.' + x)]), 'medium'))
      + save;
    return modalBg(body);
  }
  return '';
}

const newKey = () => 'k' + Math.random().toString(36).slice(2) + Date.now().toString(36);
async function saveModal() {
  const m = S.modal;
  if (!m) return;
  const k = m.kind, c = m.ctx || {};
  let op = null;
  if (k === 'book') {
    const guestId = val('#m-guest'), guestName = val('#m-guestName');
    if (!guestId && !guestName) { toast(t('f.guest'), true); return; }
    op = { type: 'book', key: newKey(), typeId: val('#m-type'), checkIn: val('#m-in'), checkOut: val('#m-out'), adults: num('#m-adults'), children: num('#m-children') || 0, source: val('#m-source'), ...(guestId ? { guestId } : { guestName }) };
  } else if (k === 'assign') op = { type: 'assignRoom', resId: c.resId, roomId: val('#m-room') };
  else if (k === 'charge') op = { type: 'postCharge', key: newKey(), resId: c.resId, kind: val('#m-kind'), desc: val('#m-desc'), amount: num('#m-amount') };
  else if (k === 'pay') op = { type: 'recordPayment', key: newKey(), resId: c.resId, method: val('#m-method'), amount: num('#m-amount') };
  else if (k === 'guest') op = { type: c.id ? 'updateGuest' : 'addGuest', key: newKey(), ...(c.id ? { guestId: c.id } : {}), name: val('#m-name'), phone: val('#m-phone'), email: val('#m-email'), notes: val('#m-notes'), vip: checked('#m-vip') };
  else if (k === 'room') op = { type: 'addRoom', key: newKey(), number: val('#m-number'), typeId: val('#m-type'), floor: num('#m-floor') };
  else if (k === 'type') op = { type: 'addRoomType', key: newKey(), name: val('#m-name'), nameAr: val('#m-nameAr'), capacity: num('#m-cap'), baseRate: num('#m-rate') };
  else if (k === 'plan') op = { type: 'addRatePlan', key: newKey(), name: val('#m-name'), typeId: val('#m-type'), start: val('#m-start'), end: val('#m-end'), rate: num('#m-rate') };
  else if (k === 'ticket') op = { type: 'openTicket', key: newKey(), roomId: val('#m-room'), title: val('#m-title'), desc: val('#m-desc'), priority: val('#m-pr') };
  if (!op) return;
  const r = await doOp(op);
  if (r === null) return;
  S.modal = null;
  render();
}

// ---------- dispatch ----------
async function onClick(ev) {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  const ok = async (op) => { const r = await doOp(op); if (r !== null) render(); };
  const d = D();
  switch (act) {
    case 'lang': S.lang = ar() ? 'en' : 'ar'; LS.set('lang', S.lang); render(); return;
    case 'logout': logout(); return;
    case 'pin': { const i = $('#pin'); if (i) { i.value = el.dataset.pin; i.focus(); } return; }
    case 'login': return signin();
    case 'bg': if (ev.target === el || el.tagName === 'BUTTON') { S.modal = null; render(); } return;
    case 'msave': return saveModal();
    case 'filter': S.filter = el.dataset.f; render(); return;
    case 'foliosel': S.folio = id; render(); return;
    case 'folio': S.folio = id; location.hash = '#/folios'; return;
    case 'newres': S.modal = { kind: 'book', ctx: {} }; render(); return;
    case 'newguest': S.modal = { kind: 'guest', ctx: {} }; render(); return;
    case 'editguest': S.modal = { kind: 'guest', ctx: { id } }; render(); return;
    case 'newroom': S.modal = { kind: 'room', ctx: {} }; render(); return;
    case 'newtype': S.modal = { kind: 'type', ctx: {} }; render(); return;
    case 'newplan': S.modal = { kind: 'plan', ctx: {} }; render(); return;
    case 'newticket': S.modal = { kind: 'ticket', ctx: { roomId: id } }; render(); return;
    case 'assign': S.modal = { kind: 'assign', ctx: { resId: id } }; render(); return;
    case 'newcharge': S.modal = { kind: 'charge', ctx: { resId: id } }; render(); return;
    case 'newpay': S.modal = { kind: 'pay', ctx: { resId: id } }; render(); return;
    case 'checkin': return ok({ type: 'checkIn', resId: id });
    case 'checkout': return ok({ type: 'checkOut', resId: id });
    case 'cancelres': return ok({ type: 'cancelReservation', resId: id });
    case 'noshow': return ok({ type: 'markNoShow', resId: id });
    case 'roomst': return ok({ type: 'setRoomStatus', roomId: id, status: el.dataset.st });
    case 'startticket': return ok({ type: 'startTicket', ticketId: id });
    case 'closeticket': return ok({ type: 'closeTicket', ticketId: id });
    case 'delplan': return ok({ type: 'deleteRatePlan', planId: id });
    case 'reset': return ok({ type: 'reset' });
    default: return;
  }
}

// ---------- render ----------
function render() {
  document.documentElement.lang = ar() ? 'ar' : 'en';
  document.documentElement.dir = ar() ? 'rtl' : 'ltr';
  const app = $('#app');
  if (!S.token || !S.me) { app.innerHTML = loginPage(); return; }
  if (!S.data) {
    app.innerHTML = `<main class="login"><p class="empty">${esc(t('loading'))}</p></main>`;
    refresh().then(render).catch(() => logout());
    return;
  }
  const pages = { dashboard: pgDashboard, calendar: pgCalendar, reservations: pgReservations, rooms: pgRooms, guests: pgGuests, folios: pgFolios, rates: pgRates, maintenance: pgMaintenance, reports: pgReports, audit: pgAudit };
  const r = route();
  app.innerHTML = shell((pages[r] || pgDashboard)());
}

async function signin() {
  const pin = val('#pin');
  if (!pin) return;
  try {
    const r = await fetch('/api/data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: { type: 'login', pin } }) });
    const j = await r.json();
    if (!r.ok) { toast(t('signin.bad'), true); return; }
    S.token = j.token; S.me = j.me;
    LS.set('token', j.token); LS.set('me', j.me);
    S.data = null;
    location.hash = '#/' + NAV[j.me.role][0];
    render();
  } catch { toast(t('signin.bad'), true); }
}

$('#app').addEventListener('click', onClick);
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'pin') signin(); if (e.key === 'Escape' && S.modal) { S.modal = null; render(); } });
window.addEventListener('hashchange', render);
render();
