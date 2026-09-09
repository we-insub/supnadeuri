import assert from 'node:assert/strict';
const request = {
  check_in: '2026-09-19',
  check_out: '2026-09-20',
  guests: 2,
  regions: ['경기', '강원'],
};
const r = await fetch('http://127.0.0.1:3000/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(190000),
});
assert.equal(r.status, 200);
const data = await r.json();
assert.equal(data.complete, true, JSON.stringify(data.warnings));
for (const room of data.rooms) {
  assert.equal(room.available, true);
  assert.ok(request.regions.includes(room.province));
  assert.ok(room.max_capacity >= 2);
  assert.equal(room.check_in, request.check_in);
  assert.equal(room.check_out, request.check_out);
  assert.ok(Number.isInteger(room.price));
  assert.equal(room.nightly_prices.length, 1);
  assert.equal(room.nightly_prices[0].date, '20260919');
  assert.match(new URL(room.booking_url).hostname, /(^|\.)foresttrip\.go\.kr$/);
  assert.ok(
    room.forest_name && room.city && room.room_name && room.facility_type,
  );
}
const again = await fetch('http://127.0.0.1:3000/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(request),
});
assert.equal((await again.json()).cached, true);
console.log(
  JSON.stringify({
    passed: true,
    live_rooms: data.rooms.length,
    checked_at: data.checked_at,
    forests_checked: data.forests_checked,
    cache_verified: true,
  }),
);
