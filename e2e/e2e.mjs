// Browser and API checks against a running Nuzul (local dev server or the live URL).
// Usage: node e2e/e2e.mjs http://localhost:3200   (needs Chrome at /usr/bin/google-chrome)
import puppeteer from 'puppeteer-core';
import * as L from '../public/logic.js';
const U = (process.argv[2] || 'http://localhost:3200').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log(c ? 'PASS' : 'FAIL', m); };
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
const errs = [];
async function newPage(w = 1280, h = 900) {
  const p = await (await b.createBrowserContext()).newPage(); await p.setViewport({ width: w, height: h });
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
  p.on('dialog', (d) => d.accept());
  return p;
}
async function login(p, pin, lang = 'en') {
  await p.goto(U + '/?lang=' + lang, { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.clear()); await p.goto(U + '/?lang=' + lang, { waitUntil: 'networkidle0' });
  await p.type('#pin', pin); await p.keyboard.press('Enter'); await p.waitForSelector('.top .nav', { timeout: 15000 }); await sleep(400);
}
const go = async (p, r) => { await p.evaluate((r) => (location.hash = '#/' + r), r); await sleep(450); };
const body = async (p) => { for (let i = 0; i < 4; i++) { try { return await p.evaluate(() => document.body.innerText); } catch { await sleep(600); } } return ''; };
const bare = /undefined|NaN|\[object/;
async function api(token, method, bodyObj, raw) {
  const r = await fetch(U + '/api/data', { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: raw ?? (bodyObj ? JSON.stringify(bodyObj) : undefined) });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, j };
}
const tokenFor = async (pin) => (await api(null, 'POST', { op: { type: 'login', pin } })).j.token;
const T = { owner: await tokenFor('1111'), front: await tokenFor('2222'), hk: await tokenFor('3333'), acc: await tokenFor('4444') };
const post = (role, op) => api(T[role], 'POST', { op });
const view = async (role) => (await api(T[role], 'GET')).j;
await post('owner', { type: 'reset' });
let n = 0; const key = () => 'e2e-' + Date.now().toString(36) + '-' + ++n;
const today = L.dayKey(Date.now());
const d40 = L.addDays(today, 40), d43 = L.addDays(today, 43);

// ---------- API security ----------
ok((await api(null, 'GET')).status === 401, 'no token: 401');
ok((await api('garbage', 'GET')).status === 401, 'garbage token: 401');
const tv = T.front.split('.'); const forged = Buffer.from('u-owner.' + (Date.now() + 1e7)).toString('base64url') + '.' + tv[1];
ok((await api(forged, 'GET')).status === 401, 'forged token for another user: 401');
ok((await api(null, 'POST', { op: { type: 'login', pin: '9999' } })).status === 401, 'wrong PIN: 401');
ok((await api(null, 'POST', { op: { type: 'login', pin: ['1111'] } })).status === 401, 'array PIN: 401');
ok((await api(null, 'POST', { op: { type: 'login', pin: 1111 } })).status === 401, 'numeric PIN: 401');
ok((await api(null, 'POST', { op: { type: 'login', pin: { $ne: 1 } } })).status === 401, 'object PIN: 401');
ok((await api(T.owner, 'POST', null, '{not json')).status === 400, 'malformed JSON: 400');
ok((await post('owner', { type: 'nope' })).status === 400, 'unknown action: 400');
ok((await post('owner', { type: 'constructor' })).status === 400, 'prototype name as action: 400');
ok((await post('owner', { type: '__proto__' })).status === 400, '__proto__ as action: 400');
ok((await post('owner', { type: 'toString' })).status === 400, 'toString as action: 400');
ok((await post('owner', { type: 'book', pad: 'x'.repeat(70000) })).status === 413, 'oversized body: 413');
ok((await api(T.owner, 'DELETE')).status === 405, 'DELETE: 405');
ok((await api(T.owner, 'PUT', { op: { type: 'reset' } })).status === 405, 'PUT: 405');
ok((await api(T.owner, 'PATCH', { op: { type: 'reset' } })).status === 405, 'PATCH: 405');
ok((await post('front', { type: 'reset' })).status === 403, 'front desk cannot reset: 403');
ok((await post('hk', { type: 'reset' })).status === 403, 'housekeeping cannot reset: 403');
ok((await post('acc', { type: 'reset' })).status === 403, 'accountant cannot reset: 403');
ok((await api(null, 'POST', { op: { type: 'reset' } })).status === 401, 'reset without token: 401');

// ---------- permission lanes ----------
const v0 = await view('owner');
const g0 = v0.guests[0], t1 = v0.roomTypes[0], t3 = v0.roomTypes[2];
const inhouse0 = v0.reservations.find((r) => r.status === 'checked_in');
const bookOp = { type: 'book', guestId: g0.id, typeId: t1.id, checkIn: d40, checkOut: d43, adults: 1 };
ok((await post('hk', bookOp)).status === 403, 'housekeeping cannot book: 403');
ok((await post('acc', bookOp)).status === 403, 'accountant cannot book: 403');
ok((await post('hk', { type: 'checkIn', resId: 'x' })).status === 403, 'housekeeping cannot check in: 403');
ok((await post('acc', { type: 'checkIn', resId: 'x' })).status === 403, 'accountant cannot check in: 403');
ok((await post('acc', { type: 'assignRoom', resId: 'x', roomId: 'y' })).status === 403, 'accountant cannot assign rooms: 403');
ok((await post('hk', { type: 'recordPayment', resId: 'x', method: 'cash', amount: 1 })).status === 403, 'housekeeping cannot take payments: 403');
ok((await post('hk', { type: 'postCharge', resId: 'x', kind: 'other', amount: 1 })).status === 403, 'housekeeping cannot post charges: 403');
ok((await post('acc', { type: 'setRoomStatus', roomId: 'x', status: 'clean' })).status === 403, 'accountant cannot touch rooms: 403');
ok((await post('front', { type: 'setRoomStatus', roomId: 'x', status: 'clean' })).status === 403, 'front desk cannot set room status: 403');
ok((await post('front', { type: 'addRoom', number: '999', typeId: t1.id, floor: 9 })).status === 403, 'front desk cannot add rooms: 403');
ok((await post('hk', { type: 'addRoom', number: '999', typeId: t1.id, floor: 9 })).status === 403, 'housekeeping cannot add rooms: 403');
ok((await post('acc', { type: 'addRoomType', name: 'X', capacity: 2, baseRate: 1000 })).status === 403, 'accountant cannot add room types: 403');
ok((await post('front', { type: 'addRatePlan', name: 'X', typeId: t1.id, start: d40, end: d43, rate: 1000 })).status === 403, 'front desk cannot add rate plans: 403');
ok((await post('hk', { type: 'deleteRatePlan', planId: 'rp1' })).status === 403, 'housekeeping cannot delete rate plans: 403');
ok((await post('acc', { type: 'openTicket', roomId: 'x', title: 'XXX', priority: 'low' })).status === 403, 'accountant cannot open tickets: 403');
ok((await post('hk', { type: 'startTicket', ticketId: 'mt1' })).status === 403, 'housekeeping cannot start tickets: 403');
ok((await post('hk', { type: 'closeTicket', ticketId: 'mt1' })).status === 403, 'housekeeping cannot close tickets: 403');
ok((await post('acc', { type: 'addGuest', name: 'XX' })).status === 403, 'accountant cannot add guests: 403');
ok((await post('hk', { type: 'updateGuest', guestId: g0.id, name: 'XX' })).status === 403, 'housekeeping cannot edit guests: 403');

// ---------- role views ----------
const hv = await view('hk');
ok(hv.charges.length === 0 && hv.payments.length === 0 && hv.ratePlans.length === 0 && hv.audit.length === 0 && hv.users.length === 0, 'housekeeping view: no charges, payments, plans, audit or users');
ok(hv.reservations.every((r) => !('balance' in r) && !('paid' in r)), 'housekeeping sees stays without folio money');
ok(hv.reports.totals.monthRevenue === 0 && hv.reports.totals.adr === 0, 'housekeeping totals carry no money');
ok(hv.guests.every((g) => !('phone' in g)), 'housekeeping sees guest names without phones');
ok(hv.rooms.length === 16 && hv.tickets.length >= 2, 'housekeeping sees the rooms and tickets');
const av = await view('acc');
ok(av.charges.length > 100 && av.payments.length > 50 && av.ratePlans.length === 4, 'accountant sees folios and rate plans');
ok(av.audit.length === 0 && av.users.length === 0, 'accountant sees no audit or users');
ok(av.reports.byMonth.length === 12, 'twelve months of reports');
const fv = await view('front');
ok(fv.charges.length > 100 && fv.audit.length === 0, 'front desk sees folios but not the audit trail');
const ov = v0;
ok(ov.users.length === 4 && ov.audit.length > 5 && ov.reservations.length > 500, 'owner sees users, audit and full history');
ok(ov.reports.totals.inHouse === 4 && ov.reports.totals.arrivals === 3 && ov.reports.totals.dirty === 2 && ov.reports.totals.openTickets === 2, 'seeded totals: 4 in-house, 3 arrivals, 2 dirty, 2 tickets');
ok(ov.insights.some((i) => i.kind === 'arrival_today') && ov.insights.some((i) => i.kind === 'departure_due') && ov.insights.some((i) => i.kind === 'dirty_rooms') && ov.insights.some((i) => i.kind === 'ticket_urgent'), 'the seeded alerts all fire');
for (const m of ov.reports.byMonth) { if (!(m.sold <= m.available && m.occupancy >= 25 && m.occupancy <= 75)) { ok(false, 'month ' + m.month + ' in band'); } }
ok(true, 'every month sits in a believable occupancy band');

// ---------- booking, overbooking guard, idempotency ----------
let r = await post('front', { ...bookOp, key: key() });
ok(r.status === 200 && /^NZ-\d{4}$/.test(r.j.result.confNo), 'front desk books a standard queen for 3 nights, conf ' + (r.j.result?.confNo || r.j.error));
ok(r.j.result.total === L.quoteStay(v0, t1.id, d40, d43) && r.j.result.total > 0, 'the quote matches the seasonal rate math (' + r.j.result.total + ')');
const bk = key();
r = await post('front', { ...bookOp, key: bk });
ok(r.status === 200 && r.j.result.confNo, 'second booking with a key');
const dup = await post('front', { ...bookOp, key: bk });
ok(dup.status === 200 && dup.j.result.duplicate === true, 'same key again: duplicate acknowledged, not applied');
ok((await view('front')).reservations.filter((x) => x.guestId === g0.id && x.checkIn === d40 && x.typeId === t1.id).length === 2, 'two bookings on file, not three');
for (let i = 0; i < 4; i++) await post('front', { ...bookOp, key: key() });
r = await post('front', { ...bookOp });
ok(r.status === 400 && /No rooms of this type/.test(r.j.error), 'the seventh standard queen on those nights is refused: overbooking guard');
ok((await post('front', { type: 'book', guestId: g0.id, typeId: t3.id, checkIn: d40, checkOut: d43, adults: 5, children: 1 })).status === 400, 'six guests in a family suite that sleeps five: 400');
ok((await post('front', { type: 'book', guestId: g0.id, typeId: t3.id, checkIn: L.addDays(today, -1), checkOut: d43, adults: 2 })).status === 400, 'check-in in the past: 400');
ok((await post('front', { type: 'book', guestId: g0.id, typeId: t3.id, checkIn: d40, checkOut: d40, adults: 2 })).status === 400, 'checkout on the same day: 400');
ok((await post('front', { type: 'book', guestId: g0.id, typeId: t3.id, checkIn: d40, checkOut: L.addDays(d40, 31), adults: 2 })).status === 400, 'a stay over 30 nights: 400');
ok((await post('front', { type: 'book', guestId: g0.id, typeId: 'zz', checkIn: d40, checkOut: d43, adults: 2 })).status === 400, 'booking a missing room type: 400');
ok((await post('front', { type: 'book', guestId: 'zz', typeId: t3.id, checkIn: d40, checkOut: d43, adults: 2 })).status === 400, 'booking a missing guest: 400');
r = await post('front', { type: 'book', guestName: 'Inline New Guest', typeId: t3.id, checkIn: d40, checkOut: d43, adults: 2, key: key() });
ok(r.status === 200 && (await view('front')).guests.some((g) => g.name === 'Inline New Guest'), 'booking creates a walk-in guest inline');

// ---------- arrivals today: assign, check in, folio, checkout ----------
let vw = await view('front');
const waiting = vw.reservations.find((x) => x.status === 'confirmed' && x.checkIn === today && !x.roomId && x.typeId === 't2');
r = await post('front', { type: 'assignRoom', resId: waiting.id, roomId: vw.rooms.find((x) => x.number === '202').id });
ok(r.status === 200 && r.j.result.roomNumber === '202', 'front desk assigns room 202 to the waiting twin booking');
r = await post('front', { type: 'assignRoom', resId: waiting.id, roomId: vw.rooms.find((x) => x.number === '204').id });
ok(r.status === 200 && r.j.result.roomNumber === '204', 'before check-in the booking can move to 204');
r = await post('front', { type: 'assignRoom', resId: waiting.id, roomId: vw.rooms.find((x) => x.number === '202').id });
ok(r.status === 200 && r.j.result.roomNumber === '202', 'and back to 202');
const dirtyRoom = vw.rooms.find((x) => x.number === '205');
const waitingT4 = vw.reservations.find((x) => x.status === 'confirmed' && x.checkIn === today && !x.roomId && x.typeId === 't4');
ok((await post('front', { type: 'assignRoom', resId: waitingT4.id, roomId: dirtyRoom.id })).status === 400, 'a dirty room cannot be assigned: 400');
ok((await post('front', { type: 'assignRoom', resId: waitingT4.id, roomId: vw.rooms.find((x) => x.number === '401').id })).status === 400, 'room 401 with an urgent ticket cannot be assigned: 400');
ok((await post('front', { type: 'assignRoom', resId: waitingT4.id, roomId: vw.rooms.find((x) => x.number === '202').id })).status === 400, 'a room of the wrong type cannot be assigned: 400');
r = await post('front', { type: 'checkIn', resId: waitingT4.id });
ok(r.status === 400 && /assign one manually/.test(r.j.error), 'the sea-view arrival cannot check in: 401 blocked by the urgent ticket, 402 occupied');
ok((await post('front', { type: 'closeTicket', ticketId: 'mt1', note: 'Compressor replaced' })).status === 200, 'front desk closes the urgent ticket on 401');
r = await post('front', { type: 'checkIn', resId: waiting.id });
ok(r.status === 200 && r.j.result.roomNumber === '202', 'the assigned guest checks into 202');
const staying = (await view('front')).reservations.find((x) => x.id === waiting.id);
ok(staying.status === 'checked_in' && staying.charges > 0, 'room charges for every night are on the folio at check-in');
ok((await post('front', { type: 'checkIn', resId: waiting.id })).status === 400, 'checking in twice: 400');
r = await post('front', { type: 'checkIn', resId: waitingT4.id });
ok(r.status === 200 && r.j.result.roomNumber === '401', 'with the ticket closed, the unassigned arrival auto-assigns room 401');
const futRes = vw.reservations.find((x) => x.status === 'confirmed' && x.checkIn > today);
ok((await post('front', { type: 'checkIn', resId: futRes.id })).status === 400, 'a future arrival cannot check in early: 400');

// ---------- folio: charges, payments, checkout guard ----------
vw = await view('front');
const guest = vw.reservations.find((x) => x.id === waiting.id);
const bal0 = guest.balance;
r = await post('acc', { type: 'postCharge', resId: waiting.id, kind: 'restaurant', desc: 'Dinner, two covers', amount: 340, key: key() });
ok(r.status === 200 && r.j.result.balance === bal0 + 340, 'accountant posts a 340 restaurant charge');
ok((await post('acc', { type: 'postCharge', resId: waiting.id, kind: 'banana', desc: 'X', amount: 10 })).status === 400, 'unknown charge kind: 400');
ok((await post('acc', { type: 'postCharge', resId: waiting.id, kind: 'other', desc: 'X', amount: 0 })).status === 400, 'zero charge: 400');
ok((await post('acc', { type: 'postCharge', resId: waiting.id, kind: 'other', desc: 'X', amount: -5 })).status === 400, 'negative charge: 400');
ok((await post('acc', { type: 'postCharge', resId: futRes.id, kind: 'other', desc: 'X', amount: 10 })).status === 400, 'charging a guest who is not in-house: 400');
ok((await post('front', { type: 'checkOut', resId: waiting.id })).status === 400, 'checkout with an open balance is refused');
ok((await post('acc', { type: 'recordPayment', resId: waiting.id, method: 'cash', amount: bal0 + 341 })).status === 400, 'overpaying the folio by one pound: 400');
ok((await post('acc', { type: 'recordPayment', resId: waiting.id, method: 'banana', amount: 10 })).status === 400, 'unknown payment method: 400');
r = await post('acc', { type: 'recordPayment', resId: waiting.id, method: 'card', amount: bal0 + 340, key: key() });
ok(r.status === 200 && r.j.result.balance === 0, 'accountant settles the folio in full by card');
r = await post('front', { type: 'checkOut', resId: waiting.id });
ok(r.status === 200 && r.j.result.roomNumber === '202', 'front desk checks the guest out');
ok((await view('hk')).rooms.find((x) => x.number === '202').hkStatus === 'dirty', 'room 202 turns dirty for housekeeping');
ok((await post('front', { type: 'checkOut', resId: waiting.id })).status === 400, 'checking out twice: 400');
ok((await post('acc', { type: 'postCharge', resId: waiting.id, kind: 'other', desc: 'X', amount: 10 })).status === 400, 'no charges after checkout: 400');
ok((await post('acc', { type: 'recordPayment', resId: waiting.id, method: 'cash', amount: 1 })).status === 400, 'no payments on a zero folio: 400');

// ---------- cancel and no-show ----------
vw = await view('front');
const toCancel = vw.reservations.find((x) => x.status === 'confirmed' && x.checkIn > today);
ok((await post('front', { type: 'cancelReservation', resId: toCancel.id })).status === 200, 'front desk cancels a future booking');
ok((await post('front', { type: 'cancelReservation', resId: toCancel.id })).status === 400, 'cancelling twice: 400');
const arrToday = vw.reservations.find((x) => x.status === 'confirmed' && x.checkIn === today);
ok((await post('front', { type: 'markNoShow', resId: arrToday.id })).status === 400, 'a guest due today can still arrive: 400');
const lateArr = vw.reservations.find((x) => x.status === 'confirmed' && x.checkIn < today);
if (lateArr) ok((await post('front', { type: 'markNoShow', resId: lateArr.id })).status === 200, 'the overdue arrival is marked no-show');
else ok(true, 'no overdue arrival to mark (none seeded today)');

// ---------- housekeeping board ----------
vw = await view('hk');
const dirty104 = vw.rooms.find((x) => x.number === '104');
ok(dirty104.hkStatus === 'dirty', 'room 104 is dirty on the board');
ok((await post('hk', { type: 'setRoomStatus', roomId: dirty104.id, status: 'clean' })).status === 200, 'housekeeper marks 104 clean');
ok((await post('hk', { type: 'setRoomStatus', roomId: dirty104.id, status: 'inspected' })).status === 200, 'and inspected');
ok((await post('hk', { type: 'setRoomStatus', roomId: dirty104.id, status: 'banana' })).status === 400, 'unknown room status: 400');
const occupiedRoom = vw.rooms.find((x) => x.number === '201');
ok((await post('hk', { type: 'setRoomStatus', roomId: occupiedRoom.id, status: 'dirty' })).status === 400, 'an occupied room cannot be marked dirty: 400');

// ---------- maintenance tickets ----------
r = await post('hk', { type: 'openTicket', roomId: vw.rooms.find((x) => x.number === '105').id, title: 'Window handle broken', desc: 'Guest reported', priority: 'high', key: key() });
ok(r.status === 200 && r.j.result.ticketId, 'housekeeper opens a ticket for room 105');
const tkId = r.j.result.ticketId;
ok((await post('front', { type: 'startTicket', ticketId: tkId })).status === 200, 'front desk starts the work');
ok((await post('front', { type: 'startTicket', ticketId: tkId })).status === 400, 'starting twice: 400');
ok((await post('front', { type: 'closeTicket', ticketId: tkId, note: 'Handle replaced' })).status === 200, 'front desk closes it with a note');
ok((await post('front', { type: 'closeTicket', ticketId: tkId })).status === 400, 'closing twice: 400');
ok((await post('front', { type: 'startTicket', ticketId: 'zz' })).status === 400, 'starting a missing ticket: 400');
ok((await post('hk', { type: 'openTicket', roomId: 'zz', title: 'XXX', priority: 'low' })).status === 400, 'ticket on a missing room: 400');
ok((await post('hk', { type: 'openTicket', roomId: vw.rooms[0].id, title: 'X', priority: 'low' })).status === 400, 'a one-letter title: 400');
ok((await post('hk', { type: 'openTicket', roomId: vw.rooms[0].id, title: 'XXX', priority: 'banana' })).status === 400, 'unknown priority: 400');

// ---------- rooms, types, rate plans (owner) ----------
r = await post('owner', { type: 'addRoom', number: '501', typeId: t1.id, floor: 5, key: key() });
ok(r.status === 200 && r.j.result.roomId, 'owner adds room 501');
ok((await post('owner', { type: 'addRoom', number: '501', typeId: t1.id, floor: 5 })).status === 400, 'the same room number again: 400');
ok((await post('owner', { type: 'addRoom', number: '502', typeId: 'zz', floor: 5 })).status === 400, 'a room of a missing type: 400');
ok((await post('owner', { type: 'addRoom', number: '5', typeId: t1.id, floor: 5 })).status === 400, 'a one-digit room number: 400');
ok((await post('owner', { type: 'addRoom', number: '503', typeId: t1.id, floor: 99 })).status === 400, 'floor 99: 400');
r = await post('owner', { type: 'addRoomType', name: 'Rooftop Studio', nameAr: 'ستوديو السطح', capacity: 2, baseRate: 1500, key: key() });
ok(r.status === 200 && r.j.result.typeId, 'owner adds a rooftop studio type');
ok((await post('owner', { type: 'addRoomType', name: 'rooftop studio', capacity: 2, baseRate: 1500 })).status === 400, 'the same type name again: 400');
ok((await post('owner', { type: 'addRoomType', name: 'XX', capacity: 0, baseRate: 1500 })).status === 400, 'zero capacity: 400');
ok((await post('owner', { type: 'addRoomType', name: 'XX', capacity: 2, baseRate: 50 })).status === 400, 'a 50-pound base rate: 400');
const yy = today.slice(0, 4);
r = await post('owner', { type: 'addRatePlan', name: 'Spring break', typeId: t3.id, start: `${yy}-04-01`, end: `${yy}-04-10`, rate: 2400, key: key() });
ok(r.status === 200 && r.j.result.planId, 'owner adds a spring rate plan for family suites');
ok((await post('owner', { type: 'addRatePlan', name: 'Spring 2', typeId: t3.id, start: `${yy}-04-05`, end: `${yy}-04-15`, rate: 2500 })).status === 400, 'an overlapping plan for the same type: 400');
ok((await post('owner', { type: 'addRatePlan', name: 'Backwards', typeId: t3.id, start: `${yy}-05-10`, end: `${yy}-05-01`, rate: 2500 })).status === 400, 'end before start: 400');
ok((await post('owner', { type: 'deleteRatePlan', planId: r.j.result.planId })).status === 200, 'owner deletes the plan again');
ok((await post('owner', { type: 'deleteRatePlan', planId: 'zz' })).status === 400, 'deleting a missing plan: 400');

// ---------- guests ----------
r = await post('front', { type: 'addGuest', name: 'Nadia <script>window.__xss=1</script> Fahmy', phone: '0100', vip: true, key: key() });
ok(r.status === 200 && r.j.result.guestId, 'front desk adds a VIP guest whose name carries script tags');
const xssGuest = r.j.result.guestId;
ok((await post('front', { type: 'updateGuest', guestId: xssGuest, name: 'Nadia Fahmy', phone: '01001234567', vip: true })).status === 200, 'front desk edits the guest');
ok((await post('front', { type: 'updateGuest', guestId: 'zz', name: 'XX' })).status === 400, 'editing a missing guest: 400');
ok((await post('front', { type: 'addGuest', name: 'X' })).status === 400, 'a one-letter guest name: 400');

// ---------- audit ----------
ok((await view('owner')).audit.length > 10, 'the audit trail fills up for the owner');
ok((await view('front')).audit.length === 0, 'front desk never sees the audit trail');

// ---------- browser on a clean seed ----------
await post('owner', { type: 'reset' });
const pw = await newPage(); await login(pw, '1111'); const bw = await body(pw);
ok(!bare.test(bw), 'owner dashboard: no undefined / NaN / [object');
ok(bw.includes('In-house now') && bw.includes('Arrivals today'), 'owner dashboard shows the house at a glance');
ok(bw.includes('Occupancy this month') && bw.includes('RevPAR'), 'occupancy, ADR and RevPAR are on the dashboard');
ok(bw.includes('401'), 'the urgent ticket on room 401 is flagged on the dashboard');
const ownerNav = await pw.evaluate(() => [...document.querySelectorAll('.nav a')].map((a) => a.getAttribute('href')).join());
ok(ownerNav.includes('rates') && ownerNav.includes('audit') && ownerNav.includes('reports'), 'owner nav reaches rates, reports and the audit log');
for (const rt of ['calendar', 'reservations', 'rooms', 'guests', 'folios', 'rates', 'maintenance', 'reports', 'audit']) { await go(pw, rt); const b2 = await body(pw); ok(!bare.test(b2) && b2.length > 150, 'owner page ' + rt + ' renders'); }
await go(pw, 'maintenance'); const bmt = await body(pw);
ok(bmt.includes('AC not cooling') && bmt.includes('Urgent'), 'maintenance board shows the urgent AC ticket');
await go(pw, 'reservations'); const bres = await body(pw);
ok(bres.includes('NZ-') && bres.includes('Mahmoud') && /confirmation/i.test(bres), 'reservations page lists confirmation numbers and guests');
await go(pw, 'calendar'); const bcal = await body(pw);
ok(bcal.includes('Availability') && bcal.includes('Standard Queen'), 'the 14-day availability grid renders by room type');
await go(pw, 'rates'); const brt = await body(pw);
ok(brt.includes('Summer high') && brt.includes('3,200'), 'rates page shows the summer sea-view plan at 3,200');
await go(pw, 'audit'); const bau = await body(pw);
ok(bau.includes('checkOut') || bau.includes('checkIn'), 'the audit log shows seeded activity');
const fv2 = await newPage(); await login(fv2, '2222'); const bf = await body(fv2);
ok(!bare.test(bf), 'front desk dashboard renders');
const fNav = await fv2.evaluate(() => [...document.querySelectorAll('.nav a')].map((a) => a.getAttribute('href')).join());
ok(!fNav.includes('rates') && !fNav.includes('audit') && !fNav.includes('reports') && fNav.includes('reservations'), 'front desk nav: no rates, reports or audit');
const hk2 = await newPage(); await login(hk2, '3333'); const bh = await body(hk2);
ok(!bare.test(bh), 'housekeeping dashboard renders');
const hNav = await hk2.evaluate(() => [...document.querySelectorAll('.nav a')].map((a) => a.getAttribute('href')).join());
ok(hNav === '#/dashboard,#/rooms,#/maintenance', 'housekeeping nav is dashboard, rooms and maintenance only');
ok(!bh.includes('EGP') && !/RevPAR|ADR/.test(bh), 'no money on the housekeeping dashboard');
await go(hk2, 'rooms'); const bhr = await body(hk2);
ok(bhr.includes('104') && bhr.includes('Dirty'), 'housekeeping board shows dirty rooms');
await go(hk2, 'reservations'); const bhr2 = await body(hk2);
ok(!bhr2.includes('Confirmation'), 'a typed hash never shows housekeeping the reservations ledger');
const ac2 = await newPage(); await login(ac2, '4444'); const bac = await body(ac2);
ok(!bare.test(bac), 'accountant dashboard renders');
const aNav = await ac2.evaluate(() => [...document.querySelectorAll('.nav a')].map((a) => a.getAttribute('href')).join());
ok(!aNav.includes('rooms') && !aNav.includes('maintenance') && !aNav.includes('rates') && aNav.includes('folios'), 'accountant nav: folios and reports, no operations boards');
await go(ac2, 'reports'); const brep = await body(ac2);
ok(/revpar/i.test(brep) && /room-nights sold/i.test(brep), 'accountant reports render occupancy, ADR and RevPAR');
const pl = await newPage(); await pl.goto(U + '/', { waitUntil: 'networkidle0' }); await pl.evaluate(() => localStorage.clear()); await pl.goto(U + '/', { waitUntil: 'networkidle0' });
const bl = await body(pl);
ok(bl.includes('1111') && bl.includes('4444') && bl.includes('Front desk') && bl.includes('Housekeeping'), 'sign-in screen lists the four demo roles with PINs');

// ---------- booking through the UI ----------
const pu = await newPage(); await login(pu, '2222');
await go(pu, 'reservations');
await pu.click('[data-act="newres"]'); await sleep(400);
ok(await pu.evaluate(() => !!document.querySelector('.modal')), 'the new-reservation modal opens');
await pu.evaluate((d40, d43) => {
  document.querySelector('#m-type').value = 't1';
  document.querySelector('#m-in').value = d40; document.querySelector('#m-out').value = d43;
  document.querySelector('#m-guestName').value = 'UI Booking Guest';
}, d40, d43);
await pu.click('[data-act="msave"]'); await sleep(900);
ok((await body(pu)).includes('UI Booking Guest'), 'a booking made through the modal appears in the list');
const uiRes = (await view('front')).reservations.find((x) => x.guestName === 'UI Booking Guest');
ok(!!uiRes && uiRes.status === 'confirmed', 'the UI booking is confirmed in the data');

// ---------- XSS stays text ----------
const pe = await newPage(); await login(pe, '1111');
await post('front', { type: 'addGuest', name: 'E2E <script>window.__xss=1</script> Script', phone: '', key: key() });
await pe.evaluate(() => { location.hash = '#/guests'; }); await pe.reload({ waitUntil: 'networkidle0' }); await sleep(900);
ok(!(await pe.evaluate(() => window.__xss === 1)), 'script in a guest name never runs');
ok((await body(pe)).includes('E2E'), 'the guest name is visible as text');

// ---------- Arabic and mobile ----------
const pa = await newPage(); await login(pa, '1111', 'ar'); const bAr = await body(pa);
ok((await pa.evaluate(() => document.documentElement.dir)) === 'rtl' && bAr.includes('الحجوزات'), 'Arabic: RTL with translated chrome');
await go(pa, 'reports'); const bArR = await body(pa);
ok(bArR.includes('الإشغال') || bArR.includes('الإيراد'), 'Arabic reports render translated');
ok(!/\[object|NaN|undefined/.test(bAr), 'Arabic pages carry no placeholders');
const pmob = await newPage(390, 844); await login(pmob, '1111');
ok(await pmob.evaluate(() => document.documentElement.scrollWidth <= 395), '390px dashboard: no horizontal scroll');
await go(pmob, 'calendar'); ok(await pmob.evaluate(() => document.documentElement.scrollWidth <= 400), '390px calendar: no horizontal scroll');
await go(pmob, 'reservations'); ok(await pmob.evaluate(() => document.documentElement.scrollWidth <= 400), '390px reservations: no horizontal scroll');
await go(pmob, 'reports'); ok(await pmob.evaluate(() => document.documentElement.scrollWidth <= 400), '390px reports: no horizontal scroll');
const hmob = await newPage(390, 844); await login(hmob, '3333'); await go(hmob, 'rooms');
ok(await hmob.evaluate(() => document.documentElement.scrollWidth <= 400), '390px housekeeping board: no horizontal scroll');
ok(errs.length === 0, 'zero page errors in every session' + (errs.length ? ' — ' + errs.join(' | ').slice(0, 300) : ''));

// ---------- reset ----------
ok((await post('owner', { type: 'reset' })).status === 200, 'reset works');
const ov2 = await view('owner');
ok(ov2.reports.totals.inHouse === 4 && ov2.reports.totals.arrivals === 3 && ov2.rooms.length === 16, 'after reset the demo data is back');
await b.close();
console.log(`RESULT ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
