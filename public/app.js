import morphdom from '/vendor/morphdom.js';
import qrcode from '/vendor/qrcode.js';

const EMOJIS = ['🍺', '🍻', '🥃', '🍹', '🍾', '🧉', '🔥', '💀', '🐸', '🦖', '🐒', '👽', '🤠', '🥑', '🌶️', '🦈'];
const INKS = ['#ffc21a', '#ff3d8b', '#16b871', '#ff6b1a', '#3d6bff', '#00b8b0', '#9a6bff', '#ff4d3d'];
const LEVELS = [
  { v: 1, name: 'Tranqui', emoji: '🥤', sub: 'Retos suaves, pa’ calentar' },
  { v: 2, name: 'Picante', emoji: '🌶️', sub: 'Aquí ya se pone bueno' },
  { v: 3, name: 'Sin frenos', emoji: '💀', sub: 'Fondo blanco, cero filtro' },
];
const KINDS = {
  reto: { label: 'Reto', ink: '#ffc21a' },
  votacion: { label: 'Votación', ink: '#ff3d8b' },
  nunca: { label: 'Yo nunca', ink: '#16b871' },
  todos: { label: 'Toman todos los que…', ink: '#ff6b1a' },
  duelo: { label: 'Duelo', ink: '#ff4d3d' },
  regla: { label: 'Regla nueva', ink: '#3d6bff' },
  ruleta: { label: 'Ruleta', ink: '#00b8b0' },
  elige: { label: 'Tú eliges', ink: '#9a6bff' },
};
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
const inkOf = (id) => INKS[Math.abs(hash(id)) % INKS.length];
const tiltOf = (id, max = 4) => ((Math.abs(hash(id + 'r')) % (max * 20)) / 10 - max).toFixed(1);
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
  if (!S.room) return `<main class="screen center"><div class="loader">Sirviendo…</div></main>`;
  const body = S.room.phase === 'lobby' ? lobbyView() : S.room.phase === 'over' ? podiumView() : gameView();
  return body + offlineBanner();
}

function offlineBanner() {
  return S.conn === 'open' ? '' : `<div class="offline">Reconectando…</div>`;
}

function badge() {
  return `
  <svg class="badge" viewBox="0 0 120 120" aria-hidden="true">
    <defs><path id="circ" d="M60 60 m-46 0 a46 46 0 1 1 92 0 a46 46 0 1 1 -92 0"/></defs>
    <circle cx="60" cy="60" r="58" fill="var(--pink)"/>
    <text><textPath href="#circ" textLength="286" lengthAdjust="spacing">FONDO BLANCO ✶ SALUD MI GENTE ✶</textPath></text>
    <text class="badge-mid" x="60" y="70" text-anchor="middle">🍻</text>
  </svg>`;
}

function homeView() {
  return `
  <main class="screen home">
    <div class="hero">
      <p class="eyebrow">retos pa’ la chupa · sin instalar nada</p>
      <h1 class="logo"><span>FON</span><span>DO</span></h1>
      ${badge()}
    </div>
    <ul class="pitch">
      <li><b>01</b> Uno arma la mesa y muestra el QR.</li>
      <li><b>02</b> Los demás lo escanean con el celu.</li>
      <li><b>03</b> Retos, votaciones y duelos. El que pierde, toma.</li>
    </ul>
    <div class="cta">
      <button class="btn btn-yellow" data-act="create" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Armando…' : 'Armar la chupa'}</button>
      ${S.codeOpen
        ? `<label class="code-entry"><span>Código de la mesa</span>
            <input id="code-input" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="4" placeholder="ABCD" value="${esc(S.draftCode)}"></label>`
        : `<button class="btn btn-ghost" data-act="open-code">Tengo un código</button>`}
      ${S.error ? `<p class="error">${esc(S.error)}</p>` : ''}
    </div>
    <p class="fineprint">Toma agüita entre ronda y ronda. Y si vas a manejar, tú eres el del jugo.</p>
  </main>`;
}

function goneView() {
  return `
  <main class="screen center">
    <div class="ticket small">
      <p class="stamp-label" style="--k:var(--red)">Mesa cerrada</p>
      <h2 class="big">La mesa <span class="mono">${esc(S.code)}</span> no existe o ya se acabó.</h2>
      <button class="btn btn-yellow" data-act="home">Armar otra</button>
    </div>
  </main>`;
}

