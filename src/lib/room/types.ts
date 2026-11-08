import type { RoomState, Seat } from "@/lib/domain/game";

export const MAX_NAME_LENGTH = 12;

export interface Room {
  id: string;
  code: string; // 4桁の部屋コード
  version: number; // 更新のたびに +1。同時更新の検出に使う
  hostId: string;
  hostName: string;
  guestId: string | null;
  guestName: string | null;
  closed: boolean; // ホストが退出した
  state: RoomState;
}

export type RoomErrorCode =
  | "not_found"
  | "full"
  | "invalid_name"
  | "invalid_code"
  | "network"
  | "unknown";

const MESSAGES: Record<RoomErrorCode, string> = {
  not_found: "その部屋コードの部屋は見つかりませんでした。コードを確かめてください。",
  full: "その部屋はすでに2人そろっています。",
  invalid_name: `名前は1〜${MAX_NAME_LENGTH}文字で入力してください。`,
  invalid_code: "部屋コードは4桁の数字で入力してください。",
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

/** 部屋の保存先。Supabase 版と、接続情報がないとき用のブラウザ内版がある。 */
export interface RoomClient {
  /** 「Supabase」か「このブラウザ内だけ」か */
  readonly kind: "supabase" | "local";
  /** この端末のプレイヤー ID を返す */
  init(): Promise<string>;
  createRoom(name: string): Promise<Room>;
  joinRoom(code: string, name: string): Promise<Room>;
  fetchRoom(id: string): Promise<Room | null>;
  /** room.version のときだけ state を書き換える。他の人が先に更新していたら null */
  saveState(room: Room, state: RoomState): Promise<Room | null>;
  leaveRoom(id: string): Promise<void>;
  /** 部屋の変化を受け取る。戻り値で購読をやめる */
  subscribe(id: string, onChange: (room: Room) => void): () => void;
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

export function normalizeCode(code: string): string {
  // 全角数字も受け付ける
  return code
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, "");
}

export function isValidCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}
