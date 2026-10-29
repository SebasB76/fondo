import morphdom from '/vendor/morphdom.js';
import qrcode from '/vendor/qrcode.js';

const EMOJIS = ['🍺', '🍻', '🥃', '🍹', '🍾', '🧉', '🔥', '💀', '🐸', '🦖', '🐒', '👽', '🤠', '🥑', '🌶️', '🦈'];
const LEVELS = [
  { v: 1, name: 'Tranqui', sub: 'Retos suaves, pa’ calentar' },
  { v: 2, name: 'Picante', sub: 'Aquí ya se pone bueno' },
  { v: 3, name: 'Sin frenos', sub: 'Fondo blanco, cero filtro' },
];
// `turn` and `hue` give each kind its own take on the green blur.
const KINDS = {
  reto: { label: 'Reto', turn: 0, hue: 0 },
  votacion: { label: 'Votación', turn: 140, hue: -18 },
  nunca: { label: 'Yo nunca', turn: 60, hue: 14 },
  todos: { label: 'Toman todos', turn: 220, hue: -16 },
  duelo: { label: 'Duelo', turn: 300, hue: 22 },
  regla: { label: 'Regla nueva', turn: 30, hue: 38 },
  ruleta: { label: 'Ruleta', turn: 180, hue: 24 },
  elige: { label: 'Tú eliges', turn: 95, hue: -8 },
};
const EMBLEM = `<svg class="emblem" viewBox="-50 -50 100 100" fill="#fff" aria-hidden="true">
  <path d="M-20-4h40l-6 48h-28z"/><path d="M-15 8h30M-14 18h28M-13 28h26" stroke="#2c6b22" stroke-width="2.2" opacity=".5"/>
  <circle cx="21" cy="-10" r="13"/><path d="M21-10v-12M21-10l10 7M21-10l-10 7M21-10l11-6M21-10l-11-6" stroke="#2c6b22" stroke-width="1.8" opacity=".55"/>
  <path d="M-6-5C-26-17-24-40-10-47-4-34-2-20-6-5Z"/><path d="M-9-7C-31-5-41-21-37-32-25-28-15-20-9-7Z"/>
  <path d="M-7-8-12-38M-10-9-31-26" stroke="#2c6b22" stroke-width="1.5" opacity=".5"/><circle cx="2" cy="-24" r="3"/><circle cx="8" cy="-33" r="2"/>
</svg>`;
const SPIN_MS = 2600;
const DUEL_TIMEOUT_MS = 5000;

const $app = document.getElementById('app');
const S = {
  code: null,
  me: loadMe(),
  room: null,
  ws: null,
  conn: 'idle',
  fails: 0,
  gone: false,
  checking: false,
  draftName: '',
  draftCode: '',
  codeOpen: false,
  board: false,
  spins: {},
  duel: null,
  lastSeq: 0,
  busy: false,
  error: '',
};
S.draftName = S.me.name;

function loadMe() {
  try {
    const me = JSON.parse(localStorage.getItem('fondo:me'));
    if (me?.id) return me;
  } catch {}
  return { id: crypto.randomUUID(), name: '', emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)] };
}
const saveMe = () => localStorage.setItem('fondo:me', JSON.stringify(S.me));
const joinedKey = (code) => `fondo:joined:${code}`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const blurStyle = (turn, hue) => `--r:${turn}deg;--h:${hue}deg`;
const playerBlur = (id) => blurStyle(Math.abs(hash(id)) % 360, (Math.abs(hash(`${id}h`)) % 70) - 35);
const pad2 = (n) => String(n).padStart(2, '0');
const drinks = (n) => (n === 1 ? '1 trago' : n >= 4 ? 'fondo blanco' : `${n} tragos`);
const player = (id) => S.room?.players.find((p) => p.id === id);
const nameOf = (id) => player(id)?.name ?? '¿?';
const online = () => new Set(S.room?.online ?? []);
const isHost = () => S.room?.host === S.me.id;
const plural = (n, one, many) => (n === 1 ? one : many);

// ---------- routing ----------

function route() {
  const m = location.pathname.match(/^\/r\/([A-Za-z]{4})\/?$/);
  const code = m ? m[1].toUpperCase() : null;
  if (code !== S.code) {
    disconnect();
    Object.assign(S, { code, room: null, gone: false, error: '', board: false, duel: null });
    if (code && localStorage.getItem(joinedKey(code))) connect();
    else if (code) checkRoom(code);
  }
  render();
}

