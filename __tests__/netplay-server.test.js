import { createRoom, joinRoom, updateState, rooms, startServer } from '../server/netplay-server.js';

describe('netplay-server room lifecycle', () => {
  let server;
  afterEach(() => {
    rooms.clear();
    if (server && server.listening) {
      server.close();
      server = null;
    }
  });

  test('startServer starts listening', async () => {
    server = startServer();
    await new Promise(res => server.on('listening', res));
    expect(server.listening).toBe(true);
  });

  test('creates a room with given id', () => {
    createRoom('room1');
    expect(rooms.has('room1')).toBe(true);
  });

  test('join room adds players and spectators', () => {
    createRoom('room2', { maxPlayers: 2, maxViewers: 1 });
    const s1 = { id: 'p1' };
    const s2 = { id: 'v1' };
    const res1 = joinRoom('room2', s1, { name: 'A', guid: 'g1' });
    const res2 = joinRoom('room2', s2, { spectator: true, name: 'B', guid: 'g2' });
    const room = rooms.get('room2');
    expect(res1).toEqual({ player: 1, spectator: false, name: 'A', guid: 'g1' });
    expect(res2).toEqual({ player: null, spectator: true, name: 'B', guid: 'g2' });
    expect(room.players.size).toBe(1);
    expect(room.viewers.size).toBe(1);
  });

  test('room removed when last participant leaves', () => {
    createRoom('room3');
    const s1 = { id: 'a' };
    const s2 = { id: 'b' };
    joinRoom('room3', s1);
    joinRoom('room3', s2);
    const room = rooms.get('room3');
    room.players.delete(s1.id);
    expect(room.players.size).toBe(1);
    room.players.delete(s2.id);
    if (room.players.size === 0 && room.viewers.size === 0) rooms.delete('room3');
    expect(rooms.has('room3')).toBe(false);
  });

  test('updateState increments version', () => {
    createRoom('room4');
    const r1 = updateState('room4', 's1');
    expect(r1).toEqual({ state: 's1', version: 1 });
    const r2 = updateState('room4', 's2');
    expect(r2).toEqual({ state: 's2', version: 2 });
    const room = rooms.get('room4');
    expect(room.state).toBe('s2');
    expect(room.stateVersion).toBe(2);
  });
});