function joinView() {
  return `
  <main class="screen join">
    <header class="top"><button class="logo-sm" data-act="home">FONDO</button><span class="chip-code">${esc(S.code)}</span></header>
    <section class="join-body">
      <p class="eyebrow">Te invitaron a la mesa ${esc(S.code)}</p>
      <label class="name-field">
        <span>¿Cómo te dicen?</span>
        <input id="name-input" maxlength="16" autocomplete="nickname" enterkeyhint="go" placeholder="Tu apodo" value="${esc(S.draftName)}">
      </label>
      <p class="label">Elige tu cara</p>
      <div class="emoji-grid">
        ${EMOJIS.map((e) => `<button class="emoji ${e === S.me.emoji ? 'on' : ''}" data-act="emoji" data-v="${e}">${e}</button>`).join('')}
      </div>
    </section>
    <div class="dock">
      <button class="btn btn-yellow" data-act="join" ${S.checking ? 'disabled' : ''}>Entrar a la mesa</button>
    </div>
  </main>`;
}

function sticker(p, { big = false, extra = '' } = {}) {
  const off = !online().has(p.id);
  return `<span class="sticker ${big ? 'big' : ''} ${off ? 'off' : ''}" style="--c:${inkOf(p.id)};--r:${tiltOf(p.id)}deg">
    <i>${esc(p.emoji)}</i>${esc(p.name)}${p.id === S.me.id ? '<small>tú</small>' : ''}${extra}</span>`;
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
  const count = r.players.filter((p) => online().has(p.id)).length;
  return `
  <main class="screen lobby">
    <header class="top"><button class="logo-sm" data-act="home">FONDO</button><span class="chip-code">${count} en la mesa</span></header>
    <div class="lobby-grid">
      <section class="entry">
        <div class="entry-top tk-top"><div class="entry-qr">${qrSvg(url)}</div></div>
        <div class="entry-info tk-bottom">
          <p class="stamp-label" style="--k:var(--pink)">Pase de entrada</p>
          <p class="code-big">${esc(r.code)}</p>
          <p class="hint">Escanea el QR o entra a <b>${esc(location.host)}</b> con este código.</p>
          <button class="btn btn-ink" data-act="share">Mandar al grupo</button>
        </div>
      </section>
      <section class="side">
        <h3 class="section-title">En la mesa</h3>
        <div class="roster">${r.players.map((p) => sticker(p, { big: true })).join('')}</div>
        <h3 class="section-title">Nivel</h3>
        <div class="levels">
          ${LEVELS.map((l) => `
            <button class="level ${r.level === l.v ? 'on' : ''}" data-act="level" data-v="${l.v}" ${host ? '' : 'disabled'}>
              <span class="level-emoji">${l.emoji}</span><b>${l.name}</b><small>${l.sub}</small>
            </button>`).join('')}
        </div>
      </section>
    </div>
    <div class="dock">
      ${host
        ? `<button class="btn btn-yellow" data-act="start" ${count < 2 ? 'disabled' : ''}>${count < 2 ? 'Esperando panas…' : 'Arrancar la chupa'}</button>`
        : `<p class="waiting">Esperando a que <b>${esc(nameOf(r.host))}</b> arranque<span class="dots"></span></p>`}
    </div>
  </main>`;
}

function fill(text, card) {
  const who = (id) => {
    const p = player(id);
    return p ? `<mark style="--c:${inkOf(p.id)}">${esc(p.name)}</mark>` : '';
  };
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
  let text;
  if (card.kind === 'reto' && !card.passed && card.losers.length === 0) text = 'Cumplido';
  else if (card.losers.length === 0) text = 'Nadie toma';
  else if (card.losers.length > 2) text = `Toman ${card.losers.length}`;
  else text = `Toma${card.losers.length > 1 ? 'n' : ''}<br>${card.losers.map((id) => esc(nameOf(id))).join(' y ')}`;
  return `<div class="verdict ${card.losers.length ? '' : 'ok'}">${text}</div>`;
}

