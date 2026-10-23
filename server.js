'use strict';

/*
 * Quebra-Cabeça a Dois — servidor
 * Express serve a pasta /public e o Socket.IO sincroniza as duas pessoas.
 * O servidor é a "fonte da verdade": ele decide quem segura cada peça,
 * quando uma peça encaixa e quando o jogo termina.
 */

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000; // o Render define a PORT automaticamente
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMG_DIR = path.join(PUBLIC_DIR, 'imagens');

/* ---------- Configuração do tabuleiro (unidades lógicas) ---------- */
const CFG = {
  COLS: 3,          // colunas do quebra-cabeça
  ROWS: 4,          // linhas do quebra-cabeça (imagem em formato 3:4)
  TILE: 200,        // tamanho de cada peça
  FIELD_W: 1000,    // largura da área de jogo
  FIELD_H: 1500,    // altura da área de jogo
  BOARD_X: 200,     // posição do tabuleiro dentro da área de jogo
  BOARD_Y: 40,
  SNAP: 70,         // distância (em unidades) para a peça encaixar
  MAX_ROT: 3        // giros permitidos por peça antes de "passar a vez"
};
const TOTAL = CFG.COLS * CFG.ROWS;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem O/0/I/1 para não confundir
const MAX_IMAGES = 12;

/* ---------- Servidor HTTP ---------- */
const app = express();
app.disable('x-powered-by');

app.get('/health', (req, res) => res.type('text').send('ok'));

app.get('/api/imagens', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(listImages());
});

app.use(
  express.static(PUBLIC_DIR, {
    maxAge: '1d',
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    }
  })
);

const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 15000,
  maxHttpBufferSize: 1e5
});

/* ---------- Imagens ---------- */
function prettyName(file) {
  const base = file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/([A-Za-zÀ-ÿ])(\d)/g, '$1 $2').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : file;
}

function listImages() {
  try {
    return fs
      .readdirSync(IMG_DIR)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'pt', { numeric: true }))
      .slice(0, MAX_IMAGES)
      .map((f) => ({ file: f, url: 'imagens/' + encodeURIComponent(f), label: prettyName(f) }));
  } catch (e) {
    return [];
  }
}

function validImage(file) {
  const list = listImages();
  if (!list.length) return null;
  const found = list.find((i) => i.file === file);
  return (found || list[0]).file;
}

/* ---------- Salas ---------- */
const rooms = new Map();

