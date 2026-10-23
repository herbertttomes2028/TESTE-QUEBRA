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
const FIELD_W = 1000;   // largura da área de jogo
const BOARD_W = 600;    // largura do tabuleiro
const BOARD_X = 200;    // posição do tabuleiro dentro da área de jogo
const BOARD_Y = 40;
const MAX_ROT = 3;      // giros permitidos por peça antes de "passar a vez"
const HINTS = 3;        // vezes que cada jogador pode ver a imagem completa
const MAX_NAME = 12;

// Quantidades de peças disponíveis (cols × rows). As peças são sempre quadradas;
// a imagem é recortada no centro para caber na proporção da grade.
const PRESETS = [
  { pieces: 6,  cols: 2, rows: 3, label: 'Bem fácil' },
  { pieces: 12, cols: 3, rows: 4, label: 'Fácil' },
  { pieces: 20, cols: 4, rows: 5, label: 'Médio' },
  { pieces: 30, cols: 5, rows: 6, label: 'Difícil' },
  { pieces: 48, cols: 6, rows: 8, label: 'Desafio' }
];
const DEFAULT_PIECES = 12;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem O/0/I/1 para não confundir
const MAX_IMAGES = 12;

function validPieces(n, fallback) {
  n = Number(n);
  return PRESETS.some((p) => p.pieces === n) ? n : fallback;
}

// calcula o desenho do campo para a quantidade de peças escolhida
function layoutFor(pieces) {
  const pr = PRESETS.find((p) => p.pieces === pieces) || PRESETS.find((p) => p.pieces === DEFAULT_PIECES);
  const tile = BOARD_W / pr.cols;
  const perRow = Math.max(1, Math.floor(FIELD_W / tile));
  const trayRows = Math.ceil(pr.pieces / perRow);
  const pitch = Math.round(tile * 0.95);
  const trayTop = BOARD_Y + pr.rows * tile + 50;
  return {
    PIECES: pr.pieces,
    COLS: pr.cols,
    ROWS: pr.rows,
    TILE: tile,
    FIELD_W,
    FIELD_H: Math.round(trayTop + (trayRows - 1) * pitch + tile + 30),
    BOARD_X,
    BOARD_Y,
    SNAP: Math.round(tile * 0.35), // distância para a peça encaixar
    MAX_ROT,
    HINTS,
    TRAY_TOP: trayTop,
    PER_ROW: perRow,
    TRAY_ROWS: trayRows,
    PITCH: pitch
  };
}

/* ---------- Servidor HTTP ---------- */
const app = express();
app.disable('x-powered-by');

app.get('/health', (req, res) => res.type('text').send('ok'));

