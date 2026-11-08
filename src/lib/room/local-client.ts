// Supabase の接続情報がないときに使う、ブラウザ内だけのサーバーの代わり（開発・動作確認用）。
// 同じブラウザの別タブ同士で対戦できる。データは localStorage に保存し、
// 変更は BroadcastChannel で他のタブに知らせる。ログイン状態はタブごと（sessionStorage）。
// Supabase 側の RPC（supabase/migrations）と同じ振る舞いになるようにしている。
import { type DealInfo, initialRoomState, normalizeRoomState, type RoomState } from "@/lib/domain/game";
import type { AnswerRecord, GameRecord, StatsData } from "@/lib/domain/stats";
import {
  type FeedbackInput,
  type LoginResult,
  type Player,
  type Room,
  RoomError,
  type RoomClient,
  MAX_FEEDBACK_LENGTH,
  isValidCode,
  isValidEmail,
  normalizeCode,
  normalizeEmail,
  normalizeName,
  randomUuid,
} from "./types";

const DB_KEY = "trivia-battle:local-db:v2";
const SESSION_KEY = "trivia-battle:local-session";
const CHANNEL = "trivia-battle:local";

interface LocalPlayer extends Player {
  savedHand: number[];
}

interface LocalAnswer {
  gameId: string;
  round: number;
  cardId: number;
  questionerId: string;
  guesserId: string;
  correct: boolean;
  bet: number;
  answeredAt: string;
}

interface LocalGame {
  id: string;
  hostId: string;
  guestId: string;
  winnerId: string;
  hostName: string;
  guestName: string;
  hostScore: number;
  guestScore: number;
  finishedAt: string;
}

export interface LocalDb {
  rooms: Record<string, Room>;
  players: Record<string, LocalPlayer>;
  sessions: Record<string, string>; // token → playerId
  seen: Record<string, Record<string, number>>; // playerId → cardId → 時刻
  answers: Record<string, LocalAnswer>; // `${gameId}:${round}`
  games: Record<string, LocalGame>;
  feedback: { message: string; page?: string; playerId: string | null; createdAt: string }[];
}

function emptyDb(): LocalDb {
  return { rooms: {}, players: {}, sessions: {}, seen: {}, answers: {}, games: {}, feedback: [] };
}

function readDb(): LocalDb {
  try {
    const raw = localStorage.getItem(DB_KEY);
    const db = { ...emptyDb(), ...(raw ? (JSON.parse(raw) as Partial<LocalDb>) : {}) };
    for (const [id, r] of Object.entries(db.rooms)) db.rooms[id] = { ...r, state: normalizeRoomState(r.state) };
    return db;
  } catch {
    return emptyDb();
  }
}

/** 保存された対戦の状態から、出会った問題・記録・終わった対戦を記録する（SQL の trivia_battle_record と同じ） */
export function recordGame(db: LocalDb, room: Room, now = Date.now()): void {
  const g = room.state.game;
  if (!g || !room.guestId) return;
  const ids = { A: room.hostId, B: room.guestId };
  const see = (playerId: string, cardId: number, bump: boolean) => {
    const m = (db.seen[playerId] ??= {});
    if (bump || m[String(cardId)] === undefined) m[String(cardId)] = now;
  };
  for (const seat of ["A", "B"] as const) for (const id of g.hands[seat]) see(ids[seat], id, true);
  for (const t of g.history) {
    const questionerId = ids[t.questioner];
    const guesserId = ids[t.questioner === "A" ? "B" : "A"];
    see(questionerId, t.cardId, false);
    see(guesserId, t.cardId, false);
    db.answers[`${g.id}:${t.round}`] ??= {
      gameId: g.id,
      round: t.round,
      cardId: t.cardId,
      questionerId,
      guesserId,
      correct: t.correct,
      bet: t.bet,
      answeredAt: new Date(now).toISOString(),
    };
  }
  if (g.phase === "over" && g.winner) {
    db.games[g.id] ??= {
      id: g.id,
      hostId: room.hostId,
      guestId: room.guestId,
      winnerId: ids[g.winner],
      hostName: room.hostName,
      guestName: room.guestName ?? "",
      hostScore: g.scores.A,
      guestScore: g.scores.B,
      finishedAt: new Date(now).toISOString(),
    };
    if (db.players[room.hostId]) db.players[room.hostId].savedHand = [...g.hands.A];
    if (db.players[room.guestId]) db.players[room.guestId].savedHand = [...g.hands.B];
  }
}

