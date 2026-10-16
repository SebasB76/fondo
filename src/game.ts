import { CARDS, KIND_WEIGHTS, type Kind, type Level } from './cards';

export interface Player {
  id: string;
  name: string;
  emoji: string;
  joinedAt: number;
  drinks: number;
  targeted: number;
}

export interface Duel {
  a: string;
  b: string;
  ready: string[];
  delayMs: number | null;
  // Reaction time in ms per duelist; -1 means they tapped before the signal.
  results: Record<string, number>;
}

export interface Card {
  seq: number;
  defId: string;
  kind: Kind;
  text: string;
  n: number;
  alsoMe: boolean;
  target: string | null;
  second: string | null;
  votes: Record<string, string | boolean>;
  duel: Duel | null;
  resolved: boolean;
  passed: boolean;
  losers: string[];
}

export interface Rule {
  text: string;
  target: string | null;
  second: string | null;
  until: number;
}

export interface RoomState {
  code: string;
  createdAt: number;
  hostId: string | null;
  level: Level;
  phase: 'lobby' | 'playing' | 'over';
  players: Player[];
  card: Card | null;
  seq: number;
  used: string[];
  rules: Rule[];
  lastKind: Kind | null;
}

export type ClientMsg =
  | { type: 'hello'; id: string; name: string; emoji: string }
  | { type: 'level'; level: Level }
  | { type: 'start' }
  | { type: 'next'; seq: number }
  | { type: 'vote'; seq: number; choice: string | boolean }
  | { type: 'reto'; seq: number; done: boolean }
  | { type: 'ready'; seq: number }
  | { type: 'react'; seq: number; ms: number }
  | { type: 'reveal'; seq: number }
  | { type: 'drink'; target: string; delta: number }
  | { type: 'end' }
  | { type: 'restart' };

const RULE_SPAN = 6;

export function newRoom(code: string): RoomState {
  return {
    code, createdAt: Date.now(), hostId: null, level: 2, phase: 'lobby',
    players: [], card: null, seq: 0, used: [], rules: [], lastKind: null,
  };
}

const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

// The host role falls to the oldest connected player while the real host is away.
export function hostOf(room: RoomState, online: Set<string>): string | null {
  if (room.hostId && online.has(room.hostId)) return room.hostId;
  return room.players.find((p) => online.has(p.id))?.id ?? room.hostId;
}

function leastTargeted(players: Player[], exclude?: string): Player {
  const pool = players.filter((p) => p.id !== exclude);
  const min = Math.min(...pool.map((p) => p.targeted));
  return pick(pool.filter((p) => p.targeted === min));
}

function draw(room: RoomState, online: Set<string>) {
  const active = room.players.filter((p) => online.has(p.id));
  if (active.length === 0) return;
  const count = active.length;

  const kindOk = (k: Kind) => {
    if (k === 'votacion') return count >= 3;
    if (k === 'duelo' || k === 'elige') return count >= 2;
    return true;
  };
  const defOk = (d: (typeof CARDS)[number]) =>
    d.level <= room.level && kindOk(d.kind) && (count >= 2 || !d.text.includes('{q}'));

  let kinds = (Object.keys(KIND_WEIGHTS) as Kind[]).filter(
    (k) => k !== room.lastKind && CARDS.some((d) => d.kind === k && defOk(d)),
  );
  if (kinds.length === 0) kinds = ['reto'];
  const total = kinds.reduce((s, k) => s + KIND_WEIGHTS[k], 0);
  let r = Math.random() * total;
  const kind = kinds.find((k) => (r -= KIND_WEIGHTS[k]) < 0) ?? kinds[0];

  let pool = CARDS.filter((d) => d.kind === kind && defOk(d) && !room.used.includes(d.id));
  if (pool.length === 0) {
    room.used = room.used.filter((id) => !id.startsWith(`${kind}-`));
    pool = CARDS.filter((d) => d.kind === kind && defOk(d));
  }
  const def = pick(pool);
  room.used.push(def.id);
  room.lastKind = kind;
  room.seq += 1;
  room.rules = room.rules.filter((rule) => rule.until > room.seq);

  const target = leastTargeted(active);
  target.targeted += 1;
  const second = count >= 2 ? leastTargeted(active, target.id) : null;
  if (second && (def.text.includes('{q}') || kind === 'duelo')) second.targeted += 1;

  const card: Card = {
    seq: room.seq, defId: def.id, kind, text: def.text,
    n: def.n + (room.level === 3 && def.level < 3 ? 1 : 0),
    alsoMe: !!def.alsoMe, target: target.id, second: second?.id ?? null,
    votes: {}, duel: null, resolved: false, passed: false, losers: [],
  };

  if (kind === 'duelo' && second) {
    card.duel = { a: target.id, b: second.id, ready: [], delayMs: null, results: {} };
  } else if (kind === 'regla') {
    room.rules.push({ text: def.text.replaceAll('{n}', String(card.n)), target: target.id, second: card.second, until: room.seq + RULE_SPAN });
    card.resolved = true;
  } else if (kind === 'ruleta') {
    const victim = pick(active);
    finish(room, card, [victim.id]);
  }
  room.card = card;
}

function finish(room: RoomState, card: Card, losers: string[]) {
  card.losers = [...new Set(losers)];
  card.resolved = true;
  for (const id of card.losers) {
    const p = room.players.find((x) => x.id === id);
    if (p) p.drinks += card.n;
  }
}

