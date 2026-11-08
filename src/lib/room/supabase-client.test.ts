import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { initialRoomState } from "@/lib/domain/game";
import type { RoomRow } from "./rows";
import { SupabaseRoomClient } from "./supabase-client";
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

function fakeSupabase(opts: {
  session?: boolean;
  rpc?: (name: string, args: unknown) => { data: unknown; error: unknown };
  update?: { data: unknown; error: unknown };
}) {
  const calls: { update?: unknown; eq: [string, unknown][] } = { eq: [] };
  const builder = {
    update(v: unknown) {
      calls.update = v;
      return builder;
    },
    select() {
      return builder;
    },
    eq(k: string, v: unknown) {
      calls.eq.push([k, v]);
      return builder;
    },
    maybeSingle: async () => opts.update ?? { data: row, error: null },
  };
  const signInAnonymously = vi.fn(async () => ({ data: { user: { id: "anon-1" } }, error: null }));
  const sb = {
    auth: {
      getSession: async () => ({ data: { session: opts.session ? { user: { id: "u1" } } : null } }),
      signInAnonymously,
    },
    rpc: vi.fn(async (name: string, args: unknown) => opts.rpc?.(name, args) ?? { data: row, error: null }),
    from: () => builder,
  };
  return { sb: sb as unknown as SupabaseClient, calls, signInAnonymously, rpc: sb.rpc };
}

describe("SupabaseRoomClient", () => {
  it("セッションがなければ匿名でサインインする", async () => {
    const f = fakeSupabase({});
    const c = new SupabaseRoomClient(f.sb);
    expect(await c.init()).toBe("anon-1");
    expect(await c.init()).toBe("anon-1");
    expect(f.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("セッションがあればそのユーザーを使う", async () => {
    const f = fakeSupabase({ session: true });
    expect(await new SupabaseRoomClient(f.sb).init()).toBe("u1");
    expect(f.signInAnonymously).not.toHaveBeenCalled();
  });

  it("参加は全角数字も受け付けて RPC に渡し、行をアプリの形にする", async () => {
    const f = fakeSupabase({ session: true });
    const room = await new SupabaseRoomClient(f.sb).joinRoom("１２３４", " ゲスト ");
    expect(f.rpc).toHaveBeenCalledWith("join_room", { p_code: "1234", p_name: "ゲスト" });
    expect(room).toMatchObject({ id: "r1", hostName: "ホスト", guestId: "u2", version: 2 });
  });

  it("RPC のエラーを日本語のエラーにする", async () => {
    const f = fakeSupabase({
      session: true,
      rpc: () => ({ data: null, error: { message: "room_full", code: "23505" } }),
    });
    const err = await new SupabaseRoomClient(f.sb).joinRoom("1234", "x").catch((e) => e);
    expect(err).toBeInstanceOf(RoomError);
    expect(err.code).toBe("full");
  });

  it("コードの形式が違えば RPC を呼ばない", async () => {
    const f = fakeSupabase({ session: true });
    await expect(new SupabaseRoomClient(f.sb).joinRoom("12", "x")).rejects.toMatchObject({ code: "invalid_code" });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("state は今の version を条件にして、version を1つ増やして保存する", async () => {
    const f = fakeSupabase({ session: true });
    const c = new SupabaseRoomClient(f.sb);
    const state = initialRoomState();
    await c.saveState({ ...(await c.joinRoom("1234", "x")) }, state);
    expect(f.calls.update).toEqual({ state, version: 3 });
    expect(f.calls.eq).toEqual([
      ["id", "r1"],
      ["version", 2],
    ]);
  });

  it("ほかの人が先に更新していたら null（0件）を返す", async () => {
    const f = fakeSupabase({ session: true, update: { data: null, error: null } });
    const c = new SupabaseRoomClient(f.sb);
    const room = await c.joinRoom("1234", "x");
    expect(await c.saveState(room, initialRoomState())).toBeNull();
  });
});
