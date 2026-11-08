import { normalizeRoomState } from "@/lib/domain/game";
import { type Room, RoomError } from "./types";

/** trivia_battle_* の RPC が返す部屋（token は含まない） */
export interface RoomRow {
  id: string;
  code: string;
  version: number;
  host_id: string;
  host_name: string;
  guest_id: string | null;
  guest_name: string | null;
  closed: boolean;
  state: unknown;
}

export function rowToRoom(row: RoomRow): Room {
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    hostId: row.host_id,
    hostName: row.host_name,
    guestId: row.guest_id ?? null,
    guestName: row.guest_name ?? null,
    closed: Boolean(row.closed),
    state: normalizeRoomState(row.state),
  };
}

/** Supabase のエラーをアプリのエラーに変える。RPC は例外メッセージにコードを入れている */
export function toRoomError(error: { message?: string; code?: string } | null | undefined): RoomError {
  const msg = error?.message ?? "";
  if (msg.includes("room_not_found")) return new RoomError("not_found");
  if (msg.includes("room_full")) return new RoomError("full");
  if (msg.includes("invalid_name")) return new RoomError("invalid_name");
  if (msg.includes("invalid_code")) return new RoomError("invalid_code");
  if (msg.includes("not_member")) return new RoomError("not_found");
  if (/fetch|network|Failed to fetch|Load failed/i.test(msg)) return new RoomError("network");
  return new RoomError("unknown", msg || undefined);
}
