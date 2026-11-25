# Nuzul (نُزُل)

Hotel and guesthouse management for small Egyptian properties: room types and rooms, seasonal rate plans, a reservations calendar with an overbooking guard, check-in and check-out, guest folios with charges and payments, a housekeeping board, maintenance tickets, and owner reports (occupancy, ADR, RevPAR). Bilingual (English / Arabic, RTL), four PIN-based roles for the demo.

**Live demo:** https://nuzul-stay.vercel.app

Product direction, scope and delivery: Nada Gamal

## The demo property

One shared demo guesthouse: 16 rooms over four floors and four room types (Standard Queen, Deluxe Twin, Family Suite, Sea View Suite), seasonal rate plans (summer high season, winter holidays), twelve guests on file, a year of stay history, four guests in-house, three arrivals due today, two rooms waiting for housekeeping and two open maintenance tickets. The data is deterministic: a fresh instance always starts from the same seed.

## Roles

Sign in with a PIN (public on the sign-in screen, this is a demo):

| PIN | Role | Can do |
| --- | --- | --- |
| 1111 | Owner | Everything: room types, rooms, rate plans, the audit log, plus every desk operation |
| 2222 | Front desk | Reservations, assign rooms, check-in/out, folios, guests, maintenance tickets |
| 3333 | Housekeeping | The rooms board (clean / dirty / inspected) and opening maintenance tickets. Never sees money |
| 4444 | Accountant | Folios: post charges and record payments, reservations and reports. No operations boards |

## How a stay works

A reservation is booked against a room type for a date range; the overbooking guard counts every active booking per night and refuses once the type is full. The front desk assigns a specific room (matching type, clean, free for the whole stay, no open maintenance ticket) or check-in auto-assigns the first free one. At check-in the room charges for every night land on the folio at the nightly rate (seasonal plan when one covers the date, base rate otherwise). Charges can only be posted while the guest is in-house, payments can never exceed the balance, and checkout is refused until the folio is settled. Checkout turns the room dirty for housekeeping.

## Reports

Twelve rolling months of room-nights sold against room-nights available, with occupancy, ADR (average daily rate) and RevPAR (revenue per available room) computed from the same source data, plus a revenue chart.

## Honest limits

- No database. State lives in the memory of the running server instance and is rebuilt from the seed about every 6 hours or on restart. Two browser tabs share the same property by design.
- PINs are demo-grade. They are public on the sign-in screen; tokens are signed with an environment secret, but this is not production auth.
- One property per deployment. There is no multi-tenancy, no channel manager and no online payments.
- Rate plans are per room type; there are no per-room overrides or length-of-stay discounts.

## Stack

Vanilla JS single-page app (`public/`), one serverless function (`api/data.js`) holding the shared state, business rules in `public/logic.js` shared verbatim by the browser, the server and the tests. No build step. Deployed on Vercel as a static site plus one function.

## Development

```
npm install
npm run dev        # local server on :3200 with the same API handler
npm test           # unit tests for logic and i18n
node e2e/e2e.mjs http://localhost:3200    # full browser + API suite (needs Chrome)
node e2e/shots.mjs http://localhost:3200  # screenshots into docs/
```

The e2e suite (176 checks) covers API security (forged tokens, prototype names as actions, oversized bodies, method handling), every role's permission lane, the full booking-assign-checkin-folio-checkout cycle, the overbooking guard, housekeeping and maintenance flows, rate plan windows, idempotency keys, the housekeeping role never seeing money (including typed hash routes), XSS stored as text, Arabic RTL, 390px layouts and zero page errors. It runs to completion against the live URL before every release.

## Environment

`NUZUL_SECRET` — signing secret for session tokens (set in the Vercel project).
