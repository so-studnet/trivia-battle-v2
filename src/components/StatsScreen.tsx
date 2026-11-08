"use client";

import { useEffect, useState } from "react";
import { type Rate, type Stats, computeStats, formatRate } from "@/lib/domain/stats";
import type { RoomSession } from "@/lib/room/session";
import type { Player } from "@/lib/room/types";
import { TRIVIA } from "@/lib/trivia";
import { Button, Panel, Spinner } from "./ui";

export function StatsScreen({
  session,
  player,
  onBack,
}: {
  session: RoomSession;
  player: Player;
  onBack: () => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    session
      .getStats()
      .then((data) => active && setStats(computeStats(data, TRIVIA)))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [session]);

  return (
    <main className="flex flex-1 flex-col gap-4 py-2">
      <div className="flex items-center justify-between">
        <Button variant="ghost" className="-ml-3 min-h-10 px-3 text-sm" onClick={onBack}>
          ← もどる
        </Button>
      </div>
      <h1 className="text-2xl font-black">{player.nickname}さんの成績</h1>

      {error ? (
        <p role="alert" className="rounded-xl bg-false-soft px-3 py-2 text-sm font-bold text-false">
          {error}
        </p>
      ) : !stats ? (
        <div className="grid flex-1 place-items-center">
          <Spinner className="size-8" />
        </div>
      ) : (
        <StatsBody stats={stats} />
      )}
    </main>
  );
}

function StatsBody({ stats }: { stats: Stats }) {
  const empty = stats.games.played === 0 && stats.guess.total === 0 && stats.fool.total === 0;
  return (
    <div className="animate-fade-up flex flex-col gap-4">
      {empty && (
        <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted">
          まだ記録がありません。対戦すると、ここに成績が表示されます。
        </p>
      )}

      <div className="grid grid-cols-3 gap-2" data-testid="stat-tiles">
        <Tile
          label="勝敗"
          value={`${stats.games.wins}勝${stats.games.losses}敗`}
          sub={`勝率 ${formatRate(stats.games.winRate)}`}
        />
        <Tile label="正答率" value={formatRate(stats.guess.rate)} sub={`${stats.guess.hit} / ${stats.guess.total}問`} />
        <Tile label="だませた率" value={formatRate(stats.fool.rate)} sub={`${stats.fool.hit} / ${stats.fool.total}問`} />
      </div>

      <Panel className="flex flex-col gap-3">
        <SectionTitle title="ジャンル別の正答率" note="回答者として答えた問題" />
        <ul className="flex flex-col gap-2.5" aria-label="ジャンル別の正答率">
          {stats.byGenre.map((g) => (
            <BarRow key={g.genre} label={g.label} rate={g} />
          ))}
        </ul>
      </Panel>

      <Panel className="flex flex-col gap-3">
        <SectionTitle title="自信度（賭け点）別の正答率" note="自信があるときほど当たっている？" />
        <ul className="flex flex-col gap-2.5" aria-label="賭け点別の正答率">
          {stats.byBet.map((b) => (
            <BarRow key={b.bet} label={`${b.bet}点賭け`} rate={b} />
          ))}
        </ul>
        <p className="text-sm text-muted">
          回答で得た点 <b className="text-text">{stats.guess.pointsWon}点</b> ・ 相手に渡した点{" "}
          <b className="text-text">{stats.guess.pointsLost}点</b>
        </p>
      </Panel>

      {stats.opponents.length > 0 && (
        <Panel className="flex flex-col gap-3">
          <SectionTitle title="対戦相手ごとの成績" />
          <ul className="flex flex-col divide-y divide-border">
            {stats.opponents.map((o) => (
              <li key={o.opponentId} className="flex items-center justify-between py-2 text-sm">
                <span className="truncate font-bold">{o.name}さん</span>
                <span className="shrink-0 tabular-nums text-muted">
                  <b className="text-text">{o.wins}</b>勝 <b className="text-text">{o.losses}</b>敗
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="flex flex-col gap-2">
        <SectionTitle title="出会った問題" note="一度出会った問題は二度と配られません" />
        <p className="text-sm">
          <b className="text-2xl tabular-nums">{stats.seen.count}</b>
          <span className="text-muted"> / {stats.seen.total}問</span>
        </p>
        <div
          className="h-2 overflow-hidden rounded-full bg-surface-2"
          role="img"
          aria-label={`全${stats.seen.total}問のうち${stats.seen.count}問に出会った`}
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${(stats.seen.count / Math.max(1, stats.seen.total)) * 100}%` }}
          />
        </div>
      </Panel>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-border bg-surface px-2 py-3 text-center">
      <span className="text-xs font-bold text-muted">{label}</span>
      <span className="mt-1 text-xl font-black tabular-nums">{value}</span>
      <span className="text-[11px] text-muted tabular-nums">{sub}</span>
    </div>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div>
      <h2 className="font-bold">{title}</h2>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

/** 1本の横棒（単色）。値と件数は文字でも示す */
function BarRow({ label, rate }: { label: string; rate: Rate }) {
  const pct = rate.rate === null ? 0 : rate.rate * 100;
  return (
    <li className="grid grid-cols-[6.5rem_1fr_5.5rem] items-center gap-2 text-sm" title={`${label}: ${rate.hit} / ${rate.total}問正解`}>
      <span className="truncate font-bold">{label}</span>
      <span className="h-2.5 overflow-hidden rounded bg-surface-2">
        {rate.total > 0 && (
          <span className="block h-full rounded bg-primary transition-all duration-500" style={{ width: `${Math.max(pct, 2)}%` }} />
        )}
      </span>
      <span className="text-right tabular-nums">
        <b>{formatRate(rate.rate)}</b>
        <span className="text-xs text-muted"> {rate.total > 0 ? `${rate.hit}/${rate.total}` : ""}</span>
      </span>
    </li>
  );
}
