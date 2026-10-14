(() => {
'use strict';

const N = 8;
const TYPES = [
  { img: 'img/ouro.png',     nome: 'barras de ouro' },
  { img: 'img/rubi.png',     nome: 'rubis' },
  { img: 'img/diamante.png', nome: 'diamantes' },
  { img: 'img/esmeralda.png', nome: 'esmeraldas' }
];
function iconHTML(i) { return `<img src="${TYPES[i].img}" alt="" draggable="false">`; }
const $ = id => document.getElementById(id);
const boardEl = $('board');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = () => Math.floor(Math.random() * TYPES.length);
const inB = (r, c) => r >= 0 && c >= 0 && r < N && c < N;
const key = (r, c) => r * N + c;

let grid = [];
let busy = true, ended = false;
let selected = null, drag = null;
let level = 1, score = 0, levelStartScore = 0;
let moves = 0, goalType = 0, goalNeed = 0, goalHave = 0;
let hintTimer = null, muted = false;
let best = 0;
try { best = +localStorage.getItem('match3-best') || 0; } catch (e) {}

/* ---------- Som ---------- */
let ac;
function beep(f, d = 0.09, type = 'sine', v = 0.06) {
  if (muted) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f; g.gain.value = v;
    o.connect(g); g.connect(ac.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d);
    o.stop(ac.currentTime + d);
  } catch (e) {}
}

/* ---------- Peças ---------- */
function skin(t) {
  t.g.className = t.sp === 'color' ? 'g sp-color' : 'g c' + t.type + (t.sp ? ' sp-' + t.sp : '');
  t.g.innerHTML = t.sp === 'color' ? '' : iconHTML(t.type);
}
function setPos(t, r, c) { t.el.style.transform = `translate(${c * 100}%,${r * 100}%)`; }

function makeTile(r, c, type, sp, fromR) {
  const el = document.createElement('div');
  el.className = 't';
  const g = document.createElement('div');
  el.appendChild(g);
  const t = { type, sp: sp || null, el, g, r, c };
  skin(t);
  el.style.transition = 'none';
  setPos(t, fromR, c);
  boardEl.appendChild(el);
  void el.offsetWidth;
  el.style.transition = '';
  setPos(t, r, c);
  return t;
}

const at = k => grid[Math.floor(k / N)][k % N];

/* ---------- Detecção de combinações ---------- */
function runLen(r, c, dr, dc) {
  const t = grid[r][c];
  if (!t || t.type < 0) return 0;
  let n = 1;
  for (let i = 1; ; i++) {
    const rr = r + dr * i, cc = c + dc * i;
    if (!inB(rr, cc) || !grid[rr][cc] || grid[rr][cc].type !== t.type) break;
    n++;
  }
  for (let i = 1; ; i++) {
    const rr = r - dr * i, cc = c - dc * i;
    if (!inB(rr, cc) || !grid[rr][cc] || grid[rr][cc].type !== t.type) break;
    n++;
  }
  return n;
}
const hasMatchAt = (r, c) => runLen(r, c, 0, 1) >= 3 || runLen(r, c, 1, 0) >= 3;

function anyMatch() {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (hasMatchAt(r, c)) return true;
  return false;
}

function findMatches(prefs) {
  const runs = [];
  for (let r = 0; r < N; r++) {
    let c = 0;
    while (c < N) {
      const t = grid[r][c];
      if (!t || t.type < 0) { c++; continue; }
      let e = c + 1;
      while (e < N && grid[r][e] && grid[r][e].type === t.type) e++;
      if (e - c >= 3) runs.push({ dir: 'h', type: t.type, cells: Array.from({ length: e - c }, (_, i) => key(r, c + i)) });
      c = e;
    }
  }
  for (let c = 0; c < N; c++) {
    let r = 0;
    while (r < N) {
      const t = grid[r][c];
      if (!t || t.type < 0) { r++; continue; }
      let e = r + 1;
      while (e < N && grid[e][c] && grid[e][c].type === t.type) e++;
      if (e - r >= 3) runs.push({ dir: 'v', type: t.type, cells: Array.from({ length: e - r }, (_, i) => key(r + i, c)) });
      r = e;
    }
  }
  const cells = new Set();
  runs.forEach(run => run.cells.forEach(k => cells.add(k)));

  const spawns = new Map();
  const rank = { h: 1, v: 1, bomb: 2, color: 3 };
  const setSpawn = (k, sp, type) => {
    const cur = spawns.get(k);
    if (!cur || rank[sp] > rank[cur.sp]) spawns.set(k, { sp, type });
  };
  const pk = (prefs || []).map(p => key(p.r, p.c));
  runs.forEach(run => {
    if (run.cells.length < 4) return;
    const pick = run.cells.find(k => pk.includes(k)) ?? run.cells[Math.floor(run.cells.length / 2)];
    const sp = run.cells.length >= 5 ? 'color' : (run.dir === 'h' ? 'v' : 'h');
    setSpawn(pick, sp, run.type);
  });
  const hs = runs.filter(r => r.dir === 'h'), vs = runs.filter(r => r.dir === 'v');
  hs.forEach(h => vs.forEach(v => {
    const common = h.cells.find(k => v.cells.includes(k));
    if (common !== undefined) setSpawn(common, 'bomb', h.type);
  }));
  return { cells, spawns };
}

/* ---------- Efeitos de especiais ---------- */
function expand(set) {
  const seen = new Set(set), q = [...set];
  while (q.length) {
    const k = q.pop();
    const t = at(k);
    if (!t || !t.sp) continue;
    const r = Math.floor(k / N), c = k % N, add = [];
    if (t.sp === 'h') for (let i = 0; i < N; i++) add.push(key(r, i));
    if (t.sp === 'v') for (let i = 0; i < N; i++) add.push(key(i, c));
    if (t.sp === 'bomb') {
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
        if (Math.abs(dr) + Math.abs(dc) <= 3 && inB(r + dr, c + dc)) add.push(key(r + dr, c + dc));
    }
    if (t.sp === 'color') {
      const count = {};
      grid.flat().forEach(x => { if (x && x.type >= 0) count[x.type] = (count[x.type] || 0) + 1; });
      const top = +Object.keys(count).sort((a, b) => count[b] - count[a])[0];
      grid.flat().forEach(x => { if (x && x.type === top) add.push(key(x.r, x.c)); });
    }
    add.forEach(x => { if (!seen.has(x)) { seen.add(x); q.push(x); } });
  }
  return seen;
}

/* ---------- Limpeza, gravidade e ciclo ---------- */
async function clearCells(set, spawns, combo) {
  const all = expand(set);
  let sr = 0, sc = 0, n = 0;
  all.forEach(k => {
    const t = at(k);
    if (!t) return;
    if (t.type === goalType) goalHave++;
    t.g.classList.add('pop');
    const r = Math.floor(k / N), c = k % N;
    sr += r; sc += c; n++;
    grid[r][c] = null;
    setTimeout(() => t.el.remove(), 300);
  });
  if (!n) return;
  const pts = n * 40 * combo;
  addScore(pts);
  floater(pts, sr / n, sc / n);
  beep(380 + combo * 90, 0.1, 'triangle');
  spawns.forEach(({ sp, type }, k) => {
    const r = Math.floor(k / N), c = k % N;
    const t = makeTile(r, c, sp === 'color' ? -1 : type, sp, r);
    t.g.classList.add('born');
    grid[r][c] = t;
    beep(700, 0.15, 'sine');
  });
  updHud();
  await sleep(300);
}

async function gravity() {
  for (let c = 0; c < N; c++) {
    let w = N - 1;
    for (let r = N - 1; r >= 0; r--) {
      const t = grid[r][c];
      if (t) {
        if (r !== w) { grid[w][c] = t; grid[r][c] = null; t.r = w; t.c = c; setPos(t, w, c); }
        w--;
      }
    }
    const n = w + 1;
    for (let r = w; r >= 0; r--) grid[r][c] = makeTile(r, c, rnd(), null, r - n);
  }
  await sleep(340);
}

async function settle(prefs) {
  let combo = 0;
  while (true) {
    const m = findMatches(prefs);
    if (!m.cells.size) break;
    combo++;
    await clearCells(m.cells, m.spawns, combo);
    await gravity();
    prefs = null;
  }
}

/* ---------- Troca ---------- */
function exchange(a, b) {
  const ta = grid[a.r][a.c], tb = grid[b.r][b.c];
  grid[a.r][a.c] = tb; grid[b.r][b.c] = ta;
  ta.r = b.r; ta.c = b.c; tb.r = a.r; tb.c = a.c;
  setPos(ta, ta.r, ta.c); setPos(tb, tb.r, tb.c);
}

async function swap(a, b) {
  busy = true; clearHint();
  const ta = grid[a.r][a.c], tb = grid[b.r][b.c];
  exchange(a, b);
  beep(300, 0.06);
  await sleep(270);

  if (ta.sp === 'color' || tb.sp === 'color') {
    moves--; updHud();
    const col = ta.sp === 'color' ? ta : tb, other = col === ta ? tb : ta;
    const set = new Set([key(col.r, col.c)]);
    grid.flat().forEach(x => { if (x && (other.sp === 'color' || x.type === other.type)) set.add(key(x.r, x.c)); });
    await clearCells(set, new Map(), 2);
    await gravity();
    await settle(null);
  } else {
    const m = findMatches([a, b]);
    if (!m.cells.size) {
      exchange(a, b);
      beep(150, 0.15, 'square', 0.04);
      await sleep(270);
      busy = false; scheduleHint();
      return;
    }
    moves--; updHud();
    await settle([a, b]);
  }
  await afterTurn();
}

async function afterTurn() {
  if (goalHave >= goalNeed) return finish(true);
  if (moves <= 0) return finish(false);
  if (!findMove()) await shuffle();
  busy = false;
  scheduleHint();
}

/* ---------- Jogadas possíveis, dica e embaralhar ---------- */
function findMove() {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const r2 = r + dr, c2 = c + dc;
      if (!inB(r2, c2)) continue;
      const A = grid[r][c], B = grid[r2][c2];
      if (A.sp === 'color' || B.sp === 'color') return [{ r, c }, { r: r2, c: c2 }];
      grid[r][c] = B; grid[r2][c2] = A;
      const ok = hasMatchAt(r, c) || hasMatchAt(r2, c2);
      grid[r][c] = A; grid[r2][c2] = B;
      if (ok) return [{ r, c }, { r: r2, c: c2 }];
    }
  }
  return null;
}