function go(path) {
  history.pushState(null, '', path);
  route();
}
addEventListener('popstate', route);

async function checkRoom(code) {
  S.checking = true;
  try {
    const res = await fetch(`/api/rooms/${code}`);
    S.gone = res.status === 404;
  } catch {}
  S.checking = false;
  render();
}

// ---------- socket ----------

function connect() {
  if (!S.code) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${S.code}`);
  S.ws = ws;
  S.conn = 'connecting';
  ws.onopen = () => {
    S.conn = 'open';
    S.fails = 0;
    send({ type: 'hello', id: S.me.id, name: S.me.name, emoji: S.me.emoji });
    render();
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'state') onState(msg.room);
  };
  ws.onclose = () => {
    if (S.ws !== ws) return;
    S.conn = 'closed';
    S.fails += 1;
    render();
    if (S.fails === 3) checkRoom(S.code);
    setTimeout(() => S.ws === ws && !S.gone && connect(), Math.min(600 * 2 ** S.fails, 8000));
  };
}

function disconnect() {
  const ws = S.ws;
  S.ws = null;
  S.conn = 'idle';
  if (ws) ws.close();
}

function send(msg) {
  if (S.ws?.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (S.code && S.ws && S.ws.readyState > WebSocket.OPEN) connect();
  if (S.code && S.ws) keepAwake();
});

function onState(room) {
  const prev = S.room;
  S.room = room;
  const card = room.card;
  if (card && card.seq !== prev?.card?.seq) {
    S.lastSeq = card.seq;
    const mine = card.target === S.me.id || card.duel?.b === S.me.id;
    if (mine && card.kind !== 'ruleta' && card.kind !== 'regla') navigator.vibrate?.([70, 40, 70]);
    if (card.kind === 'ruleta' && !S.spins[card.seq]) {
      S.spins[card.seq] = Date.now();
      setTimeout(render, SPIN_MS + 50);
    }
  }
  armDuel(card);
  render();
}

let wakeLock = null;
async function keepAwake() {
  try {
    if (!wakeLock || wakeLock.released) wakeLock = await navigator.wakeLock?.request('screen');
  } catch {}
}

// ---------- duel (each phone times its own reaction, so latency doesn't matter) ----------

function armDuel(card) {
  const d = card?.duel;
  const mine = d && (d.a === S.me.id || d.b === S.me.id);
  if (!mine || card.resolved || d.delayMs == null || S.me.id in d.results) return;
  if (S.duel?.seq === card.seq) return;
  const duel = { seq: card.seq, phase: 'wait', t0: 0, ms: null };
  S.duel = duel;
  duel.timer = setTimeout(() => {
    if (S.duel !== duel) return;
    duel.phase = 'go';
    navigator.vibrate?.(120);
    render();
    duel.t0 = performance.now();
    duel.timeout = setTimeout(() => react(DUEL_TIMEOUT_MS), DUEL_TIMEOUT_MS);
  }, d.delayMs);
}

function react(ms) {
  const duel = S.duel;
  if (!duel || duel.phase === 'done') return;
  clearTimeout(duel.timer);
  clearTimeout(duel.timeout);
  duel.phase = 'done';
  duel.ms = ms;
  send({ type: 'react', seq: duel.seq, ms });
  render();
}

document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('[data-pad]') || !S.duel) return;
  e.preventDefault();
  if (S.duel.phase === 'wait') react(-1);
  else if (S.duel.phase === 'go') react(performance.now() - S.duel.t0);
});

// ---------- actions ----------

const actions = {
  async create() {
    if (S.busy) return;
    S.busy = true;
    render();
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const { code } = await res.json();
      go(`/r/${code}`);
    } catch {
      S.error = 'No se pudo armar la mesa. Revisa tu internet.';
    }
    S.busy = false;
    render();
  },
  'open-code'() {
    S.codeOpen = true;
    render();
    document.getElementById('code-input')?.focus();
  },
  'go-code'() {
    const code = S.draftCode.trim().toUpperCase();
    if (code.length === 4) go(`/r/${code}`);
  },
  emoji(el) {
    S.me.emoji = el.dataset.v;
    render();
  },
  join() {
    const name = S.draftName.replace(/\s+/g, ' ').trim();
    if (!name) {
      document.getElementById('name-input')?.focus();
      return;
    }
    S.me.name = name.slice(0, 16);
    saveMe();
    localStorage.setItem(joinedKey(S.code), '1');
    keepAwake();
    connect();
    render();
  },
  home() {
    go('/');
  },
  level: (el) => send({ type: 'level', level: Number(el.dataset.v) }),
  start: () => send({ type: 'start' }),
  next: () => send({ type: 'next', seq: S.room.seq }),
  vote: (el) => send({ type: 'vote', seq: S.room.seq, choice: el.dataset.v }),
  yes: () => send({ type: 'vote', seq: S.room.seq, choice: true }),
  no: () => send({ type: 'vote', seq: S.room.seq, choice: false }),
  'reto-done': () => send({ type: 'reto', seq: S.room.seq, done: true }),
  'reto-pass': () => send({ type: 'reto', seq: S.room.seq, done: false }),
  ready: () => send({ type: 'ready', seq: S.room.seq }),
  reveal: () => send({ type: 'reveal', seq: S.room.seq }),
  drink: (el) => send({ type: 'drink', target: el.dataset.id, delta: Number(el.dataset.d) }),
  board() {
    S.board = !S.board;
    render();
  },
  end() {
    if (confirm('¿Cerrar la chupa y ver el podio?')) send({ type: 'end' });
  },
  restart: () => send({ type: 'restart' }),
  async share() {
    const url = `${location.origin}/r/${S.code}`;
    const text = `Entra a la chupa 🍻 código ${S.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'FONDO', text, url }); } catch {}
    } else {
      open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, '_blank');
    }
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  actions[el.dataset.act]?.(el);
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'name-input') S.draftName = e.target.value;
  if (e.target.id === 'code-input') {
    S.draftCode = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    e.target.value = S.draftCode;
    if (S.draftCode.length === 4) actions['go-code']();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'name-input') actions.join();
  if (e.target.id === 'code-input') actions['go-code']();
});

