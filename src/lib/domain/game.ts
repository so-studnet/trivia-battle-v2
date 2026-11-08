// 雑学カードバトルのルール（純粋関数）。
// 画面や通信から切り離してあり、Vitest でテストする。
// 部屋の状態（RoomState）は Supabase の rooms.state(jsonb) にそのまま保存される。

export type Seat = "A" | "B"; // A = ホスト, B = ゲスト
export type FirstPlayerMode = Seat | "random";
export type Bet = 1 | 2 | 3;

export const MIN_TARGET = 1;
export const MAX_TARGET = 10;
export const DEFAULT_TARGET = 3;
export const HAND_SIZE = 4;
export const BETS: readonly Bet[] = [1, 2, 3];

export interface TriviaCard {
  id: number;
  text: string;
  isTrue: boolean;
  explanation: string;
}

export interface Settings {
  firstPlayer: FirstPlayerMode;
  targetScore: number;
}

export interface Turn {
  round: number;
  cardId: number;
  questioner: Seat;
  guess: boolean; // 回答者の答え（true = 本当）
  bet: Bet;
  correct: boolean;
  scorer: Seat; // 点が入った人（正解なら回答者、不正解なら出題者）
}

export type Phase = "select" | "guess" | "result" | "over";

export interface Game {
  round: number;
  firstPlayer: Seat;
  questioner: Seat;
  phase: Phase;
  scores: Record<Seat, number>;
  hand: number[]; // 出題者に配られたカード
  cardId: number | null; // 出題中のカード
  acks: Seat[]; // 結果画面で「次へ」を押した人
  usedIds: number[];
  history: Turn[];
  winner: Seat | null;
}

export interface RoomState {
  ready: Record<Seat, boolean>;
  settings: Settings;
  game: Game | null;
}

export type Action =
  | { type: "setReady"; ready: boolean }
  | { type: "updateSettings"; settings: Settings }
  | { type: "start" }
  | { type: "selectCard"; cardId: number }
  | { type: "guess"; answer: boolean; bet: Bet }
  | { type: "next" }
  | { type: "rematch" };

export interface RuleContext {
  cards: readonly TriviaCard[];
  random: () => number; // 0 以上 1 未満
  hasGuest: boolean;
}

export function initialRoomState(): RoomState {
  return {
    ready: { A: false, B: false },
    settings: { firstPlayer: "random", targetScore: DEFAULT_TARGET },
    game: null,
  };
}

export function other(seat: Seat): Seat {
  return seat === "A" ? "B" : "A";
}

export function guesserOf(game: Game): Seat {
  return other(game.questioner);
}

export function clampTarget(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return DEFAULT_TARGET;
  return Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.round(n)));
}

export function isBet(value: unknown): value is Bet {
  return value === 1 || value === 2 || value === 3;
}

export function resolveFirstPlayer(mode: FirstPlayerMode, random: () => number): Seat {
  if (mode === "A" || mode === "B") return mode;
  return random() < 0.5 ? "A" : "B";
}

/** 未使用のカードから HAND_SIZE 枚を配る。足りなければ使用済みをリセットする。 */
export function drawHand(
  cards: readonly TriviaCard[],
  usedIds: readonly number[],
  random: () => number,
): { hand: number[]; usedIds: number[] } {
  const used = new Set(usedIds);
  let pool = cards.filter((c) => !used.has(c.id)).map((c) => c.id);
  let nextUsed = [...usedIds];
  if (pool.length < HAND_SIZE) {
    pool = cards.map((c) => c.id);
    nextUsed = [];
  }
  // Fisher–Yates で先頭 HAND_SIZE 枚だけ混ぜる
  const ids = [...pool];
  const n = Math.min(HAND_SIZE, ids.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (ids.length - i));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return { hand: ids.slice(0, n), usedIds: nextUsed };
}

function startGame(state: RoomState, ctx: RuleContext): Game {
  const firstPlayer = resolveFirstPlayer(state.settings.firstPlayer, ctx.random);
  const { hand, usedIds } = drawHand(ctx.cards, [], ctx.random);
  return {
    round: 1,
    firstPlayer,
    questioner: firstPlayer,
    phase: "select",
    scores: { A: 0, B: 0 },
    hand,
    cardId: null,
    acks: [],
    usedIds,
    history: [],
    winner: null,
  };
}

/**
 * seat の人が action を行った後の部屋の状態を返す。
 * ルール上できない操作なら null（状態は変えない）。
 * 元の state は変更しない。
 */
