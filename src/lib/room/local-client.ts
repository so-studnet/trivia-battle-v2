// Supabase の接続情報がないときに使う、ブラウザ内だけの部屋。
// 同じブラウザの別タブ同士で対戦できる（開発・動作確認用）。
// 部屋は localStorage に保存し、変更は BroadcastChannel で他のタブに知らせる。
import { initialRoomState, normalizeRoomState, type RoomState } from "@/lib/domain/game";
import {
  type Room,
  RoomError,
  type RoomClient,
  isValidCode,
  normalizeCode,
  normalizeName,
} from "./types";

const ROOMS_KEY = "trivia-battle:local-rooms:v1";
const USER_KEY = "trivia-battle:local-user";
const CHANNEL = "trivia-battle:local";

type RoomMap = Record<string, Room>;

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readRooms(): RoomMap {
  try {
    const raw = localStorage.getItem(ROOMS_KEY);
    const parsed = raw ? (JSON.parse(raw) as RoomMap) : {};
    const out: RoomMap = {};
    for (const [id, r] of Object.entries(parsed)) {
      if (r && typeof r === "object" && typeof r.code === "string") {
        out[id] = { ...r, state: normalizeRoomState(r.state) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export class LocalRoomClient implements RoomClient {
  readonly kind = "local" as const;
  private userId: string | null = null;
  private channel: BroadcastChannel | null = null;

  private getChannel(): BroadcastChannel | null {
    if (typeof BroadcastChannel === "undefined") return null;
    this.channel ??= new BroadcastChannel(CHANNEL);
    return this.channel;
  }

  private write(room: Room, rooms: RoomMap = readRooms()) {
    rooms[room.id] = room;
    localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
    this.getChannel()?.postMessage({ id: room.id });
  }

  async init(): Promise<string> {
    if (this.userId) return this.userId;
    // タブごとに別のプレイヤーにする
    let id = sessionStorage.getItem(USER_KEY);
    if (!id) {
      id = randomId();
      sessionStorage.setItem(USER_KEY, id);
    }
    this.userId = id;
    return id;
  }

  async createRoom(name: string): Promise<Room> {
    const uid = await this.init();
    const hostName = normalizeName(name);
    if (!hostName) throw new RoomError("invalid_name");
    const rooms = readRooms();
    // 閉じた部屋は片付ける
    for (const [id, r] of Object.entries(rooms)) if (r.closed) delete rooms[id];
    const used = new Set(Object.values(rooms).map((r) => r.code));
    let code: string;
    do code = String(1000 + Math.floor(Math.random() * 9000));
    while (used.has(code));
    const room: Room = {
      id: randomId(),
      code,
      version: 1,
      hostId: uid,
      hostName,
      guestId: null,
      guestName: null,
      closed: false,
      state: initialRoomState(),
    };
    this.write(room, rooms);
    return room;
  }

  async joinRoom(rawCode: string, name: string): Promise<Room> {
    const uid = await this.init();
    const code = normalizeCode(rawCode);
    if (!isValidCode(code)) throw new RoomError("invalid_code");
    const guestName = normalizeName(name);
    if (!guestName) throw new RoomError("invalid_name");
    const room = Object.values(readRooms()).find((r) => r.code === code && !r.closed);
    if (!room) throw new RoomError("not_found");
    if (room.hostId === uid || room.guestId === uid) return room;
    if (room.guestId) throw new RoomError("full");
    const next: Room = {
      ...room,
      guestId: uid,
      guestName,
      version: room.version + 1,
      state: { ...room.state, ready: { ...room.state.ready, B: false } },
    };
    this.write(next);
    return next;
  }

  async fetchRoom(id: string): Promise<Room | null> {
    const uid = await this.init();
    const room = readRooms()[id];
    if (!room || (room.hostId !== uid && room.guestId !== uid)) return null;
    return room;
  }

  async saveState(room: Room, state: RoomState): Promise<Room | null> {
    const current = readRooms()[room.id];
    if (!current || current.version !== room.version) return null;
    const next = { ...current, state, version: current.version + 1 };
    this.write(next);
    return next;
  }

  async leaveRoom(id: string): Promise<void> {
    const uid = await this.init();
    const room = readRooms()[id];
    if (!room) return;
    if (room.hostId === uid) {
      this.write({ ...room, closed: true, version: room.version + 1 });
    } else if (room.guestId === uid) {
      this.write({
        ...room,
        guestId: null,
        guestName: null,
        version: room.version + 1,
        state: { ...room.state, ready: { ...room.state.ready, B: false }, game: null },
      });
    }
  }

  subscribe(id: string, onChange: (room: Room) => void): () => void {
    const notify = () => {
      const room = readRooms()[id];
      if (room) onChange(room);
    };
    const onMessage = (e: MessageEvent<{ id?: string }>) => {
      if (e.data?.id === id) notify();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === ROOMS_KEY) notify();
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
