// Nuzul business rules. Pure functions shared by the browser, the API and the tests.
// Money is whole EGP. Cairo calendar days are 'YYYY-MM-DD'. Times are epoch ms.
export const TZ = 'Africa/Cairo';
export const ROLES = { owner: 'owner', front: 'front', housekeeping: 'housekeeping', accountant: 'accountant' };
export const DEMO_USERS = [
  { pin: '1111', label: 'Owner (Mr. Adel)', labelAr: 'المالك (أ. عادل)' },
  { pin: '2222', label: 'Front desk (Mariam)', labelAr: 'الاستقبال (مريم)' },
  { pin: '3333', label: 'Housekeeping (Soad)', labelAr: 'التدبير المنزلي (سعاد)' },
  { pin: '4444', label: 'Accountant (Karim)', labelAr: 'المحاسب (كريم)' },
];
export const RES_STATUS = ['confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'];
export const ROOM_STATUS = ['clean', 'dirty', 'inspected'];
export const CHARGE_KINDS = ['room', 'restaurant', 'laundry', 'minibar', 'service', 'other'];
export const PAY_METHODS = ['cash', 'card', 'transfer'];
export const SOURCES = ['direct', 'phone', 'walk_in', 'booking_site'];
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const TICKET_STATUS = ['open', 'in_progress', 'done'];
export const MAX_AMOUNT = 5000000;
export const MAX_NIGHTS = 30;

export class UserError extends Error {}
export class PermError extends Error {}

// ---------- dates ----------
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = (ts) => fmt.format(ts);
const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const toKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (k, n) => toKey(parse(k) + n * 864e5);
export const monthOf = (k) => k.slice(0, 7);
export const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && toKey(parse(k)) === k;
export const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const t = y * 12 + (mo - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
export const nightsOf = (r) => daysBetween(r.checkIn, r.checkOut);
export const overlaps = (aIn, aOut, bIn, bOut) => aIn < bOut && bIn < aOut;
export const eachNight = (r) => { const out = []; for (let d = r.checkIn; d < r.checkOut; d = addDays(d, 1)) out.push(d); return out; };

// ---------- validation ----------
const str = (v, min, max, label) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) throw new UserError(`${label} must be ${min === max ? min : `${min} to ${max}`} characters`);
  return s;
};
const optStr = (v, max, label) => (v === undefined || v === null || v === '' ? '' : str(v, 0, max, label));
const intIn = (v, min, max, label) => { if (!Number.isInteger(v) || v < min || v > max) throw new UserError(`${label} must be a whole number from ${min} to ${max}`); return v; };
const oneOf = (v, list, msg) => { if (typeof v !== 'string' || !list.includes(v)) throw new UserError(msg); return v; };
const need = (user, roles) => { if (!roles.includes(user.role)) throw new PermError('You do not have permission to do this'); };
const nextId = (s, p) => `${p}${(s.counters[p] = (s.counters[p] || 0) + 1)}`;
const audit = (s, user, now, action, detail) => { s.audit.unshift({ ts: now, userId: user.id, name: user.name, action, detail: String(detail).slice(0, 200) }); if (s.audit.length > 400) s.audit.length = 400; };
const once = (s, op, fn) => {
  if (op.key !== undefined && (typeof op.key !== 'string' || op.key.length < 4 || op.key.length > 64)) throw new UserError('Bad request');
  if (op.key && s.keys.includes(op.key)) return { duplicate: true };
  const r = fn(); if (op.key) { s.keys.push(op.key); if (s.keys.length > 600) s.keys.shift(); } return r;
};
const find = (arr, id, what) => { const x = typeof id === 'string' ? arr.find((y) => y.id === id) : null; if (!x) throw new UserError(`${what} not found`); return x; };
const getRes = (s, id) => find(s.reservations, id, 'Reservation');
const getRoom = (s, id) => find(s.rooms, id, 'Room');
const getType = (s, id) => find(s.roomTypes, id, 'Room type');
const getTicket = (s, id) => find(s.tickets, id, 'Ticket');

// ---------- rates ----------
export function rateFor(s, typeId, date) {
  const t = getType(s, typeId);
  const plan = s.ratePlans.filter((p) => p.typeId === typeId && p.start <= date && date <= p.end).sort((a, b) => (a.start < b.start ? -1 : 1)).pop();
  return plan ? plan.rate : t.baseRate;
}
export function quoteStay(s, typeId, checkIn, checkOut) {
  let total = 0;
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) total += rateFor(s, typeId, d);
  return total;
}

