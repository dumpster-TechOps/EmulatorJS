'use strict';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { parse, fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const PORT = parseInt(process.env.PORT || '8080', 10);
const JWT_SECRET = process.env.JWT_SECRET || process.env.API_KEY || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const ALLOW_PLAYER_JOIN = process.env.ALLOW_PLAYER_JOIN !== 'false';
const ALLOW_VIEWER_JOIN = process.env.ALLOW_VIEWER_JOIN !== 'false';
const ICE_SERVERS = process.env.ICE_SERVERS ? JSON.parse(process.env.ICE_SERVERS) : [];
const ALLOWED_DOMAINS = process.env.ALLOWED_DOMAINS ? process.env.ALLOWED_DOMAINS.split(',') : ['*'];

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

function roomState(room) {
  return {
    frame: room.frame,
    players: Array.from(room.guidMap.entries()).map(([guid, info]) => ({ num: info.num, name: info.name, guid })),
    viewers: Array.from(room.viewers.values()).map(v => ({ name: v.name, guid: v.guid }))
  };
}

function createRoom(id, opts = {}) {
  if (rooms.has(id)) throw new Error('Room already exists');
  rooms.set(id, {
    password: opts.password || '',
    privacy: opts.privacy || 'public',
    roomName: opts.roomName || id,
    game: opts.game || '',
    maxPlayers: opts.maxPlayers || 2,
    maxViewers: typeof opts.maxViewers === 'number' ? opts.maxViewers : 0,
    allowedUsers: Array.isArray(opts.allowedUsers) ? new Set(opts.allowedUsers) : null,
    players: new Map(),
    viewers: new Map(),
    guidMap: new Map(),
    stats: new Map(),
    frame: 0,
    inputs: {},
    state: null,
    stateVersion: 0
  });
}

function joinRoom(id, socket, { spectator = false, password = '', name = '', guid = '' } = {}) {
  const room = rooms.get(id);
  if (!room) return { error: 'no-room' };
  if (room.password && room.password !== password) return { error: 'bad-password' };
  if (room.allowedUsers && !room.allowedUsers.has(guid)) return { error: 'not-allowed' };
  if (spectator || room.players.size >= room.maxPlayers) {
    if (!ALLOW_VIEWER_JOIN) return { error: 'viewers-disabled' };
    if (room.viewers.size >= room.maxViewers) return { error: 'room-full' };
    room.viewers.set(socket.id, { name, guid });
    return { player: null, spectator: true, name, guid };
  }
  if (!ALLOW_PLAYER_JOIN) return { error: 'players-disabled' };
  let playerNum;
  if (room.guidMap.has(guid)) {
    const info = room.guidMap.get(guid);
    playerNum = info.num;
    room.players.set(socket.id, { num: playerNum, name: info.name, guid });
    info.socketId = socket.id;
    info.disconnectedAt = null;
  } else {
    playerNum = room.players.size + 1;
    room.players.set(socket.id, { num: playerNum, name, guid });
    room.guidMap.set(guid, { num: playerNum, name, socketId: socket.id, disconnectedAt: null });
  }
  if (!room.stats.has(guid)) room.stats.set(guid, { latencies: [], lastSeq: 0, lost: 0 });
  return { player: playerNum, spectator: false, name, guid };
}

function updateState(id, state) {
  const room = rooms.get(id);
  if (!room) throw new Error('Room not found');
  room.state = state;
  room.stateVersion = (room.stateVersion || 0) + 1;
  return { state: room.state, version: room.stateVersion };
}

function verifyToken(token) {
  if (!JWT_SECRET) return false;
  try {
    jwt.verify(token, JWT_SECRET);
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
    if ((req.headers['x-api-key'] || query.key) !== JWT_SECRET) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const token = jwt.sign({}, JWT_SECRET, { expiresIn: '1d' });
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
  } else if (req.method === 'GET' && pathname === '/public-rooms') {
    const list = [];
    for (const [roomId, room] of rooms.entries()) {
      if (room.privacy === 'public') {
        list.push({ roomId, roomName: room.roomName, game: room.game });
      }
    }
    res.end(JSON.stringify(list));
  } else if (req.method === 'GET' && pathname === '/rooms/search') {
    const q = (query.game || '').toLowerCase();
    const list = [];
    for (const [roomId, room] of rooms.entries()) {
      if (room.privacy === 'public' && room.game && room.game.toLowerCase().includes(q)) {
        list.push({ roomId, roomName: room.roomName, game: room.game });
      }
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
  cors: { origin: ALLOWED_DOMAINS, methods: ['GET','POST'] }
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
  let playerGuid = null;
  let seq = 0;
  const pingInterval = setInterval(() => {
    if (currentRoom) {
      socket.emit('latency-ping', { t: Date.now(), seq: seq++ });
    }
  }, 5000);

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
      playerGuid = joinRes.guid;
      isSpectator = false;
      socket.join(currentRoom);
      socket.emit('joined', { player: playerNum, name: joinRes.name, guid: joinRes.guid, frame: 0, roomId: currentRoom, state: null, stateVersion: 0 });
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
    playerGuid = res.guid;
    isSpectator = !!res.spectator;
    socket.join(currentRoom);
    const room = rooms.get(currentRoom);
    socket.emit('joined', { player: playerNum, spectator: isSpectator, name: res.name, guid: res.guid, frame: room.frame, roomId: currentRoom, state: room.state, stateVersion: room.stateVersion });
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

  socket.on('predict', data => {
    if (!currentRoom || isSpectator) return;
    socket.to(currentRoom).emit('predict', { frame: data.frame, input: data.input, player: playerNum });
  });

  socket.on('sync-state', data => {
    if (!currentRoom) return;
    const result = updateState(currentRoom, data.state);
    socket.to(currentRoom).emit('sync-state', { state: result.state, version: result.version });
  });

  socket.on('spectate-data', data => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    for (const [id] of room.viewers) {
      if (id !== socket.id) io.to(id).emit('spectate-data', data);
    }
  });

  socket.on('signal', data => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('signal', { guid: playerGuid, data });
  });

  socket.on('latency-pong', data => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const stat = room.stats.get(playerGuid);
    if (!stat) return;
    const latency = Date.now() - data.t;
    stat.latencies.push(latency);
    if (stat.latencies.length > 10) stat.latencies.shift();
    if (typeof data.seq === 'number') {
      if (data.seq > stat.lastSeq + 1) stat.lost += data.seq - stat.lastSeq - 1;
      stat.lastSeq = data.seq;
    }
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (room.players.has(socket.id)) {
      const info = room.players.get(socket.id);
      room.players.delete(socket.id);
      const entry = room.guidMap.get(info.guid);
      if (entry) entry.disconnectedAt = Date.now();
      setTimeout(() => {
        const e = room.guidMap.get(info.guid);
        if (e && e.disconnectedAt && Date.now() - e.disconnectedAt >= 30000) {
          room.guidMap.delete(info.guid);
          room.stats.delete(info.guid);
          io.to(currentRoom).emit('user-left', { player: info.num, name: info.name, guid: info.guid });
          if (room.players.size === 0 && room.viewers.size === 0 && room.guidMap.size === 0) rooms.delete(currentRoom);
        }
      }, 30000);
    } else if (room.viewers.has(socket.id)) {
      const info = room.viewers.get(socket.id);
      room.viewers.delete(socket.id);
      io.to(currentRoom).emit('user-left', { spectator: true, name: info.name, guid: info.guid });
    }
    if (room.players.size === 0 && room.viewers.size === 0 && room.guidMap.size === 0) {
      rooms.delete(currentRoom);
    }
    clearInterval(pingInterval);
  });
});

function startServer() {
  httpServer.listen(PORT, () => {
    console.log(`Netplay server listening on ${PORT}`);
  });
}

export { createRoom, joinRoom, updateState, rooms };