app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json({ images: listImages(), presets: PRESETS, defaultPieces: DEFAULT_PIECES, hints: HINTS, maxName: MAX_NAME });
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
const SMALL_WORDS = new Set(['e', 'de', 'do', 'da', 'dos', 'das', 'a', 'o', 'com']);
function prettyName(file) {
  const base = file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/([A-Za-zÀ-ÿ])(\d)/g, '$1 $2').trim();
  if (!base) return file;
  return base
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function cleanName(n) {
  return String(n == null ? '' : n)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
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

function buildPieces(cfg) {
  const total = cfg.COLS * cfg.ROWS;
  // posições da bandeja (embaixo do tabuleiro), espalhadas na largura toda
  const slots = [];
  for (let r = 0; r < cfg.TRAY_ROWS; r++) {
    for (let c = 0; c < cfg.PER_ROW; c++) {
      const x = cfg.PER_ROW > 1 ? Math.round((c * (cfg.FIELD_W - cfg.TILE)) / (cfg.PER_ROW - 1)) : Math.round((cfg.FIELD_W - cfg.TILE) / 2);
      slots.push({ x, y: cfg.TRAY_TOP + r * cfg.PITCH });
    }
  }
  shuffle(slots);
  const jit = Math.max(4, Math.round(cfg.TILE * 0.05));
  const pieces = [];
  for (let id = 0; id < total; id++) {
    const sl = slots[id];
    pieces.push({
      id,
      col: id % cfg.COLS,
      row: Math.floor(id / cfg.COLS),
      x: clamp(sl.x + rnd(-jit, jit), 0, cfg.FIELD_W - cfg.TILE),
      y: clamp(sl.y + rnd(-jit, jit), 0, cfg.FIELD_H - cfg.TILE),
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

function createRoom(code, imageId, pieces) {
  const now = Date.now();
  const cfg = layoutFor(pieces);
  return {
    code,
    imageId,
    cfg,
    hints: [HINTS, HINTS],
    status: 'waiting', // waiting | playing | won
    createdAt: now,
    lastActive: now,
    roundStart: now,
    startedAt: null,
    finishedAt: null,
    z: 100,
    pieces: buildPieces(cfg),
    players: [null, null] // { pid, socketId, connected, name }
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
  return room.players.map((p, idx) => ({ idx, joined: !!p, connected: !!(p && p.connected), name: p ? p.name : '' }));
}

function meta(room) {
  return {
    status: room.status,
    players: playersInfo(room),
    elapsedMs: elapsed(room),
    counts: counts(room),
    locked: lockedTotal(room),
    total: room.pieces.length,
    hints: room.hints
  };
}

function snapshot(room) {
  return Object.assign(
    {
      code: room.code,
      imageId: room.imageId,
      cfg: room.cfg,
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
      if (p.rotUsed >= MAX_ROT) p.rotUsed = 0; // "passou a vez": giros renovados
      io.to(room.code).emit('released', { id: p.id, by: idx, x: Math.round(p.x), y: Math.round(p.y), rotUsed: p.rotUsed });
    }
  }
}

// tenta encaixar a peça; devolve true se travou
function tryLock(room, p, idx) {
  const cfg = room.cfg;
  const tx = cfg.BOARD_X + p.col * cfg.TILE;
  const ty = cfg.BOARD_Y + p.row * cfg.TILE;
  if (p.rot !== 0) return false;
  if (Math.hypot(p.x - tx, p.y - ty) > cfg.SNAP) return false;

  p.x = tx;
  p.y = ty;
  p.locked = true;
  p.lockedBy = idx;
  p.heldBy = null;
  p.z = 1;
  io.to(room.code).emit('locked', { id: p.id, x: tx, y: ty, by: idx, counts: counts(room), locked: lockedTotal(room) });

  if (lockedTotal(room) === room.pieces.length) {
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
  if (!Number.isInteger(id) || id < 0 || id >= room.pieces.length) return null;
  return room.pieces[id];
}

function reply(cb, data) {
  if (typeof cb === 'function') cb(data);
}

function cleanPid(pid) {
  return typeof pid === 'string' && pid.length >= 6 && pid.length <= 64 ? pid : null;
}

// coloca o socket dentro da sala (novo jogador, reconexão ou vaga de quem saiu)
function attach(room, socket, pid, name) {
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
  const prevName = old && old.pid === pid ? old.name : '';
  room.players[idx] = { pid, socketId: socket.id, connected: true, name: cleanName(name) || prevName || 'Jogador ' + (idx + 1) };
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
    const room = createRoom(code, imageId, validPieces(data.pieces, DEFAULT_PIECES));
    rooms.set(code, room);
    const res = attach(room, socket, pid, data.name);
    reply(cb, { ok: true, idx: res.idx, snapshot: snapshot(room) });
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
    const res = attach(room, socket, pid, data.name);
    if (res.error) return reply(cb, { ok: false, error: res.error });
    reply(cb, { ok: true, idx: res.idx, snapshot: snapshot(room) });
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
    p.x = clamp(data.x, 0, c.room.cfg.FIELD_W - c.room.cfg.TILE);
    p.y = clamp(data.y, 0, c.room.cfg.FIELD_H - c.room.cfg.TILE);
    socket.to(c.room.code).volatile.emit('moved', { id: p.id, x: Math.round(p.x), y: Math.round(p.y) });
  });

  socket.on('rotate', (data) => {
    const c = ctx(socket);
    if (!c || !data) return;
    const { room, idx } = c;
    const p = pieceFrom(room, data.id);
    if (!p || p.heldBy !== idx || p.locked) return;
    if (p.rotUsed >= MAX_ROT) {
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
    p.x = clamp(data.x, 0, room.cfg.FIELD_W - room.cfg.TILE);
    p.y = clamp(data.y, 0, room.cfg.FIELD_H - room.cfg.TILE);
    if (tryLock(room, p, idx)) return;
    p.heldBy = null;
    if (p.rotUsed >= MAX_ROT) p.rotUsed = 0;
    io.to(room.code).emit('released', { id: p.id, by: idx, x: Math.round(p.x), y: Math.round(p.y), rotUsed: p.rotUsed });
  });

  socket.on('restart', (data, cb) => {
    const c = ctx(socket);
    if (!c) return reply(cb, { ok: false });
    const { room } = c;
    const imageId = validImage(data && data.imageId) || room.imageId;
    room.imageId = imageId;
    room.cfg = layoutFor(validPieces(data && data.pieces, room.cfg.PIECES));
    room.pieces = buildPieces(room.cfg);
    room.hints = [HINTS, HINTS];
    room.z = 100;
    room.finishedAt = null;
    room.roundStart = Date.now();
    room.startedAt = null;
    room.status = 'waiting';
    startIfReady(room);
    io.to(room.code).emit('state', snapshot(room));
    reply(cb, { ok: true });
  });

  // 💡 ver a imagem completa: cada jogador tem HINTS usos por partida (controlado aqui,
  // para não "renovar" recarregando a página)
  socket.on('hint', (data, cb) => {
    const c = ctx(socket);
    if (!c) return reply(cb, { ok: false, left: 0 });
    const { room, idx } = c;
    if (room.hints[idx] <= 0) return reply(cb, { ok: false, left: 0 });
    room.hints[idx]--;
    reply(cb, { ok: true, left: room.hints[idx] });
    socket.emit('meta', meta(room));
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
