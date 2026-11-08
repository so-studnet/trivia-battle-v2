// 雑学カードバトルのルール（純粋関数）。
// 画面や通信から切り離してあり、Vitest でテストする。
// 部屋の状態（RoomState）は Supabase の trivia_battle_rooms.state(jsonb) にそのまま保存される。

export type Seat = "A" | "B"; // A = ホスト, B = ゲスト
export type FirstPlayerMode = Seat | "random";
export type Bet = 1 | 2 | 3;

export const MIN_TARGET = 1;
export const MAX_TARGET = 10;
export const DEFAULT_TARGET = 10;
export const HAND_SIZE = 4;
export const BETS: readonly Bet[] = [1, 2, 3];

export type Genre =
  | "animals"
  | "space"
  | "science"
  | "body"
  | "geography"
  | "history"
  | "food"
  | "culture";

export const GENRES: readonly { id: Genre; label: string }[] = [
  { id: "animals", label: "生き物" },
  { id: "space", label: "宇宙・地球" },
  { id: "science", label: "科学" },
  { id: "body", label: "人体" },
  { id: "geography", label: "地理" },
  { id: "history", label: "歴史" },
  { id: "food", label: "食べ物" },
  { id: "culture", label: "文化・スポーツ" },
];

export function genreLabel(genre: string): string {
  return GENRES.find((g) => g.id === genre)?.label ?? genre;
}

