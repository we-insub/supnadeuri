import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { groupRoomsByForest } from '../../app/room-groups.mjs';

const test = (name, run) => {
  void nodeTest(name, run);
};
const room = (forest_id, room_id, price) => ({
  forest_id,
  room_id,
  price,
  forest_name: '동일한 이름',
  booking_url: `https://www.foresttrip.go.kr/${forest_id}`,
});

test('grouping keeps each room and booking link under its official forest ID', () => {
  const a = room('0244', 'A-고로쇠', 173000);
  const b = room('0244', 'B-너구리', 173000);
  const another = room('0113', 'A-고로쇠', 134000);
  const input = Object.freeze([
    Object.freeze(a),
    Object.freeze(another),
    Object.freeze(b),
  ]);
  const grouped = groupRoomsByForest(input);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].rooms, [a, b]);
  assert.equal(grouped[0].rooms[1], b);
  assert.equal(grouped[0].rooms[1].booking_url, b.booking_url);
  assert.equal(grouped[1].rooms[0], another);
  assert.equal(
    grouped.reduce((n, g) => n + g.rooms.length, 0),
    3,
  );
  assert.deepEqual(input, [a, another, b]);
});

test('empty filtered results produce no forest cards', () => {
  assert.deepEqual(groupRoomsByForest([]), []);
});

test('ascending rooms preserve minimum-price forest order and option order', () => {
  const input = [
    room('a', 'a1', 90000),
    room('b', 'b1', 140000),
    room('a', 'a2', 173000),
  ];
  const grouped = groupRoomsByForest(input);
  assert.deepEqual(
    grouped.map((g) => g.forest.forest_id),
    ['a', 'b'],
  );
  assert.deepEqual(
    grouped[0].rooms.map((r) => r.price),
    [90000, 173000],
  );
  assert.equal(grouped[0].min_price, 90000);
  assert.equal(grouped[0].max_price, 173000);
});

test('descending rooms preserve maximum-price forest order and option order', () => {
  const input = [
    room('b', 'b1', 350000),
    room('a', 'a1', 173000),
    room('b', 'b2', 90000),
  ];
  const grouped = groupRoomsByForest(input);
  assert.deepEqual(
    grouped.map((g) => g.forest.forest_id),
    ['b', 'a'],
  );
  assert.deepEqual(
    grouped[0].rooms.map((r) => r.price),
    [350000, 90000],
  );
  assert.equal(grouped[0].min_price, 90000);
  assert.equal(grouped[0].max_price, 350000);
});

test('price ranges and counts use only the rooms remaining after filters', () => {
  const input = [
    room('a', 'a1', 90000),
    room('a', 'a2', 173000),
    room('b', 'b1', 350000),
  ];
  const grouped = groupRoomsByForest(input.filter((r) => r.price <= 100000));
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].rooms.length, 1);
  assert.equal(grouped[0].min_price, 90000);
  assert.equal(grouped[0].max_price, 90000);
});