function settleVotes(room: RoomState, card: Card, force: boolean, online: Set<string>) {
  const voters = room.players.filter((p) => online.has(p.id));
  const allIn = voters.every((p) => p.id in card.votes);
  if (!force && !allIn) return;
  if (card.kind === 'votacion') {
    const tally: Record<string, number> = {};
    for (const v of Object.values(card.votes)) if (typeof v === 'string') tally[v] = (tally[v] ?? 0) + 1;
    const max = Math.max(0, ...Object.values(tally));
    finish(room, card, max > 0 ? Object.keys(tally).filter((id) => tally[id] === max) : []);
  } else {
    finish(room, card, Object.keys(card.votes).filter((id) => card.votes[id] === true));
  }
}

function settleDuel(room: RoomState, card: Card, force: boolean) {
  const d = card.duel!;
  const has = (id: string) => id in d.results;
  if (!force && !(has(d.a) && has(d.b))) return;
  // A missing result on a forced reveal counts as a foul.
  const ra = d.results[d.a] ?? -1;
  const rb = d.results[d.b] ?? -1;
  let losers: string[];
  if (ra < 0 || rb < 0) losers = [ra < 0 ? d.a : '', rb < 0 ? d.b : ''].filter(Boolean);
  else if (ra === rb) losers = [d.a, d.b];
  else losers = [ra > rb ? d.a : d.b];
  finish(room, card, losers);
}

// Re-check open votes when someone leaves, so the table never waits on a ghost.
export function recheck(room: RoomState, online: Set<string>): boolean {
  const card = room.card;
  if (!card || card.resolved || !['votacion', 'nunca', 'todos'].includes(card.kind)) return false;
  settleVotes(room, card, false, online);
  return card.resolved;
}

export function apply(room: RoomState, pid: string, msg: ClientMsg, online: Set<string>): boolean {
  const isHost = hostOf(room, online) === pid;
  const card = room.card;
  const live = (seq: number) => card && card.seq === seq && !card.resolved;

  switch (msg.type) {
    case 'level':
      if (!isHost || ![1, 2, 3].includes(msg.level)) return false;
      room.level = msg.level;
      return true;
    case 'start':
      if (!isHost || room.phase !== 'lobby') return false;
      room.phase = 'playing';
      draw(room, online);
      return true;
    case 'next':
      if (room.phase !== 'playing' || msg.seq !== room.seq) return false;
      if (card && !card.resolved && !isHost) return false;
      draw(room, online);
      return true;
    case 'vote': {
      if (!live(msg.seq)) return false;
      const c = card!;
      if (c.kind === 'elige') {
        if (pid !== c.target || typeof msg.choice !== 'string') return false;
        if (!room.players.some((p) => p.id === msg.choice)) return false;
        finish(room, c, c.alsoMe ? [msg.choice, pid] : [msg.choice]);
        return true;
      }
      if (c.kind === 'votacion') {
        if (typeof msg.choice !== 'string' || !room.players.some((p) => p.id === msg.choice)) return false;
      } else if (c.kind === 'nunca' || c.kind === 'todos') {
        if (typeof msg.choice !== 'boolean') return false;
      } else return false;
      c.votes[pid] = msg.choice;
      settleVotes(room, c, false, online);
      return true;
    }
    case 'reto': {
      if (!live(msg.seq) || card!.kind !== 'reto') return false;
      if (pid !== card!.target && !isHost) return false;
      card!.passed = !msg.done;
      finish(room, card!, msg.done ? [] : [card!.target!]);
      return true;
    }
    case 'ready': {
      const d = card?.duel;
      if (!live(msg.seq) || !d || (pid !== d.a && pid !== d.b) || d.ready.includes(pid)) return false;
      d.ready.push(pid);
      if (d.ready.length === 2) d.delayMs = 1500 + Math.floor(Math.random() * 3500);
      return true;
    }
    case 'react': {
      const d = card?.duel;
      if (!live(msg.seq) || !d || d.delayMs === null || (pid !== d.a && pid !== d.b) || pid in d.results) return false;
      d.results[pid] = msg.ms < 0 ? -1 : Math.min(Math.round(msg.ms), 5000);
      settleDuel(room, card!, false);
      return true;
    }
    case 'reveal':
      if (!isHost || !live(msg.seq)) return false;
      if (card!.duel) settleDuel(room, card!, true);
      else if (['votacion', 'nunca', 'todos'].includes(card!.kind)) settleVotes(room, card!, true, online);
      else finish(room, card!, []);
      return true;
    case 'drink': {
      const p = room.players.find((x) => x.id === msg.target);
      if (!p || ![1, -1].includes(msg.delta)) return false;
      p.drinks = Math.max(0, p.drinks + msg.delta);
      return true;
    }
    case 'end':
      if (!isHost || room.phase !== 'playing') return false;
      room.phase = 'over';
      return true;
    case 'restart':
      if (!isHost || room.phase !== 'over') return false;
      room.phase = 'lobby';
      room.card = null;
      room.rules = [];
      for (const p of room.players) { p.drinks = 0; p.targeted = 0; }
      return true;
  }
  return false;
}

export function join(room: RoomState, id: string, name: string, emoji: string) {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 16) || 'Anónimo';
  const face = [...emoji].slice(0, 2).join('') || '🍺';
  const existing = room.players.find((p) => p.id === id);
  if (existing) {
    existing.name = clean;
    existing.emoji = face;
  } else {
    room.players.push({ id, name: clean, emoji: face, joinedAt: Date.now(), drinks: 0, targeted: 0 });
  }
  room.hostId ??= id;
}