function scheduleHint() {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (busy || ended) return;
    const m = findMove();
    if (m) m.forEach(p => grid[p.r][p.c].g.classList.add('hint'));
  }, 5000);
}
function clearHint() {
  clearTimeout(hintTimer);
  boardEl.querySelectorAll('.hint').forEach(e => e.classList.remove('hint'));
}

async function shuffle() {
  toast('Sem jogadas! Embaralhando...');
  const tiles = grid.flat();
  for (let tries = 0; tries < 80; tries++) {
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    tiles.forEach((t, i) => { grid[Math.floor(i / N)][i % N] = t; });
    if (!anyMatch() && findMove()) break;
  }
  tiles.forEach((t, i) => { t.r = Math.floor(i / N); t.c = i % N; setPos(t, t.r, t.c); });
  await sleep(500);
  if (anyMatch()) await settle(null);
}

/* ---------- Níveis ---------- */
function fillBoard() {
  boardEl.querySelectorAll('.t,.float').forEach(e => e.remove());
  do {
    grid = Array.from({ length: N }, () => Array(N).fill(null));
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      let ty;
      do { ty = rnd(); } while (
        (c >= 2 && grid[r][c - 1].type === ty && grid[r][c - 2].type === ty) ||
        (r >= 2 && grid[r - 1][c].type === ty && grid[r - 2][c].type === ty)
      );
      grid[r][c] = { type: ty, sp: null, r, c };
    }
  } while (!findMove());
  grid = grid.map((row, r) => row.map((o, c) => makeTile(r, c, o.type, null, r - N)));
}

