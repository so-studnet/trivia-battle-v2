import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { initialRoomState } from "@/lib/domain/game";
import type { RoomRow } from "./rows";
import { SupabaseRoomClient, loadIdentity, topicOf } from "./supabase-client";
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

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

function fakeSupabase(rpcImpl?: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown }) {
  const httpSend = vi.fn(async () => ({ success: true }));
  const sb = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => rpcImpl?.(name, args) ?? { data: row, error: null }),
    channel: vi.fn(() => ({ httpSend })),
    removeChannel: vi.fn(async () => "ok"),
  };
  const storage = new MemoryStorage();
  const client = new SupabaseRoomClient(sb as unknown as SupabaseClient, () => storage as unknown as Storage);
  return { client, rpc: sb.rpc, channel: sb.channel, httpSend, storage };
}

describe("loadIdentity", () => {
  it("初回はつくって保存し、次からは同じものを返す", () => {
    const s = new MemoryStorage() as unknown as Storage;
    const a = loadIdentity(s);
    expect(a.playerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.token).not.toBe(a.playerId);
    expect(loadIdentity(s)).toEqual(a);
  });

  it("壊れていたらつくり直す", () => {
    const s = new MemoryStorage();
    s.setItem("trivia-battle:player:v1", '{"playerId":"x"}');
    expect(loadIdentity(s as unknown as Storage).playerId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("SupabaseRoomClient", () => {
  it("参加は全角数字も受け付け、player_id と token を付けて RPC を呼ぶ", async () => {
    const f = fakeSupabase();
    const me = await f.client.init();
    const room = await f.client.joinRoom("１２３４", " ゲスト ");
    const [name, args] = f.rpc.mock.calls[0];
    expect(name).toBe("trivia_battle_join_room");
    expect(args).toMatchObject({ p_code: "1234", p_player_id: me, p_name: "ゲスト" });
    expect(args.p_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(args.p_token).not.toBe(me);
    expect(room).toMatchObject({ id: "r1", hostName: "ホスト", guestId: "u2", version: 2 });
    // 参加の知らせは subscribe でつながったときに送るので、ここではチャンネルをつくらない
    expect(f.channel).not.toHaveBeenCalled();
  });

  it("退出したら、購読していない部屋には REST で知らせる", async () => {
    const f = fakeSupabase(() => ({ data: null, error: null }));
    await f.client.leaveRoom("r1");
    expect(f.rpc).toHaveBeenCalledWith("trivia_battle_leave_room", expect.objectContaining({ p_room_id: "r1" }));
    expect(f.channel).toHaveBeenCalledWith(topicOf("r1"));
    expect(f.httpSend).toHaveBeenCalledWith("changed", {});
  });

  it("RPC のエラーを日本語のエラーにする", async () => {
    const f = fakeSupabase(() => ({ data: null, error: { message: "room_full", code: "23505" } }));
    const err = await f.client.joinRoom("1234", "x").catch((e) => e);
    expect(err).toBeInstanceOf(RoomError);
    expect(err.code).toBe("full");
  });

  it("コードの形式が違えば RPC を呼ばない", async () => {
    const f = fakeSupabase();
    await expect(f.client.joinRoom("12", "x")).rejects.toMatchObject({ code: "invalid_code" });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("状態は今の version を付けて保存する", async () => {
    const f = fakeSupabase();
    const room = await f.client.joinRoom("1234", "x");
    const state = initialRoomState();
    await f.client.saveState(room, state);
    expect(f.rpc).toHaveBeenLastCalledWith(
      "trivia_battle_save_state",
      expect.objectContaining({ p_room_id: "r1", p_version: 2, p_state: state }),
    );
  });

  it("ほかの人が先に更新していたら（null）・メンバーでなくなっていたら null を返す", async () => {
    const f = fakeSupabase((name) =>
      name === "trivia_battle_save_state" ? { data: null, error: null } : { data: row, error: null },
    );
    const room = await f.client.joinRoom("1234", "x");
    expect(await f.client.saveState(room, initialRoomState())).toBeNull();

    const g = fakeSupabase((name) =>
      name === "trivia_battle_save_state"
        ? { data: null, error: { message: "not_member", code: "42501" } }
        : { data: row, error: null },
    );
    expect(await g.client.saveState(room, initialRoomState())).toBeNull();
  });

  it("メンバーでなければ fetchRoom は null", async () => {
    const f = fakeSupabase(() => ({ data: null, error: null }));
    expect(await f.client.fetchRoom("r1")).toBeNull();
  });
});