export interface TriviaCard {
  id: number;
  text: string;
  isTrue: boolean;
  explanation: string;
  genre: Genre;
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

/**
 * 対戦開始時にサーバーから受け取る、2人の「出会った問題」の情報。
 * 出会った問題（手札に配られた・出題された）は、できるだけ二度と配らない。
 */
export interface DealInfo {
  /** 2人のどちらかが出会ったことのある問題と、最後に出会った時刻（ミリ秒） */
  seenAt: Record<string, number>;
  /** 前の対戦から持ち越した手札（新しい相手がまだ出会っていないものだけ） */
  hands: Record<Seat, number[]>;
}

export interface Game {
  id: string; // 対戦ごとの ID（成績の記録に使う）
  startedAt: number;
  round: number;
  firstPlayer: Seat;
  questioner: Seat;
  phase: Phase;
  scores: Record<Seat, number>;
  /**
   * それぞれの手札。出題で使わなかったカードは手札に残り、
   * 次に出題者になったときに足りない分だけ補充する（対戦が終わっても次の対戦に持ち越す）。
   */
  hands: Record<Seat, number[]>;
  /** 2人のどちらかが出会った問題と、その時刻。ここにある問題は新しく配らない */
  seenAt: Record<string, number>;
  cardId: number | null; // 出題中のカード
  acks: Seat[]; // 結果画面で「次へ」を押した人
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
  now: () => number;
  newId: () => string;
  /** 対戦開始（start）のときに使う。なければ「2人とも何も出会っていない」として配る */
  deal?: DealInfo;
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

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * seat の手札を HAND_SIZE 枚まで補充する。
 * 1. 2人とも出会っていない問題から、手札のジャンルがなるべくばらけるように選ぶ
 * 2. 足りなければ、この対戦より前に出会った問題を、出会ったのが古い順に選ぶ
 * 配った問題は seenAt に記録する。元のオブジェクトは変えない。
 */
export function refillHand(
  game: Pick<Game, "hands" | "seenAt" | "startedAt">,
  seat: Seat,
  cards: readonly TriviaCard[],
  random: () => number,
  now: number,
): { hands: Record<Seat, number[]>; seenAt: Record<string, number> } {
  if (game.hands[seat].length >= HAND_SIZE) return { hands: game.hands, seenAt: game.seenAt };
  const hand = [...game.hands[seat]];
  const seenAt = { ...game.seenAt };
  const inHands = new Set([...game.hands.A, ...game.hands.B]);
  const genreOf = new Map(cards.map((c) => [c.id, c.genre]));
  const genres = new Set(hand.map((id) => genreOf.get(id)));
  const take = (id: number) => {
    hand.push(id);
    inHands.add(id);
    genres.add(genreOf.get(id));
    seenAt[String(id)] = now;
  };

  // 1. まだ2人とも出会っていない問題（ジャンルがかぶらないものを優先）
  const fresh = shuffled(
    cards.filter((c) => !(String(c.id) in seenAt) && !inHands.has(c.id)),
    random,
  );
  while (hand.length < HAND_SIZE && fresh.length > 0) {
    const i = fresh.findIndex((c) => !genres.has(c.genre));
    const [card] = fresh.splice(Math.max(i, 0), 1);
    take(card.id);
  }

  // 2. 足りなければ、この対戦より前に出会った問題を古い順に
  if (hand.length < HAND_SIZE) {
    const old = shuffled(
      cards.filter((c) => {
        const t = seenAt[String(c.id)];
        return t !== undefined && t < game.startedAt && !inHands.has(c.id);
      }),
      random,
    ).sort((a, b) => seenAt[String(a.id)] - seenAt[String(b.id)]);
    for (const card of old) {
      if (hand.length >= HAND_SIZE) break;
      take(card.id);
    }
  }

  // 3. それでも1枚もない（問題が極端に少ない）ときは、手札にないものから
  if (hand.length === 0) {
    const any = cards.find((c) => !inHands.has(c.id));
    if (any) take(any.id);
  }

  return { hands: { ...game.hands, [seat]: hand }, seenAt };
}

/** 持ち越しの手札を、存在するカードだけ・2人で重複なし・最大 HAND_SIZE 枚にそろえる */
export function cleanHands(
  raw: Partial<Record<Seat, unknown>> | undefined,
  cards: readonly TriviaCard[],
): Record<Seat, number[]> {
  const ids = new Set(cards.map((c) => c.id));
  const used = new Set<number>();
  const pick = (list: unknown) => {
    const out: number[] = [];
    for (const id of Array.isArray(list) ? list : []) {
      if (out.length >= HAND_SIZE) break;
      if (typeof id === "number" && ids.has(id) && !used.has(id)) {
        used.add(id);
        out.push(id);
      }
    }
    return out;
  };
  return { A: pick(raw?.A), B: pick(raw?.B) };
}

function startGame(state: RoomState, ctx: RuleContext): Game {
  const firstPlayer = resolveFirstPlayer(state.settings.firstPlayer, ctx.random);
  const startedAt = ctx.now();
  const base = {
    hands: cleanHands(ctx.deal?.hands, ctx.cards),
    seenAt: { ...(ctx.deal?.seenAt ?? {}) },
    startedAt,
  };
  const { hands, seenAt } = refillHand(base, firstPlayer, ctx.cards, ctx.random, startedAt);
  return {
    id: ctx.newId(),
    startedAt,
    round: 1,
    firstPlayer,
    questioner: firstPlayer,
    phase: "select",
    scores: { A: 0, B: 0 },
    hands,
    seenAt,
    cardId: null,
    acks: [],
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
      if (!game.hands[seat].includes(action.cardId)) return null;
      return {
        ...state,
        game: {
          ...game,
          phase: "guess",
          cardId: action.cardId,
          hands: { ...game.hands, [seat]: game.hands[seat].filter((id) => id !== action.cardId) },
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
          // 回答者もこの問題に出会った
          seenAt: { ...game.seenAt, [String(card.id)]: ctx.now() },
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
      const questioner = other(game.questioner);
      const { hands, seenAt } = refillHand(game, questioner, ctx.cards, ctx.random, ctx.now());
      return {
        ...state,
        game: {
          ...game,
          round: game.round + 1,
          questioner,
          phase: "select",
          hands,
          seenAt,
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
    typeof g.id === "string" &&
    typeof g.startedAt === "number" &&
    typeof g.round === "number" &&
    isSeat(g.questioner) &&
    isSeat(g.firstPlayer) &&
    (g.phase === "select" || g.phase === "guess" || g.phase === "result" || g.phase === "over") &&
    typeof g.scores?.A === "number" &&
    typeof g.scores?.B === "number" &&
    Array.isArray(g.hands?.A) &&
    Array.isArray(g.hands?.B) &&
    !!g.seenAt &&
    typeof g.seenAt === "object" &&
    Array.isArray(g.acks) &&
    Array.isArray(g.history) &&
    (g.winner === null || isSeat(g.winner))
  );
}