/** 2人が出会った問題と持ち越しの手札（SQL の trivia_battle_deal_info と同じ） */
export function dealInfoOf(db: LocalDb, hostId: string, guestId: string): DealInfo {
  const seenAt: Record<string, number> = {};
  for (const pid of [hostId, guestId]) {
    for (const [card, t] of Object.entries(db.seen[pid] ?? {})) seenAt[card] = Math.max(seenAt[card] ?? 0, t);
  }
  const keep = (owner: string, opponent: string) =>
    (db.players[owner]?.savedHand ?? []).filter((id) => db.seen[opponent]?.[String(id)] === undefined);
  return { seenAt, hands: { A: keep(hostId, guestId), B: keep(guestId, hostId) } };
}

export class LocalRoomClient implements RoomClient {
  readonly kind = "local" as const;
  private channel: BroadcastChannel | null = null;

  private getChannel(): BroadcastChannel | null {
    if (typeof BroadcastChannel === "undefined") return null;
    this.channel ??= new BroadcastChannel(CHANNEL);
    return this.channel;
  }

  private update<T>(fn: (db: LocalDb) => T, changedRoom?: string): T {
    const db = readDb();
    const out = fn(db);
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    if (changedRoom) this.getChannel()?.postMessage({ id: changedRoom });
    return out;
  }

  private me(db: LocalDb = readDb()): LocalPlayer | null {
    const token = sessionStorage.getItem(SESSION_KEY);
    const pid = token ? db.sessions[token] : undefined;
    return (pid && db.players[pid]) || null;
  }

  private requireMe(db: LocalDb): LocalPlayer {
    const p = this.me(db);
    if (!p) throw new RoomError("not_logged_in");
    return p;
  }

  private startSession(db: LocalDb, playerId: string): Player {
    const token = randomUuid();
    db.sessions[token] = playerId;
    sessionStorage.setItem(SESSION_KEY, token);
    const { id, email, nickname } = db.players[playerId];
    return { id, email, nickname };
  }

  async restoreLogin(): Promise<Player | null> {
    const p = this.me();
    return p ? { id: p.id, email: p.email, nickname: p.nickname } : null;
  }

  async login(rawEmail: string): Promise<LoginResult> {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new RoomError("invalid_email");
    return this.update((db) => {
      const p = Object.values(db.players).find((x) => x.email === email);
      return p ? { status: "ok" as const, player: this.startSession(db, p.id) } : { status: "new" as const };
    });
  }

  async register(rawEmail: string, nickname: string): Promise<Player> {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new RoomError("invalid_email");
    const n = normalizeName(nickname);
    if (!n) throw new RoomError("invalid_name");
    return this.update((db) => {
      let p = Object.values(db.players).find((x) => x.email === email);
      if (!p) {
        p = { id: randomUuid(), email, nickname: n, savedHand: [] };
        db.players[p.id] = p;
      }
      return this.startSession(db, p.id);
    });
  }

  async logout(): Promise<void> {
    const token = sessionStorage.getItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    if (token) this.update((db) => void delete db.sessions[token]);
  }

  async createRoom(name: string): Promise<Room> {
    const n = normalizeName(name);
    if (!n) throw new RoomError("invalid_name");
    let roomId = "";
    const room = this.update((db) => {
      const me = this.requireMe(db);
      me.nickname = n;
      for (const [id, r] of Object.entries(db.rooms)) if (r.closed) delete db.rooms[id];
      const used = new Set(Object.values(db.rooms).map((r) => r.code));
      let code: string;
      do code = String(1000 + Math.floor(Math.random() * 9000));
      while (used.has(code));
      const r: Room = {
        id: randomUuid(),
        code,
        version: 1,
        hostId: me.id,
        hostName: n,
        guestId: null,
        guestName: null,
        closed: false,
        state: initialRoomState(),
      };
      db.rooms[r.id] = r;
      roomId = r.id;
      return r;
    });
    this.getChannel()?.postMessage({ id: roomId });
    return room;
  }