function ruletaReel(card) {
  const names = S.room.players.map((p) => p.name);
  const victim = nameOf(card.losers[0]);
  const reel = [];
  for (let i = 0; i < 6; i++) for (const n of names) reel.push(n);
  reel.push(victim);
  const done = !spinning(card);
  return `<div class="reel" id="reel-${card.seq}">
    <div class="reel-strip ${done ? 'done' : ''}" style="--steps:${reel.length - 1}">
      ${reel.map((n) => `<div>${esc(n)}</div>`).join('')}
    </div></div>`;
}

function cardView(card) {
  const k = KINDS[card.kind];
  return `
  <article class="card deal" id="card-${card.seq}" data-kind="${card.kind}" style="--k:${k.ink};--tilt:${tiltOf(String(card.seq), 2.2)}deg">
    <div class="card-main tk-top">
      <div class="card-head">
        <span class="stamp-label" style="--k:${k.ink}">${k.label}</span>
        <span class="card-no">Nº ${String(card.seq).padStart(2, '0')}</span>
      </div>
      <h2 class="card-text">${cardHeadline(card)}</h2>
      ${card.kind === 'ruleta' ? ruletaReel(card) : ''}
      ${verdict(card)}
    </div>
    <div class="card-stub tk-bottom"><span>${cardFoot(card)}</span><span class="card-brand">FONDO</span></div>
  </article>`;
}

function rulesTicker() {
  const rules = S.room.rules;
  if (!rules.length) return '';
  const items = rules.map((r) => {
    const left = r.until - S.room.seq;
    return `<span>⚠ ${fill(r.text, { target: r.target, second: r.second, n: 1 })} <em>(${left} ${plural(left, 'carta', 'cartas')})</em></span>`;
  }).join('');
  return `<div class="ticker" aria-label="Reglas activas"><div class="ticker-track">${items}${items}</div></div>`;
}