// ---------- availability ----------
const activeRes = (s) => s.reservations.filter((r) => r.status === 'confirmed' || r.status === 'checked_in');
export function typeBookedOn(s, typeId, checkIn, checkOut, exceptId) {
  return activeRes(s).filter((r) => r.typeId === typeId && r.id !== exceptId && overlaps(r.checkIn, r.checkOut, checkIn, checkOut)).length;
}
export function typeAvailable(s, typeId, checkIn, checkOut, exceptId) {
  const total = s.rooms.filter((x) => x.typeId === typeId).length;
  let worst = 0;
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
    const booked = activeRes(s).filter((r) => r.typeId === typeId && r.id !== exceptId && r.checkIn <= d && d < r.checkOut).length;
    if (booked > worst) worst = booked;
  }
  return total - worst;
}
export function roomFree(s, roomId, checkIn, checkOut, exceptId) {
  const room = getRoom(s, roomId);
  if (s.tickets.some((t) => t.roomId === roomId && t.status !== 'done')) return false;
  return !activeRes(s).some((r) => r.roomId === roomId && r.id !== exceptId && overlaps(r.checkIn, r.checkOut, checkIn, checkOut));
}

// ---------- folios ----------
export const folioCharges = (s, resId) => s.charges.filter((c) => c.resId === resId).reduce((x, c) => x + c.amount, 0);
export const folioPaid = (s, resId) => s.payments.filter((p) => p.resId === resId).reduce((x, p) => x + p.amount, 0);
export const folioBalance = (s, resId) => folioCharges(s, resId) - folioPaid(s, resId);

// ---------- reports ----------
export function monthReport(s, month, roomsCount) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let sold = 0, revenue = 0;
  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const inHouse = s.reservations.filter((r) => (r.status === 'checked_in' || r.status === 'checked_out') && r.checkIn <= date && date < r.checkOut);
    sold += inHouse.length;
    revenue += s.charges.filter((c) => c.kind === 'room' && c.date === date).reduce((x, c) => x + c.amount, 0);
  }
  const available = days * roomsCount;
  return {
    month, days, sold, available, revenue,
    occupancy: available ? Math.round((sold / available) * 100) : 0,
    adr: sold ? Math.round(revenue / sold) : 0,
    revpar: available ? Math.round(revenue / available) : 0,
  };
}

// ---------- operations ----------
const FRONT = ['owner', 'front'];
const MONEY = ['owner', 'front', 'accountant'];
export const OP_ROLES = {
  book: FRONT, cancelReservation: FRONT, markNoShow: FRONT, assignRoom: FRONT, checkIn: FRONT, checkOut: FRONT,
  addGuest: FRONT, updateGuest: FRONT,
  postCharge: MONEY, recordPayment: MONEY,
  setRoomStatus: ['owner', 'housekeeping'],
  openTicket: ['owner', 'front', 'housekeeping'], startTicket: FRONT, closeTicket: FRONT,
  addRoomType: ['owner'], addRoom: ['owner'], addRatePlan: ['owner'], deleteRatePlan: ['owner'],
};

const txDate = (op, now) => {
  const today = dayKey(now);
  const d = op.date === undefined ? today : op.date;
  if (!isKey(d)) throw new UserError('Date must be a valid date');
  if (d > today) throw new UserError('Date cannot be in the future');
  if (d < addDays(today, -365)) throw new UserError('Date cannot be more than a year ago');
  return d;
};

