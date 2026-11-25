import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../public/logic.js';

const NOW = Date.UTC(2026, 10, 25, 12); // noon UTC, Cairo evening of 2026-11-25
const today = L.dayKey(NOW);
const fresh = () => L.seed(NOW);
const u = (s, role) => s.users.find((x) => x.role === role);
const run = (s, role, op) => L.applyOp(s, op, { user: u(s, role), now: NOW });
const viewFor = (s, role) => L.view(s, u(s, role), NOW);

test('seed is internally consistent', () => {
  const s = fresh();
  assert.equal(s.roomTypes.length, 4);
  assert.equal(s.rooms.length, 16);
  for (const r of s.rooms) assert.ok(s.roomTypes.some((t) => t.id === r.typeId));
  // no room ever holds two overlapping active stays
  for (const room of s.rooms) {
    const stays = s.reservations.filter((r) => r.roomId === room.id && ['confirmed', 'checked_in'].includes(r.status)).sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1));
    for (let i = 1; i < stays.length; i++) assert.ok(stays[i].checkIn >= stays[i - 1].checkOut, room.number + ' double-booked');
  }
  // folios never negative in seed
  for (const r of s.reservations) assert.ok(L.folioBalance(s, r.id) >= 0, r.id);
  assert.ok(s.reservations.filter((r) => r.status === 'checked_in').length === 4);
  assert.ok(s.reservations.filter((r) => r.status === 'confirmed' && r.checkIn === today).length === 3);
  assert.ok(s.tickets.some((t) => t.priority === 'urgent' && t.status === 'open'));
  const v = viewFor(s, 'owner');
  assert.equal(v.reports.byMonth.length, 12);
  for (const m of v.reports.byMonth) {
    assert.ok(m.sold <= m.available);
    assert.ok(m.occupancy >= 0 && m.occupancy <= 100);
    if (m.sold > 0) { assert.ok(m.adr > 0); assert.ok(m.revenue > 0); }
  }
  assert.ok(v.insights.some((i) => i.kind === 'arrival_today'));
  assert.ok(v.insights.some((i) => i.kind === 'departure_due'));
  assert.ok(v.insights.some((i) => i.kind === 'dirty_rooms'));
  assert.ok(v.insights.some((i) => i.kind === 'ticket_urgent'));
});

test('rateFor uses seasonal plan inside its window, base rate outside', () => {
  const s = fresh();
  const t4 = s.roomTypes[3];
  const y = today.slice(0, 4);
  assert.equal(L.rateFor(s, t4.id, `${y}-07-10`), 3200);
  assert.equal(L.rateFor(s, t4.id, `${y}-03-10`), t4.baseRate);
  const t1 = s.roomTypes[0];
  assert.equal(L.rateFor(s, t1.id, `${y}-12-25`), 1200);
  assert.equal(L.rateFor(s, t1.id, `${y}-11-25`), t1.baseRate);
});

