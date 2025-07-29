'use strict';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { parse, fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const PORT = parseInt(process.env.PORT || '8080', 10);
const API_KEY = process.env.API_KEY || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';

/**
 * Room structure
 * {
 *   password: string,
 *   maxPlayers: number,
 *   maxViewers: number,
 *   players: Map(socket.id -> {num,name,guid}),
 *   viewers: Map(socket.id -> {name,guid}),
 *   frame: number,
 *   inputs: Record<frame, Record<playerNum, input>>
 * }
 */
const rooms = new Map();

function createRoom(id, opts = {}) {
  if (rooms.has(id)) throw new Error('Room already exists');
  rooms.set(id, {
    password: opts.password || '',
    privacy: opts.privacy || 'public',
    roomName: opts.roomName || id,
    maxPlayers: opts.maxPlayers || 2,
    maxViewers: typeof opts.maxViewers === 'number' ? opts.maxViewers : 0,
    allowedUsers: Array.isArray(opts.allowedUsers) ? new Set(opts.allowedUsers) : null,
    players: new Map(),
    viewers: new Map(),
    frame: 0,
    inputs: {}
  });
}

function joinRoom(id, socket, { spectator = false, password = '', name = '', guid = '' } = {}) {
  const room = rooms.get(id);
  if (!room) return { error: 'no-room' };
  if (room.password && room.password !== password) return { error: 'bad-password' };
  if (room.allowedUsers && !room.allowedUsers.has(guid)) return { error: 'not-allowed' };
  if (spectator || room.players.size >= room.maxPlayers) {
    if (room.viewers.size >= room.maxViewers) return { error: 'room-full' };
    room.viewers.set(socket.id, { name, guid });
    return { player: null, spectator: true, name, guid };
  }
  const playerNum = room.players.size + 1;
  room.players.set(socket.id, { num: playerNum, name, guid });
  return { player: playerNum, spectator: false, name, guid };
}

function verifyToken(token) {
  if (!API_KEY) return false;
  try {
    jwt.verify(token, API_KEY);
    return true;
  } catch {
    return false;
  }
}

function checkAuth(req, query, admin = false) {
  if (admin) {
    const key = req.headers['x-admin-key'] || query.adminKey;
    if (ADMIN_KEY && key === ADMIN_KEY) return true;
    return false;
  }
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (query.token || '');
  if (token && verifyToken(token)) return true;
  return false;
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const httpServer = createServer(async (req, res) => {
  const { pathname, query } = parse(req.url, true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST' && pathname === '/token') {
    if ((req.headers['x-api-key'] || query.key) !== API_KEY) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const token = jwt.sign({}, API_KEY, { expiresIn: '1d' });
    res.end(JSON.stringify({ token }));
    return;
  }

  if (req.method !== 'GET' || !(pathname === '/rooms' || pathname.startsWith('/rooms/'))) {
    if (!checkAuth(req, query, true)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/rooms') {
    const list = [];
    for (const [roomId, room] of rooms.entries()) {
      list.push({
        roomId,
        roomName: room.roomName,
        players: Array.from(room.players.values()).map(p => ({ num: p.num, name: p.name, guid: p.guid })),
        viewers: Array.from(room.viewers.values()).map(v => ({ name: v.name, guid: v.guid })),
        maxPlayers: room.maxPlayers,
        maxViewers: room.maxViewers,
        passwordProtected: !!room.password,
        privacy: room.privacy || 'public'
      });
    }
    res.end(JSON.stringify(list));
  } else if (req.method === 'GET' && pathname.startsWith('/rooms/')) {
    const id = decodeURIComponent(pathname.split('/')[2] || '');
    const room = rooms.get(id);
    if (!room) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not-found' }));
    } else {
      res.end(
        JSON.stringify({
          roomId: id,
          roomName: room.roomName,
          players: Array.from(room.players.values()).map(p => ({ num: p.num, name: p.name, guid: p.guid })),
          viewers: Array.from(room.viewers.values()).map(v => ({ name: v.name, guid: v.guid })),
          maxPlayers: room.maxPlayers,
          maxViewers: room.maxViewers,
          passwordProtected: !!room.password,
          privacy: room.privacy || 'public'
        })
      );
    }
  } else if (req.method === 'POST' && pathname === '/rooms') {
    const body = await readBody(req);
    try {
      createRoom(body.roomId, body);
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (req.method === 'POST' && pathname.startsWith('/rooms/') && pathname.endsWith('/join')) {
    const id = decodeURIComponent(pathname.split('/')[2] || '');
    const body = await readBody(req);
    const fakeSocket = { id: `api-${Math.random().toString(16).slice(2)}` };
    const resJoin = joinRoom(id, fakeSocket, body);
    if (resJoin.error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: resJoin.error }));
    } else {
      // Immediately remove since this is just an API call
      const room = rooms.get(id);
      if (room) {
        if (resJoin.spectator) room.viewers.delete(fakeSocket.id);
        else room.players.delete(fakeSocket.id);
      }
      res.end(JSON.stringify(resJoin));
    }
  } else if (req.method === 'DELETE' && pathname.startsWith('/rooms/')) {
    const id = decodeURIComponent(pathname.split('/')[2] || '');
    if (rooms.has(id)) {
      rooms.delete(id);
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not-found' }));
    }
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not-found' }));
  }
});
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers['authorization']?.split(' ')[1];
  if (!token || !verifyToken(token)) return next(new Error('unauthorized'));
  next();
});