const OPS = {
  addGuest(s, op, { user, now }) {
    need(user, OP_ROLES.addGuest);
    return once(s, op, () => {
      const g = { id: nextId(s, 'g'), name: str(op.name, 2, 80, 'Name'), phone: optStr(op.phone, 30, 'Phone'), email: optStr(op.email, 80, 'Email'), notes: optStr(op.notes, 200, 'Notes'), vip: op.vip === true, createdAt: now };
      s.guests.push(g); audit(s, user, now, 'addGuest', `${g.id} ${g.name}`); return { guestId: g.id };
    });
  },
  updateGuest(s, op, { user, now }) {
    need(user, OP_ROLES.updateGuest);
    const g = find(s.guests, op.guestId, 'Guest');
    Object.assign(g, { name: str(op.name, 2, 80, 'Name'), phone: optStr(op.phone, 30, 'Phone'), email: optStr(op.email, 80, 'Email'), notes: optStr(op.notes, 200, 'Notes'), vip: op.vip === true });
    audit(s, user, now, 'updateGuest', g.id); return {};
  },
  book(s, op, { user, now }) {
    need(user, OP_ROLES.book);
    return once(s, op, () => {
      const t = getType(s, op.typeId);
      const checkIn = op.checkIn, checkOut = op.checkOut, today = dayKey(now);
      if (!isKey(checkIn) || !isKey(checkOut)) throw new UserError('Dates must be valid dates');
      if (checkIn < today) throw new UserError('The check-in date cannot be in the past');
      if (checkOut <= checkIn) throw new UserError('The check-out date must be after check-in');
      if (daysBetween(checkIn, checkOut) > MAX_NIGHTS) throw new UserError(`A stay cannot be longer than ${MAX_NIGHTS} nights`);
      const adults = intIn(op.adults, 1, 6, 'Adults'), children = intIn(op.children ?? 0, 0, 4, 'Children');
      if (adults + children > t.capacity) throw new UserError(`This room type sleeps ${t.capacity}`);
      if (typeAvailable(s, t.id, checkIn, checkOut) < 1) throw new UserError('No rooms of this type are free for those dates');
      let g;
      if (op.guestId) g = find(s.guests, op.guestId, 'Guest');
      else { g = { id: nextId(s, 'g'), name: str(op.guestName, 2, 80, 'Guest name'), phone: optStr(op.phone, 30, 'Phone'), email: optStr(op.email, 80, 'Email'), notes: '', vip: false, createdAt: now }; s.guests.push(g); }
      const source = oneOf(op.source ?? 'direct', SOURCES, 'Unknown source');
      const r = { id: nextId(s, 'r'), confNo: `NZ-${String(++s.counters.conf).padStart(4, '0')}`, guestId: g.id, typeId: t.id, roomId: null, checkIn, checkOut, adults, children, source, note: optStr(op.note, 150, 'Note'), status: 'confirmed', by: user.id, createdAt: now, checkedInAt: null, checkedOutAt: null };
      s.reservations.push(r); audit(s, user, now, 'book', `${r.confNo} ${g.name} ${checkIn}→${checkOut}`);
      return { resId: r.id, confNo: r.confNo, guestId: g.id, total: quoteStay(s, t.id, checkIn, checkOut) };
    });
  },
  cancelReservation(s, op, { user, now }) {
    need(user, OP_ROLES.cancelReservation);
    const r = getRes(s, op.resId);
    if (r.status !== 'confirmed') throw new UserError('Only a confirmed reservation can be cancelled');
    r.status = 'cancelled'; r.cancelledAt = now; audit(s, user, now, 'cancelReservation', r.confNo); return {};
  },
  markNoShow(s, op, { user, now }) {
    need(user, OP_ROLES.markNoShow);
    const r = getRes(s, op.resId);
    if (r.status !== 'confirmed') throw new UserError('Only a confirmed reservation can be a no-show');
    if (dayKey(now) <= r.checkIn) throw new UserError('The guest can still arrive today');
    r.status = 'no_show'; audit(s, user, now, 'markNoShow', r.confNo); return {};
  },
  assignRoom(s, op, { user, now }) {
    need(user, OP_ROLES.assignRoom);
    const r = getRes(s, op.resId);
    if (r.status !== 'confirmed') throw new UserError('Only a confirmed reservation needs a room');
    const room = getRoom(s, op.roomId);
    if (room.typeId !== r.typeId) throw new UserError('That room is a different type');
    if (room.hkStatus === 'dirty') throw new UserError('That room is not clean yet');
    if (!roomFree(s, room.id, r.checkIn, r.checkOut, r.id)) throw new UserError('That room is not free for the whole stay');
    r.roomId = room.id; audit(s, user, now, 'assignRoom', `${r.confNo} → ${room.number}`); return { roomNumber: room.number };
  },
  checkIn(s, op, { user, now }) {
    need(user, OP_ROLES.checkIn);
    const r = getRes(s, op.resId);
    if (r.status !== 'confirmed') throw new UserError('Only a confirmed reservation can check in');
    const today = dayKey(now);
    if (today < r.checkIn) throw new UserError('This guest arrives on ' + r.checkIn);
    if (today >= r.checkOut) throw new UserError('This stay has already ended; book a new one');
    if (!r.roomId) {
      const room = s.rooms.find((x) => x.typeId === r.typeId && x.hkStatus !== 'dirty' && roomFree(s, x.id, r.checkIn, r.checkOut, r.id));
      if (!room) throw new UserError('No clean room of this type is free; assign one manually');
      r.roomId = room.id;
    } else if (!roomFree(s, r.roomId, r.checkIn, r.checkOut, r.id)) throw new UserError('The assigned room is no longer free');
    r.status = 'checked_in'; r.checkedInAt = now;
    for (const d of eachNight(r)) {
      s.charges.push({ id: nextId(s, 'ch'), resId: r.id, kind: 'room', desc: `Room ${getRoom(s, r.roomId).number} · ${d}`, amount: rateFor(s, r.typeId, d), date: d, by: user.id, ts: now });
    }
    audit(s, user, now, 'checkIn', `${r.confNo} room ${getRoom(s, r.roomId).number}`);
    return { roomNumber: getRoom(s, r.roomId).number, total: quoteStay(s, r.typeId, r.checkIn, r.checkOut) };
  },
  checkOut(s, op, { user, now }) {
    need(user, OP_ROLES.checkOut);
    const r = getRes(s, op.resId);
    if (r.status !== 'checked_in') throw new UserError('Only an in-house guest can check out');
    const bal = folioBalance(s, r.id);
    if (bal > 0) throw new UserError(`The folio still has a balance of ${bal} EGP`);
    r.status = 'checked_out'; r.checkedOutAt = now;
    const room = getRoom(s, r.roomId); room.hkStatus = 'dirty';
    audit(s, user, now, 'checkOut', `${r.confNo} room ${room.number}`); return { roomNumber: room.number };
  },
  postCharge(s, op, { user, now }) {
    need(user, OP_ROLES.postCharge);
    return once(s, op, () => {
      const r = getRes(s, op.resId);
      if (r.status !== 'checked_in') throw new UserError('Charges can only be posted while the guest is in-house');
      const c = { id: nextId(s, 'ch'), resId: r.id, kind: oneOf(op.kind, CHARGE_KINDS, 'Unknown charge kind'), desc: optStr(op.desc, 120, 'Description'), amount: intIn(op.amount, 1, MAX_AMOUNT, 'Amount'), date: txDate(op, now), by: user.id, ts: now };
      s.charges.push(c); audit(s, user, now, 'postCharge', `${r.confNo} ${c.kind} ${c.amount}`); return { chargeId: c.id, balance: folioBalance(s, r.id) };
    });
  },
  recordPayment(s, op, { user, now }) {
    need(user, OP_ROLES.recordPayment);
    return once(s, op, () => {
      const r = getRes(s, op.resId);
      if (r.status !== 'checked_in' && r.status !== 'checked_out') throw new UserError('There is no open folio for this reservation');
      const amt = intIn(op.amount, 1, MAX_AMOUNT, 'Amount');
      const bal = folioBalance(s, r.id);
      if (amt > bal) throw new UserError('That is more than the folio balance');
      const p = { id: nextId(s, 'pay'), resId: r.id, method: oneOf(op.method, PAY_METHODS, 'Unknown method'), amount: amt, date: txDate(op, now), by: user.id, ts: now };
      s.payments.push(p); audit(s, user, now, 'recordPayment', `${r.confNo} ${p.method} ${p.amount}`);
      return { paymentId: p.id, balance: folioBalance(s, r.id) };
    });
  },
  setRoomStatus(s, op, { user, now }) {
    need(user, OP_ROLES.setRoomStatus);
    const room = getRoom(s, op.roomId);
    const st = oneOf(op.status, ROOM_STATUS, 'Unknown room status');
    if (s.reservations.some((r) => r.status === 'checked_in' && r.roomId === room.id)) throw new UserError('The room is occupied');
    room.hkStatus = st; audit(s, user, now, 'setRoomStatus', `${room.number} ${st}`); return {};
  },
  openTicket(s, op, { user, now }) {
    need(user, OP_ROLES.openTicket);
    return once(s, op, () => {
      const room = getRoom(s, op.roomId);
      const t = { id: nextId(s, 'mt'), roomId: room.id, title: str(op.title, 3, 80, 'Title'), desc: optStr(op.desc, 200, 'Description'), priority: oneOf(op.priority, PRIORITIES, 'Unknown priority'), status: 'open', by: user.id, createdAt: now, doneAt: null };
      s.tickets.push(t); audit(s, user, now, 'openTicket', `${room.number} ${t.title}`); return { ticketId: t.id };
    });
  },
  startTicket(s, op, { user, now }) {
    need(user, OP_ROLES.startTicket);
    const t = getTicket(s, op.ticketId);
    if (t.status !== 'open') throw new UserError('Only an open ticket can start');
    t.status = 'in_progress'; audit(s, user, now, 'startTicket', t.id); return {};
  },
  closeTicket(s, op, { user, now }) {
    need(user, OP_ROLES.closeTicket);
    const t = getTicket(s, op.ticketId);
    if (t.status === 'done') throw new UserError('This ticket is already done');
    t.status = 'done'; t.doneAt = now; t.note = optStr(op.note, 120, 'Note'); audit(s, user, now, 'closeTicket', t.id); return {};
  },
  addRoomType(s, op, { user, now }) {
    need(user, OP_ROLES.addRoomType);
    return once(s, op, () => {
      const t = { id: nextId(s, 't'), name: str(op.name, 2, 60, 'Name'), nameAr: optStr(op.nameAr, 60, 'Arabic name'), capacity: intIn(op.capacity, 1, 8, 'Capacity'), baseRate: intIn(op.baseRate, 100, 1000000, 'Base rate') };
      if (s.roomTypes.some((x) => x.name.toLowerCase() === t.name.toLowerCase())) throw new UserError('A room type with this name exists');
      s.roomTypes.push(t); audit(s, user, now, 'addRoomType', t.name); return { typeId: t.id };
    });
  },
  addRoom(s, op, { user, now }) {
    need(user, OP_ROLES.addRoom);
    return once(s, op, () => {
      const t = getType(s, op.typeId);
      const number = str(op.number, 2, 8, 'Room number');
      if (s.rooms.some((x) => x.number === number)) throw new UserError('This room number exists');
      const room = { id: nextId(s, 'rm'), number, typeId: t.id, floor: intIn(op.floor, 1, 8, 'Floor'), hkStatus: 'clean' };
      s.rooms.push(room); audit(s, user, now, 'addRoom', `${number} (${t.name})`); return { roomId: room.id };
    });
  },
  addRatePlan(s, op, { user, now }) {
    need(user, OP_ROLES.addRatePlan);
    return once(s, op, () => {
      const t = getType(s, op.typeId);
      const p = { id: nextId(s, 'rp'), typeId: t.id, name: str(op.name, 2, 60, 'Name'), rate: intIn(op.rate, 100, 1000000, 'Rate'), start: op.start, end: op.end };
      if (!isKey(p.start) || !isKey(p.end) || p.end < p.start) throw new UserError('The plan window is not a valid date range');
      if (s.ratePlans.some((x) => x.typeId === t.id && overlaps(x.start, addDays(x.end, 1), p.start, addDays(p.end, 1)))) throw new UserError('A plan already covers part of this window');
      s.ratePlans.push(p); audit(s, user, now, 'addRatePlan', `${t.name} ${p.name} ${p.rate}`); return { planId: p.id };
    });
  },
  deleteRatePlan(s, op, { user, now }) {
    need(user, OP_ROLES.deleteRatePlan);
    const p = find(s.ratePlans, op.planId, 'Rate plan');
    s.ratePlans = s.ratePlans.filter((x) => x.id !== p.id); audit(s, user, now, 'deleteRatePlan', p.id); return {};
  },
};
export function applyOp(s, op, ctx) {
  if (!op || typeof op !== 'object' || !Object.prototype.hasOwnProperty.call(OPS, op.type)) throw new UserError('Unknown action');
  return OPS[op.type](s, op, ctx);
}