function gameView() {
  const r = S.room;
  const card = r.card;
  const me = player(S.me.id);
  return `
  <main class="screen game ${S.board ? 'board-open' : ''}">
    <header class="top">
      <button class="logo-sm" data-act="home">FONDO</button>
      <span class="chip-code">${esc(r.code)}</span>
      <button class="board-btn" data-act="board" aria-label="Ver tablero">${glass(me?.drinks ?? 0, maxDrinks(), 'me', 'mini')}<b>${me?.drinks ?? 0}</b></button>
    </header>
    ${rulesTicker()}
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
  return `<button class="btn btn-yellow" data-act="next">Siguiente carta →</button>`;
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
  return `<div class="losers"><span>${plural(card.losers.length, 'Toma', 'Toman')} ${drinks(card.n)}:</span>${card.losers.map((id) => player(id) ? sticker(player(id)) : '').join('')}</div>`;
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
          <button class="btn btn-green" data-act="reto-done">Lo hice</button>
          <button class="btn btn-ghost" data-act="reto-pass">Paso, tomo ${drinks(card.n)}</button>
        </div>`;
      }
      return waiting(`Le toca a <b>${esc(nameOf(card.target))}</b>`) + hostTools(card);

    case 'votacion': {
      const mine = card.votes[me];
      const missing = live.filter((p) => !(p.id in card.votes)).length;
      return `<div class="vote-grid">
        ${S.room.players.map((p) => `<button class="vote ${mine === p.id ? 'on' : ''}" data-act="vote" data-v="${p.id}">
          <i>${esc(p.emoji)}</i>${esc(p.name)}</button>`).join('')}
      </div>
      ${waiting(mine ? `Votaste. ${plural(missing, 'Falta', 'Faltan')} ${missing}` : 'Vota en secreto')}${hostTools(card)}`;
    }

    case 'nunca':
    case 'todos': {
      const mine = card.votes[me];
      const missing = live.filter((p) => !(p.id in card.votes)).length;
      return `<div class="duo">
        <button class="btn btn-green ${mine === true ? 'on' : ''}" data-act="yes">${card.kind === 'nunca' ? 'Yo sí, tomo' : 'Me toca, tomo'}</button>
        <button class="btn btn-ghost ${mine === false ? 'on' : ''}" data-act="no">${card.kind === 'nunca' ? 'Yo nunca' : 'Me salvo'}</button>
      </div>
      ${mine === undefined ? '' : waiting(`${plural(missing, 'Falta', 'Faltan')} ${missing} por responder`)}${hostTools(card)}`;
    }

    case 'elige':
      if (card.target === me) {
        return `<div class="vote-grid">
          ${S.room.players.filter((p) => p.id !== me).map((p) => `<button class="vote" data-act="vote" data-v="${p.id}"><i>${esc(p.emoji)}</i>${esc(p.name)}</button>`).join('')}
        </div>`;
      }
      return waiting(`<b>${esc(nameOf(card.target))}</b> está eligiendo`) + hostTools(card);

    case 'duelo': {
      const d = card.duel;
      const fighter = d.a === me || d.b === me;
      const vs = `<div class="vs">${sticker(player(d.a), { big: true })}<b>VS</b>${sticker(player(d.b), { big: true })}</div>`;
      if (fighter && !d.ready.includes(me)) {
        return `${vs}<p class="hint">Cuando la pantalla se ponga <b class="green">verde</b>, toca lo más rápido que puedas. Si tocas antes, pierdes.</p>
          <button class="btn btn-red" data-act="ready">Estoy listo</button>`;
      }
      if (d.delayMs == null) return vs + waiting('Esperando a que los dos estén listos') + hostTools(card);
      return vs + waiting('¡Reflejos en curso!') + hostTools(card);
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
      <div class="bar" style="--w:${(n / max) * 100}%;--c:${inkOf(id)}"><span>${esc(player(id)?.emoji ?? '')} ${esc(nameOf(id))}</span><b>${n}</b></div>`).join('')}</div>`;
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
    const label = duel.ms < 0 ? '¡Te adelantaste!' : `${Math.round(duel.ms)} ms`;
    return `<div class="pad done"><p>${label}</p><small>Esperando al rival…</small></div>`;
  }
  const go = duel.phase === 'go';
  return `<div class="pad ${go ? 'go' : 'wait'}" data-pad><p>${go ? '¡YA!' : 'Espera…'}</p><small>${go ? 'Toca, toca, toca' : 'No toques todavía'}</small></div>`;
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
        <rect x="0" y="0" width="40" height="52" fill="var(--amber)"/>
        <rect x="0" y="-1" width="40" height="5" fill="var(--foam)"/>
      </g>
    </g>
    <path d="M3 2 L7 49 H33 L37 2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function boardView() {
  const r = S.room;
  const max = maxDrinks();
  const rows = [...r.players].sort((a, b) => b.drinks - a.drinks);
  return `
  <aside class="board">
    <div class="board-head"><h3 class="section-title">Tablero</h3><button class="link only-mobile" data-act="board">Cerrar</button></div>
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
    <p class="hint">¿Alguien rompió una regla? Súmale un trago con +.</p>
    ${isHost() ? `<button class="btn btn-ghost small" data-act="end">Terminar la chupa</button>` : ''}
  </aside>`;
}

function podiumView() {
  const r = S.room;
  const rows = [...r.players].sort((a, b) => b.drinks - a.drinks);
  const max = Math.max(1, rows[0]?.drinks ?? 1);
  const title = (i) => (i === 0 ? 'Leyenda de la chupa' : i === rows.length - 1 && rows.length > 2 ? 'Modo agüita' : i === 1 ? 'Casi casi' : '');
  return `
  <main class="screen podium">
    <header class="top"><button class="logo-sm" data-act="home">FONDO</button><span class="chip-code">${esc(r.code)}</span></header>
    <h1 class="podium-title">Se acabó<br>la chupa</h1>
    <ol class="ranking">
      ${rows.map((p, i) => `
        <li style="--c:${inkOf(p.id)};--d:${i * 90}ms">
          <span class="rank">${i + 1}</span>
          ${glass(p.drinks, max, `p-${p.id}`)}
          <div class="who"><b>${esc(p.emoji)} ${esc(p.name)}</b>${title(i) ? `<small>${title(i)}</small>` : ''}</div>
          <span class="count">${p.drinks}<small>${plural(p.drinks, 'trago', 'tragos')}</small></span>
        </li>`).join('')}
    </ol>
    <div class="dock">
      ${isHost() ? `<button class="btn btn-yellow" data-act="restart">Otra ronda</button>` : waiting('El host decide si hay otra')}
    </div>
  </main>`;
}

route();
