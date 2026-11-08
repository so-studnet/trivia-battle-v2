import type { DealInfo, RoomState, Seat } from "@/lib/domain/game";
import type { StatsData } from "@/lib/domain/stats";

export const MAX_NAME_LENGTH = 12;
export const MAX_FEEDBACK_LENGTH = 2000;

export interface Room {
  id: string;
  code: string; // 4桁の部屋コード
  version: number; // 更新のたびに +1。同時更新の検出に使う
  hostId: string; // プレイヤー ID
  hostName: string;
  guestId: string | null;
  guestName: string | null;
  closed: boolean; // ホストが退出した
  state: RoomState;
}

export interface Player {
  id: string;
  email: string;
  nickname: string;
}

export type LoginResult = { status: "ok"; player: Player } | { status: "new" };

export interface FeedbackInput {
  message: string;
  page?: string;
}

export type RoomErrorCode =
  | "not_found"
  | "full"
  | "invalid_name"
  | "invalid_code"
  | "invalid_email"
  | "invalid_message"
  | "not_logged_in"
  | "too_many"
  | "network"
  | "unknown";

const MESSAGES: Record<RoomErrorCode, string> = {
  not_found: "その部屋コードの部屋は見つかりませんでした。コードを確かめてください。",
  full: "その部屋はすでに2人そろっています。",
  invalid_name: `名前は1〜${MAX_NAME_LENGTH}文字で入力してください。`,
  invalid_code: "部屋コードは4桁の数字で入力してください。",
  invalid_email: "メールアドレスの形式が正しくありません。",
  invalid_message: `1〜${MAX_FEEDBACK_LENGTH}文字で入力してください。`,
  not_logged_in: "ログインの有効期限が切れました。もう一度ログインしてください。",
  too_many: "短い時間にたくさん送られています。少し待ってから送ってください。",
  network: "通信に失敗しました。電波の良いところでやり直してください。",
  unknown: "うまくいきませんでした。もう一度お試しください。",
};

export class RoomError extends Error {
  constructor(
    readonly code: RoomErrorCode,
    detail?: string,
  ) {
    super(MESSAGES[code] + (detail && code === "unknown" ? `（${detail}）` : ""));
    this.name = "RoomError";
  }
}

/** サーバーとのやりとり。Supabase 版と、接続情報がないとき用のブラウザ内版がある。 */
export interface RoomClient {
  /** 「Supabase」か「このブラウザ内だけ」か */
  readonly kind: "supabase" | "local";

  /** この端末で前にログインしていれば、そのプレイヤー */
  restoreLogin(): Promise<Player | null>;
  /** メールアドレスでログインする。登録されていなければ { status: "new" } */
  login(email: string): Promise<LoginResult>;
  /** 新しく登録してログインする */
  register(email: string, nickname: string): Promise<Player>;
  logout(): Promise<void>;

  createRoom(name: string): Promise<Room>;
  joinRoom(code: string, name: string): Promise<Room>;
  fetchRoom(id: string): Promise<Room | null>;
  /** room.version のときだけ state を書き換える。他の人が先に更新していたら null */
  saveState(room: Room, state: RoomState): Promise<Room | null>;
  leaveRoom(id: string): Promise<void>;
  /** 部屋の変化を受け取る。戻り値で購読をやめる */
  subscribe(id: string, onChange: (room: Room) => void): () => void;

  /** 対戦を始めるときの、2人が出会った問題と持ち越しの手札 */
  getDealInfo(roomId: string): Promise<DealInfo>;
  /** 自分の成績のもとになる記録 */
  getStats(): Promise<StatsData>;
  sendFeedback(input: FeedbackInput): Promise<void>;
}

export function seatOf(room: Room, userId: string | null): Seat | null {
  if (!userId) return null;
  if (room.hostId === userId) return "A";
  if (room.guestId === userId) return "B";
  return null;
}

export function normalizeName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export function normalizeCode(code: string): string {
  // 全角数字も受け付ける
  return code
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, "");
}

export function isValidCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}

export function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID は https / localhost でしか使えないので、その代わり
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