// ---------- views ----------

function render() {
  const html = view();
  morphdom($app, `<div id="app">${html}</div>`, {
    onBeforeElUpdated(from, to) {
      if (from === document.activeElement && from.tagName === 'INPUT') return false;
      return !from.isEqualNode(to);
    },
  });
}

function view() {
  if (!S.code) return homeView();
  if (S.gone) return goneView();
  if (!S.ws) return joinView();
  if (!S.room) return `<main class="screen center"><p class="loader">Sirviendo…</p></main>`;
  const body = S.room.phase === 'lobby' ? lobbyView() : S.room.phase === 'over' ? podiumView() : gameView();
  return body + offlineBanner();
}

function offlineBanner() {
  return S.conn === 'open' ? '' : `<div class="offline">Reconectando…</div>`;
}

function topBar(right = '') {
  return `<header class="top"><button class="logo" data-act="home">Fondo</button>${right}</header>`;
}

function homeView() {
  return `
  <main class="screen home">
    ${topBar(S.codeOpen ? '' : '<button class="menu" data-act="open-code">Tengo un código</button>')}
    <h1 class="headline">Retos para la chupa que se juegan desde el celu, sin instalar nada</h1>
    <div class="blur hero" style="${blurStyle(0, 0)}"><span>FONDO</span>${EMBLEM}<span>BLANCO</span></div>
    ${S.codeOpen ? '' : `<p class="kicker">Cómo se juega</p>
    <p class="lede">Uno arma la mesa y los demás escanean el QR. Cada carta es un reto, un voto o un duelo. Alguien siempre toma.</p>`}
    <div class="cta">
      ${S.codeOpen
        ? `<label class="code-entry"><span class="kicker">Código de la mesa</span>
            <input id="code-input" class="field" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="4" placeholder="ABCD" value="${esc(S.draftCode)}"></label>`
        : ''}
      <button class="btn arrow" data-act="create" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Armando la mesa…' : 'Armar la mesa'}</button>
      ${S.error ? `<p class="error">${esc(S.error)}</p>` : ''}
    </div>
    <p class="fineprint">Toma agüita entre ronda y ronda. Y si vas a manejar, tú eres el del jugo.</p>
  </main>`;
}

function goneView() {
  return `
  <main class="screen gone">
    ${topBar()}
    <section class="gone-body">
      <p class="kicker">Mesa cerrada</p>
      <h1 class="headline">La mesa ${esc(S.code)} no existe o ya se acabó.</h1>
      <button class="btn arrow" data-act="home">Armar otra</button>
    </section>
  </main>`;
}