async function startLevel(n) {
  level = n; ended = false; busy = true; clearHint();
  levelStartScore = score;
  moves = Math.min(15, 10 + Math.floor(n / 2));
  goalType = Math.floor(Math.random() * TYPES.length);
  goalNeed = Math.min(50, 12 + n * 3);
  goalHave = 0;
  fillBoard();
  updHud();
  await sleep(600);
  busy = false;
  scheduleHint();
}

async function finish(win) {
  ended = true; busy = true; clearHint();
  await sleep(300);
  if (win) {
    const left = moves;
    addScore(left * 50);
    updHud();
    const stars = left >= 8 ? 3 : left >= 4 ? 2 : 1;
    beep(660, 0.2, 'triangle'); setTimeout(() => beep(880, 0.3, 'triangle'), 180);
    showModal('Nível ' + level + ' completo!', stars,
      left > 0 ? `Bônus de ${left * 50} pontos pelas jogadas que sobraram.` : 'Você conseguiu na última jogada!',
      'Próximo nível', () => startLevel(level + 1));
  } else {
    beep(200, 0.4, 'sawtooth', 0.04);
    showModal('Acabaram as jogadas', 0, `Faltaram ${goalNeed - goalHave} ${TYPES[goalType].nome} para completar o objetivo.`,
      'Tentar de novo', () => { score = levelStartScore; startLevel(level); });
  }
}

