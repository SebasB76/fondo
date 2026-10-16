import { DurableObject } from 'cloudflare:workers';
import { apply, hostOf, join, newRoom, recheck, type ClientMsg, type RoomState } from './game';

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

const ROOM_TTL_MS = 2 * 24 * 60 * 60 * 1000;
// No I, L or O: codes get read aloud across a loud room.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RE = /^[A-HJKMNP-Z]{4}$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const roomStub = (code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      for (let i = 0; i < 8; i++) {
        const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => ALPHABET[b % ALPHABET.length]).join('');
        const res = await roomStub(code).fetch(`https://room/init?code=${code}`, { method: 'POST' });
        if (res.ok) return json({ code });
      }
      return json({ error: 'busy' }, 503);
    }

    const m = url.pathname.match(/^\/(api\/rooms|ws)\/([A-Za-z]{4})$/);
    if (m) {
      const code = m[2].toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: 'not_found' }, 404);
      return roomStub(code).fetch(m[1] === 'ws' ? new Request('https://room/ws', req) : 'https://room/exists');
    }

    return env.ASSETS.fetch(req);
  },
};

export class Room extends DurableObject<Env> {
  room: RoomState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomState>('room')) ?? null;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/init') {
      if (this.room) return json({ error: 'taken' }, 409);
      this.room = newRoom(url.searchParams.get('code')!);
      await this.save();
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return json({ code: this.room.code });
    }
    if (!this.room) return json({ error: 'not_found' }, 404);
    if (url.pathname === '/exists') return json({ code: this.room.code, phase: this.room.phase, players: this.room.players.length });
    if (req.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.room || typeof raw !== 'string' || raw.length > 2000) return;
    let msg: ClientMsg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'hello') {
      if (typeof msg.id !== 'string' || !/^[\w-]{8,64}$/.test(msg.id)) return;
      join(this.room, msg.id, String(msg.name ?? ''), String(msg.emoji ?? ''));
      ws.serializeAttachment({ pid: msg.id });
      await this.commit();
      return;
    }

    const pid = (ws.deserializeAttachment() as { pid?: string } | null)?.pid;
    if (!pid) return;
    if (apply(this.room, pid, msg, this.online())) await this.commit();
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 ? 1000 : code); } catch {}
    if (!this.room) return;
    recheck(this.room, this.online(ws));
    await this.commit(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1011);
  }

  async alarm() {
    for (const ws of this.ctx.getWebSockets()) try { ws.close(1001, 'room expired'); } catch {}
    this.room = null;
    await this.ctx.storage.deleteAll();
  }

  private online(skip?: WebSocket): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === skip || ws.readyState !== WebSocket.OPEN) continue;
      const pid = (ws.deserializeAttachment() as { pid?: string } | null)?.pid;
      if (pid) ids.add(pid);
    }
    return ids;
  }

  private async save() {
    await this.ctx.storage.put('room', this.room);
  }

  private async commit(skip?: WebSocket) {
    await this.save();
    const online = this.online(skip);
    const view = {
      ...this.room!,
      used: undefined,
      host: hostOf(this.room!, online),
      online: [...online],
      now: Date.now(),
    };
    const payload = JSON.stringify({ type: 'state', room: view });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === skip) continue;
      try { ws.send(payload); } catch {}
    }
  }
}