// ---------- seed ----------
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function seed(now) {
  const today = dayKey(now), m0 = monthOf(today);
  const rnd = mulberry32(20261125);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const s = {
    users: [
      { id: 'u-owner', pin: '1111', name: 'Adel Bishara', nameAr: 'عادل بشارة', role: 'owner' },
      { id: 'u-front', pin: '2222', name: 'Mariam Soliman', nameAr: 'مريم سليمان', role: 'front' },
      { id: 'u-hk', pin: '3333', name: 'Soad Amin', nameAr: 'سعاد أمين', role: 'housekeeping' },
      { id: 'u-acc', pin: '4444', name: 'Karim Fawzy', nameAr: 'كريم فوزي', role: 'accountant' },
    ],
    counters: { conf: 0 }, keys: [], audit: [],
    roomTypes: [], rooms: [], ratePlans: [], guests: [], reservations: [], charges: [], payments: [], tickets: [],
  };
  const F = { id: 'u-front' }, A = { id: 'u-acc' };
  const mkType = (name, nameAr, capacity, baseRate) => { const t = { id: nextId(s, 't'), name, nameAr, capacity, baseRate }; s.roomTypes.push(t); return t; };
  const t1 = mkType('Standard Queen', 'ستاندرد كوين', 2, 950);
  const t2 = mkType('Deluxe Twin', 'ديلوكس توين', 3, 1250);
  const t3 = mkType('Family Suite', 'جناح عائلي', 5, 1900);
  const t4 = mkType('Sea View Suite', 'جناح بإطلالة بحرية', 4, 2600);
  const mkRooms = (t, floor, nums) => nums.forEach((n) => s.rooms.push({ id: nextId(s, 'rm'), number: String(n), typeId: t.id, floor, hkStatus: 'clean' }));
  mkRooms(t1, 1, [101, 102, 103, 104, 105, 106]);
  mkRooms(t2, 2, [201, 202, 203, 204, 205]);
  mkRooms(t3, 3, [301, 302, 303]);
  mkRooms(t4, 4, [401, 402]);
  const y = m0.slice(0, 4);
  const mkPlan = (t, name, rate, start, end) => s.ratePlans.push({ id: nextId(s, 'rp'), typeId: t.id, name, rate, start, end });
  mkPlan(t4, 'Summer high', 3200, `${y}-06-01`, `${y}-08-31`);
  mkPlan(t3, 'Summer high', 2300, `${y}-06-01`, `${y}-08-31`);
  mkPlan(t1, 'Winter holidays', 1200, `${y}-12-20`, `${Number(y) + 1}-01-05`);
  mkPlan(t2, 'Winter holidays', 1500, `${y}-12-20`, `${Number(y) + 1}-01-05`);
  const names = [
    ['Mahmoud El-Sayed', 'محمود السيد'], ['Heba Rashwan', 'هبة رشوان'], ['Tarek Nosseir', 'طارق نصير'], ['Salma Khairy', 'سلمى خيري'],
    ['Omar El-Gendy', 'عمر الجندي'], ['Dina Mansour', 'دينا منصور'], ['John Whitfield', 'جون ويتفيلد'], ['Claire Dubois', 'كلير دوبوا'],
    ['Mostafa Hanafy', 'مصطفى حنفي'], ['Rania Sabry', 'رانيا صبري'], ['Youssef Adly', 'يوسف عدلي'], ['Nour El-Din Hossam', 'نور الدين حسام'],
  ];
  const guests = names.map(([name, nameAr], i) => { const g = { id: nextId(s, 'g'), name, nameAr, phone: '01' + String(100000000 + Math.floor(rnd() * 899999999)), email: '', notes: i === 0 ? 'Allergic to feather pillows' : '', vip: i === 3 || i === 8, createdAt: now - 200 * 864e5 }; s.guests.push(g); return g; });
  const roomsOf = (t) => s.rooms.filter((x) => x.typeId === t.id);
  // checked-out history over the last 6 months: the occupancy and revenue base
  const mkStay = (g, t, room, ci, co, extra) => {
    const r = { id: nextId(s, 'r'), confNo: `NZ-${String(++s.counters.conf).padStart(4, '0')}`, guestId: g.id, typeId: t.id, roomId: room.id, checkIn: ci, checkOut: co, adults: 1 + Math.floor(rnd() * 2), children: rnd() < 0.3 ? 1 : 0, source: pick(SOURCES), note: '', status: 'checked_out', by: F.id, createdAt: parse(ci) - 864e5 * 5, checkedInAt: parse(ci) + 10 * 3600e3, checkedOutAt: parse(co) + 10 * 3600e3 };
    s.reservations.push(r);
    for (const d of eachNight(r)) s.charges.push({ id: nextId(s, 'ch'), resId: r.id, kind: 'room', desc: `Room ${room.number} · ${d}`, amount: rateFor(s, t.id, d), date: d, by: F.id, ts: r.checkedInAt });
    if (extra) for (const [kind, amt] of extra) s.charges.push({ id: nextId(s, 'ch'), resId: r.id, kind, desc: kind, amount: amt, date: ci, by: A.id, ts: r.checkedInAt });
    s.payments.push({ id: nextId(s, 'pay'), resId: r.id, method: pick(PAY_METHODS), amount: folioBalance(s, r.id), date: co, by: A.id, ts: r.checkedOutAt });
    return r;
  };
  // ten months of stay chains, room by room, so the calendar is realistic and rooms never double-book
  const tDay = Number(today.slice(8, 10));
  for (let back = 11; back >= 0; back--) {
    const m = addMonths(m0, -back);
    const [yy, mm] = m.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const lastDay = back === 0 ? Math.min(daysInMonth, tDay - 2) : daysInMonth;
    if (lastDay < 3) continue;
    for (const room of s.rooms) {
      const t = getType(s, room.typeId);
      let d = 1;
      while (d <= lastDay - 1) {
        if (rnd() < 0.62) {
          let len = 1 + Math.floor(rnd() * 3.4);
          if (d + len > lastDay + 1) len = lastDay + 1 - d;
          const ci = `${m}-${String(d).padStart(2, '0')}`;
          const co = addDays(ci, len);
          mkStay(pick(guests), t, room, ci, co, rnd() < 0.35 ? [[pick(['restaurant', 'laundry', 'minibar']), 150 + Math.floor(rnd() * 400)]] : null);
          d += len + (rnd() < 0.5 ? 1 : 2);
        } else d += 1 + Math.floor(rnd() * 2);
      }
    }
  }
  // in-house now
  const mkCurrent = (g, t, roomIdx, nightsBefore, totalNights, extra) => {
    const ci = addDays(today, -nightsBefore), co = addDays(ci, totalNights);
    const room = roomsOf(t)[roomIdx];
    const r = { id: nextId(s, 'r'), confNo: `NZ-${String(++s.counters.conf).padStart(4, '0')}`, guestId: g.id, typeId: t.id, roomId: room.id, checkIn: ci, checkOut: co, adults: 2, children: 0, source: pick(SOURCES), note: '', status: 'checked_in', by: F.id, createdAt: parse(ci) - 864e5 * 4, checkedInAt: parse(ci) + 11 * 3600e3, checkedOutAt: null };
    s.reservations.push(r);
    for (const d of eachNight(r)) s.charges.push({ id: nextId(s, 'ch'), resId: r.id, kind: 'room', desc: `Room ${room.number} · ${d}`, amount: rateFor(s, t.id, d), date: d, by: F.id, ts: r.checkedInAt });
    if (extra) for (const [kind, amt, desc] of extra) s.charges.push({ id: nextId(s, 'ch'), resId: r.id, kind, desc: desc || kind, amount: amt, date: addDays(today, -1), by: A.id, ts: now - 864e5 });
    const paid = Math.floor(folioBalance(s, r.id) * (rnd() < 0.5 ? 0 : 0.6));
    if (paid > 0) s.payments.push({ id: nextId(s, 'pay'), resId: r.id, method: pick(['cash', 'card']), amount: paid, date: ci, by: A.id, ts: r.checkedInAt });
    return r;
  };
  mkCurrent(guests[1], t2, 0, 2, 4, [['restaurant', 340, 'Dinner, two covers']]);   // 201, departs in 2 days
  mkCurrent(guests[6], t4, 1, 3, 6, [['laundry', 180, 'Laundry bag']]);              // 402, departs in 3 days
  mkCurrent(guests[4], t1, 2, 1, 1, null);                                           // 103, departs today
  mkCurrent(guests[9], t3, 0, 0, 3, [['minibar', 220, 'Minibar top-up']]);           // 301, checked in today
  // arrivals today: one pre-assigned, two waiting for a room
  const mkArrival = (g, t, nights, roomIdx, extraNote) => {
    const r = { id: nextId(s, 'r'), confNo: `NZ-${String(++s.counters.conf).padStart(4, '0')}`, guestId: g.id, typeId: t.id, roomId: roomIdx === null ? null : roomsOf(t)[roomIdx].id, checkIn: today, checkOut: addDays(today, nights), adults: 2, children: 1, source: pick(SOURCES), note: extraNote || '', status: 'confirmed', by: F.id, createdAt: now - 3 * 864e5, checkedInAt: null, checkedOutAt: null };
    s.reservations.push(r); return r;
  };
  mkArrival(guests[2], t1, 3, 0);
  mkArrival(guests[7], t2, 2, null, 'Late arrival, after 22:00');
  mkArrival(guests[11], t4, 2, null);
  // upcoming confirmed
  const mkFuture = (g, t, inDays, nights) => {
    const r = { id: nextId(s, 'r'), confNo: `NZ-${String(++s.counters.conf).padStart(4, '0')}`, guestId: g.id, typeId: t.id, roomId: null, checkIn: addDays(today, inDays), checkOut: addDays(today, inDays + nights), adults: 2, children: 0, source: pick(SOURCES), note: '', status: 'confirmed', by: F.id, createdAt: now - 2 * 864e5, checkedInAt: null, checkedOutAt: null };
    s.reservations.push(r); return r;
  };
  mkFuture(guests[0], t2, 3, 4);
  mkFuture(guests[3], t4, 6, 3);
  mkFuture(guests[5], t1, 9, 2);
  mkFuture(guests[8], t3, 12, 5);
  mkFuture(guests[10], t2, 18, 3);
  mkFuture(guests[3], t3, 30, 4);
  // a cancelled and a no-show
  const rC = mkFuture(guests[6], t1, 5, 2); rC.status = 'cancelled'; rC.cancelledAt = now - 864e5;
  const rN = { id: nextId(s, 'r'), confNo: `NZ-${String(++s.counters.conf).padStart(4, '0')}`, guestId: guests[10].id, typeId: t1.id, roomId: null, checkIn: addDays(today, -2), checkOut: addDays(today, 1), adults: 1, children: 0, source: 'booking_site', note: '', status: 'no_show', by: F.id, createdAt: now - 6 * 864e5, checkedInAt: null, checkedOutAt: null };
  s.reservations.push(rN);
  // housekeeping: two rooms need turnover, one urgent maintenance
  const dirty1 = s.rooms.find((x) => x.number === '104'); dirty1.hkStatus = 'dirty';
  const dirty2 = s.rooms.find((x) => x.number === '205'); dirty2.hkStatus = 'dirty';
  s.tickets.push({ id: nextId(s, 'mt'), roomId: s.rooms.find((x) => x.number === '401').id, title: 'AC not cooling', desc: 'Compressor fault, technician called', priority: 'urgent', status: 'open', by: 'u-hk', createdAt: now - 864e5, doneAt: null });
  s.tickets.push({ id: nextId(s, 'mt'), roomId: s.rooms.find((x) => x.number === '203').id, title: 'Bathroom sink leak', desc: '', priority: 'medium', status: 'in_progress', by: 'u-front', createdAt: now - 2 * 864e5, doneAt: null });
  // a believable audit trail of the last few days
  const nameOf = (id) => s.users.find((x) => x.id === id)?.name || '';
  const past = s.reservations.filter((r) => r.status === 'checked_out' && r.checkedOutAt).sort((a, b) => b.checkedOutAt - a.checkedOutAt).slice(0, 12);
  for (const r of past) audit(s, { id: r.by, name: nameOf(r.by) }, r.checkedOutAt, 'checkOut', `${r.confNo} room ${s.rooms.find((x) => x.id === r.roomId)?.number || ''}`);
  for (const r of s.reservations.filter((r) => r.status === 'checked_in')) audit(s, { id: r.by, name: nameOf(r.by) }, r.checkedInAt, 'checkIn', `${r.confNo} room ${s.rooms.find((x) => x.id === r.roomId)?.number || ''}`);
  audit(s, { id: 'u-hk', name: nameOf('u-hk') }, now - 864e5, 'openTicket', '401 AC not cooling');
  audit(s, { id: 'u-owner', name: nameOf('u-owner') }, now - 3 * 864e5, 'setRoomStatus', '205 dirty');
  return s;
}