test('book: overbooking guard, capacity, dates, quote, idempotency', () => {
  const s = fresh();
  const t1 = s.roomTypes[0];
  const inD = L.addDays(today, 40), outD = L.addDays(today, 43);
  const g = s.guests[0];
  const r = run(s, 'front', { type: 'book', key: 'bk-1', guestId: g.id, typeId: t1.id, checkIn: inD, checkOut: outD, adults: 2, children: 0, source: 'direct' });
  assert.match(r.confNo, /^NZ-\d{4}$/);
  assert.equal(r.total, L.quoteStay(s, t1.id, inD, outD));
  assert.equal(r.total, L.quoteStay(s, t1.id, inD, outD));
  // duplicate key is a no-op
  const n = s.reservations.length;
  const dup = run(s, 'front', { type: 'book', key: 'bk-1', guestId: g.id, typeId: t1.id, checkIn: inD, checkOut: outD, adults: 2 });
  assert.ok(dup.duplicate);
  assert.equal(s.reservations.length, n);
  // fill the remaining 5 rooms of t1 on those nights
  for (let i = 0; i < 5; i++) run(s, 'front', { type: 'book', key: 'bkx-' + i, guestId: g.id, typeId: t1.id, checkIn: inD, checkOut: outD, adults: 1 });
  assert.throws(() => run(s, 'front', { type: 'book', guestId: g.id, typeId: t1.id, checkIn: inD, checkOut: outD, adults: 1 }), /No rooms of this type/);
  // capacity: family suite sleeps 5
  const t3 = s.roomTypes[2];
  assert.throws(() => run(s, 'front', { type: 'book', guestId: g.id, typeId: t3.id, checkIn: inD, checkOut: outD, adults: 5, children: 1 }), /sleeps 5/);
  assert.throws(() => run(s, 'front', { type: 'book', guestId: g.id, typeId: t3.id, checkIn: L.addDays(today, -1), checkOut: outD, adults: 2 }), /past/);
  assert.throws(() => run(s, 'front', { type: 'book', guestId: g.id, typeId: t3.id, checkIn: inD, checkOut: inD, adults: 2 }), /after check-in/);
  assert.throws(() => run(s, 'front', { type: 'book', guestId: g.id, typeId: t3.id, checkIn: inD, checkOut: L.addDays(inD, 31), adults: 2 }), /longer than 30/);
  // book can create a new guest inline
  const before = s.guests.length;
  run(s, 'front', { type: 'book', guestName: 'New Walk-In Guest', typeId: t3.id, checkIn: inD, checkOut: outD, adults: 2 });
  assert.equal(s.guests.length, before + 1);
});

test('assign room: type match, clean, free for whole stay, ticket blocks', () => {
  const s = fresh();
  const waiting = s.reservations.find((r) => r.status === 'confirmed' && r.checkIn === today && !r.roomId && r.typeId === s.roomTypes[1].id);
  const t2rooms = s.rooms.filter((x) => x.typeId === s.roomTypes[1].id);
  const free = t2rooms.find((x) => x.number === '202');
  assert.ok(L.roomFree(s, free.id, waiting.checkIn, waiting.checkOut, waiting.id));
  const res = run(s, 'front', { type: 'assignRoom', resId: waiting.id, roomId: free.id });
  assert.equal(res.roomNumber, '202');
  // wrong type refused
  const other = s.reservations.find((r) => r.status === 'confirmed' && !r.roomId && r.typeId !== s.roomTypes[1].id);
  assert.throws(() => run(s, 'front', { type: 'assignRoom', resId: other.id, roomId: t2rooms[1].id }), /different type/);
  // dirty room refused (205)
  const dirty = s.rooms.find((x) => x.number === '205');
  assert.throws(() => run(s, 'front', { type: 'assignRoom', resId: other.id, roomId: dirty.id }), /different type|not clean/);
});

test('check-in auto-assigns and posts room charges per night; checkout blocked by balance', () => {
  const s = fresh();
  const arr = s.reservations.find((r) => r.status === 'confirmed' && r.checkIn === today && !r.roomId);
  const before = s.charges.length;
  const res = run(s, 'front', { type: 'checkIn', resId: arr.id });
  const rr = s.reservations.find((x) => x.id === arr.id);
  assert.equal(rr.status, 'checked_in');
  assert.ok(rr.roomId);
  assert.equal(s.charges.length, before + L.nightsOf(rr));
  assert.equal(res.total, L.quoteStay(s, rr.typeId, rr.checkIn, rr.checkOut));
  const bal = L.folioBalance(s, rr.id);
  assert.ok(bal > 0);
  assert.throws(() => run(s, 'front', { type: 'checkOut', resId: rr.id }), /balance/);
  // pay in full, then checkout works and room turns dirty
  run(s, 'accountant', { type: 'recordPayment', resId: rr.id, method: 'card', amount: bal });
  assert.equal(L.folioBalance(s, rr.id), 0);
  const room = L.view(s, u(s, 'owner'), NOW).rooms.find((x) => x.id === rr.roomId);
  const out = run(s, 'front', { type: 'checkOut', resId: rr.id });
  assert.ok(out.roomNumber);
  assert.equal(s.rooms.find((x) => x.id === rr.roomId).hkStatus, 'dirty');
  assert.equal(room.number, out.roomNumber);
});

