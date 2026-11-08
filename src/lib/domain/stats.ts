// プレイヤーの成績の集計（純粋関数）。
// サーバーからは記録をそのまま受け取り、ジャンルなどの問題の情報と合わせてここで集計する。
import { type Bet, BETS, GENRES, type Genre, type TriviaCard } from "./game";

/** 1問ごとの記録（自分が回答者または出題者だったもの） */
export interface AnswerRecord {
  gameId: string;
  round: number;
  cardId: number;
  role: "guesser" | "questioner";
  /** 回答者が正解したか */
  correct: boolean;
  bet: number;
  answeredAt: string;
}

/** 終わった対戦の記録 */
export interface GameRecord {
  id: string;
  finishedAt: string;
  won: boolean;
  myScore: number;
  opponentScore: number;
  opponentId: string;
  opponentName: string;
}

export interface StatsData {
  answers: AnswerRecord[];
  games: GameRecord[];
  /** これまでに出会った問題の数 */
  seenCount: number;
}

export interface Rate {
  total: number;
  hit: number;
  /** 0〜1。total が 0 なら null */
  rate: number | null;
}

export interface Stats {
  games: { played: number; wins: number; losses: number; winRate: number | null };
  /** 回答者として */
  guess: Rate & { pointsWon: number; pointsLost: number };
  byGenre: (Rate & { genre: Genre; label: string })[];
  byBet: (Rate & { bet: Bet })[];
  /** 出題者として、相手をだませた（相手が不正解だった）割合 */
  fool: Rate;
  opponents: { opponentId: string; name: string; wins: number; losses: number }[];
  seen: { count: number; total: number };
}

function rate(total: number, hit: number): Rate {
  return { total, hit, rate: total > 0 ? hit / total : null };
}

export function computeStats(data: StatsData, cards: readonly TriviaCard[]): Stats {
  const genreOf = new Map(cards.map((c) => [c.id, c.genre]));
  const guesses = data.answers.filter((a) => a.role === "guesser");
  const asked = data.answers.filter((a) => a.role === "questioner");

  const byGenre = GENRES.map(({ id, label }) => {
    const list = guesses.filter((a) => genreOf.get(a.cardId) === id);
    return { genre: id, label, ...rate(list.length, list.filter((a) => a.correct).length) };
  });
  const byBet = BETS.map((bet) => {
    const list = guesses.filter((a) => a.bet === bet);
    return { bet, ...rate(list.length, list.filter((a) => a.correct).length) };
  });

  const opponents = new Map<string, { opponentId: string; name: string; wins: number; losses: number; last: string }>();
  for (const g of data.games) {
    const o = opponents.get(g.opponentId) ?? { opponentId: g.opponentId, name: g.opponentName, wins: 0, losses: 0, last: "" };
    if (g.won) o.wins++;
    else o.losses++;
    // 名前は最新の対戦のものを使う
    if (g.finishedAt >= o.last) {
      o.last = g.finishedAt;
      o.name = g.opponentName;
    }
    opponents.set(g.opponentId, o);
  }

  const wins = data.games.filter((g) => g.won).length;
  return {
    games: {
      played: data.games.length,
      wins,
      losses: data.games.length - wins,
      winRate: data.games.length > 0 ? wins / data.games.length : null,
    },
    guess: {
      ...rate(guesses.length, guesses.filter((a) => a.correct).length),
      pointsWon: guesses.filter((a) => a.correct).reduce((s, a) => s + a.bet, 0),
      pointsLost: guesses.filter((a) => !a.correct).reduce((s, a) => s + a.bet, 0),
    },
    byGenre,
    byBet,
    fool: rate(asked.length, asked.filter((a) => !a.correct).length),
    opponents: [...opponents.values()]
      .sort((a, b) => b.wins + b.losses - (a.wins + a.losses) || (a.last < b.last ? 1 : -1))
      .map(({ opponentId, name, wins: w, losses }) => ({ opponentId, name, wins: w, losses })),
    seen: { count: Math.min(data.seenCount, cards.length), total: cards.length },
  };
}

/** 特定の相手との通算成績 */
export function headToHead(data: StatsData, opponentId: string): { wins: number; losses: number } {
  const games = data.games.filter((g) => g.opponentId === opponentId);
  const wins = games.filter((g) => g.won).length;
  return { wins, losses: games.length - wins };
}

export function formatRate(r: number | null): string {
  return r === null ? "—" : `${Math.round(r * 100)}%`;
}