function newCode() {
  for (let t = 0; t < 100; t++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function rnd(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clamp(v, min, max) {
  v = Number(v);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function buildPieces() {
  // 15 posições na bandeja (embaixo do tabuleiro); 12 são sorteadas
  const slots = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) slots.push({ x: c * 200, y: 900 + r * 185 });
  shuffle(slots);
  const pieces = [];
  for (let id = 0; id < TOTAL; id++) {
    const s = slots[id];
    pieces.push({
      id,
      col: id % CFG.COLS,
      row: Math.floor(id / CFG.COLS),
      x: clamp(s.x + rnd(-10, 10), 0, CFG.FIELD_W - CFG.TILE),
      y: clamp(s.y + rnd(-8, 8), 0, CFG.FIELD_H - CFG.TILE),
      rot: rnd(0, 3),   // 0 = certa; cada giro é 90° no sentido horário
      rotUsed: 0,
      heldBy: null,     // índice do jogador que está segurando
      locked: false,
      lockedBy: null,
      z: 10 + id
    });
  }
  return pieces;
}

function createRoom(code, imageId) {
  const now = Date.now();
  return {
    code,
    imageId,
    status: 'waiting', // waiting | playing | won
    createdAt: now,
    lastActive: now,
    roundStart: now,
    startedAt: null,
    finishedAt: null,
    z: 100,
    pieces: buildPieces(),
    players: [null, null] // { pid, socketId, connected }
  };
}

function connectedCount(room) {
  return room.players.filter((p) => p && p.connected).length;
}

function elapsed(room) {
  if (!room.startedAt) return 0;
  return (room.finishedAt || Date.now()) - room.startedAt;
}

function counts(room) {
  const c = [0, 0];
  for (const p of room.pieces) if (p.locked && (p.lockedBy === 0 || p.lockedBy === 1)) c[p.lockedBy]++;
  return c;
}

function lockedTotal(room) {
  return room.pieces.reduce((n, p) => n + (p.locked ? 1 : 0), 0);
}

function playersInfo(room) {
  return room.players.map((p, idx) => ({ idx, joined: !!p, connected: !!(p && p.connected) }));
}

function meta(room) {
  return {
    status: room.status,
    players: playersInfo(room),
    elapsedMs: elapsed(room),
    counts: counts(room),
    locked: lockedTotal(room)
  };
}

function snapshot(room) {
  return Object.assign(
    {
      code: room.code,
      imageId: room.imageId,
      total: TOTAL,
      pieces: room.pieces.map((p) => ({
        id: p.id,
        col: p.col,
        row: p.row,
        x: Math.round(p.x),
        y: Math.round(p.y),
        rot: p.rot,
        rotUsed: p.rotUsed,
        heldBy: p.heldBy,
        locked: p.locked,
        lockedBy: p.lockedBy,
        z: p.z
      }))
    },
    meta(room)
  );
}

function broadcastMeta(room) {
  io.to(room.code).emit('meta', meta(room));
}

function startIfReady(room) {
  if (room.status === 'waiting' && connectedCount(room) === 2) {
    room.status = 'playing';
    if (!room.startedAt) room.startedAt = Date.now();
  }
}

function releaseHeldBy(room, idx, exceptId) {
  for (const p of room.pieces) {
    if (p.heldBy === idx && p.id !== exceptId) {
      p.heldBy = null;
      if (p.rotUsed >= CFG.MAX_ROT) p.rotUsed = 0; // "passou a vez": giros renovados
      io.to(room.code).emit('released', { id: p.id, by: idx, x: Math.round(p.x), y: Math.round(p.y), rotUsed: p.rotUsed });
    }
  }
}

// tenta encaixar a peça; devolve true se travou
function tryLock(room, p, idx) {
  const tx = CFG.BOARD_X + p.col * CFG.TILE;
  const ty = CFG.BOARD_Y + p.row * CFG.TILE;
  if (p.rot !== 0) return false;
  if (Math.hypot(p.x - tx, p.y - ty) > CFG.SNAP) return false;

  p.x = tx;
  p.y = ty;
  p.locked = true;
  p.lockedBy = idx;
  p.heldBy = null;
  p.z = 1;
  io.to(room.code).emit('locked', { id: p.id, x: tx, y: ty, by: idx, counts: counts(room), locked: lockedTotal(room) });

  if (lockedTotal(room) === TOTAL) {
    room.status = 'won';
    if (!room.startedAt) room.startedAt = room.roundStart;
    room.finishedAt = Date.now();
    io.to(room.code).emit('won', { elapsedMs: elapsed(room), counts: counts(room) });
    broadcastMeta(room);
  }
  return true;
}

function ctx(socket) {
  const code = socket.data.code;
  if (!code) return null;
  const room = rooms.get(code);
  if (!room) return null;
  const idx = socket.data.idx;
  const pl = room.players[idx];
  if (!pl || pl.socketId !== socket.id) return null;
  room.lastActive = Date.now();
  return { room, idx };
}

function pieceFrom(room, id) {
  id = Number(id);
  if (!Number.isInteger(id) || id < 0 || id >= TOTAL) return null;
  return room.pieces[id];
}

function reply(cb, data) {
  if (typeof cb === 'function') cb(data);
}

function cleanPid(pid) {
  return typeof pid === 'string' && pid.length >= 6 && pid.length <= 64 ? pid : null;
}

// coloca o socket dentro da sala (novo jogador, reconexão ou vaga de quem saiu)
function attach(room, socket, pid) {
  let idx = room.players.findIndex((p) => p && p.pid === pid);
  if (idx === -1) {
    idx = room.players.findIndex((p) => !p);
    if (idx === -1) idx = room.players.findIndex((p) => p && !p.connected); // assume a vaga de quem caiu
    if (idx === -1) return { error: 'full' };
    if (room.players[idx]) releaseHeldBy(room, idx, -1);
  }
  const old = room.players[idx];
  if (old && old.connected && old.socketId && old.socketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(old.socketId);
    if (oldSocket) {
      oldSocket.data.code = null;
      oldSocket.leave(room.code);
    }
  }
  room.players[idx] = { pid, socketId: socket.id, connected: true };
  socket.data.code = room.code;
  socket.data.idx = idx;
  socket.join(room.code);
  room.lastActive = Date.now();
  startIfReady(room);
  return { idx };
}

function leaveCurrent(socket) {
  const code = socket.data.code;
  if (!code) return;
  const room = rooms.get(code);
  socket.data.code = null;
  socket.leave(code);
  if (!room) return;
  const idx = socket.data.idx;
  const pl = room.players[idx];
  if (pl && pl.socketId === socket.id) {
    pl.connected = false;
    pl.socketId = null;
    releaseHeldBy(room, idx, -1);
    room.lastActive = Date.now();
    broadcastMeta(room);
  }
}

/* ---------- Eventos do Socket.IO ---------- */
io.on('connection', (socket) => {
  socket.data.lastMove = 0;

  socket.on('create', (data, cb) => {
    data = data || {};
    const pid = cleanPid(data.pid);
    if (!pid) return reply(cb, { ok: false, error: 'invalid' });
    const imageId = validImage(data.imageId);
    if (!imageId) return reply(cb, { ok: false, error: 'noimages' });
    const code = newCode();
    if (!code) return reply(cb, { ok: false, error: 'busy' });

    leaveCurrent(socket);
    const room = createRoom(code, imageId);
    rooms.set(code, room);
    const res = attach(room, socket, pid);
    reply(cb, { ok: true, idx: res.idx, cfg: CFG, snapshot: snapshot(room) });
    broadcastMeta(room);
  });

  socket.on('join', (data, cb) => {
    data = data || {};
    const pid = cleanPid(data.pid);
    const code = String(data.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (!pid) return reply(cb, { ok: false, error: 'invalid' });
    const room = rooms.get(code);
    if (!room) return reply(cb, { ok: false, error: 'notfound' });

    if (socket.data.code && socket.data.code !== code) leaveCurrent(socket);
    const res = attach(room, socket, pid);
    if (res.error) return reply(cb, { ok: false, error: res.error });
    reply(cb, { ok: true, idx: res.idx, cfg: CFG, snapshot: snapshot(room) });
    broadcastMeta(room);
  });

  socket.on('grab', (data) => {
    const c = ctx(socket);
    if (!c || !data) return;
    const { room, idx } = c;
    const p = pieceFrom(room, data.id);
    if (!p || room.status === 'won') return;
    if (p.locked || (p.heldBy !== null && p.heldBy !== idx)) {
      socket.emit('deny', { id: p.id, reason: p.locked ? 'locked' : 'held', by: p.heldBy });
      return;
    }
    releaseHeldBy(room, idx, p.id); // só uma peça por vez
    p.heldBy = idx;
    p.z = ++room.z;
    io.to(room.code).emit('grabbed', { id: p.id, by: idx, z: p.z });
  });

  socket.on('move', (data) => {
    const c = ctx(socket);
    if (!c || !data) return;
    const now = Date.now();
    if (now - socket.data.lastMove < 25) return; // limite de ~40 msgs/s
    socket.data.lastMove = now;
    const p = pieceFrom(c.room, data.id);
    if (!p || p.heldBy !== c.idx) return;
    p.x = clamp(data.x, 0, CFG.FIELD_W - CFG.TILE);
    p.y = clamp(data.y, 0, CFG.FIELD_H - CFG.TILE);
    socket.to(c.room.code).volatile.emit('moved', { id: p.id, x: Math.round(p.x), y: Math.round(p.y) });
  });

  socket.on('rotate', (data) => {
    const c = ctx(socket);
    if (!c || !data) return;
    const { room, idx } = c;
    const p = pieceFrom(room, data.id);
    if (!p || p.heldBy !== idx || p.locked) return;
    if (p.rotUsed >= CFG.MAX_ROT) {
      socket.emit('rotated', { id: p.id, rot: p.rot, rotUsed: p.rotUsed }); // só para sincronizar
      return;
    }
    p.rot = (p.rot + 1) % 4;
    p.rotUsed++;
    io.to(room.code).emit('rotated', { id: p.id, rot: p.rot, rotUsed: p.rotUsed });
    tryLock(room, p, idx); // se girou até ficar certa em cima do lugar, encaixa
  });

  // soltar a peça (arrastou e largou, ou tocou de novo para dispensar)
  socket.on('drop', (data) => {
    const c = ctx(socket);
    if (!c || !data) return;
    const { room, idx } = c;
    const p = pieceFrom(room, data.id);
    if (!p || p.heldBy !== idx || p.locked) return;
    p.x = clamp(data.x, 0, CFG.FIELD_W - CFG.TILE);
    p.y = clamp(data.y, 0, CFG.FIELD_H - CFG.TILE);
    if (tryLock(room, p, idx)) return;
    p.heldBy = null;
    if (p.rotUsed >= CFG.MAX_ROT) p.rotUsed = 0;
    io.to(room.code).emit('released', { id: p.id, by: idx, x: Math.round(p.x), y: Math.round(p.y), rotUsed: p.rotUsed });
  });

  socket.on('restart', (data, cb) => {
    const c = ctx(socket);
    if (!c) return reply(cb, { ok: false });
    const { room } = c;
    const imageId = validImage(data && data.imageId) || room.imageId;
    room.imageId = imageId;
    room.pieces = buildPieces();
    room.z = 100;
    room.finishedAt = null;
    room.roundStart = Date.now();
    room.startedAt = null;
    room.status = 'waiting';
    startIfReady(room);
    io.to(room.code).emit('state', snapshot(room));
    reply(cb, { ok: true });
  });

  socket.on('disconnect', () => leaveCurrent(socket));
});

/* ---------- Limpeza de salas antigas ---------- */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const idleMin = (now - room.lastActive) / 60000;
    const ageH = (now - room.createdAt) / 3600000;
    if ((connectedCount(room) === 0 && idleMin > 15) || ageH > 8) rooms.delete(code);
  }
}, 60000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log('Quebra-cabeça a dois rodando na porta ' + PORT);
});
