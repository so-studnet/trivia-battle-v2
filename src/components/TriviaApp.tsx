"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getRoomClient } from "@/lib/room/client";
import { RoomSession } from "@/lib/room/session";
import { seatOf } from "@/lib/room/types";
import { TRIVIA } from "@/lib/trivia";
import { GameScreen } from "./GameScreen";
import { LobbyScreen } from "./LobbyScreen";
import { TitleScreen } from "./TitleScreen";
import { Spinner } from "./ui";

let session: RoomSession | null = null;

function getSession(): RoomSession {
  session ??= new RoomSession(getRoomClient(), TRIVIA);
  return session;
}

export function TriviaApp() {
  const s = getSession();
  const snap = useSyncExternalStore(s.subscribe, s.getSnapshot, s.getServerSnapshot);

  useEffect(() => {
    void s.restore();
  }, [s]);

  // 通知は数秒で消す
  useEffect(() => {
    if (!snap.notice) return;
    const t = setTimeout(() => s.clearNotice(), 6000);
    return () => clearTimeout(t);
  }, [snap.notice, s]);

  const room = snap.room;
  const seat = room ? seatOf(room, snap.userId) : null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {snap.notice && (
        <div
          role="status"
          className="animate-fade-up fixed inset-x-4 top-4 z-50 mx-auto max-w-md rounded-2xl bg-text px-4 py-3 text-sm font-bold text-bg shadow-2xl"
          onClick={() => s.clearNotice()}
        >
          {snap.notice}
        </div>
      )}

      {snap.restoring ? (
        <div className="grid flex-1 place-items-center">
          <Spinner className="size-8" />
        </div>
      ) : room && seat ? (
        room.state.game ? (
          <GameScreen session={s} room={room} seat={seat} error={snap.error} />
        ) : (
          <LobbyScreen session={s} room={room} seat={seat} error={snap.error} />
        )
      ) : (
        <TitleScreen session={s} busy={snap.busy} error={snap.error} />
      )}
    </div>
  );
}
