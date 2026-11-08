// Supabase を使った部屋。
// ほかのアプリと同じ Supabase プロジェクトに同居できるよう、Supabase Auth は使わない。
// - 本人確認は端末で作った token（合言葉）で行い、部屋の操作はすべて trivia_battle_* の RPC で行う
// - 相手への通知は Realtime Broadcast（「部屋が変わったよ」とだけ送り、受け取った側が読み直す）
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { RoomState } from "@/lib/domain/game";
import { type RoomRow, rowToRoom, toRoomError } from "./rows";
import {
  type Room,
  RoomError,
  type RoomClient,
  isValidCode,
  normalizeCode,
  normalizeName,
} from "./types";

const IDENTITY_KEY = "trivia-battle:player:v1";
const EVENT = "changed";

export interface PlayerIdentity {
  playerId: string; // 相手にも見える ID
  token: string; // 本人だけが知る合言葉
}

function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID は https / localhost でしか使えないので、その代わり
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** この端末のプレイヤーを読み出す（なければつくって保存する） */
export function loadIdentity(storage: Storage | null): PlayerIdentity {
  try {
    const raw = storage?.getItem(IDENTITY_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<PlayerIdentity>) : null;
    if (parsed && UUID.test(parsed.playerId ?? "") && UUID.test(parsed.token ?? "")) {
      return { playerId: parsed.playerId!, token: parsed.token! };
    }
  } catch {
    // 壊れていたらつくり直す
  }
  const id = { playerId: randomUuid(), token: randomUuid() };
  try {
    storage?.setItem(IDENTITY_KEY, JSON.stringify(id));
  } catch {}
  return id;
}

export function topicOf(roomId: string): string {
  return `trivia-battle:room:${roomId}`;
}

export class SupabaseRoomClient implements RoomClient {
  readonly kind = "supabase" as const;
  private identity: PlayerIdentity | null = null;
  private channels = new Map<string, RealtimeChannel>();

  constructor(
    private readonly sb: SupabaseClient,
    private readonly storage: () => Storage | null = () =>
      typeof localStorage === "undefined" ? null : localStorage,
  ) {}

  private me(): PlayerIdentity {
    this.identity ??= loadIdentity(this.storage());
    return this.identity;
  }

  async init(): Promise<string> {
    return this.me().playerId;
  }

  private async call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw toRoomError(error);
    return data;
  }

  async createRoom(name: string): Promise<Room> {
    const n = normalizeName(name);
    if (!n) throw new RoomError("invalid_name");
    const { playerId, token } = this.me();
    const data = await this.call("trivia_battle_create_room", {
      p_player_id: playerId,
      p_token: token,
      p_name: n,
    });
    return rowToRoom(data as RoomRow);
  }

  async joinRoom(rawCode: string, name: string): Promise<Room> {
    const code = normalizeCode(rawCode);
    if (!isValidCode(code)) throw new RoomError("invalid_code");
    const n = normalizeName(name);
    if (!n) throw new RoomError("invalid_name");
    const { playerId, token } = this.me();
    const data = await this.call("trivia_battle_join_room", {
      p_code: code,
      p_player_id: playerId,
      p_token: token,
      p_name: n,
    });
    // 相手への参加の知らせは、subscribe でつながったときに送る（ここで一時的なチャンネルをつくると、
    // supabase-js が同じ名前のチャンネルを使い回すため、直後の購読が消えてしまう）
    return rowToRoom(data as RoomRow);
  }

  async fetchRoom(id: string): Promise<Room | null> {
    const data = await this.call("trivia_battle_get_room", { p_room_id: id, p_token: this.me().token });
    return data ? rowToRoom(data as RoomRow) : null;
  }

  async saveState(room: Room, state: RoomState): Promise<Room | null> {
    let data: unknown;
    try {
      data = await this.call("trivia_battle_save_state", {
        p_room_id: room.id,
        p_token: this.me().token,
        p_version: room.version,
        p_state: state,
      });
    } catch (e) {
      // メンバーでなくなっていたら「保存できなかった」として扱う（呼び出し側が読み直して部屋を出る）
      if (e instanceof RoomError && e.code === "not_found") return null;
      throw e;
    }
    if (!data) return null;
    this.notify(room.id);
    return rowToRoom(data as RoomRow);
  }

  async leaveRoom(id: string): Promise<void> {
    await this.call("trivia_battle_leave_room", { p_room_id: id, p_token: this.me().token });
    this.notify(id);
  }

  /** 相手に「部屋が変わった」と知らせる。届かなくても相手は定期的に読み直すので、失敗は無視する */
  private notify(roomId: string) {
    const ch = this.channels.get(roomId);
    if (ch) {
      const sent =
        ch.state === "joined"
          ? ch.send({ type: "broadcast", event: EVENT, payload: {} })
          : ch.httpSend(EVENT, {});
      void sent.catch(() => {});
      return;
    }
    // 購読していない部屋（退出した直後など）には、一時的なチャンネルから REST で送る
    const tmp = this.sb.channel(topicOf(roomId));
    void tmp
      .httpSend(EVENT, {})
      .catch(() => {})
      .finally(() => void this.sb.removeChannel(tmp));
  }

  subscribe(id: string, onChange: (room: Room) => void): () => void {
    let active = true;
    const refetch = async () => {
      try {
        const room = await this.fetchRoom(id);
        if (active && room) onChange(room);
      } catch {
        // 次の通知か画面復帰で読み直す
      }
    };
    const channel = this.sb
      .channel(topicOf(id), { config: { broadcast: { self: false } } })
      .on("broadcast", { event: EVENT }, () => void refetch())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // つながる前の変更を取りこぼさないよう読み直し、相手にも読み直してもらう（参加の通知を兼ねる）
          void refetch();
          void channel.send({ type: "broadcast", event: EVENT, payload: {} }).catch(() => {});
        }
      });
    this.channels.set(id, channel);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refetch);
    // Realtime が届かない環境でも進行できるように、たまに読み直す
    const timer = window.setInterval(refetch, 10000);
    return () => {
      active = false;
      if (this.channels.get(id) === channel) this.channels.delete(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refetch);
      window.clearInterval(timer);
      void this.sb.removeChannel(channel);
    };
  }
}