function joinView() {
  return `
  <main class="screen join">
    ${topBar(`<span class="menu">Mesa ${esc(S.code)}</span>`)}
    <section class="join-body">
      <p class="kicker">Te invitaron a la mesa ${esc(S.code)}</p>
      <label class="name-field">
        <span class="headline">¿Cómo te dicen?</span>
        <input id="name-input" class="field name" maxlength="16" autocomplete="nickname" enterkeyhint="go" placeholder="Tu apodo" value="${esc(S.draftName)}">
      </label>
      <p class="kicker spaced">Elige tu cara</p>
      <div class="emoji-grid">
        ${EMOJIS.map((e) => `<button class="emoji ${e === S.me.emoji ? 'on' : ''}" data-act="emoji" data-v="${e}">${e}</button>`).join('')}
      </div>
    </section>
    <div class="dock">
      <button class="btn arrow" data-act="join" ${S.checking ? 'disabled' : ''}>Entrar a la mesa</button>
    </div>
  </main>`;
}

function chip(p) {
  return `<span class="chip ${online().has(p.id) ? '' : 'off'}">${esc(p.emoji)} ${esc(p.name)}${p.id === S.me.id ? ' <small>tú</small>' : ''}</span>`;
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
  return `<svg class="qr" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="Código QR para entrar"><path d="${d}"/></svg>`;
}

function lobbyView() {
  const r = S.room;
  const host = isHost();
  const url = `${location.origin}/r/${r.code}`;
  const live = online();
  const count = r.players.filter((p) => live.has(p.id)).length;
  const level = LEVELS.find((l) => l.v === r.level) ?? LEVELS[0];
  const status = (p) => [p.id === r.host && 'arma la mesa', p.id === S.me.id && 'tú', !live.has(p.id) && 'desconectado']
    .filter(Boolean).join(' · ');
  return `
  <main class="screen lobby">
    ${topBar('<button class="menu" data-act="home">Salir</button>')}
    <div class="lobby-grid">
      <section class="entry">
        <p class="kicker">Mesa abierta</p>
        <p class="code-big">${esc(r.code)}</p>
        <div class="qr-card">${qrSvg(url)}</div>
        <p class="note">Escaneen el QR o entren a <b>${esc(location.host)}</b> con el código.</p>
        <button class="btn ghost arrow" data-act="share">Mandar al grupo</button>
      </section>
      <section class="side">
        <p class="kicker">En la mesa · ${count}</p>
        <ol class="roster">
          ${r.players.map((p, i) => `
            <li class="sticker ${live.has(p.id) ? '' : 'off'}"><span class="no">${pad2(i + 1)}</span><b>${esc(p.emoji)} ${esc(p.name)}</b><small>${status(p)}</small></li>`).join('')}
        </ol>
        <p class="kicker spaced">Nivel</p>
        <div class="levels">
          ${LEVELS.map((l) => `<button class="level ${r.level === l.v ? 'on' : ''}" data-act="level" data-v="${l.v}" ${host ? '' : 'disabled'}>${l.name}</button>`).join('')}
        </div>
        <p class="note">${level.sub}</p>
      </section>
    </div>
    <div class="dock">
      ${host
        ? `<button class="btn arrow" data-act="start" ${count < 2 ? 'disabled' : ''}>${count < 2 ? 'Esperando panas…' : 'Arrancar la chupa'}</button>`
        : waiting(`Esperando a que <b>${esc(nameOf(r.host))}</b> arranque`)}
    </div>
  </main>`;
}

function fill(text, card) {
  const who = (id) => (player(id) ? `<mark>${esc(nameOf(id))}</mark>` : '');
  return esc(text)
    .replaceAll('{p}', who(card.target))
    .replaceAll('{q}', who(card.second))
    .replaceAll('{n}', `<b class="n">${drinks(card.n)}</b>`);
}

function cardHeadline(card) {
  if (card.kind === 'votacion') return `<span class="pre">¿Quién es más probable que…</span>${fill(card.text, card)}?`;
  if (card.kind === 'todos') return `<span class="pre">Toman ${drinks(card.n)} los que…</span>${fill(card.text, card)}`;
  return fill(card.text, card);
}

