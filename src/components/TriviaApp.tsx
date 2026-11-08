"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getRoomClient } from "@/lib/room/client";
import { RoomSession } from "@/lib/room/session";
import { seatOf } from "@/lib/room/types";
import { TRIVIA } from "@/lib/trivia";
import { FeedbackDialog } from "./FeedbackDialog";
import { GameScreen } from "./GameScreen";
import { LobbyScreen } from "./LobbyScreen";
import { LoginScreen } from "./LoginScreen";
import { StatsScreen } from "./StatsScreen";
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
  const [view, setView] = useState<"title" | "stats">("title");
  const [feedbackFrom, setFeedbackFrom] = useState<string | null>(null);

  useEffect(() => {
    void s.restore();
  }, [s]);

  // 通知は数秒で消す
  useEffect(() => {
    if (!snap.notice) return;
    const t = setTimeout(() => s.clearNotice(), 6000);
    return () => clearTimeout(t);
  }, [snap.notice, s]);

  const { player, room } = snap;
  const seat = room ? seatOf(room, player?.id ?? null) : null;
  const openFeedback = (page: string) => setFeedbackFrom(page);

  let screen;
  if (snap.restoring) {
    screen = (
      <div className="grid flex-1 place-items-center">
        <Spinner className="size-8" />
      </div>
    );
  } else if (!player) {
    screen = <LoginScreen session={s} busy={snap.busy} error={snap.error} onFeedback={() => openFeedback("login")} />;
  } else if (room && seat) {
    screen = room.state.game ? (
      <GameScreen session={s} room={room} seat={seat} error={snap.error} onFeedback={() => openFeedback("game")} />
    ) : (
      <LobbyScreen session={s} room={room} seat={seat} error={snap.error} />
    );
  } else if (view === "stats") {
    screen = <StatsScreen session={s} player={player} onBack={() => setView("title")} />;
  } else {
    screen = (
      <TitleScreen
        session={s}
        player={player}
        busy={snap.busy}
        error={snap.error}
        onStats={() => setView("stats")}
        onFeedback={() => openFeedback("title")}
      />
    );
  }

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
      {screen}
      <FeedbackDialog session={s} page={feedbackFrom} onClose={() => setFeedbackFrom(null)} />
    </div>
  );
}
