/*
 * Quebra-Cabeça a Dois — cliente (navegador)
 * - Peças são elementos HTML movidos com transform (rápido no celular).
 * - O servidor decide tudo (quem segura, encaixe, vitória); aqui só mostramos
 *   e enviamos as ações. Movimentos são enviados no máximo a cada 50 ms.
 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var PLAYER_COLORS = ['#2f6bff', '#ff4f8b'];
  var HINT_MS = 6000;

  /* ---------------------------------------------------------
   * Estado
   * --------------------------------------------------------- */
  var state = {
    pid: makePid(),
    name: '',
    cfg: null,
    images: [],
    presets: [],
    defaultPieces: 12,
    hints: 3,
    hintTimer: null,
    names: ['', ''],
    idx: null,
    code: null,
    imageId: null,
    imageUrl: null,
    status: 'waiting',
    players: [],
    counts: [0, 0],
    locked: 0,
    total: 12,
    pieces: [],
    selectedId: null,
    drag: null,
    scale: 1,
    zMax: 100,
    timerBase: null,
    finalMs: 0,
    inGame: false,
    friendOnline: false,
    pickMode: 'create',
    pickChoice: null,
    pickPieces: 12,
    idleTimer: null
  };

  var imagesReady = null;
  var imgCache = {};
  var wakeLock = null;

  var socket = io({ transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000 });

  /* ---------------------------------------------------------
   * Utilidades
   * --------------------------------------------------------- */
  function makePid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* segue */ }
    return 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function myName() { return state.idx !== null && state.names[state.idx] ? state.names[state.idx] : 'Você'; }
  function friendName() {
    var n = state.idx !== null ? state.names[1 - state.idx] : '';
    return n || 'Seu amigo';
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignora */ } }

  function showScreen(name) {
    ['home', 'pick', 'game'].forEach(function (n) {
      $('#screen-' + n).classList.toggle('active', n === name);
    });
    if (name === 'game') layout();
  }

  function setLoading(on, text) {
    $('#loading').hidden = !on;
    if (text) $('#loading-text').textContent = text;
  }

  function showError(el, msg) {
    el.textContent = msg;
    el.hidden = !msg;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        navigator.wakeLock.request('screen').then(function (l) {
          wakeLock = l;
          l.addEventListener('release', function () { wakeLock = null; });
        }, function () { /* sem permissão: tudo bem */ });
      }
    } catch (e) { /* ignora */ }
  }

  /* ---------------------------------------------------------
   * Imagens: redimensiona/recorta para 3:4 (720×960) uma única vez
   * --------------------------------------------------------- */
  function loadImage(url) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('Falha ao carregar ' + url)); };
      im.src = url;
    });
  }

  // recorta o centro da imagem na proporção da grade (cols:rows) e reduz o tamanho
  function prepareImage(item, cols, rows) {
    var key = item.file + '|' + cols + 'x' + rows;
    if (imgCache[key]) return imgCache[key];
    imgCache[key] = loadImage(item.url).then(function (img) {
      var W = 720;
      var H = Math.round(W * rows / cols);
      return cropToBlob(img, W, H, item.url);
    }).catch(function () { return item.url; });
    return imgCache[key];
  }

  // miniaturas leves (3:4) para a tela de escolha
  function prepareThumb(item) {
    var key = item.file + '|thumb';
    if (imgCache[key]) return imgCache[key];
    imgCache[key] = loadImage(item.url).then(function (img) {
      return cropToBlob(img, 300, 400, item.url);
    }).catch(function () { return item.url; });
    return imgCache[key];
  }

  function cropToBlob(img, W, H, fallbackUrl) {
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
    var ar = W / H;
    if (sw / sh > ar) { var nw = sh * ar; sx = (sw - nw) / 2; sw = nw; }
    else { var nh = sw / ar; sy = (sh - nh) / 2; sh = nh; }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    return new Promise(function (res) {
      cv.toBlob(function (blob) { res(blob ? URL.createObjectURL(blob) : fallbackUrl); }, 'image/jpeg', 0.9);
    });
  }

  function fetchConfig() {
    imagesReady = fetch('api/config', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (c) {
        state.images = Array.isArray(c.images) ? c.images : [];
        state.presets = Array.isArray(c.presets) ? c.presets : [];
        state.defaultPieces = c.defaultPieces || 12;
        state.pickPieces = state.defaultPieces;
        state.hints = c.hints || 3;
      })
      .catch(function () { state.images = []; });
    return imagesReady;
  }

  /* ---------------------------------------------------------
   * Tela de escolha de imagem
   * --------------------------------------------------------- */
  function openPick(mode) {
    state.pickMode = mode;
    $('#pick-title').textContent = mode === 'create' ? 'Escolha a imagem' : 'Trocar imagem ou peças';
    $('#btn-pick-go').textContent = mode === 'create' ? 'Criar partida' : 'Recomeçar com essa escolha';
    showError($('#pick-error'), '');
    imagesReady.then(function () {
      if (!state.images.length) {
        showError($('#pick-error'), 'Nenhuma imagem encontrada na pasta public/imagens.');
        $('#pick-grid').innerHTML = '';
        $('#btn-pick-go').disabled = true;
        return;
      }
      var keep = mode === 'change' && state.images.some(function (i) { return i.file === state.imageId; });
      state.pickChoice = keep ? state.imageId : state.images[0].file;
      state.pickPieces = mode === 'change' && state.cfg ? state.cfg.PIECES : state.defaultPieces;
      renderPickGrid();
      renderSizes();
    });
    showScreen('pick');
  }

  function renderPickGrid() {
    var grid = $('#pick-grid');
    grid.innerHTML = '';
    state.images.forEach(function (item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick-card';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', item.file === state.pickChoice ? 'true' : 'false');
      b.dataset.file = item.file;
      var thumb = document.createElement('span');
      thumb.className = 'thumb';
      var label = document.createElement('span');
      label.textContent = item.label;
      b.appendChild(thumb);
      b.appendChild(label);
      grid.appendChild(b);
      prepareThumb(item).then(function (url) { thumb.style.backgroundImage = 'url("' + url + '")'; });
    });
    $('#btn-pick-go').disabled = false;
  }

  function renderSizes() {
    var grid = $('#size-grid');
    grid.innerHTML = '';
    state.presets.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'size-btn';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', p.pieces === state.pickPieces ? 'true' : 'false');
      b.dataset.pieces = p.pieces;
      b.innerHTML = '<b>' + p.pieces + '</b><span>' + p.label + '</span>';
      grid.appendChild(b);
    });
    updateSizeNote();
  }

  function updateSizeNote() {
    var p = state.presets.filter(function (x) { return x.pieces === state.pickPieces; })[0];
    if (!p) return;
    var note = p.pieces + ' peças (' + p.cols + ' × ' + p.rows + ').';
    if (p.pieces >= 48) note += ' As peças ficam pequenas no celular: melhor para telas grandes.';
    else if (p.pieces <= 6) note += ' Peças grandes, ótimas para começar.';
    $('#size-note').textContent = note;
  }

  /* ---------------------------------------------------------
   * Entrar / criar partida
   * --------------------------------------------------------- */
  function errorText(code) {
    if (code === 'notfound') return 'Não encontramos essa sala. Confira o código com seu amigo.';
    if (code === 'full') return 'Essa sala já tem duas pessoas jogando.';
    if (code === 'noimages') return 'O jogo está sem imagens. Adicione arquivos na pasta public/imagens.';
    return 'Não foi possível conectar. Tente de novo.';
  }

  function readName() {
    state.name = $('#input-name').value.replace(/\s+/g, ' ').trim().slice(0, 12);
    return state.name;
  }

  function doCreate(imageId, pieces) {
    setLoading(true, 'Criando a sala…');
    socket.emit('create', { pid: state.pid, imageId: imageId, pieces: pieces, name: readName() }, function (res) {
      if (!res || !res.ok) {
        setLoading(false);
        showError($('#pick-error'), errorText(res && res.error));
        return;
      }
      enterRoom(res);
    });
  }

  function doJoin(code) {
    setLoading(true, 'Entrando na sala…');
    socket.emit('join', { pid: state.pid, code: code, name: readName() }, function (res) {
      if (!res || !res.ok) {
        setLoading(false);
        showScreen('home');
        showError($('#home-error'), errorText(res && res.error));
        return;
      }
      enterRoom(res);
    });
  }

  function enterRoom(res) {
    state.idx = res.idx;
    startGame(res.snapshot);
  }

  function startGame(snap) {
    setLoading(true, 'Preparando as peças…');
    return imagesReady.then(function () {
      var item = state.images.filter(function (i) { return i.file === snap.imageId; })[0] ||
                 { file: snap.imageId, url: 'imagens/' + encodeURIComponent(snap.imageId) };
      return prepareImage(item, snap.cfg.COLS, snap.cfg.ROWS);
    }).then(function (url) {
      state.cfg = snap.cfg;
      state.code = snap.code;
      state.imageId = snap.imageId;
      state.imageUrl = url;
      state.total = snap.total;
      state.selectedId = null;
      state.drag = null;
      clearTimeout(state.idleTimer);
      buildField(snap);
      applyMeta(snap);
      $('#room-code').textContent = snap.code;
      $('#modal-win').hidden = true;
      $('#modal-menu').hidden = true;
      $('#confetti').innerHTML = '';
      closeHint();
      try { history.replaceState(null, '', '?sala=' + snap.code); } catch (e) { /* ignora */ }
      state.inGame = true;
      showScreen('game');
      layout();
      updateUi();
      setLoading(false);
      keepAwake();
    });
  }

  /* ---------------------------------------------------------
   * Campo de jogo
   * --------------------------------------------------------- */
  function buildField(snap) {
    var cfg = state.cfg;
    var T = cfg.TILE;
    var field = $('#field');
    field.innerHTML = '';
    field.style.width = cfg.FIELD_W + 'px';
    field.style.height = cfg.FIELD_H + 'px';
    field.style.setProperty('--tile', T + 'px');

    var board = document.createElement('div');
    board.id = 'board';
    board.style.left = cfg.BOARD_X + 'px';
    board.style.top = cfg.BOARD_Y + 'px';
    board.style.width = cfg.COLS * T + 'px';
    board.style.height = cfg.ROWS * T + 'px';
    board.style.backgroundSize = T + 'px ' + T + 'px';
    field.appendChild(board);

    state.pieces = snap.pieces.map(function (d) {
      var el = document.createElement('div');
      el.className = 'piece';
      el.dataset.id = d.id;
      el.style.width = T + 'px';
      el.style.height = T + 'px';
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.style.backgroundImage = 'url("' + state.imageUrl + '")';
      tile.style.backgroundSize = cfg.COLS * T + 'px ' + cfg.ROWS * T + 'px';
      tile.style.backgroundPosition = '-' + d.col * T + 'px -' + d.row * T + 'px';
      el.appendChild(tile);
      var tag = document.createElement('span');
      tag.className = 'tag';
      el.appendChild(tag);
      field.appendChild(el);
      var p = {
        id: d.id, col: d.col, row: d.row, el: el, tile: tile, tag: tag,
        x: d.x, y: d.y, tx: d.x, ty: d.y,
        rot: d.rot, ang: d.rot * 90, rotUsed: d.rotUsed,
        heldBy: d.heldBy, locked: d.locked, lockedBy: d.lockedBy, z: d.z,
        scaled: false, dirty: true
      };
      if (p.z > state.zMax) state.zMax = p.z;
      tile.style.transform = 'rotate(' + p.ang + 'deg)';
      classify(p);
      return p;
    });
  }

  function classify(p) {
    var mine = p.heldBy === state.idx && !p.locked;
    var theirs = p.heldBy !== null && p.heldBy !== undefined && p.heldBy !== state.idx && !p.locked;
    p.el.classList.toggle('mine', mine);
    p.el.classList.toggle('theirs', theirs);
    p.el.classList.toggle('locked', !!p.locked);
    if (mine || theirs) p.el.style.setProperty('--hc', PLAYER_COLORS[p.heldBy] || '#1b2559');
    if (theirs && p.tag) p.tag.textContent = state.names[p.heldBy] || 'Amigo';
    p.el.style.zIndex = p.locked ? 1 : p.z;
    p.scaled = mine || theirs;
    p.dirty = true;
  }

  function setAngle(p, rot) {
    var diff = (((rot * 90 - p.ang) % 360) + 360) % 360;
    p.ang += diff;
    p.rot = rot;
    p.tile.style.transform = 'rotate(' + p.ang + 'deg)';
  }

  function layout() {
    if (!state.cfg) return;
    var stage = $('#stage');
    var w = stage.clientWidth - 12;
    var h = stage.clientHeight;
    if (w <= 0 || h <= 0) return;
    var s = Math.min(w / state.cfg.FIELD_W, h / state.cfg.FIELD_H);
    state.scale = s;
    var wrap = $('#fieldWrap');
    wrap.style.width = Math.floor(state.cfg.FIELD_W * s) + 'px';
    wrap.style.height = Math.floor(state.cfg.FIELD_H * s) + 'px';
    $('#field').style.transform = 'scale(' + s + ')';
  }

  /* Laço de animação: só mexe nas peças que mudaram */
  var lastTimerPaint = 0;
  function frame(now) {
    var ps = state.pieces;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var changed = p.dirty;
      var dragging = state.drag && state.drag.id === p.id && state.drag.moved;
      if (!p.locked && !dragging) {
        var dx = p.tx - p.x, dy = p.ty - p.y;
        if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) { p.x += dx * 0.35; p.y += dy * 0.35; changed = true; }
        else if (dx !== 0 || dy !== 0) { p.x = p.tx; p.y = p.ty; changed = true; }
      } else if (p.locked && (p.x !== p.tx || p.y !== p.ty)) {
        p.x = p.tx; p.y = p.ty; changed = true;
      }
      if (changed) {
        p.el.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)' + (p.scaled ? ' scale(1.05)' : '');
        p.dirty = false;
      }
    }
    if (now - lastTimerPaint > 250) { lastTimerPaint = now; paintTimer(); }
    requestAnimationFrame(frame);
  }

  function curElapsed() {
    if (state.status === 'won') return state.finalMs;
    if (state.status === 'playing' && state.timerBase !== null) return Date.now() - state.timerBase;
    return 0;
  }
  function paintTimer() {
    if (!state.inGame) return;
    $('#hud-time').textContent = fmtTime(curElapsed());
  }

  /* ---------------------------------------------------------
   * Toque / mouse nas peças
   * --------------------------------------------------------- */
  function resetIdle() {
    clearTimeout(state.idleTimer);
    if (state.selectedId === null) return;
    state.idleTimer = setTimeout(function () {
      if (state.selectedId !== null && !state.drag) { dropSelected(); toast('Peça solta para seu amigo poder usar'); }
    }, 20000);
  }

  function dropSelected() {
    if (state.selectedId === null) return;
    var p = state.pieces[state.selectedId];
    state.selectedId = null;
    clearTimeout(state.idleTimer);
    if (p && !p.locked) {
      p.heldBy = null;
      classify(p);
      socket.emit('drop', { id: p.id, x: Math.round(p.x), y: Math.round(p.y) });
    }
    updateUi();
  }

  function shake(p) {
    p.el.classList.remove('shake');
    void p.el.offsetWidth;
    p.el.classList.add('shake');
    setTimeout(function () { p.el.classList.remove('shake'); }, 320);
  }

  function onPointerDown(e) {
    if (state.drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var el = e.target.closest ? e.target.closest('.piece') : null;
    var p = el ? state.pieces[Number(el.dataset.id)] : null;

    if (!p) { // toque no vazio: solta a peça escolhida
      if (state.selectedId !== null) dropSelected();
      return;
    }
    if (p.locked) return;
    if (p.heldBy !== null && p.heldBy !== undefined && p.heldBy !== state.idx) {
      toast(friendName() + ' está com essa peça');
      shake(p);
      return;
    }
    e.preventDefault();

    var wasSelected = state.selectedId === p.id;
    if (!wasSelected) {
      if (state.selectedId !== null) {
        var old = state.pieces[state.selectedId];
        old.heldBy = null;
        classify(old);
      }
      state.selectedId = p.id;
      p.heldBy = state.idx;
      p.z = ++state.zMax;
      classify(p);
      socket.emit('grab', { id: p.id });
    }

    var rect = $('#field').getBoundingClientRect();
    var lx = (e.clientX - rect.left) / state.scale;
    var ly = (e.clientY - rect.top) / state.scale;
    state.drag = {
      id: p.id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY,
      offX: lx - p.x, offY: ly - p.y, rect: rect, moved: false, last: 0, wasSelected: wasSelected
    };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
    clearTimeout(state.idleTimer);
    updateUi();
  }

  function onPointerMove(e) {
    var d = state.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return;
      d.moved = true;
    }
    var p = state.pieces[d.id];
    var T = state.cfg.TILE;
    var lx = (e.clientX - d.rect.left) / state.scale;
    var ly = (e.clientY - d.rect.top) / state.scale;
    p.x = clamp(lx - d.offX, 0, state.cfg.FIELD_W - T);
    p.y = clamp(ly - d.offY, 0, state.cfg.FIELD_H - T);
    p.tx = p.x; p.ty = p.y;
    p.dirty = true;
    var now = performance.now();
    if (now - d.last >= 50) {
      d.last = now;
      socket.volatile.emit('move', { id: p.id, x: Math.round(p.x), y: Math.round(p.y) });
    }
  }

  function endPointer(e, cancelled) {
    var d = state.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    state.drag = null;
    var p = state.pieces[d.id];
    if (d.moved) {
      dropSelected();                       // arrastou e soltou: tenta encaixar
    } else if (d.wasSelected && !cancelled) {
      dropSelected();                       // tocou de novo na peça escolhida: solta
    } else {
      resetIdle();                          // tocou numa peça nova: fica escolhida
    }
    if (p && !p.locked) p.dirty = true;
    updateUi();
  }

  /* ---------------------------------------------------------
   * Girar
   * --------------------------------------------------------- */
  function rotateSelected() {
    if (state.selectedId === null) return;
    var p = state.pieces[state.selectedId];
    if (!p || p.locked) return;
    if (p.rotUsed >= state.cfg.MAX_ROT) { toast('Sem giros. Solte a peça para ganhar mais.'); return; }
    p.rotUsed++;
    setAngle(p, (p.rot + 1) % 4);
    socket.emit('rotate', { id: p.id });
    vibrate(10);
    resetIdle();
    updateUi();
  }

  /* ---------------------------------------------------------
   * 💡 Dica: mostra a imagem completa por alguns segundos (3 vezes por partida)
   * --------------------------------------------------------- */
  function useHint() {
    if (state.hints <= 0) { toast('Suas dicas acabaram'); return; }
    socket.emit('hint', null, function (res) {
      if (!res || !res.ok) { state.hints = 0; updateUi(); toast('Suas dicas acabaram'); return; }
      state.hints = res.left;
      showHint();
      updateUi();
    });
  }

  function showHint() {
    var img = $('#hint-img');
    img.style.backgroundImage = 'url("' + state.imageUrl + '")';
    img.style.setProperty('--ar', state.cfg.COLS / state.cfg.ROWS);
    $('#hint-left').textContent = (state.hints > 0
      ? 'Ainda restam ' + state.hints + (state.hints === 1 ? ' dica' : ' dicas')
      : 'Foi a sua última dica') + ' · toque para fechar';
    var bar = $('#hint-bar');
    bar.classList.remove('run');
    void bar.offsetWidth;
    bar.classList.add('run');
    $('#hint-view').hidden = false;
    clearTimeout(state.hintTimer);
    state.hintTimer = setTimeout(closeHint, HINT_MS);
    if (state.selectedId !== null && !state.drag) dropSelected();
  }

  function closeHint() {
    clearTimeout(state.hintTimer);
    $('#hint-view').hidden = true;
  }

  /* ---------------------------------------------------------
   * Interface: HUD, dica e botão de girar
   * --------------------------------------------------------- */
  function updateUi() {
    var sel = state.selectedId !== null ? state.pieces[state.selectedId] : null;
    var btn = $('#btn-rotate');
    var hint = $('#hint');
    if (!sel) {
      btn.disabled = true;
      btn.textContent = '↻ Girar';
      hint.textContent = 'Arraste para o tabuleiro · toque na peça para girar · ▲ é o lado de cima';
    } else {
      var left = state.cfg.MAX_ROT - sel.rotUsed;
      btn.disabled = left <= 0;
      btn.textContent = left > 0 ? '↻ Girar (' + left + ')' : '↻ Sem giros';
      hint.textContent = left > 0
        ? 'Peça escolhida: gire e arraste até o lugar certo.'
        : 'Acabaram os giros. Solte a peça para ganhar mais giros.';
    }
    $('#hint-badge').textContent = state.hints;
    $('#btn-hint').disabled = state.hints <= 0;
    updateHud();
  }

  function updateHud() {
    $('#hud-count').textContent = state.locked + '/' + state.total;
    $('#hud-bar').style.width = (state.total ? (100 * state.locked) / state.total : 0) + '%';
    var me = $('#chip-me'), fr = $('#chip-friend');
    if (state.idx !== null) {
      me.style.setProperty('--c', PLAYER_COLORS[state.idx]);
      fr.style.setProperty('--c', PLAYER_COLORS[1 - state.idx]);
    }
    me.querySelector('.chip-name').textContent = myName();
    fr.querySelector('.chip-name').textContent = (state.idx !== null && state.names[1 - state.idx]) || 'Aguardando…';
    fr.classList.toggle('off', !state.friendOnline);
    $('#banner-wait').hidden = !(state.status === 'waiting' && state.inGame);
  }

  function applyMeta(m) {
    var friend = m.players && state.idx !== null ? m.players[1 - state.idx] : null;
    var online = !!(friend && friend.connected);
    state.players = m.players || [];
    state.names = [(state.players[0] && state.players[0].name) || '', (state.players[1] && state.players[1].name) || ''];
    if (m.hints && state.idx !== null) state.hints = m.hints[state.idx];
    if (state.inGame && online !== state.friendOnline) {
      toast(online ? friendName() + ' entrou!' : friendName() + ' saiu da sala');
    }
    state.friendOnline = online;
    state.pieces.forEach(function (p) { if (p.heldBy !== null && p.heldBy !== undefined) classify(p); });
    state.status = m.status;
    state.counts = m.counts || [0, 0];
    state.locked = m.locked || 0;
    if (m.status === 'playing') state.timerBase = Date.now() - m.elapsedMs;
    else if (m.status === 'won') state.finalMs = m.elapsedMs;
    else state.timerBase = null;
    updateHud();
    paintTimer();
  }

  /* ---------------------------------------------------------
   * Vitória
   * --------------------------------------------------------- */
  function showWin(data) {
    state.finalMs = data.elapsedMs;
    $('#win-time').textContent = fmtTime(data.elapsedMs);
    var mine = data.counts[state.idx] || 0;
    var theirs = data.counts[1 - state.idx] || 0;
    $('#win-me').textContent = mine;
    $('#win-friend').textContent = theirs;
    $('#win-me-name').textContent = myName();
    $('#win-friend-name').textContent = friendName();
    $('.chip.big.me').style.setProperty('--c', PLAYER_COLORS[state.idx]);
    $('.chip.big.friend').style.setProperty('--c', PLAYER_COLORS[1 - state.idx]);
    var box = $('#confetti');
    box.innerHTML = '';
    var colors = ['#ffcf33', '#2f6bff', '#ff4f8b', '#1fc8a0', '#ffffff'];
    for (var i = 0; i < 44; i++) {
      var c = document.createElement('i');
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 2.4 + Math.random() * 2.2 + 's';
      c.style.animationDelay = Math.random() * 0.8 + 's';
      box.appendChild(c);
    }
    $('#modal-win').hidden = false;
    vibrate([40, 60, 40]);
  }

  /* ---------------------------------------------------------
   * Eventos vindos do servidor
   * --------------------------------------------------------- */
  socket.on('grabbed', function (d) {
    var p = state.pieces[d.id];
    if (!p || p.locked) return;
    p.z = d.z;
    if (d.z > state.zMax) state.zMax = d.z;
    if (d.by !== state.idx) { p.heldBy = d.by; if (state.selectedId === p.id) { state.selectedId = null; state.drag = null; } }
    classify(p);
    updateUi();
  });

  socket.on('moved', function (d) {
    var p = state.pieces[d.id];
    if (!p || p.locked || p.heldBy === state.idx) return;
    p.tx = d.x; p.ty = d.y;
  });

  socket.on('rotated', function (d) {
    var p = state.pieces[d.id];
    if (!p) return;
    p.rotUsed = d.rotUsed;
    setAngle(p, d.rot);
    updateUi();
  });

  socket.on('released', function (d) {
    var p = state.pieces[d.id];
    if (!p || p.locked) return;
    p.heldBy = null;
    p.rotUsed = d.rotUsed;
    if (d.by !== state.idx) { p.tx = d.x; p.ty = d.y; }
    if (state.selectedId === p.id && d.by === state.idx && !state.drag) state.selectedId = null;
    classify(p);
    updateUi();
  });

  socket.on('deny', function (d) {
    var p = state.pieces[d.id];
    if (!p) return;
    if (state.selectedId === p.id) state.selectedId = null;
    if (state.drag && state.drag.id === p.id) state.drag = null;
    p.heldBy = d.reason === 'locked' ? null : (d.by === undefined ? null : d.by);
    classify(p);
    if (d.reason !== 'locked') { toast(friendName() + ' pegou essa peça primeiro'); shake(p); }
    updateUi();
  });

  socket.on('locked', function (d) {
    var p = state.pieces[d.id];
    if (!p) return;
    p.locked = true;
    p.lockedBy = d.by;
    p.heldBy = null;
    p.x = d.x; p.y = d.y; p.tx = d.x; p.ty = d.y;
    setAngle(p, 0);
    if (state.selectedId === p.id) { state.selectedId = null; clearTimeout(state.idleTimer); }
    if (state.drag && state.drag.id === p.id) state.drag = null;
    classify(p);
    state.counts = d.counts;
    state.locked = d.locked;
    if (d.by === state.idx) vibrate(25);
    updateUi();
  });

  socket.on('meta', function (m) { applyMeta(m); updateUi(); });

  socket.on('state', function (snap) { startGame(snap); });

  socket.on('won', function (d) {
    setTimeout(function () { showWin(d); }, 650);
  });

  socket.on('connect', function () {
    $('#banner-conn').hidden = true;
    if (state.code && state.inGame) {
      socket.emit('join', { pid: state.pid, code: state.code }, function (res) {
        if (res && res.ok) {
          state.idx = res.idx;
          resync(res.snapshot);
        } else {
          toast('A sala não existe mais.');
          goHome();
        }
      });
    }
  });

  socket.on('disconnect', function () {
    if (state.inGame) $('#banner-conn').hidden = false;
    state.drag = null;
  });

  socket.on('connect_error', function () {
    if (state.inGame) $('#banner-conn').hidden = false;
  });

  // depois de reconectar, atualiza sem recriar as peças (se for a mesma imagem)
  function resync(snap) {
    if (snap.imageId !== state.imageId || snap.pieces.length !== state.pieces.length || snap.cfg.TILE !== state.cfg.TILE) { startGame(snap); return; }
    state.selectedId = null;
    snap.pieces.forEach(function (d) {
      var p = state.pieces[d.id];
      p.x = p.tx = d.x; p.y = p.ty = d.y;
      p.rotUsed = d.rotUsed;
      p.heldBy = d.heldBy;
      p.locked = d.locked;
      p.lockedBy = d.lockedBy;
      p.z = d.z;
      if (p.z > state.zMax) state.zMax = p.z;
      setAngle(p, d.rot);
      classify(p);
      if (p.heldBy === state.idx && !p.locked) state.selectedId = p.id;
    });
    applyMeta(snap);
    updateUi();
  }

  function goHome() {
    state.inGame = false;
    state.code = null;
    state.pieces = [];
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignora */ }
    $('#banner-conn').hidden = true;
    $('#modal-win').hidden = true;
    $('#modal-menu').hidden = true;
    showScreen('home');
  }

  /* ---------------------------------------------------------
   * Compartilhar
   * --------------------------------------------------------- */
  function roomLink() { return location.origin + location.pathname + '?sala=' + state.code; }
  function inviteText() { return 'Vem montar um quebra-cabeça comigo! Código da sala: ' + state.code; }

  function shareRoom() {
    var url = roomLink();
    if (navigator.share) {
      navigator.share({ title: 'Quebra-cabeça a dois', text: inviteText(), url: url }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        copyLink();
      });
    } else {
      copyLink();
    }
  }
  function copyLink() {
    copyText(roomLink()).then(function (ok) { toast(ok ? 'Link copiado!' : 'Copie o código: ' + state.code); });
  }
  function openWhats() {
    window.open('https://wa.me/?text=' + encodeURIComponent(inviteText() + ' ' + roomLink()), '_blank', 'noopener');
  }

  /* ---------------------------------------------------------
   * Botões e teclado
   * --------------------------------------------------------- */
  $('#btn-create').addEventListener('click', function () { readName(); openPick('create'); });

  $('#btn-join').addEventListener('click', function () {
    var code = $('#input-code').value.trim().toUpperCase();
    if (code.length < 4) { showError($('#home-error'), 'Digite os 4 caracteres do código.'); return; }
    showError($('#home-error'), '');
    doJoin(code);
  });
  $('#input-code').addEventListener('input', function (e) {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    showError($('#home-error'), '');
  });
  $('#input-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#btn-join').click(); });
  $('#input-name').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { if ($('#input-code').value.length === 4) $('#btn-join').click(); else $('#input-name').blur(); }
  });

  $('#pick-grid').addEventListener('click', function (e) {
    var card = e.target.closest('.pick-card');
    if (!card) return;
    state.pickChoice = card.dataset.file;
    Array.prototype.forEach.call(document.querySelectorAll('.pick-card'), function (c) {
      c.setAttribute('aria-selected', c === card ? 'true' : 'false');
    });
  });

  $('#size-grid').addEventListener('click', function (e) {
    var btn = e.target.closest('.size-btn');
    if (!btn) return;
    state.pickPieces = Number(btn.dataset.pieces);
    Array.prototype.forEach.call(document.querySelectorAll('.size-btn'), function (b) {
      b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
    });
    updateSizeNote();
  });

  $('#btn-pick-back').addEventListener('click', function () {
    showScreen(state.pickMode === 'change' && state.inGame ? 'game' : 'home');
  });

  $('#btn-pick-go').addEventListener('click', function () {
    if (!state.pickChoice) return;
    if (state.pickMode === 'create') {
      doCreate(state.pickChoice, state.pickPieces);
    } else {
      socket.emit('restart', { imageId: state.pickChoice, pieces: state.pickPieces });
      showScreen('game');
    }
  });

  $('#btn-rotate').addEventListener('click', rotateSelected);
  $('#btn-hint').addEventListener('click', useHint);
  $('#hint-view').addEventListener('click', closeHint);

  $('#btn-share').addEventListener('click', shareRoom);
  $('#btn-whats').addEventListener('click', openWhats);

  $('#btn-menu').addEventListener('click', function () { $('#modal-menu').hidden = false; });
  $('#menu-close').addEventListener('click', function () { $('#modal-menu').hidden = true; });
  $('#modal-menu').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  $('#menu-copy').addEventListener('click', function () { $('#modal-menu').hidden = true; copyLink(); });
  $('#menu-change').addEventListener('click', function () { $('#modal-menu').hidden = true; openPick('change'); });
  $('#menu-restart').addEventListener('click', function () {
    $('#modal-menu').hidden = true;
    if (window.confirm('Recomeçar esta imagem? O progresso será perdido para os dois.')) {
      socket.emit('restart', { imageId: state.imageId, pieces: state.cfg.PIECES });
    }
  });
  $('#menu-leave').addEventListener('click', function () {
    if (window.confirm('Sair da partida?')) {
      socket.disconnect();
      window.location.href = location.pathname;
    }
  });

  $('#win-again').addEventListener('click', function () { socket.emit('restart', { imageId: state.imageId, pieces: state.cfg.PIECES }); });
  $('#win-change').addEventListener('click', function () { $('#modal-win').hidden = true; openPick('change'); });

  var fieldEl = $('#field');
  fieldEl.addEventListener('pointerdown', onPointerDown);
  fieldEl.addEventListener('pointermove', onPointerMove);
  fieldEl.addEventListener('pointerup', function (e) { endPointer(e, false); });
  fieldEl.addEventListener('pointercancel', function (e) { endPointer(e, true); });
  fieldEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  document.addEventListener('keydown', function (e) {
    if (!state.inGame || e.target.tagName === 'INPUT') return;
    if (e.key === 'r' || e.key === 'R') rotateSelected();
    if (e.key === 'Escape') dropSelected();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { if (state.selectedId !== null && !state.drag) dropSelected(); }
    else if (state.inGame) keepAwake();
  });

  if (window.ResizeObserver) new ResizeObserver(layout).observe($('#stage'));
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });

  /* ---------------------------------------------------------
   * Início
   * --------------------------------------------------------- */
  fetchConfig().then(function () {
    var param = '';
    try { param = (new URLSearchParams(location.search).get('sala') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); } catch (e) { /* ignora */ }
    if (param.length === 4) {
      $('#input-code').value = param;
      var inv = $('#home-invite');
      inv.innerHTML = 'Você foi convidado para a sala <strong></strong>.<br>Digite seu nome e toque em <b>Entrar</b>.';
      inv.querySelector('strong').textContent = param;
      inv.hidden = false;
      $('#btn-create').hidden = true;
      $('#btn-join').classList.remove('btn-secondary');
      $('#btn-join').classList.add('btn-primary');
      try { $('#input-name').focus(); } catch (e) { /* ignora */ }
    }
  });

  requestAnimationFrame(frame);
})();