function cardFoot(card) {
  const n = drinks(card.n);
  switch (card.kind) {
    case 'reto': return `Si no lo haces: ${n}`;
    case 'votacion': return `El más votado toma ${n}`;
    case 'nunca': return `Si lo has hecho, tomas ${n}`;
    case 'todos': return 'Sé honesto, el grupo te mira';
    case 'duelo': return 'Toca cuando se ponga verde';
    case 'regla': return 'Dura 5 cartas';
    case 'ruleta': return `Le toca ${n}`;
    case 'elige': return card.alsoMe ? `Ambos toman ${n}` : `Toma ${n}`;
  }
  return '';
}

function spinning(card) {
  return card.kind === 'ruleta' && Date.now() - (S.spins[card.seq] ?? 0) < SPIN_MS;
}

function verdict(card) {
  if (!card.resolved || spinning(card) || card.kind === 'regla') return '';
  const n = card.losers.length;
  let pre, main;
  if (card.kind === 'reto' && !card.passed && n === 0) [pre, main] = ['Reto', 'Cumplido'];
  else if (n === 0) [pre, main] = ['Esta vez', 'Nadie toma'];
  else if (n > 2) [pre, main] = ['Toman', n === S.room.players.length ? 'Todos' : `${n} de la mesa`];
  else [pre, main] = [plural(n, 'Toma', 'Toman'), card.losers.map((id) => esc(nameOf(id))).join(' y ')];
  return `<div class="verdict ${n ? '' : 'ok'}"><em>${pre}</em><b>${main}</b></div>`;
}

function ruletaReel(card) {
  const names = S.room.players.map((p) => p.name);
  const reel = [];
  for (let i = 0; i < 6; i++) reel.push(...names);
  reel.push(nameOf(card.losers[0]));
  return `<div class="reel" id="reel-${card.seq}"><div class="reel-strip" style="--steps:${reel.length - 1}">
    ${reel.map((n) => `<div>${esc(n)}</div>`).join('')}</div></div>`;
}

function cardView(card) {
  const k = KINDS[card.kind];
  const spin = spinning(card);
  const stamp = verdict(card);
  return `
  <article class="card deal" id="card-${card.seq}" data-kind="${card.kind}">
    <div class="blur tile ${spin || stamp ? 'busy' : ''}" style="${blurStyle(k.turn, k.hue)}">
      <span class="tile-label">${k.label}</span>
      ${spin ? ruletaReel(card) : ''}
      ${stamp}
    </div>
    <div class="card-meta"><span class="card-no">Nº ${pad2(card.seq)}</span><span>${cardFoot(card)}</span></div>
    <h2 class="card-text">${cardHeadline(card)}</h2>
  </article>`;
}

function rulesView() {
  const rules = S.room.rules;
  if (!rules.length) return '';
  return `<ul class="rules" aria-label="Reglas activas">${rules.map((r) => {
    const left = r.until - S.room.seq;
    return `<li><span><em>Regla activa:</em> ${fill(r.text, { target: r.target, second: r.second, n: 1 })}</span><small>${plural(left, 'queda 1', `quedan ${left}`)}</small></li>`;
  }).join('')}</ul>`;
}

function gameView() {
  const r = S.room;
  const card = r.card;
  const me = player(S.me.id);
  return `
  <main class="screen game ${S.board ? 'board-open' : ''}">
    ${topBar(`<span class="menu">Mesa ${esc(r.code)}</span>
      <button class="board-btn" data-act="board" aria-label="Ver tablero">${glass(me?.drinks ?? 0, maxDrinks(), 'me', 'mini')}<b>${me?.drinks ?? 0}</b></button>`)}
    ${rulesView()}
    <div class="game-grid">
      <section class="stage">
        ${card ? cardView(card) : ''}
        <div class="actions">${card ? actionsView(card) : ''}</div>
      </section>
      ${boardView()}
    </div>
    ${S.board ? '<div class="scrim" data-act="board"></div>' : ''}
    ${duelPad(card)}
  </main>`;
}

function waiting(text) {
  return `<p class="waiting">${text}<span class="dots"></span></p>`;
}

function nextBtn() {
  return `<button class="btn arrow" data-act="next">Siguiente carta</button>`;
}

function hostTools(card, label = 'Saltar carta') {
  if (!isHost() || card.resolved) return '';
  const canReveal = ['votacion', 'nunca', 'todos', 'duelo'].includes(card.kind);
  return `<div class="host-tools">
    ${canReveal ? `<button class="link" data-act="reveal">Revelar ya</button>` : ''}
    <button class="link" data-act="next">${label}</button>
  </div>`;
}

