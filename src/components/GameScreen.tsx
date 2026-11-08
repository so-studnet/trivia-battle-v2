"use client";

import { useEffect, useState } from "react";
import { type Bet, BETS, type Game, genreLabel, other, type Seat, type Turn } from "@/lib/domain/game";
import { headToHead } from "@/lib/domain/stats";
import type { RoomSession } from "@/lib/room/session";
import type { Room } from "@/lib/room/types";
import { getCard } from "@/lib/trivia";
import { Avatar, Button, GenreBadge, Panel, Spinner, TriviaText, TruthBadge } from "./ui";

interface Props {
  session: RoomSession;
  room: Room;
  seat: Seat;
  error: string | null;
  onFeedback: () => void;
}

export function GameScreen({ session, room, seat, error, onFeedback }: Props) {
  const game = room.state.game!;
  const names: Record<Seat, string> = { A: room.hostName, B: room.guestName ?? "ゲスト" };
  const target = room.state.settings.targetScore;

  return (
    <main className="flex flex-1 flex-col gap-4 py-2">
      <TopBar session={session} round={game.round} over={game.phase === "over"} />
      <ScoreBoard game={game} names={names} me={seat} target={target} />
      {error && (
        <p role="alert" className="rounded-xl bg-false-soft px-3 py-2 text-sm font-bold text-false">
          {error}
        </p>
      )}
      <Phase
        session={session}
        game={game}
        names={names}
        me={seat}
        target={target}
        opponentId={(seat === "A" ? room.guestId : room.hostId) ?? ""}
        onFeedback={onFeedback}
      />
    </main>
  );
}

function TopBar({ session, round, over }: { session: RoomSession; round: number; over: boolean }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-black text-muted">{over ? "対戦終了" : `第${round}問`}</span>
      {over ? null : confirming ? (
        <span className="flex items-center gap-1">
          <Button variant="ghost" className="min-h-9 px-3 text-sm" onClick={() => setConfirming(false)}>
            続ける
          </Button>
          <Button variant="false" className="min-h-9 px-3 text-sm" onClick={() => session.leaveRoom()}>
            本当に退出
          </Button>
        </span>
      ) : (
        <Button variant="ghost" className="-mr-3 min-h-9 px-3 text-sm" onClick={() => setConfirming(true)}>
          退出
        </Button>
      )}
    </div>
  );
}

