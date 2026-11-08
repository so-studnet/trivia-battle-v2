import { describe, expect, it } from "vitest";
import { type DealInfo, initialRoomState, type RoomState, type TriviaCard } from "@/lib/domain/game";
import type { StatsData } from "@/lib/domain/stats";
import { RoomSession } from "./session";
import { type LoginResult, type Player, type Room, RoomError, type RoomClient } from "./types";

const cards: TriviaCard[] = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  text: `雑学${i + 1}`,
  isTrue: i % 2 === 0,
  explanation: "",
  genre: "animals",
}));

/** 2人で共有するメモリ上の「サーバー」 */
class FakeServer {
  rooms = new Map<string, Room>();
  listeners = new Map<string, Set<(r: Room) => void>>();
  /** true の間は通知を止める（Realtime の遅れを再現） */
  paused = false;
  pending: Room[] = [];

  publish(room: Room) {
    this.rooms.set(room.id, room);
    if (this.paused) this.pending.push(room);
    else for (const l of this.listeners.get(room.id) ?? []) l(room);
  }

  flush() {
    this.paused = false;
    for (const r of this.pending.splice(0)) for (const l of this.listeners.get(r.id) ?? []) l(r);
  }
}

class FakeClient implements RoomClient {
  readonly kind = "local" as const;
  deal: DealInfo = { seenAt: {}, hands: { A: [], B: [] } };
  loggedIn = true;
  constructor(
    private server: FakeServer,
    private uid: string,
  ) {}
  private get player(): Player {
    return { id: this.uid, email: `${this.uid}@example.com`, nickname: this.uid };
  }
  async restoreLogin() {
    return this.loggedIn ? this.player : null;
  }
  async login(): Promise<LoginResult> {
    return { status: "ok", player: this.player };
  }
  async register() {
    return this.player;
  }
  async logout() {
    this.loggedIn = false;
  }
  async getDealInfo() {
    return this.deal;
  }
  async getStats(): Promise<StatsData> {
    return { answers: [], games: [], seenCount: 0 };
  }
  async sendFeedback() {}
  async createRoom(name: string) {
    const room: Room = {
      id: "r1",
      code: "1234",
      version: 1,
      hostId: this.uid,
      hostName: name,
      guestId: null,
      guestName: null,
      closed: false,
      state: initialRoomState(),
    };
    this.server.publish(room);
    return room;
  }
  async joinRoom(code: string, name: string) {
    const room = [...this.server.rooms.values()].find((r) => r.code === code);
    if (!room) throw new RoomError("not_found");
    if (room.guestId && room.guestId !== this.uid) throw new RoomError("full");
    const next = { ...room, guestId: this.uid, guestName: name, version: room.version + 1 };
    this.server.publish(next);
    return next;
  }
  async fetchRoom(id: string) {
    return this.server.rooms.get(id) ?? null;
  }
  async saveState(room: Room, state: RoomState) {
    if (!this.loggedIn) throw new RoomError("not_logged_in");
    const cur = this.server.rooms.get(room.id);
    if (!cur || cur.version !== room.version) return null;
    const next = { ...cur, state, version: cur.version + 1 };
    this.server.publish(next);
    return next;
  }
  async leaveRoom(id: string) {
    const cur = this.server.rooms.get(id)!;
    if (cur.hostId === this.uid) this.server.publish({ ...cur, closed: true, version: cur.version + 1 });
    else
      this.server.publish({
        ...cur,
        guestId: null,
        guestName: null,
        version: cur.version + 1,
        state: { ...cur.state, game: null, ready: { ...cur.state.ready, B: false } },
      });
  }
  subscribe(id: string, cb: (r: Room) => void) {
    const set = this.server.listeners.get(id) ?? new Set();
    set.add(cb);
    this.server.listeners.set(id, set);
    return () => set.delete(cb);
  }
}

async function setup() {
  const server = new FakeServer();
  const hostClient = new FakeClient(server, "host");
  const host = new RoomSession(hostClient, cards, () => 0);
  const guest = new RoomSession(new FakeClient(server, "guest"), cards, () => 0);
  await host.restore();
  await guest.restore();
  await host.createRoom("ホスト");
  await guest.joinRoom("1234", "ゲスト");
  return { server, host, guest, hostClient };
}

