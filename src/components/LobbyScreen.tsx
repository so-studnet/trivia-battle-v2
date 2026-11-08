"use client";

import { useState } from "react";
import { type FirstPlayerMode, MAX_TARGET, MIN_TARGET, type Seat } from "@/lib/domain/game";
import type { RoomSession } from "@/lib/room/session";
import type { Room } from "@/lib/room/types";
import { Avatar, Button, Panel, Spinner } from "./ui";

export function LobbyScreen({
  session,
  room,
  seat,
  error,
}: {
  session: RoomSession;
  room: Room;
  seat: Seat;
  error: string | null;
}) {
  const { ready, settings } = room.state;
  const isHost = seat === "A";
  const hasGuest = !!room.guestId;
  const bothReady = hasGuest && ready.A && ready.B;
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const inviteUrl =
    typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}?room=${room.code}`;

  const copy = async (kind: "code" | "link") => {
    const text = kind === "code" ? room.code : inviteUrl;
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "雑学カードバトル", text: `部屋コード ${room.code} で対戦しよう！`, url: inviteUrl });
        return;
      } catch {
        return; // キャンセル
      }
    }
    await copy("link");
  };

  const setFirst = (firstPlayer: FirstPlayerMode) =>
    session.dispatch({ type: "updateSettings", settings: { ...settings, firstPlayer } });
  const setTarget = (targetScore: number) =>
    session.dispatch({ type: "updateSettings", settings: { ...settings, targetScore } });

  const names: Record<Seat, string> = { A: room.hostName, B: room.guestName ?? "ゲスト" };
  const firstOptions: { value: FirstPlayerMode; label: string }[] = [
    { value: "A", label: room.hostName },
    { value: "B", label: room.guestName ?? "ゲスト" },
    { value: "random", label: "ランダム" },
  ];

  let status: string;
  if (!hasGuest) status = "相手の参加を待っています…";
  else if (!bothReady) status = "2人とも「準備OK」にしてください";
  else if (isHost) status = "準備がそろいました！対戦を始めましょう";
  else status = `${room.hostName}さんが始めるのを待っています…`;

  return (
    <main className="flex flex-1 flex-col gap-4 py-2">
      <div className="flex items-center justify-between">
        <Button variant="ghost" className="-ml-3 min-h-10 px-3 text-sm" onClick={() => session.leaveRoom()}>
          ← 部屋を出る
        </Button>
        <span className="text-xs font-bold text-muted">{isHost ? "あなたはホスト" : "あなたはゲスト"}</span>
      </div>

      <Panel className="animate-fade-up text-center">
        <p className="text-xs font-bold text-muted">部屋コード</p>
        <p className="mt-1 font-mono text-5xl font-black tracking-[0.25em] text-primary" data-testid="room-code">
          {room.code}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" className="min-h-10 px-4 text-sm" onClick={() => copy("code")}>
            {copied === "code" ? "コピーしました" : "コードをコピー"}
          </Button>
          <Button variant="outline" className="min-h-10 px-4 text-sm" onClick={share}>
            {copied === "link" ? "リンクをコピーしました" : "招待リンクを送る"}
          </Button>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-3">
        {(["A", "B"] as const).map((s) => {
          const joined = s === "A" || hasGuest;
          return (
            <div
              key={s}
              className={`flex items-center gap-3 rounded-2xl p-2 ${joined ? "" : "opacity-60"}`}
              data-testid={`slot-${s}`}
            >
              {joined ? (
                <Avatar name={names[s]} seat={s} />
              ) : (
                <span className="grid size-11 place-items-center rounded-2xl border-2 border-dashed border-border">
                  <Spinner className="size-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">
                  {joined ? names[s] : "まだ参加していません"}
                  {s === seat && <span className="ml-1 text-xs text-muted">（あなた）</span>}
                </p>
                <p className="text-xs text-muted">{s === "A" ? "ホスト" : "ゲスト"}</p>
              </div>
              {joined && (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    ready[s] ? "bg-true-soft text-true" : "bg-surface-2 text-muted"
                  }`}
                >
                  {ready[s] ? "準備OK" : "準備中"}
                </span>
              )}
            </div>
          );
        })}
      </Panel>

      <Panel className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold">対戦ルール</h2>
          {!isHost && <span className="text-xs text-muted">ホストが決めます</span>}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold text-muted">先攻（最初の出題者）</span>
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1" role="radiogroup" aria-label="先攻">
            {firstOptions.map((o) => {
              const active = settings.firstPlayer === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={!isHost || (o.value === "B" && !hasGuest && !active)}
                  onClick={() => setFirst(o.value)}
                  className={`min-h-10 truncate rounded-xl px-2 text-sm font-bold transition ${
                    active ? "bg-surface text-primary shadow" : "text-muted"
                  } disabled:cursor-default`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-muted">勝利に必要な点数</span>
          <div className="flex items-center gap-2">
            {isHost && (
              <button
                type="button"
                aria-label="目標点を減らす"
                disabled={settings.targetScore <= MIN_TARGET}
                onClick={() => setTarget(settings.targetScore - 1)}
                className="grid size-10 place-items-center rounded-xl bg-surface-2 text-xl font-black disabled:opacity-40"
              >
                −
              </button>
            )}
            <span className="w-14 text-center text-2xl font-black" data-testid="target-score">
              {settings.targetScore}
              <span className="text-sm font-bold text-muted">点</span>
            </span>
            {isHost && (
              <button
                type="button"
                aria-label="目標点を増やす"
                disabled={settings.targetScore >= MAX_TARGET}
                onClick={() => setTarget(settings.targetScore + 1)}
                className="grid size-10 place-items-center rounded-xl bg-surface-2 text-xl font-black disabled:opacity-40"
              >
                ＋
              </button>
            )}
          </div>
        </div>
      </Panel>

      <div className="mt-auto flex flex-col gap-3 pt-2">
        <p className="flex items-center justify-center gap-2 text-center text-sm font-bold text-muted" role="status">
          {!(bothReady && isHost) && <Spinner className="size-4" />}
          {status}
        </p>
        {error && (
          <p role="alert" className="rounded-xl bg-false-soft px-3 py-2 text-sm font-bold text-false">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button
            variant={ready[seat] ? "outline" : "true"}
            className="flex-1"
            disabled={!hasGuest}
            onClick={() => session.dispatch({ type: "setReady", ready: !ready[seat] })}
          >
            {ready[seat] ? "準備を取り消す" : "準備OK！"}
          </Button>
          {isHost && (
            <Button className="flex-1" disabled={!bothReady} onClick={() => session.dispatch({ type: "start" })}>
              対戦スタート
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
