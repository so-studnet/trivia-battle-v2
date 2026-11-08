import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { initialRoomState } from "@/lib/domain/game";
import type { RoomRow } from "./rows";
import { SupabaseRoomClient, topicOf } from "./supabase-client";
import { RoomError } from "./types";

const row: RoomRow = {
  id: "r1",
  code: "1234",
  version: 2,
  host_id: "u1",
  host_name: "ホスト",
  guest_id: "u2",
  guest_name: "ゲスト",
  closed: false,
  state: initialRoomState(),
};

const player = { id: "u1", email: "a@example.com", nickname: "アリス" };
const TOKEN = "11111111-1111-4111-8111-111111111111";

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

type Rpc = (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown } | undefined;

function fake(rpcImpl?: Rpc, fetchImpl?: typeof fetch) {
  const httpSend = vi.fn(async () => ({ success: true }));
  const sb = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => rpcImpl?.(name, args) ?? { data: row, error: null }),
    channel: vi.fn(() => ({ httpSend })),
    removeChannel: vi.fn(async () => "ok"),
  };
  const storage = new MemoryStorage();
  const client = new SupabaseRoomClient(
    sb as unknown as SupabaseClient,
    () => storage as unknown as Storage,
    fetchImpl ?? (vi.fn() as unknown as typeof fetch),
  );
  return { client, rpc: sb.rpc, channel: sb.channel, httpSend, storage };
}