test('charges only while in-house; payment capped at balance', () => {
  const s = fresh();
  const inhouse = s.reservations.find((r) => r.status === 'checked_in');
  const c = run(s, 'front', { type: 'postCharge', key: 'c-1x', resId: inhouse.id, kind: 'restaurant', desc: 'Dinner', amount: 250 });
  assert.equal(c.balance, L.folioBalance(s, inhouse.id));
  const confirmed = s.reservations.find((r) => r.status === 'confirmed');
  assert.throws(() => run(s, 'front', { type: 'postCharge', resId: confirmed.id, kind: 'laundry', amount: 50 }), /in-house/);
  assert.throws(() => run(s, 'accountant', { type: 'recordPayment', resId: inhouse.id, method: 'cash', amount: c.balance + 1 }), /more than the folio balance/);
  assert.throws(() => run(s, 'front', { type: 'postCharge', resId: inhouse.id, kind: 'other', amount: 0 }), /Amount/);
});

test('cancel and no-show rules', () => {
  const s = fresh();
  const fut = s.reservations.find((r) => r.status === 'confirmed' && r.checkIn > today);
  run(s, 'front', { type: 'cancelReservation', resId: fut.id });
  assert.equal(s.reservations.find((x) => x.id === fut.id).status, 'cancelled');
  assert.throws(() => run(s, 'front', { type: 'cancelReservation', resId: fut.id }), /confirmed/);
  const todayArr = s.reservations.find((r) => r.status === 'confirmed' && r.checkIn === today);
  assert.throws(() => run(s, 'front', { type: 'markNoShow', resId: todayArr.id }), /still arrive/);
  const late = s.reservations.find((r) => r.status === 'confirmed' && r.checkIn < today);
  if (late) { run(s, 'front', { type: 'markNoShow', resId: late.id }); assert.equal(s.reservations.find((x) => x.id === late.id).status, 'no_show'); }
});

test('housekeeping board: status flips, occupied rooms locked', () => {
  const s = fresh();
  const dirty = s.rooms.find((x) => x.number === '104');
  run(s, 'housekeeping', { type: 'setRoomStatus', roomId: dirty.id, status: 'clean' });
  assert.equal(s.rooms.find((x) => x.id === dirty.id).hkStatus, 'clean');
  run(s, 'housekeeping', { type: 'setRoomStatus', roomId: dirty.id, status: 'inspected' });
  const occupied = s.rooms.find((x) => s.reservations.some((r) => r.status === 'checked_in' && r.roomId === x.id));
  assert.throws(() => run(s, 'housekeeping', { type: 'setRoomStatus', roomId: occupied.id, status: 'dirty' }), /occupied/);
  assert.throws(() => run(s, 'accountant', { type: 'setRoomStatus', roomId: dirty.id, status: 'clean' }), /permission/);
});

test('urgent ticket blocks the room', () => {
  const s = fresh();
  const r401 = s.rooms.find((x) => x.number === '401');
  const v = viewFor(s, 'front');
  assert.ok(v.rooms.find((x) => x.number === '401').openTickets >= 1);
  assert.ok(!L.roomFree(s, r401.id, today, L.addDays(today, 1)));
});

test('tickets: open → start → done; done frees the room', () => {
  const s = fresh();
  const r401 = s.rooms.find((x) => x.number === '401');
  const tk = s.tickets.find((x) => x.roomId === r401.id && x.status === 'open');
  assert.throws(() => run(s, 'front', { type: 'startTicket', ticketId: tk.id + 'zz' }), /not found/);
  run(s, 'front', { type: 'startTicket', ticketId: tk.id });
  assert.throws(() => run(s, 'front', { type: 'startTicket', ticketId: tk.id }), /open ticket can start/);
  run(s, 'front', { type: 'closeTicket', ticketId: tk.id, note: 'Compressor replaced' });
  assert.equal(s.tickets.find((x) => x.id === tk.id).status, 'done');
  assert.throws(() => run(s, 'front', { type: 'closeTicket', ticketId: tk.id }), /already done/);
  assert.ok(L.roomFree(s, r401.id, today, L.addDays(today, 1)));
});