  async joinRoom(rawCode: string, name: string): Promise<Room> {
    const code = normalizeCode(rawCode);
    if (!isValidCode(code)) throw new RoomError("invalid_code");
    const n = normalizeName(name);
    if (!n) throw new RoomError("invalid_name");
    const db = readDb();
    const me = this.requireMe(db);
    const room = Object.values(db.rooms).find((r) => r.code === code && !r.closed);
    if (!room) throw new RoomError("not_found");
    if (room.hostId === me.id || room.guestId === me.id) return room;
    if (room.guestId) throw new RoomError("full");
    return this.update((d) => {
      d.players[me.id].nickname = n;
      const next: Room = {
        ...room,
        guestId: me.id,
        guestName: n,
        version: room.version + 1,
        state: { ...room.state, ready: { ...room.state.ready, B: false } },
      };
      d.rooms[room.id] = next;
      return next;
    }, room.id);
  }

  async fetchRoom(id: string): Promise<Room | null> {
    const db = readDb();
    const me = this.me(db);
    const room = db.rooms[id];
    if (!me || !room || (room.hostId !== me.id && room.guestId !== me.id)) return null;
    return room;
  }

  async saveState(room: Room, state: RoomState): Promise<Room | null> {
    return this.update((db) => {
      const current = db.rooms[room.id];
      if (!current || current.version !== room.version || current.closed) return null;
      const next = { ...current, state, version: current.version + 1 };
      db.rooms[room.id] = next;
      recordGame(db, next);
      return next;
    }, room.id);
  }

  async leaveRoom(id: string): Promise<void> {
    this.update((db) => {
      const me = this.me(db);
      const room = db.rooms[id];
      if (!me || !room) return;
      if (room.hostId === me.id) {
        db.rooms[id] = { ...room, closed: true, version: room.version + 1 };
      } else if (room.guestId === me.id) {
        db.rooms[id] = {
          ...room,
          guestId: null,
          guestName: null,
          version: room.version + 1,
          state: { ...room.state, ready: { ...room.state.ready, B: false }, game: null },
        };
      }
    }, id);
  }

  async getDealInfo(roomId: string): Promise<DealInfo> {
    const db = readDb();
    const room = db.rooms[roomId];
    if (!room?.guestId) return { seenAt: {}, hands: { A: [], B: [] } };
    return dealInfoOf(db, room.hostId, room.guestId);
  }

  async getStats(): Promise<StatsData> {
    const db = readDb();
    const me = this.requireMe(db);
    const answers: AnswerRecord[] = Object.values(db.answers)
      .filter((a) => a.questionerId === me.id || a.guesserId === me.id)
      .map((a) => ({
        gameId: a.gameId,
        round: a.round,
        cardId: a.cardId,
        role: a.guesserId === me.id ? "guesser" : "questioner",
        correct: a.correct,
        bet: a.bet,
        answeredAt: a.answeredAt,
      }));
    const games: GameRecord[] = Object.values(db.games)
      .filter((g) => g.hostId === me.id || g.guestId === me.id)
      .map((g) => {
        const host = g.hostId === me.id;
        return {
          id: g.id,
          finishedAt: g.finishedAt,
          won: g.winnerId === me.id,
          myScore: host ? g.hostScore : g.guestScore,
          opponentScore: host ? g.guestScore : g.hostScore,
          opponentId: host ? g.guestId : g.hostId,
          opponentName: host ? g.guestName : g.hostName,
        };
      });
    return { answers, games, seenCount: Object.keys(db.seen[me.id] ?? {}).length };
  }

  async sendFeedback(input: FeedbackInput): Promise<void> {
    const message = input.message.trim();
    if (!message || message.length > MAX_FEEDBACK_LENGTH) throw new RoomError("invalid_message");
    // お試しモードではメールは送らず、このブラウザに保存するだけ
    this.update((db) => {
      db.feedback.push({ message, page: input.page, playerId: this.me(db)?.id ?? null, createdAt: new Date().toISOString() });
    });
  }

  subscribe(id: string, onChange: (room: Room) => void): () => void {
    const notify = () => {
      const room = readDb().rooms[id];
      if (room) onChange(room);
    };
    const onMessage = (e: MessageEvent<{ id?: string }>) => {
      if (e.data?.id === id) notify();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === DB_KEY) notify();
    };
    const ch = this.getChannel();
    ch?.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    return () => {
      ch?.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
    };
  }
}
