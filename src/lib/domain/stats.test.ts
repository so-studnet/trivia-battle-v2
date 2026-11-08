import { describe, expect, it } from "vitest";
import type { TriviaCard } from "./game";
import { type AnswerRecord, type GameRecord, computeStats, formatRate, headToHead } from "./stats";

const cards: TriviaCard[] = [
  { id: 1, text: "", isTrue: true, explanation: "", genre: "animals" },
  { id: 2, text: "", isTrue: false, explanation: "", genre: "animals" },
  { id: 3, text: "", isTrue: true, explanation: "", genre: "history" },
  { id: 4, text: "", isTrue: true, explanation: "", genre: "food" },
];

const a = (cardId: number, role: AnswerRecord["role"], correct: boolean, bet = 1): AnswerRecord => ({
  gameId: "g",
  round: cardId,
  cardId,
  role,
  correct,
  bet,
  answeredAt: "2026-11-09T00:00:00Z",
});

const g = (id: string, won: boolean, opponentId: string, opponentName: string, finishedAt: string): GameRecord => ({
  id,
  won,
  opponentId,
  opponentName,
  finishedAt,
  myScore: won ? 3 : 1,
  opponentScore: won ? 1 : 3,
});

describe("computeStats", () => {
  it("回答の正答率・ジャンル別・賭け点別・点数を集計する", () => {
    const s = computeStats(
      {
        answers: [
          a(1, "guesser", true, 3),
          a(2, "guesser", false, 2),
          a(3, "guesser", true, 1),
          a(4, "questioner", false), // 出題して相手が不正解 = だませた
          a(1, "questioner", true),
        ],
        games: [],
        seenCount: 3,
      },
      cards,
    );
    expect(s.guess).toMatchObject({ total: 3, hit: 2, pointsWon: 4, pointsLost: 2 });
    expect(s.guess.rate).toBeCloseTo(2 / 3);
    expect(s.byGenre.find((x) => x.genre === "animals")).toMatchObject({ total: 2, hit: 1, rate: 0.5, label: "生き物" });
    expect(s.byGenre.find((x) => x.genre === "history")).toMatchObject({ total: 1, hit: 1, rate: 1 });
    expect(s.byGenre.find((x) => x.genre === "science")).toMatchObject({ total: 0, rate: null });
    expect(s.byBet.map((b) => [b.bet, b.total, b.hit])).toEqual([
      [1, 1, 1],
      [2, 1, 0],
      [3, 1, 1],
    ]);
    expect(s.fool).toMatchObject({ total: 2, hit: 1, rate: 0.5 });
    expect(s.seen).toEqual({ count: 3, total: 4 });
  });

  it("勝敗と相手ごとの成績を集計する（名前は最新のもの）", () => {
    const games = [
      g("1", true, "p2", "たろう", "2026-11-01"),
      g("2", false, "p2", "タロウ", "2026-11-03"),
      g("3", true, "p3", "はなこ", "2026-11-02"),
      g("4", true, "p2", "たろう", "2026-11-02"),
    ];
    const s = computeStats({ answers: [], games, seenCount: 0 }, cards);
    expect(s.games).toEqual({ played: 4, wins: 3, losses: 1, winRate: 0.75 });
    expect(s.opponents).toEqual([
      { opponentId: "p2", name: "タロウ", wins: 2, losses: 1 },
      { opponentId: "p3", name: "はなこ", wins: 1, losses: 0 },
    ]);
    expect(headToHead({ answers: [], games, seenCount: 0 }, "p2")).toEqual({ wins: 2, losses: 1 });
  });

  it("記録がなくても壊れない", () => {
    const s = computeStats({ answers: [], games: [], seenCount: 0 }, cards);
    expect(s.guess.rate).toBeNull();
    expect(s.games.winRate).toBeNull();
    expect(formatRate(s.guess.rate)).toBe("—");
    expect(formatRate(0.666)).toBe("67%");
  });
});
