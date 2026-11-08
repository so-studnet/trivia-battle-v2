// Supabase を使った部屋。
// - ログインは匿名サインイン（利用者は名前を入れるだけ）
// - 部屋の作成・参加・退出は RPC（security definer の関数）で行う
// - ゲーム中の状態は rooms.state を version 付きで更新し、Realtime で相手に届く
import type { SupabaseClient } from "@supabase/supabase-js";
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

export class SupabaseRoomClient implements RoomClient {
  readonly kind = "supabase" as const;
  private userId: string | null = null;
  private initPromise: Promise<string> | null = null;

  constructor(private readonly sb: SupabaseClient) {}

  init(): Promise<string> {
    if (this.userId) return Promise.resolve(this.userId);
    this.initPromise ??= (async () => {
      try {
        const { data } = await this.sb.auth.getSession();
        let uid = data.session?.user.id ?? null;
        if (!uid) {
          const res = await this.sb.auth.signInAnonymously();
          if (res.error || !res.data.user) throw res.error ?? new Error("no user");
          uid = res.data.user.id;
        }
        this.userId = uid;
        return uid;
      } catch (e) {
        this.initPromise = null;
        throw e instanceof RoomError ? e : new RoomError("auth");
      }
    })();
    return this.initPromise;
  }

  async createRoom(name: string): Promise<Room> {
    await this.init();
    const n = normalizeName(name);
    if (!n) throw new RoomError("invalid_name");
    const { data, error } = await this.sb.rpc("create_room", { p_name: n });
    if (error || !data) throw toRoomError(error);
    return rowToRoom(data as RoomRow);
  }

  async joinRoom(rawCode: string, name: string): Promise<Room> {
    await this.init();
    const code = normalizeCode(rawCode);
    if (!isValidCode(code)) throw new RoomError("invalid_code");
    const n = normalizeName(name);
    if (!n) throw new RoomError("invalid_name");
    const { data, error } = await this.sb.rpc("join_room", { p_code: code, p_name: n });
    if (error || !data) throw toRoomError(error);
    return rowToRoom(data as RoomRow);
  }

  async fetchRoom(id: string): Promise<Room | null> {
    await this.init();
    const { data, error } = await this.sb.from("rooms").select("*").eq("id", id).maybeSingle();
    if (error) throw toRoomError(error);
    return data ? rowToRoom(data as RoomRow) : null;
  }

  async saveState(room: Room, state: RoomState): Promise<Room | null> {
    const { data, error } = await this.sb
      .from("rooms")
      .update({ state, version: room.version + 1 })
      .eq("id", room.id)
      .eq("version", room.version)
      .select("*")
      .maybeSingle();
    if (error) throw toRoomError(error);
    return data ? rowToRoom(data as RoomRow) : null;
  }

  async leaveRoom(id: string): Promise<void> {
    const { error } = await this.sb.rpc("leave_room", { p_room_id: id });
    if (error) throw toRoomError(error);
  }

  subscribe(id: string, onChange: (room: Room) => void): () => void {
    let active = true;
    const refetch = async () => {
      try {
        const room = await this.fetchRoom(id);
        if (active && room) onChange(room);
      } catch {
        // 次の変更通知か画面復帰で取り直す
      }
    };
    const channel = this.sb
      .channel(`room:${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${id}` },
        (payload) => {
          if (active && payload.new) onChange(rowToRoom(payload.new as RoomRow));
        },
      )
      .subscribe((status) => {
        // つながった（つなぎ直した）ときは、その間の変更を取りこぼさないよう読み直す
        if (status === "SUBSCRIBED") void refetch();
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refetch);
    // 念のため、たまに読み直す（Realtime が止まっていても進行できるように）
    const timer = window.setInterval(refetch, 15000);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refetch);
      window.clearInterval(timer);
      void this.sb.removeChannel(channel);
    };
  }
}