function losersLine(card) {
  if (!card.losers.length) return '';
  return `<div class="losers"><em>${plural(card.losers.length, 'Toma', 'Toman')} ${drinks(card.n)}</em>${card.losers.map((id) => (player(id) ? chip(player(id)) : '')).join('')}</div>`;
}

function voteBtn(p, on = false) {
  return `<button class="vote ${on ? 'on' : ''}" data-act="vote" data-v="${p.id}"><i>${esc(p.emoji)}</i>${esc(p.name)}</button>`;
}

function actionsView(card) {
  if (spinning(card)) return waiting('Girando');
  if (card.resolved) return `${resultDetail(card)}${losersLine(card)}${nextBtn()}`;
  const me = S.me.id;
  const live = S.room.players.filter((p) => online().has(p.id));

  switch (card.kind) {
    case 'reto':
      if (card.target === me) {
        return `<div class="duo">
          <button class="btn accent" data-act="reto-done">Lo hice</button>
          <button class="btn ghost" data-act="reto-pass">Paso, tomo ${drinks(card.n)}</button>
        </div>`;
      }
      return waiting(`Le toca a <b>${esc(nameOf(card.target))}</b>`) + hostTools(card);

    case 'votacion': {
      const mine = card.votes[me];
      const missing = live.filter((p) => !(p.id in card.votes)).length;
      return `<div class="vote-grid">${S.room.players.map((p) => voteBtn(p, mine === p.id)).join('')}</div>
      ${waiting(mine ? `Votaste. ${plural(missing, 'Falta', 'Faltan')} ${missing}` : 'Vota en secreto')}${hostTools(card)}`;
    }

    case 'nunca':
    case 'todos': {
      const mine = card.votes[me];
      const missing = live.filter((p) => !(p.id in card.votes)).length;
      return `<div class="duo">
        <button class="btn ${mine === true ? 'on' : ''}" data-act="yes">${card.kind === 'nunca' ? 'Yo sí, tomo' : 'Me toca, tomo'}</button>
        <button class="btn ghost ${mine === false ? 'on' : ''}" data-act="no">${card.kind === 'nunca' ? 'Yo nunca' : 'Me salvo'}</button>
      </div>
      ${mine === undefined ? '' : waiting(`${plural(missing, 'Falta', 'Faltan')} ${missing} por responder`)}${hostTools(card)}`;
    }

    case 'elige':
      if (card.target === me) {
        return `<div class="vote-grid">${S.room.players.filter((p) => p.id !== me).map((p) => voteBtn(p)).join('')}</div>`;
      }
      return waiting(`<b>${esc(nameOf(card.target))}</b> está eligiendo`) + hostTools(card);

    case 'duelo': {
      const d = card.duel;
      const fighter = d.a === me || d.b === me;
      const vs = `<div class="vs"><b>${esc(nameOf(d.a))}</b><em>vs</em><b>${esc(nameOf(d.b))}</b></div>`;
      if (fighter && !d.ready.includes(me)) {
        return `${vs}<p class="hint">Cuando la pantalla se ponga <b>verde</b>, toca lo más rápido que puedas. Si tocas antes, pierdes.</p>
          <button class="btn accent arrow" data-act="ready">Estoy listo</button>`;
      }
      if (d.delayMs == null) return vs + waiting('Esperando a que los dos estén listos') + hostTools(card);
      return vs + waiting('Reflejos en curso') + hostTools(card);
    }
  }
  return nextBtn();
}

function resultDetail(card) {
  if (card.kind === 'votacion') {
    const tally = {};
    for (const v of Object.values(card.votes)) tally[v] = (tally[v] ?? 0) + 1;
    const max = Math.max(1, ...Object.values(tally));
    const rows = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    return `<div class="tally">${rows.map(([id, n]) => `
      <div class="tally-row" style="--w:${(n / max) * 100}%"><span>${esc(player(id)?.emoji ?? '')} ${esc(nameOf(id))}</span><i></i><b>${n}</b></div>`).join('')}</div>`;
  }
  if (card.kind === 'duelo') {
    const d = card.duel;
    const t = (id) => {
      const v = d.results[id];
      return v == null ? 'no tocó' : v < 0 ? 'se adelantó' : `${v} ms`;
    };
    return `<div class="duel-res">
      ${[d.a, d.b].map((id) => `<div class="${card.losers.includes(id) ? 'lost' : 'won'}">${esc(nameOf(id))}<b>${t(id)}</b></div>`).join('')}
    </div>`;
  }
  if (card.kind === 'nunca' || card.kind === 'todos') {
    const safe = Object.keys(card.votes).filter((id) => card.votes[id] === false);
    return safe.length ? `<p class="safe">Se salvan: ${safe.map((id) => esc(nameOf(id))).join(', ')}</p>` : '';
  }
  return '';
}