export function reduce(
  state: RoomState,
  seat: Seat,
  action: Action,
  ctx: RuleContext,
): RoomState | null {
  const game = state.game;
  switch (action.type) {
    case "setReady": {
      if (game) return null;
      if (seat === "B" && !ctx.hasGuest) return null;
      if (state.ready[seat] === action.ready) return null;
      return { ...state, ready: { ...state.ready, [seat]: action.ready } };
    }
    case "updateSettings": {
      if (game || seat !== "A") return null;
      const mode = action.settings.firstPlayer;
      if (mode !== "A" && mode !== "B" && mode !== "random") return null;
      const settings: Settings = {
        firstPlayer: mode,
        targetScore: clampTarget(action.settings.targetScore),
      };
      if (
        settings.firstPlayer === state.settings.firstPlayer &&
        settings.targetScore === state.settings.targetScore
      ) {
        return null;
      }
      // 設定が変わったら、ゲストに確認してもらうため準備完了を外す
      return { ...state, settings, ready: { A: state.ready.A, B: false } };
    }
    case "start": {
      if (game || seat !== "A" || !ctx.hasGuest) return null;
      if (!state.ready.A || !state.ready.B) return null;
      return { ...state, game: startGame(state, ctx) };
    }
    case "selectCard": {
      if (!game || game.phase !== "select" || game.questioner !== seat) return null;
      if (!game.hand.includes(action.cardId)) return null;
      return {
        ...state,
        game: {
          ...game,
          phase: "guess",
          cardId: action.cardId,
          usedIds: [...game.usedIds, action.cardId],
        },
      };
    }
    case "guess": {
      if (!game || game.phase !== "guess" || guesserOf(game) !== seat) return null;
      if (!isBet(action.bet) || typeof action.answer !== "boolean") return null;
      const card = ctx.cards.find((c) => c.id === game.cardId);
      if (!card) return null;
      const correct = action.answer === card.isTrue;
      const scorer = correct ? seat : game.questioner;
      const scores = { ...game.scores, [scorer]: game.scores[scorer] + action.bet };
      const turn: Turn = {
        round: game.round,
        cardId: card.id,
        questioner: game.questioner,
        guess: action.answer,
        bet: action.bet,
        correct,
        scorer,
      };
      // 1ターンに点が入るのは1人だけなので、目標に届いたらその人の勝ち
      const winner = scores[scorer] >= state.settings.targetScore ? scorer : null;
      return {
        ...state,
        game: {
          ...game,
          scores,
          history: [...game.history, turn],
          phase: winner ? "over" : "result",
          acks: [],
          winner,
        },
      };
    }
    case "next": {
      if (!game || game.phase !== "result" || game.acks.includes(seat)) return null;
      const acks = [...game.acks, seat];
      if (acks.length < 2) return { ...state, game: { ...game, acks } };
      const { hand, usedIds } = drawHand(ctx.cards, game.usedIds, ctx.random);
      return {
        ...state,
        game: {
          ...game,
          round: game.round + 1,
          questioner: other(game.questioner),
          phase: "select",
          hand,
          usedIds,
          cardId: null,
          acks: [],
        },
      };
    }
    case "rematch": {
      if (!game || game.phase !== "over") return null;
      return { ...state, game: null, ready: { A: false, B: false } };
    }
  }
}

/** DB から読んだ state を安全な形にそろえる（壊れていたら初期値に戻す）。 */
export function normalizeRoomState(raw: unknown): RoomState {
  const base = initialRoomState();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<RoomState>;
  const ready = {
    A: Boolean(r.ready?.A),
    B: Boolean(r.ready?.B),
  };
  const mode = r.settings?.firstPlayer;
  const settings: Settings = {
    firstPlayer: mode === "A" || mode === "B" || mode === "random" ? mode : "random",
    targetScore: clampTarget(r.settings?.targetScore),
  };
  const g = r.game;
  const game = g && typeof g === "object" && isGame(g) ? g : null;
  return { ready, settings, game };
}

function isSeat(v: unknown): v is Seat {
  return v === "A" || v === "B";
}

function isGame(g: Partial<Game>): g is Game {
  return (
    typeof g.round === "number" &&
    isSeat(g.questioner) &&
    isSeat(g.firstPlayer) &&
    (g.phase === "select" || g.phase === "guess" || g.phase === "result" || g.phase === "over") &&
    typeof g.scores?.A === "number" &&
    typeof g.scores?.B === "number" &&
    Array.isArray(g.hand) &&
    Array.isArray(g.acks) &&
    Array.isArray(g.usedIds) &&
    Array.isArray(g.history) &&
    (g.winner === null || isSeat(g.winner))
  );
}