io.on('connection', socket => {
  let currentRoom = null;
  let playerNum = null;
  let isSpectator = false;

  socket.on('list-rooms', cb => {
    const list = [];
    for (const [roomId, room] of rooms.entries()) {
      list.push({
        roomId,
        roomName: room.roomName,
        players: Array.from(room.players.values()).map(p => ({ num: p.num, name: p.name, guid: p.guid })),
        viewers: Array.from(room.viewers.values()).map(v => ({ name: v.name, guid: v.guid })),
        maxPlayers: room.maxPlayers,
        maxViewers: room.maxViewers,
        passwordProtected: !!room.password,
        privacy: room.privacy || 'public',
      });
    }
    cb && cb(list);
  });

  socket.on('create-room', (opts = {}, cb) => {
    try {
      createRoom(opts.roomId, opts);
      const joinRes = joinRoom(opts.roomId, socket, {
        password: opts.password,
        name: opts.name || '',
        guid: opts.guid || ''
      });
      currentRoom = opts.roomId;
      playerNum = joinRes.player;
      isSpectator = false;
      socket.join(currentRoom);
      socket.emit('joined', { player: playerNum, name: joinRes.name, guid: joinRes.guid, frame: 0, roomId: currentRoom });
      io.to(currentRoom).emit('user-joined', { player: playerNum, spectator: false, name: joinRes.name, guid: joinRes.guid });
      cb && cb(null);
    } catch (err) {
      cb && cb(err.message);
    }
  });

  socket.on('join-room', (opts = {}, cb) => {
    const res = joinRoom(opts.roomId, socket, {
      spectator: opts.spectator,
      password: opts.password,
      name: opts.name || '',
      guid: opts.guid || ''
    });
    if (res.error) return cb && cb(res.error);
    currentRoom = opts.roomId;
    playerNum = res.player;
    isSpectator = !!res.spectator;
    socket.join(currentRoom);
    socket.emit('joined', { player: playerNum, spectator: isSpectator, name: res.name, guid: res.guid, frame: rooms.get(currentRoom).frame, roomId: currentRoom });
    io.to(currentRoom).emit('user-joined', { player: playerNum, spectator: isSpectator, name: res.name, guid: res.guid });
    cb && cb(null);
  });

  socket.on('input', data => {
    if (!currentRoom || isSpectator) return;
    const room = rooms.get(currentRoom);
    const frame = data.frame;
    room.inputs[frame] = room.inputs[frame] || {};
    room.inputs[frame][playerNum] = data.input;
    if (Object.keys(room.inputs[frame]).length === room.players.size) {
      io.to(currentRoom).emit('frame', {
        frame,
        inputs: room.inputs[frame]
      });
      room.frame = frame;
      delete room.inputs[frame];
    }
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (room.players.has(socket.id)) {
      const info = room.players.get(socket.id);
      room.players.delete(socket.id);
      io.to(currentRoom).emit('user-left', { player: info.num, name: info.name, guid: info.guid });
    } else if (room.viewers.has(socket.id)) {
      const info = room.viewers.get(socket.id);
      room.viewers.delete(socket.id);
      io.to(currentRoom).emit('user-left', { spectator: true, name: info.name, guid: info.guid });
    }
    if (room.players.size === 0 && room.viewers.size === 0) {
      rooms.delete(currentRoom);
    }
  });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  httpServer.listen(PORT, () => {
    console.log(`Netplay server listening on ${PORT}`);
  });
}

export { createRoom, rooms };