function duelPad(card) {
  const duel = S.duel;
  if (!card?.duel || !duel || duel.seq !== card.seq || card.resolved) return '';
  if (duel.phase === 'done') {
    const label = duel.ms < 0 ? 'Te adelantaste' : `${Math.round(duel.ms)} ms`;
    return `<div class="pad done"><p>${label}</p><small>Esperando al rival…</small></div>`;
  }
  if (duel.phase === 'go') return `<div class="pad go blur" style="${blurStyle(40, 10)}" data-pad><p>Ya</p><small>Toca, toca, toca</small></div>`;
  return `<div class="pad wait" data-pad><p>Espera…</p><small>No toques todavía</small></div>`;
}

function maxDrinks() {
  return Math.max(6, ...(S.room?.players.map((p) => p.drinks) ?? [0]));
}

function glass(n, max, key, cls = '') {
  const h = 46 * Math.min(1, n / max);
  const id = `g-${key}`;
  return `<svg class="glass ${cls}" viewBox="0 0 40 52" aria-hidden="true">
    <clipPath id="${id}"><path d="M3 2 L7 49 H33 L37 2 Z"/></clipPath>
    <g clip-path="url(#${id})">
      <g class="liquid" style="transform:translateY(${(50 - h).toFixed(1)}px)">
        <rect x="0" y="0" width="40" height="52" fill="var(--green)"/>
        <rect x="0" y="-1" width="40" height="5" fill="var(--foam)"/>
      </g>
    </g>
    <path d="M3 2 L7 49 H33 L37 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function boardView() {
  const r = S.room;
  const max = maxDrinks();
  const rows = [...r.players].sort((a, b) => b.drinks - a.drinks);
  return `
  <aside class="board">
    <div class="board-head"><h3 class="board-title">Tablero</h3><button class="link only-mobile" data-act="board">Cerrar</button></div>
    <ol class="board-list">
      ${rows.map((p) => `
        <li class="${online().has(p.id) ? '' : 'off'}">
          ${glass(p.drinks, max, `b-${p.id}`)}
          <div class="who"><span>${esc(p.emoji)} ${esc(p.name)}${p.id === r.host ? ' <small>host</small>' : ''}</span><b>${p.drinks}</b></div>
          <div class="pm">
            <button data-act="drink" data-id="${p.id}" data-d="-1" aria-label="Quitar un trago">−</button>
            <button data-act="drink" data-id="${p.id}" data-d="1" aria-label="Sumar un trago">+</button>
          </div>
        </li>`).join('')}
    </ol>
    <p class="note">¿Alguien rompió una regla? Súmale un trago con +.</p>
    ${isHost() ? `<button class="btn ghost" data-act="end">Terminar la chupa</button>` : ''}
  </aside>`;
}

function podiumView() {
  const r = S.room;
  const rows = [...r.players].sort((a, b) => b.drinks - a.drinks);
  const title = (i) => (i === 0 ? 'Leyenda de la chupa' : i === rows.length - 1 && rows.length > 2 ? 'Modo agüita' : i === 1 ? 'Casi casi' : '');
  return `
  <main class="screen podium">
    ${topBar(`<span class="menu">Mesa ${esc(r.code)}</span>`)}
    <p class="kicker">Fin de la chupa</p>
    <h1 class="headline">Ranking de la noche</h1>
    <ol class="ranking">
      ${rows.map((p, i) => `
        <li style="--d:${i * 90}ms">
          <div class="blur thumb" style="${playerBlur(p.id)}">${i + 1}</div>
          <div class="who"><em>${esc(p.emoji)} ${esc(p.name)}</em><small>${p.drinks} ${plural(p.drinks, 'trago', 'tragos')}${title(i) ? ` — ${title(i)}` : ''}</small></div>
        </li>`).join('')}
    </ol>
    <div class="dock">
      ${isHost() ? `<button class="btn arrow" data-act="restart">Otra ronda</button>` : waiting('El host decide si hay otra')}
    </div>
  </main>`;
}

route();
