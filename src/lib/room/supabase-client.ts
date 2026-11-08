// Supabase を使ったサーバーとのやりとり。
// ほかのアプリと同じ Supabase プロジェクトに同居できるよう、Supabase Auth は使わない。
// - ログインはメールアドレスだけ。サーバーが発行したセッション token をこの端末に保存し、
//   以後の RPC はこの token で本人確認する（同じ端末・同じブラウザならログインを省ける）
// - 部屋の操作はすべて trivia_battle_* の RPC で行う
// - 相手への通知は Realtime Broadcast（「部屋が変わったよ」とだけ送り、受け取った側が読み直す）
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { DealInfo, RoomState } from "@/lib/domain/game";
import type { StatsData } from "@/lib/domain/stats";
import { type PlayerRow, type RoomRow, rowToPlayer, rowToRoom, toRoomError } from "./rows";
import {
  type FeedbackInput,
  type LoginResult,
  type Player,
  type Room,
  RoomError,
  type RoomClient,
  isValidCode,
  isValidEmail,
  normalizeCode,
  normalizeEmail,
  normalizeName,
} from "./types";

const SESSION_KEY = "trivia-battle:session:v1";
const EVENT = "changed";

export function topicOf(roomId: string): string {
  return `trivia-battle:room:${roomId}`;
}

export class SupabaseRoomClient implements RoomClient {
  readonly kind = "supabase" as const;
  private channels = new Map<string, RealtimeChannel>();

  constructor(
    private readonly sb: SupabaseClient,
    private readonly storage: () => Storage | null = () =>
      typeof localStorage === "undefined" ? null : localStorage,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private get token(): string | null {
    try {
      return this.storage()?.getItem(SESSION_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private set token(value: string | null) {
    try {
      if (value) this.storage()?.setItem(SESSION_KEY, value);
      else this.storage()?.removeItem(SESSION_KEY);
    } catch {}
  }

  private async call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw toRoomError(error);
    return data;
  }

  private loggedIn(data: unknown): Player {
    const d = data as { token: string; player: PlayerRow };
    this.token = d.token;
    return rowToPlayer(d.player);
  }

  async restoreLogin(): Promise<Player | null> {
    const token = this.token;
    if (!token) return null;
    const data = await this.call("trivia_battle_me", { p_token: token });
    if (!data) {
      this.token = null;
      return null;
    }
    return rowToPlayer(data as PlayerRow);
  }

  async login(rawEmail: string): Promise<LoginResult> {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new RoomError("invalid_email");
    const data = (await this.call("trivia_battle_login", { p_email: email })) as { status: string };
    if (data.status === "new") return { status: "new" };
    return { status: "ok", player: this.loggedIn(data) };
  }

  async register(rawEmail: string, nickname: string): Promise<Player> {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new RoomError("invalid_email");
    const n = normalizeName(nickname);
    if (!n) throw new RoomError("invalid_name");
    return this.loggedIn(await this.call("trivia_battle_register", { p_email: email, p_nickname: n }));
  }

  async logout(): Promise<void> {
    const token = this.token;
    this.token = null;
    if (token) await this.call("trivia_battle_logout", { p_token: token }).catch(() => {});
  }

  async createRoom(name: string): Promise<Room> {
    const n = normalizeName(name);
    if (!n) throw new RoomError("invalid_name");
    const data = await this.call("trivia_battle_create_room", { p_token: this.token, p_name: n });
    return rowToRoom(data as RoomRow);
  }

  async joinRoom(rawCode: string, name: string): Promise<Room> {
    const code = normalizeCode(rawCode);
    if (!isValidCode(code)) throw new RoomError("invalid_code");
    const n = normalizeName(name);
    if (!n) throw new RoomError("invalid_name");
    const data = await this.call("trivia_battle_join_room", { p_code: code, p_token: this.token, p_name: n });
    // 相手への参加の知らせは、subscribe でつながったときに送る（ここで一時的なチャンネルをつくると、
    // supabase-js が同じ名前のチャンネルを使い回すため、直後の購読が消えてしまう）
    return rowToRoom(data as RoomRow);
  }

  async fetchRoom(id: string): Promise<Room | null> {
    const data = await this.call("trivia_battle_get_room", { p_room_id: id, p_token: this.token });
    return data ? rowToRoom(data as RoomRow) : null;
  }

  async saveState(room: Room, state: RoomState): Promise<Room | null> {
    let data: unknown;
    try {
      data = await this.call("trivia_battle_save_state", {
        p_room_id: room.id,
        p_token: this.token,
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
    await this.call("trivia_battle_leave_room", { p_room_id: id, p_token: this.token });
    this.notify(id);
  }

  async getDealInfo(roomId: string): Promise<DealInfo> {
    const data = (await this.call("trivia_battle_deal_info", { p_room_id: roomId, p_token: this.token })) as DealInfo;
    return { seenAt: data?.seenAt ?? {}, hands: { A: data?.hands?.A ?? [], B: data?.hands?.B ?? [] } };
  }

  async getStats(): Promise<StatsData> {
    const data = (await this.call("trivia_battle_my_stats", { p_token: this.token })) as StatsData;
    return { answers: data?.answers ?? [], games: data?.games ?? [], seenCount: data?.seenCount ?? 0 };
  }

  async sendFeedback(input: FeedbackInput): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: this.token, message: input.message, page: input.page }),
      });
    } catch {
      throw new RoomError("network");
    }
    if (res.ok) return;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw toRoomError({ message: body.error ?? `status ${res.status}` });
  }

  /** 相手に「部屋が変わった」と知らせる。届かなくても相手は定期的に読み直すので、失敗は無視する */
  private notify(roomId: string) {
    const ch = this.channels.get(roomId);
    if (ch) {
      const sent =
        ch.state === "joined" ? ch.send({ type: "broadcast", event: EVENT, payload: {} }) : ch.httpSend(EVENT, {});
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