describe("ログイン", () => {
  it("登録済みならセッション token を保存し、次からはログインを省ける", async () => {
    const f = fake((name) =>
      name === "trivia_battle_login"
        ? { data: { status: "ok", token: TOKEN, player }, error: null }
        : name === "trivia_battle_me"
          ? { data: player, error: null }
          : undefined,
    );
    expect(await f.client.restoreLogin()).toBeNull(); // まだログインしていない
    expect(f.rpc).not.toHaveBeenCalled();
    const r = await f.client.login("  A@Example.com ");
    expect(f.rpc).toHaveBeenCalledWith("trivia_battle_login", { p_email: "a@example.com" });
    expect(r).toEqual({ status: "ok", player });
    expect(await f.client.restoreLogin()).toEqual(player);
    expect(f.rpc).toHaveBeenLastCalledWith("trivia_battle_me", { p_token: TOKEN });
  });

  it("未登録なら new を返し、登録するとログインする", async () => {
    const f = fake((name) =>
      name === "trivia_battle_login"
        ? { data: { status: "new" }, error: null }
        : { data: { status: "ok", token: TOKEN, player }, error: null },
    );
    expect(await f.client.login("a@example.com")).toEqual({ status: "new" });
    expect(await f.client.register("a@example.com", " アリス ")).toEqual(player);
    expect(f.rpc).toHaveBeenLastCalledWith("trivia_battle_register", { p_email: "a@example.com", p_nickname: "アリス" });
  });

  it("メールの形式が違えば RPC を呼ばない", async () => {
    const f = fake();
    await expect(f.client.login("abc")).rejects.toMatchObject({ code: "invalid_email" });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("サーバーでログインが切れていたら、保存していた token を消す", async () => {
    const f = fake(() => ({ data: null, error: null }));
    f.storage.setItem("trivia-battle:session:v1", TOKEN);
    expect(await f.client.restoreLogin()).toBeNull();
    expect(f.storage.getItem("trivia-battle:session:v1")).toBeNull();
  });

  it("ログアウトで token を消してサーバーにも知らせる", async () => {
    const f = fake(() => ({ data: null, error: null }));
    f.storage.setItem("trivia-battle:session:v1", TOKEN);
    await f.client.logout();
    expect(f.rpc).toHaveBeenCalledWith("trivia_battle_logout", { p_token: TOKEN });
    expect(f.storage.getItem("trivia-battle:session:v1")).toBeNull();
  });
});

describe("部屋", () => {
  function loggedIn(rpcImpl?: Rpc) {
    const f = fake(rpcImpl);
    f.storage.setItem("trivia-battle:session:v1", TOKEN);
    return f;
  }

  it("参加は全角数字も受け付け、token を付けて RPC を呼ぶ", async () => {
    const f = loggedIn();
    const room = await f.client.joinRoom("１２３４", " ゲスト ");
    expect(f.rpc).toHaveBeenCalledWith("trivia_battle_join_room", { p_code: "1234", p_token: TOKEN, p_name: "ゲスト" });
    expect(room).toMatchObject({ id: "r1", hostName: "ホスト", guestId: "u2", version: 2 });
    // 参加の知らせは subscribe でつながったときに送るので、ここではチャンネルをつくらない
    expect(f.channel).not.toHaveBeenCalled();
  });

  it("RPC のエラーを日本語のエラーにする", async () => {
    const f = loggedIn(() => ({ data: null, error: { message: "room_full", code: "23505" } }));
    const err = await f.client.joinRoom("1234", "x").catch((e) => e);
    expect(err).toBeInstanceOf(RoomError);
    expect(err.code).toBe("full");
    const g = loggedIn(() => ({ data: null, error: { message: "not_logged_in" } }));
    await expect(g.client.createRoom("x")).rejects.toMatchObject({ code: "not_logged_in" });
  });

  it("状態は今の version を付けて保存する。先に更新されていた・メンバーでない場合は null", async () => {
    const f = loggedIn();
    const state = initialRoomState();
    await f.client.saveState(await f.client.joinRoom("1234", "x"), state);
    expect(f.rpc).toHaveBeenLastCalledWith("trivia_battle_save_state", {
      p_room_id: "r1",
      p_token: TOKEN,
      p_version: 2,
      p_state: state,
    });
    const room = await f.client.joinRoom("1234", "x");
    const g = loggedIn((name) => (name === "trivia_battle_save_state" ? { data: null, error: null } : undefined));
    expect(await g.client.saveState(room, state)).toBeNull();
    const h = loggedIn((name) =>
      name === "trivia_battle_save_state" ? { data: null, error: { message: "not_member" } } : undefined,
    );
    expect(await h.client.saveState(room, state)).toBeNull();
  });

  it("退出したら、購読していない部屋には REST で知らせる", async () => {
    const f = loggedIn(() => ({ data: null, error: null }));
    await f.client.leaveRoom("r1");
    expect(f.rpc).toHaveBeenCalledWith("trivia_battle_leave_room", { p_room_id: "r1", p_token: TOKEN });
    expect(f.channel).toHaveBeenCalledWith(topicOf("r1"));
    expect(f.httpSend).toHaveBeenCalledWith("changed", {});
  });

  it("出会った問題・成績を受け取る（欠けていても壊れない）", async () => {
    const f = loggedIn((name) =>
      name === "trivia_battle_deal_info"
        ? { data: { seenAt: { "1": 5 }, hands: { A: [2] } }, error: null }
        : { data: { answers: [] }, error: null },
    );
    expect(await f.client.getDealInfo("r1")).toEqual({ seenAt: { "1": 5 }, hands: { A: [2], B: [] } });
    expect(await f.client.getStats()).toEqual({ answers: [], games: [], seenCount: 0 });
  });
});

describe("フィードバック", () => {
  it("token と内容を API に送る", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const f = fake(undefined, fetchImpl as unknown as typeof fetch);
    f.storage.setItem("trivia-battle:session:v1", TOKEN);
    await f.client.sendFeedback({ message: "楽しい", page: "title" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/feedback", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ token: TOKEN, message: "楽しい", page: "title" });
  });

  it("API のエラーを日本語のエラーにする", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "too_many_feedback" }), { status: 429 }));
    const f = fake(undefined, fetchImpl as unknown as typeof fetch);
    await expect(f.client.sendFeedback({ message: "x" })).rejects.toMatchObject({ code: "too_many" });
  });
});