describe("RoomSession", () => {
  it("作成・参加すると両者に相手が見える", async () => {
    const { host, guest } = await setup();
    expect(host.getSnapshot().room?.guestName).toBe("ゲスト");
    expect(guest.getSnapshot().room?.hostName).toBe("ホスト");
  });

  it("同時に操作してぶつかっても、読み直してやり直すので両方の操作が残る", async () => {
    const { server, host, guest } = await setup();
    server.paused = true; // 相手の更新がまだ届いていない状態
    await host.dispatch({ type: "setReady", ready: true });
    await guest.dispatch({ type: "setReady", ready: true });
    server.flush();
    const state = server.rooms.get("r1")!.state;
    expect(state.ready).toEqual({ A: true, B: true });
    expect(host.getSnapshot().room?.state.ready).toEqual({ A: true, B: true });
    expect(guest.getSnapshot().room?.state.ready).toEqual({ A: true, B: true });
  });

  it("1ターン通して遊べる", async () => {
    const { host, guest } = await setup();
    await host.dispatch({ type: "setReady", ready: true });
    await guest.dispatch({ type: "setReady", ready: true });
    await host.dispatch({ type: "updateSettings", settings: { firstPlayer: "A", targetScore: 5 } });
    await guest.dispatch({ type: "setReady", ready: true });
    await host.dispatch({ type: "start" });
    const g = guest.getSnapshot().room!.state.game!;
    expect(g.phase).toBe("select");
    await host.dispatch({ type: "selectCard", cardId: g.hands.A[0] });
    await guest.dispatch({ type: "guess", answer: true, bet: 2 });
    expect(host.getSnapshot().room!.state.game!.phase).toBe("result");
    await host.dispatch({ type: "next" });
    await guest.dispatch({ type: "next" });
    expect(host.getSnapshot().room!.state.game).toMatchObject({ phase: "select", questioner: "B" });
  });

  it("ゲストが退出するとホストに知らせ、ホストが退出すると部屋が閉じる", async () => {
    const { server, host, guest } = await setup();
    guest.leaveRoom();
    await Promise.resolve();
    expect(guest.getSnapshot().room).toBeNull();
    expect(host.getSnapshot().notice).toContain("ゲストさんが退出しました");

    const guest2 = new RoomSession(new FakeClient(server, "g2"), cards);
    await guest2.restore();
    await guest2.joinRoom("1234", "二人目");
    host.leaveRoom();
    await Promise.resolve();
    expect(guest2.getSnapshot().room).toBeNull();
    expect(guest2.getSnapshot().notice).toContain("部屋は閉じられました");
  });

  it("参加できないときはエラーを出す", async () => {
    const server = new FakeServer();
    const s = new RoomSession(new FakeClient(server, "x"), cards);
    await s.restore();
    await s.joinRoom("9999", "x");
    expect(s.getSnapshot().error).toContain("見つかりませんでした");
    expect(s.getSnapshot().room).toBeNull();
  });

  it("対戦を始めるときは、サーバーから受け取った持ち越しの手札・出会った問題で配る", async () => {
    const { host, guest, hostClient } = await setup();
    hostClient.deal = { seenAt: { "1": 1, "2": 1, "5": 1 }, hands: { A: [3], B: [] } };
    await host.dispatch({ type: "updateSettings", settings: { firstPlayer: "A", targetScore: 3 } });
    await host.dispatch({ type: "setReady", ready: true });
    await guest.dispatch({ type: "setReady", ready: true });
    await host.dispatch({ type: "start" });
    const hand = host.getSnapshot().room!.state.game!.hands.A;
    expect(hand[0]).toBe(3);
    expect(hand).toHaveLength(4);
    expect(hand.some((id) => [1, 2, 5].includes(id))).toBe(false);
  });

  it("ログインが切れていたらログアウトしてエラーを出す", async () => {
    const { host, hostClient } = await setup();
    hostClient.loggedIn = false;
    await host.dispatch({ type: "setReady", ready: true });
    expect(host.getSnapshot().player).toBeNull();
    expect(host.getSnapshot().room).toBeNull();
    expect(host.getSnapshot().error).toContain("ログイン");
  });

  it("部屋をつくるとニックネームが更新される", async () => {
    const { host } = await setup();
    expect(host.getSnapshot().player?.nickname).toBe("ホスト");
  });
});