function ScoreBoard({
  game,
  names,
  me,
  target,
}: {
  game: Game;
  names: Record<Seat, string>;
  me: Seat;
  target: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3" data-testid="scoreboard">
      {(["A", "B"] as const).map((s) => {
        const isQuestioner = game.questioner === s && game.phase !== "over";
        return (
          <div
            key={s}
            className={`relative rounded-2xl border-2 bg-surface p-3 transition ${
              isQuestioner ? "border-primary" : "border-border"
            }`}
          >
            {s === me && (
              <span className="absolute -top-2.5 left-3 rounded-full bg-text px-2 py-0.5 text-[10px] font-black text-bg">
                あなた
              </span>
            )}
            <div className="flex items-center gap-2">
              <Avatar name={names[s]} seat={s} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{names[s]}</p>
                <p className="text-xs font-bold text-muted">
                  {game.phase === "over" ? (game.winner === s ? "🏆 勝利" : "") : isQuestioner ? "出題者" : "回答者"}
                </p>
              </div>
              <p className="text-3xl font-black tabular-nums" data-testid={`score-${s}`}>
                {game.scores[s]}
              </p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full transition-all duration-500 ${s === "A" ? "bg-violet-500" : "bg-amber-500"}`}
                style={{ width: `${Math.min(100, (game.scores[s] / target) * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
      <p className="col-span-2 -mt-1 text-center text-xs font-bold text-muted">先に {target} 点で勝利</p>
    </div>
  );
}

function Phase({
  session,
  game,
  names,
  me,
  target,
  opponentId,
  onFeedback,
}: {
  session: RoomSession;
  game: Game;
  names: Record<Seat, string>;
  me: Seat;
  target: number;
  opponentId: string;
  onFeedback: () => void;
}) {
  const opponent = names[other(me)];
  const iAmQuestioner = game.questioner === me;

  switch (game.phase) {
    case "select":
      return iAmQuestioner ? (
        <SelectPhase key={game.round} game={game} onDecide={(cardId) => session.dispatch({ type: "selectCard", cardId })} />
      ) : (
        <Waiting message={`${opponent}さんが出題する雑学を選んでいます…`} />
      );
    case "guess":
      return iAmQuestioner ? (
        <QuestionerWaiting game={game} opponent={opponent} />
      ) : (
        <GuessPhase
          key={game.round}
          game={game}
          onGuess={(answer, bet) => session.dispatch({ type: "guess", answer, bet })}
        />
      );
    case "result":
      return (
        <ResultPhase
          turn={game.history[game.history.length - 1]}
          names={names}
          me={me}
          waiting={game.acks.includes(me)}
          opponent={opponent}
          onNext={() => session.dispatch({ type: "next" })}
        />
      );
    case "over":
      return (
        <OverPhase
          session={session}
          game={game}
          names={names}
          me={me}
          target={target}
          opponentId={opponentId}
          onFeedback={onFeedback}
        />
      );
  }
}

function Waiting({ message }: { message: string }) {
  return (
    <Panel className="animate-fade-up flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
      <div className="flex gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-14 w-10 animate-bounce rounded-lg bg-primary/80 shadow"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
      <p className="font-bold text-muted" role="status">
        {message}
      </p>
    </Panel>
  );
}

function SelectPhase({ game, onDecide }: { game: Game; onDecide: (cardId: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <section className="flex flex-1 flex-col gap-3">
      <div>
        <h2 className="text-lg font-black">あなたが出題者です</h2>
        <p className="text-sm text-muted">
          相手が間違えそうな雑学を1つ選びましょう。答えはあなたにだけ見えています。選ばなかったカードは手札に残ります。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="出題する雑学">
        {game.hands[game.questioner].map((id, i) => {
          const card = getCard(id);
          if (!card) return null;
          const active = selected === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSelected(id)}
              style={{ animationDelay: `${i * 0.08}s` }}
              className={`animate-deal flex flex-col items-start gap-2 rounded-2xl border-2 bg-surface p-4 text-left shadow-md transition ${
                active ? "border-primary ring-4 ring-primary/20" : "border-border hover:border-primary/50"
              }`}
            >
              <span className="flex flex-wrap gap-1.5">
                <TruthBadge isTrue={card.isTrue} />
                <GenreBadge label={genreLabel(card.genre)} />
              </span>
              <TriviaText text={card.text} />
            </button>
          );
        })}
      </div>
      <div className="sticky bottom-0 -mx-4 mt-auto bg-gradient-to-t from-bg via-bg/90 to-transparent px-4 pt-6 pb-4">
        <Button className="w-full text-lg" disabled={selected === null} onClick={() => selected !== null && onDecide(selected)}>
          この雑学で出題する
        </Button>
      </div>
    </section>
  );
}

function QuestionerWaiting({ game, opponent }: { game: Game; opponent: string }) {
  const card = getCard(game.cardId);
  return (
    <section className="flex flex-1 flex-col gap-4">
      {card && (
        <Panel className="animate-fade-up flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-bold text-muted">
              あなたの出題 <GenreBadge label={genreLabel(card.genre)} />
            </span>
            <TruthBadge isTrue={card.isTrue} />
          </div>
          <TriviaText text={card.text} large />
        </Panel>
      )}
      <p className="flex items-center justify-center gap-2 font-bold text-muted" role="status">
        <Spinner className="size-4" />
        {opponent}さんが考えています…
      </p>
    </section>
  );
}

function GuessPhase({ game, onGuess }: { game: Game; onGuess: (answer: boolean, bet: Bet) => void }) {
  const [bet, setBet] = useState<Bet>(1);
  const [sent, setSent] = useState(false);
  const card = getCard(game.cardId);
  if (!card) return null;

  const guess = (answer: boolean) => {
    if (sent) return;
    setSent(true);
    onGuess(answer, bet);
  };

  return (
    <section className="flex flex-1 flex-col gap-4">
      <h2 className="text-lg font-black">この雑学は本当？ウソ？</h2>
      <Panel className="animate-pop flex min-h-40 flex-col justify-center gap-3">
        <span>
          <GenreBadge label={genreLabel(card.genre)} />
        </span>
        <TriviaText text={card.text} large />
      </Panel>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-muted">
          自信度を賭ける <span className="font-normal">（当たれば自分に、外れたら相手に入る点数）</span>
        </p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="賭ける点数">
          {BETS.map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={bet === b}
              onClick={() => setBet(b)}
              className={`flex min-h-14 flex-col items-center justify-center rounded-2xl border-2 font-black transition ${
                bet === b ? "border-gold bg-gold/15 text-text" : "border-border bg-surface text-muted"
              }`}
            >
              <span className="text-xl">{b}点</span>
              <span className="text-[10px] font-bold">{b === 1 ? "自信なし" : b === 2 ? "まあまあ" : "自信あり！"}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto grid grid-cols-2 gap-3 pt-2">
        <Button variant="true" className="min-h-16 text-xl" disabled={sent} onClick={() => guess(true)}>
          ◯ 本当
        </Button>
        <Button variant="false" className="min-h-16 text-xl" disabled={sent} onClick={() => guess(false)}>
          ✕ ウソ
        </Button>
      </div>
    </section>
  );
}

function TurnSummary({ turn, names, me }: { turn: Turn; names: Record<Seat, string>; me: Seat }) {
  const card = getCard(turn.cardId);
  if (!card) return null;
  const guesser = other(turn.questioner);
  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-bold text-muted">
          答え <GenreBadge label={genreLabel(card.genre)} />
        </span>
        <TruthBadge isTrue={card.isTrue} className="text-sm" />
      </div>
      <TriviaText text={card.text} />
      <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm leading-relaxed">{card.explanation}</p>
      <p className="text-sm text-muted">
        {names[guesser]}さんの回答：<b className="text-text">{turn.guess ? "本当" : "ウソ"}</b>（{turn.bet}点賭け）→{" "}
        <b className="text-text">
          {names[turn.scorer]}さん{turn.scorer === me ? "（あなた）" : ""}に +{turn.bet}点
        </b>
      </p>
    </Panel>
  );
}

function ResultPhase({
  turn,
  names,
  me,
  waiting,
  opponent,
  onNext,
}: {
  turn: Turn;
  names: Record<Seat, string>;
  me: Seat;
  waiting: boolean;
  opponent: string;
  onNext: () => void;
}) {
  const iGuessed = other(turn.questioner) === me;
  const good = turn.scorer === me;
  const heading = iGuessed ? (turn.correct ? "正解！" : "ざんねん…") : turn.correct ? "見破られた！" : "だませた！";
  return (
    <section className="flex flex-1 flex-col gap-4">
      <div className="animate-pop text-center">
        <p className={`text-4xl font-black ${good ? "text-true" : "text-false"}`} data-testid="result-heading">
          {heading}
        </p>
        <p className="mt-1 text-sm font-bold text-muted">
          {good ? `あなたに +${turn.bet}点` : `${opponent}さんに +${turn.bet}点`}
        </p>
      </div>
      <TurnSummary turn={turn} names={names} me={me} />
      <div className="mt-auto pt-2">
        {waiting ? (
          <p className="flex min-h-12 items-center justify-center gap-2 font-bold text-muted" role="status">
            <Spinner className="size-4" />
            {opponent}さんが確認中です…
          </p>
        ) : (
          <Button className="w-full text-lg" onClick={onNext}>
            次の問題へ
          </Button>
        )}
      </div>
    </section>
  );
}

function OverPhase({
  session,
  game,
  names,
  me,
  target,
  opponentId,
  onFeedback,
}: {
  session: RoomSession;
  game: Game;
  names: Record<Seat, string>;
  me: Seat;
  target: number;
  opponentId: string;
  onFeedback: () => void;
}) {
  const won = game.winner === me;
  const last = game.history[game.history.length - 1];
  const [record, setRecord] = useState<{ wins: number; losses: number } | null>(null);

  // この相手との通算成績（この対戦の結果も含む）
  useEffect(() => {
    let active = true;
    session
      .getStats()
      .then((data) => {
        if (!active) return;
        const r = headToHead(data, opponentId);
        // 記録の保存が間に合っていなければ、この対戦の結果を足して見せる
        const counted = data.games.some((g) => g.id === game.id);
        setRecord(counted ? r : { wins: r.wins + (won ? 1 : 0), losses: r.losses + (won ? 0 : 1) });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [session, opponentId, game.id, won]);
  return (
    <section className="flex flex-1 flex-col gap-4">
      <div className="animate-pop py-2 text-center">
        <p className="text-5xl" aria-hidden>
          {won ? "🏆" : "🤝"}
        </p>
        <p className="mt-2 text-3xl font-black" data-testid="winner-heading">
          {won ? "あなたの勝ち！" : `${names[game.winner!]}さんの勝ち`}
        </p>
        <p className="mt-1 text-sm font-bold text-muted">
          {names.A} {game.scores.A} − {game.scores.B} {names.B}（{target}点先取）
        </p>
        {record && (
          <p className="mt-2 inline-block rounded-full bg-surface-2 px-3 py-1 text-sm font-bold" data-testid="head-to-head">
            {names[other(me)]}さんとの通算 {record.wins}勝{record.losses}敗
          </p>
        )}
      </div>

      {last && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-muted">最後の問題</h3>
          <TurnSummary turn={last} names={names} me={me} />
        </div>
      )}

      <details className="rounded-2xl border border-border bg-surface p-4">
        <summary className="cursor-pointer font-bold">この対戦で出た雑学（{game.history.length}問）</summary>
        <ol className="mt-3 flex flex-col gap-3">
          {game.history.map((t, i) => {
            const card = getCard(t.cardId);
            if (!card) return null;
            return (
              <li key={i} className="border-t border-border pt-3 first:border-0 first:pt-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-black text-muted">第{i + 1}問</span>
                  <TruthBadge isTrue={card.isTrue} />
                  <GenreBadge label={genreLabel(card.genre)} />
                  <span className="text-xs text-muted">
                    {names[t.scorer]}さんに+{t.bet}
                  </span>
                </div>
                <p className="text-sm font-bold">{card.text}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{card.explanation}</p>
              </li>
            );
          })}
        </ol>
      </details>

      <button type="button" onClick={onFeedback} className="self-center text-sm font-bold text-muted underline underline-offset-2">
        問題の間違いや感想を送る
      </button>

      <div className="mt-auto flex gap-3 pt-2">
        <Button variant="outline" className="flex-1" onClick={() => session.leaveRoom()}>
          部屋を出る
        </Button>
        <Button className="flex-1" onClick={() => session.dispatch({ type: "rematch" })}>
          もう一度あそぶ
        </Button>
      </div>
    </section>
  );
}