/* ---------- Interface ---------- */
function addScore(p) {
  score += p;
  if (score > best) { best = score; try { localStorage.setItem('match3-best', best); } catch (e) {} }
}
function updHud() {
  $('level').textContent = level;
  $('moves').textContent = Math.max(0, moves);
  $('score').textContent = score;
  $('best').textContent = best;
  $('goalIcon').innerHTML = iconHTML(goalType);
  $('goalTxt').textContent = Math.min(goalHave, goalNeed) + '/' + goalNeed;
  const pct = Math.min(1, goalHave / goalNeed);
  $('barFill').style.width = pct * 100 + '%';
  [...$('stars').children].forEach((s, i) => s.classList.toggle('on', pct >= (i + 1) / 3 - 0.001));
}
function floater(pts, r, c) {
  const f = document.createElement('div');
  f.className = 'float';
  f.textContent = '+' + pts;
  f.style.left = ((c + 0.5) / N * 100) + '%';
  f.style.top = ((r + 0.5) / N * 100) + '%';
  boardEl.appendChild(f);
  setTimeout(() => f.remove(), 850);
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 1400);
}
function showModal(title, stars, text, btn, fn) {
  $('mTitle').textContent = title;
  $('mStars').textContent = stars ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '';
  $('mText').textContent = text;
  $('mBtn').textContent = btn;
  $('mBtn').onclick = () => { $('modal').classList.add('hidden'); fn(); };
  $('modal').classList.remove('hidden');
  $('mBtn').focus();
}

/* ---------- Entrada (toque, mouse e arraste) ---------- */
function cellFrom(e) {
  const rect = boardEl.getBoundingClientRect();
  const c = Math.floor((e.clientX - rect.left) / rect.width * N);
  const r = Math.floor((e.clientY - rect.top) / rect.height * N);
  return inB(r, c) ? { r, c } : null;
}
function setSel(p) {
  if (selected && grid[selected.r][selected.c]) grid[selected.r][selected.c].g.classList.remove('sel');
  selected = p;
  if (p) grid[p.r][p.c].g.classList.add('sel');
}
const adj = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

boardEl.addEventListener('pointerdown', e => {
  if (busy || ended) return;
  const p = cellFrom(e);
  if (!p) return;
  clearHint();
  if (selected && selected.r === p.r && selected.c === p.c) { setSel(null); return; }
  if (selected && adj(selected, p)) { const s = selected; setSel(null); swap(s, p); return; }
  setSel(p);
  drag = { x: e.clientX, y: e.clientY, p };
});
boardEl.addEventListener('pointermove', e => {
  if (!drag || busy) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) < boardEl.clientWidth / N * 0.35) return;
  const p = drag.p;
  const q = Math.abs(dx) > Math.abs(dy) ? { r: p.r, c: p.c + Math.sign(dx) } : { r: p.r + Math.sign(dy), c: p.c };
  drag = null; setSel(null);
  if (inB(q.r, q.c)) swap(p, q);
});
window.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('pointercancel', () => { drag = null; });

$('btnRestart').addEventListener('click', () => {
  if (busy && !ended) return;
  $('modal').classList.add('hidden');
  score = levelStartScore;
  startLevel(level);
});
$('btnSound').addEventListener('click', e => {
  muted = !muted;
  e.currentTarget.textContent = muted ? 'Som: desligado' : 'Som: ligado';
  e.currentTarget.setAttribute('aria-pressed', muted);
});

startLevel(1);
})();
