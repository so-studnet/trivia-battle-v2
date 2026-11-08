import { createClient } from "@supabase/supabase-js";
import { LocalRoomClient } from "./local-client";
import { SupabaseRoomClient } from "./supabase-client";
import type { RoomClient } from "./types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// 新しい「Publishable key」と従来の「anon key」のどちらでもよい
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Supabase の接続情報が設定されているか。未設定なら同じブラウザ内だけで遊べるモードになる */
export const isSupabaseConfigured = Boolean(url && key);

let client: RoomClient | null = null;

export function getRoomClient(): RoomClient {
  if (client) return client;
  client =
    url && key
      ? new SupabaseRoomClient(
          createClient(url, key, {
            // Supabase Auth は使わない（同じプロジェクトのほかのアプリのログインとも混ざらない）
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          }),
        )
      : new LocalRoomClient();
  return client;
}
