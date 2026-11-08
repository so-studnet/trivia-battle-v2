// 画面から使う「ログイン状態」と「いま入っている部屋」の状態と操作。
// 画面は useSyncExternalStore で snapshot を読む。
import { type Action, type DealInfo, reduce, type RuleContext, type TriviaCard } from "@/lib/domain/game";
import type { StatsData } from "@/lib/domain/stats";
import {
  type FeedbackInput,
  type LoginResult,
  type Player,
  type Room,
  RoomError,
  type RoomClient,
  randomUuid,
  seatOf,
} from "./types";

const CURRENT_ROOM_KEY = "trivia-battle:current-room";

export interface SessionSnapshot {
  /** 起動直後の「ログイン済みか・前の部屋に戻れるか」の確認中 */
  restoring: boolean;
  busy: boolean;
  player: Player | null;
  room: Room | null;
  error: string | null;
  /** 相手の退出など、知らせたいこと */
  notice: string | null;
}

const INITIAL: SessionSnapshot = {
  restoring: true,
  busy: false,
  player: null,
  room: null,
  error: null,
  notice: null,
};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function message(e: unknown): string {
  return e instanceof RoomError || e instanceof Error ? e.message : String(e);
}

export class RoomSession {
  private snapshot: SessionSnapshot = INITIAL;
  private listeners = new Set<() => void>();
  private unsubscribeRoom: (() => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly client: RoomClient,
    private readonly cards: readonly TriviaCard[],
    private readonly random: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {}

  get kind() {
    return this.client.kind;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  getServerSnapshot = () => INITIAL;

  private set(patch: Partial<SessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private get userId() {
    return this.snapshot.player?.id ?? null;
  }

  clearError() {
    this.set({ error: null });
  }

  clearNotice() {
    this.set({ notice: null });
  }

  /** 起動時: この端末でログインしていればそのまま使い、入っていた部屋へ戻る */
  async restore(): Promise<void> {
    try {
      const player = await this.client.restoreLogin();
      this.set({ player });
      const id = storage()?.getItem(CURRENT_ROOM_KEY);
      if (player && id) {
        const room = await this.client.fetchRoom(id);
        if (room && !room.closed && seatOf(room, player.id)) this.enter(room);
        else storage()?.removeItem(CURRENT_ROOM_KEY);
      }
    } catch {
      // 戻れなければログイン画面・タイトルから
    } finally {
      this.set({ restoring: false });
    }
  }

  /** メールアドレスでログインする。未登録なら "new" を返す（登録画面に進む） */
  async login(email: string): Promise<LoginResult["status"] | null> {
    let result: LoginResult | null = null;
    await this.run(async () => {
      result = await this.client.login(email);
      if (result.status === "ok") this.set({ player: result.player });
    });
    return (result as LoginResult | null)?.status ?? null;
  }

  register(email: string, nickname: string) {
    return this.run(async () => {
      this.set({ player: await this.client.register(email, nickname) });
    });
  }

  async logout() {
    this.leaveRoom();
    await this.client.logout().catch(() => {});
    this.set({ player: null, error: null });
  }

  createRoom(name: string) {
    return this.run(async () => {
      const room = await this.client.createRoom(name);
      this.rename(name);
      this.enter(room);
    });
  }

  joinRoom(code: string, name: string) {
    return this.run(async () => {
      const room = await this.client.joinRoom(code, name);
      this.rename(name);
      this.enter(room);
    });
  }

  leaveRoom() {
    const room = this.snapshot.room;
    this.exit();
    if (room) void this.client.leaveRoom(room.id).catch(() => {});
  }

  getStats(): Promise<StatsData> {
    return this.client.getStats();
  }

  sendFeedback(input: FeedbackInput): Promise<void> {
    return this.client.sendFeedback(input);
  }

  /** ゲームの操作。相手と同時に更新してぶつかったら、最新を読み直してやり直す */
  dispatch(action: Action): Promise<void> {
    const job = this.queue.then(() => this.dispatchNow(action));
    this.queue = job.catch(() => {});
    return job;
  }

  private async dispatchNow(action: Action) {
    let deal: DealInfo | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const room = this.snapshot.room;
      const seat = room && seatOf(room, this.userId);
      if (!room || !seat) return;
      try {
        // 対戦を始めるときは、2人が出会った問題をサーバーから受け取って配る
        if (action.type === "start" && !deal && !room.state.game) deal = await this.client.getDealInfo(room.id);
      } catch (e) {
        this.set({ error: message(e) });
        return;
      }
      const ctx: RuleContext = {
        cards: this.cards,
        random: this.random,
        hasGuest: !!room.guestId,
        now: this.now,
        newId: randomUuid,
        deal,
      };
      const next = reduce(room.state, seat, action, ctx);
      if (!next) return; // ルール上できない操作（すでに相手が進めた等）
      // 画面はすぐに変える（楽観的更新）
      this.set({ room: { ...room, state: next } });
      try {
        const saved = await this.client.saveState(room, next);
        if (saved) {
          this.applyRoom(saved);
          return;
        }
        const latest = await this.client.fetchRoom(room.id);
        if (!latest) {
          this.exit("部屋が見つからなくなりました。");
          return;
        }
        this.applyRoom(latest, true);
      } catch (e) {
        this.applyRoom(room, true);
        if (e instanceof RoomError && e.code === "not_logged_in") await this.logout();
        this.set({ error: message(e) });
        return;
      }
    }
  }

  private async run(fn: () => Promise<void>) {
    if (this.snapshot.busy) return;
    this.set({ busy: true, error: null });
    try {
      await fn();
    } catch (e) {
      if (e instanceof RoomError && e.code === "not_logged_in") await this.logout();
      this.set({ error: message(e) });
    } finally {
      this.set({ busy: false });
    }
  }

  private rename(name: string) {
    const p = this.snapshot.player;
    const n = name.trim();
    if (p && n && p.nickname !== n) this.set({ player: { ...p, nickname: n } });
  }

  private enter(room: Room) {
    this.unsubscribeRoom?.();
    storage()?.setItem(CURRENT_ROOM_KEY, room.id);
    this.set({ room, error: null, notice: null });
    this.unsubscribeRoom = this.client.subscribe(room.id, (r) => this.applyRoom(r));
  }

  private exit(notice: string | null = null) {
    this.unsubscribeRoom?.();
    this.unsubscribeRoom = null;
    storage()?.removeItem(CURRENT_ROOM_KEY);
    this.set({ room: null, notice });
  }

  /** サーバーから届いた部屋を反映する。古い版は無視する（force なら必ず反映） */
  private applyRoom(next: Room, force = false) {
    const prev = this.snapshot.room;
    if (!prev || prev.id !== next.id) return;
    if (!force && next.version <= prev.version) return;
    const me = this.userId;
    if (next.closed) {
      this.exit(prev.hostId === me ? null : `${next.hostName}さん（ホスト）が部屋を出たため、部屋は閉じられました。`);
      return;
    }
    if (!seatOf(next, me)) {
      this.exit("部屋から外れました。");
      return;
    }
    let notice = this.snapshot.notice;
    if (prev.guestId && !next.guestId) {
      notice = prev.state.game
        ? `${prev.guestName}さんが退出したため、対戦は中断されました。`
        : `${prev.guestName}さんが退出しました。`;
    }
    this.set({ room: next, notice });
  }
}