// ---------- per-role views ----------
export function view(s, user, now) {
  const today = dayKey(now), m0 = monthOf(today);
  const money = user.role !== 'housekeeping';
  const gOf = (id) => s.guests.find((g) => g.id === id);
  const occupiedNow = new Set(s.reservations.filter((r) => r.status === 'checked_in').map((r) => r.roomId));
  const rooms = s.rooms.map((x) => ({ ...x, occupied: occupiedNow.has(x.id), openTickets: s.tickets.filter((t) => t.roomId === x.id && t.status !== 'done').length }));
  const reservations = s.reservations.map((r) => {
    const base = { ...r, guestName: gOf(r.guestId)?.name || '', roomNumber: r.roomId ? getRoom(s, r.roomId).number : '', total: r.status === 'cancelled' || r.status === 'no_show' ? 0 : quoteStay(s, r.typeId, r.checkIn, r.checkOut) };
    if (!money) return base;
    return { ...base, charges: folioCharges(s, r.id), paid: folioPaid(s, r.id), balance: folioBalance(s, r.id) };
  }).sort((a, b) => (a.checkIn < b.checkIn ? 1 : -1));
  const byMonth = []; for (let i = 11; i >= 0; i--) byMonth.push(monthReport(s, addMonths(m0, -i), s.rooms.length));
  const cur = byMonth[11];
  const arrivals = s.reservations.filter((r) => r.status === 'confirmed' && r.checkIn === today);
  const departures = s.reservations.filter((r) => r.status === 'checked_in' && r.checkOut <= today);
  const inHouse = s.reservations.filter((r) => r.status === 'checked_in');
  const totals = {
    rooms: s.rooms.length,
    inHouse: inHouse.length,
    arrivals: arrivals.length,
    departures: departures.length,
    dirty: s.rooms.filter((x) => x.hkStatus === 'dirty').length,
    openTickets: s.tickets.filter((t) => t.status !== 'done').length,
    occupancyTonight: s.rooms.length ? Math.round((inHouse.length / s.rooms.length) * 100) : 0,
    monthRevenue: money ? cur.revenue : 0,
    occupancy: cur.occupancy, adr: money ? cur.adr : 0, revpar: money ? cur.revpar : 0,
  };
  const insights = [];
  for (const r of arrivals) {
    insights.push({ kind: 'arrival_today', resId: r.id, unassigned: !r.roomId });
  }
  for (const r of s.reservations) if (r.status === 'confirmed' && r.checkIn < today) insights.push({ kind: 'noshow_risk', resId: r.id, days: daysBetween(r.checkIn, today) });
  for (const r of departures) insights.push({ kind: 'departure_due', resId: r.id, late: r.checkOut < today });
  if (totals.dirty > 0) insights.push({ kind: 'dirty_rooms', count: totals.dirty });
  for (const t of s.tickets) if (t.status !== 'done' && (t.priority === 'urgent' || t.priority === 'high')) insights.push({ kind: 'ticket_urgent', ticketId: t.id, roomNumber: getRoom(s, t.roomId).number });
  const out = {
    me: { id: user.id, name: user.name, nameAr: user.nameAr, role: user.role }, today, now,
    roomTypes: s.roomTypes, rooms, reservations, tickets: s.tickets.map((t) => ({ ...t, roomNumber: getRoom(s, t.roomId).number })),
    reports: { byMonth, totals },
    insights,
    audit: user.role === 'owner' ? s.audit.slice(0, 120) : [],
    users: user.role === 'owner' ? s.users.map((u) => ({ id: u.id, name: u.name, nameAr: u.nameAr, role: u.role })) : [],
  };
  if (money) {
    out.guests = s.guests;
    out.ratePlans = s.ratePlans;
    out.charges = s.charges.slice(-400).reverse();
    out.payments = s.payments.slice(-200).reverse();
  } else {
    out.guests = s.guests.map((g) => ({ id: g.id, name: g.name, nameAr: g.nameAr, vip: g.vip }));
    out.ratePlans = []; out.charges = []; out.payments = [];
  }
  return out;
}