test('owner-only: rooms, types, rate plans', () => {
  const s = fresh();
  assert.throws(() => run(s, 'front', { type: 'addRoom', number: '501', typeId: s.roomTypes[0].id, floor: 5 }), /permission/);
  const rm = run(s, 'owner', { type: 'addRoom', key: 'r-1x', number: '501', typeId: s.roomTypes[0].id, floor: 5 });
  assert.ok(rm.roomId);
  assert.throws(() => run(s, 'owner', { type: 'addRoom', number: '501', typeId: s.roomTypes[0].id, floor: 5 }), /exists/);
  const tp = run(s, 'owner', { type: 'addRoomType', key: 't-1x', name: 'Rooftop Studio', nameAr: 'ستوديو السطح', capacity: 2, baseRate: 1500 });
  assert.ok(tp.typeId);
  const y = today.slice(0, 4);
  const p = run(s, 'owner', { type: 'addRatePlan', key: 'p-1x', name: 'Eid', typeId: s.roomTypes[0].id, start: `${y}-04-01`, end: `${y}-04-10`, rate: 1400 });
  assert.ok(p.planId);
  assert.throws(() => run(s, 'owner', { type: 'addRatePlan', name: 'Eid 2', typeId: s.roomTypes[0].id, start: `${y}-04-05`, end: `${y}-04-15`, rate: 1500 }), /covers part/);
  run(s, 'owner', { type: 'deleteRatePlan', planId: p.planId });
  assert.ok(!s.ratePlans.some((x) => x.id === p.planId));
});

test('permissions across roles', () => {
  const s = fresh();
  const g = s.guests[0];
  const inD = L.addDays(today, 40), outD = L.addDays(today, 42);
  assert.throws(() => run(s, 'housekeeping', { type: 'book', guestId: g.id, typeId: s.roomTypes[0].id, checkIn: inD, checkOut: outD, adults: 1 }), /permission/);
  assert.throws(() => run(s, 'accountant', { type: 'book', guestId: g.id, typeId: s.roomTypes[0].id, checkIn: inD, checkOut: outD, adults: 1 }), /permission/);
  assert.throws(() => run(s, 'housekeeping', { type: 'recordPayment', resId: 'x', method: 'cash', amount: 1 }), /permission/);
  const tk = run(s, 'housekeeping', { type: 'openTicket', key: 'hk-1', roomId: s.rooms[0].id, title: 'Light flickers', priority: 'low' });
  assert.ok(tk.ticketId);
});

test('views: housekeeping sees no money, owner sees audit', () => {
  const s = fresh();
  const hk = viewFor(s, 'housekeeping');
  assert.equal(hk.charges.length, 0);
  assert.equal(hk.payments.length, 0);
  assert.equal(hk.ratePlans.length, 0);
  for (const r of hk.reservations) assert.ok(!('balance' in r), 'no balance for hk');
  assert.equal(hk.reports.totals.monthRevenue, 0);
  assert.equal(hk.audit.length, 0);
  const own = viewFor(s, 'owner');
  assert.ok(own.charges.length > 100);
  assert.ok(own.payments.length > 50);
  assert.ok(own.audit.length > 0);
  assert.ok(own.users.length === 4);
  const acc = viewFor(s, 'accountant');
  assert.ok(acc.charges.length > 100);
  assert.ok(acc.reservations.every((r) => 'balance' in r));
});

test('monthly report math: occupancy, ADR, RevPAR are consistent', () => {
  const s = fresh();
  const v = viewFor(s, 'owner');
  for (const m of v.reports.byMonth) {
    assert.equal(m.occupancy, m.available ? Math.round((m.sold / m.available) * 100) : 0);
    if (m.sold > 0) assert.equal(m.adr, Math.round(m.revenue / m.sold));
    if (m.available > 0) assert.equal(m.revpar, Math.round(m.revenue / m.available));
    const rev = s.charges.filter((c) => c.kind === 'room' && c.date.startsWith(m.month)).reduce((x, c) => x + c.amount, 0);
    assert.equal(m.revenue, rev);
  }
  // seed keeps every month in a believable band
  for (const m of v.reports.byMonth) assert.ok(m.occupancy >= 25 && m.occupancy <= 75, m.month + ' ' + m.occupancy);
});
