import { createRoom, rooms } from '../server/netplay-server.js';

describe('netplay-server createRoom', () => {
  afterEach(() => {
    rooms.clear();
  });

  test('creates a room with given id', () => {
    createRoom('room1');
    expect(rooms.has('room1')).toBe(true);
  });
});
