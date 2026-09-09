/**
 * Group the already filtered/sorted rooms by official forest ID, never by name
 * or address. Preserve every room and its original booking URL and price.
 * First occurrence preserves the selected price order between forest cards.
 * @template {{forest_id: string, price: number}} T
 * @param {T[]} rooms
 * @returns {{forest: T, rooms: T[], min_price: number, max_price: number}[]}
 */
export function groupRoomsByForest(rooms) {
  /** @type {Map<string, {forest: T, rooms: T[], min_price: number, max_price: number}>} */
  const groups = new Map();
  for (const room of rooms) {
    const group = groups.get(room.forest_id);
    if (group) {
      group.rooms.push(room);
      group.min_price = Math.min(group.min_price, room.price);
      group.max_price = Math.max(group.max_price, room.price);
    } else {
      groups.set(room.forest_id, {
        forest: room,
        rooms: [room],
        min_price: room.price,
        max_price: room.price,
      });
    }
  }
  return [...groups.values()];
}
