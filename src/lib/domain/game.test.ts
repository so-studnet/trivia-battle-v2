import { describe, expect, it } from "vitest";
import {
  type Action,
  type Genre,
  HAND_SIZE,
  type RoomState,
  type RuleContext,
  type Seat,
  type TriviaCard,
  cleanHands,
  initialRoomState,
  normalizeRoomState,
  reduce,
  refillHand,
} from "./game";

const GENRE_LIST: Genre[] = ["animals", "space", "science", "body", "geography", "history", "food", "culture"];

function makeCards(n: number, genres: Genre[] = GENRE_LIST): TriviaCard[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    text: `雑学${i + 1}`,
    isTrue: (i + 1) % 2 === 1, // 奇数が本当
    explanation: `解説${i + 1}`,
    genre: genres[i % genres.length],
  }));
}

const cards = makeCards(40);

function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

let clock = 1000;
const ctx: RuleContext = {
  cards,
  random: () => 0,
  hasGuest: true,
  now: () => ++clock,
  newId: () => "game-1",
};

function apply(state: RoomState, steps: [Seat, Action][], c: RuleContext = ctx): RoomState {
  return steps.reduce((s, [seat, action]) => {
    const next = reduce(s, seat, action, c);
    if (!next) throw new Error(`拒否された: ${seat} ${JSON.stringify(action)}`);
    return next;
  }, state);
}

function started(firstPlayer: "A" | "B" = "A", targetScore = 3, c: RuleContext = ctx): RoomState {
  return apply(
    initialRoomState(),
    [
      ["A", { type: "updateSettings", settings: { firstPlayer, targetScore } }],
      ["A", { type: "setReady", ready: true }],
      ["B", { type: "setReady", ready: true }],
      ["A", { type: "start" }],
    ],
    c,
  );
}

/** 1ターン進める（出題者は手札の先頭を出し、回答者は「本当」と答える） */
function playTurn(s: RoomState, bet: 1 | 2 | 3 = 1, c: RuleContext = ctx): RoomState {
  const g = s.game!;
  const q = g.questioner;
  const guesser = q === "A" ? "B" : "A";
  let next = apply(
    s,
    [
      [q, { type: "selectCard", cardId: g.hands[q][0] }],
      [guesser, { type: "guess", answer: true, bet }],
    ],
    c,
  );
  if (next.game!.phase === "result") {
    next = apply(next, [["A", { type: "next" }], ["B", { type: "next" }]], c);
  }
  return next;
}

describe("ロビー", () => {
  it("勝利に必要な点数の初期値は10点", () => {
    expect(initialRoomState().settings.targetScore).toBe(10);
  });

  it("両者が準備完了ならホストが開始でき、先攻に手札が配られる", () => {
    const s = started("B");
    expect(s.game?.phase).toBe("select");
    expect(s.game?.questioner).toBe("B");
    expect(s.game?.id).toBe("game-1");
    expect(s.game?.hands.B).toHaveLength(HAND_SIZE);
    expect(s.game?.hands.A).toHaveLength(0); // 後攻はまだ配られない
    expect(new Set(s.game?.hands.B).size).toBe(HAND_SIZE);
  });

  it("ゲストは開始できず、準備ができていなければ開始できない", () => {
    let s = apply(initialRoomState(), [["A", { type: "setReady", ready: true }]]);
    expect(reduce(s, "A", { type: "start" }, ctx)).toBeNull();
    s = apply(s, [["B", { type: "setReady", ready: true }]]);
    expect(reduce(s, "B", { type: "start" }, ctx)).toBeNull();
  });

  it("ゲストがいなければ開始できない", () => {
    const s = { ...initialRoomState(), ready: { A: true, B: true } };
    expect(reduce(s, "A", { type: "start" }, { ...ctx, hasGuest: false })).toBeNull();
  });

  it("設定はホストだけが変えられ、目標点は1〜10に収まる", () => {
    const s0 = initialRoomState();
    expect(
      reduce(s0, "B", { type: "updateSettings", settings: { firstPlayer: "A", targetScore: 5 } }, ctx),
    ).toBeNull();
    const s1 = reduce(s0, "A", { type: "updateSettings", settings: { firstPlayer: "B", targetScore: 99 } }, ctx);
    expect(s1?.settings).toEqual({ firstPlayer: "B", targetScore: 10 });
  });

  it("設定を変えるとゲストの準備完了が外れる", () => {
    const s = apply(initialRoomState(), [
      ["A", { type: "setReady", ready: true }],
      ["B", { type: "setReady", ready: true }],
      ["A", { type: "updateSettings", settings: { firstPlayer: "A", targetScore: 5 } }],
    ]);
    expect(s.ready).toEqual({ A: true, B: false });
  });

  it("ランダムの先攻は開始時に決まる", () => {
    const base = { ...initialRoomState(), ready: { A: true, B: true } };
    expect(reduce(base, "A", { type: "start" }, { ...ctx, random: () => 0.1 })?.game?.questioner).toBe("A");
    expect(reduce(base, "A", { type: "start" }, { ...ctx, random: () => 0.9 })?.game?.questioner).toBe("B");
  });

  it("元の state を変更しない", () => {
    const s = initialRoomState();
    const copy = structuredClone(s);
    reduce(s, "A", { type: "setReady", ready: true }, ctx);
    expect(s).toEqual(copy);
  });
});

describe("ターンの進行", () => {
  it("出題者だけが自分の手札から選べ、選んだカードは手札から消える", () => {
    const s = started("A");
    const card = s.game!.hands.A[0];
    expect(reduce(s, "B", { type: "selectCard", cardId: card }, ctx)).toBeNull();
    const notInHand = cards.find((c) => !s.game!.hands.A.includes(c.id))!.id;
    expect(reduce(s, "A", { type: "selectCard", cardId: notInHand }, ctx)).toBeNull();
    const s2 = reduce(s, "A", { type: "selectCard", cardId: card }, ctx)!;
    expect(s2.game?.phase).toBe("guess");
    expect(s2.game?.cardId).toBe(card);
    expect(s2.game?.hands.A).toHaveLength(HAND_SIZE - 1);
    expect(s2.game?.hands.A).not.toContain(card);
  });

  it("正解なら回答者に、不正解なら出題者に賭けた点が入る", () => {
    const s = started("A", 10);
    const trueCard = s.game!.hands.A.find((id) => id % 2 === 1)!;
    const correct = apply(s, [
      ["A", { type: "selectCard", cardId: trueCard }],
      ["B", { type: "guess", answer: true, bet: 2 }],
    ]);
    expect(correct.game?.scores).toEqual({ A: 0, B: 2 });
    expect(correct.game?.phase).toBe("result");
    expect(correct.game?.history[0]).toMatchObject({ correct: true, scorer: "B", bet: 2 });

    const wrong = apply(s, [
      ["A", { type: "selectCard", cardId: trueCard }],
      ["B", { type: "guess", answer: false, bet: 3 }],
    ]);
    expect(wrong.game?.scores).toEqual({ A: 3, B: 0 });
  });

  it("回答者以外は回答できず、賭け点は1〜3だけ", () => {
    const s0 = started("A");
    const s = apply(s0, [["A", { type: "selectCard", cardId: s0.game!.hands.A[0] }]]);
    expect(reduce(s, "A", { type: "guess", answer: true, bet: 1 }, ctx)).toBeNull();
    expect(reduce(s, "B", { type: "guess", answer: true, bet: 4 as 1 }, ctx)).toBeNull();
  });

  it("両者が「次へ」を押すと出題者が交代し、新しい出題者の手札が補充される", () => {
    const s = started("A", 10);
    const r = apply(s, [
      ["A", { type: "selectCard", cardId: s.game!.hands.A[0] }],
      ["B", { type: "guess", answer: true, bet: 1 }],
      ["A", { type: "next" }],
    ]);
    expect(r.game?.acks).toEqual(["A"]);
    expect(reduce(r, "A", { type: "next" }, ctx)).toBeNull(); // 2回押しても進まない
    const n = reduce(r, "B", { type: "next" }, { ...ctx, random: seq(0.5, 0.3) })!;
    expect(n.game).toMatchObject({ phase: "select", questioner: "B", round: 2, cardId: null, acks: [] });
    expect(n.game?.hands.B).toHaveLength(HAND_SIZE);
    // A の残り3枚はそのまま手札に残る
    expect(n.game?.hands.A).toEqual(r.game?.hands.A);
    // B の手札は、A の手札・出題済みのカードと重ならない
    const used = new Set([...n.game!.hands.A, s.game!.hands.A[0]]);
    expect(n.game!.hands.B.some((id) => used.has(id))).toBe(false);
  });

  it("2回目の出題では1枚だけ補充される（手札の持ち越し）", () => {
    let s = started("A", 10);
    s = playTurn(s); // A が出題 → B の番
    s = playTurn(s); // B が出題 → A の番
    expect(s.game?.questioner).toBe("A");
    expect(s.game?.hands.A).toHaveLength(HAND_SIZE);
    // 出会った問題は 4（A）+ 4（B）+ 1（A の補充）= 9 枚だけ
    expect(Object.keys(s.game!.seenAt)).toHaveLength(9);
  });

  it("目標点に届いたらその人の勝ちで終わり、もう一度で準備画面に戻る", () => {
    const s = started("A", 3);
    const trueCard = s.game!.hands.A.find((id) => id % 2 === 1)!;
    const over = apply(s, [
      ["A", { type: "selectCard", cardId: trueCard }],
      ["B", { type: "guess", answer: true, bet: 3 }],
    ]);
    expect(over.game?.phase).toBe("over");
    expect(over.game?.winner).toBe("B");
    expect(reduce(over, "A", { type: "next" }, ctx)).toBeNull();

    const again = reduce(over, "A", { type: "rematch" }, ctx)!;
    expect(again.game).toBeNull();
    expect(again.ready).toEqual({ A: false, B: false });
    expect(again.settings.targetScore).toBe(3);
  });

  it("対戦中は準備状態や設定を変えられない", () => {
    const s = started();
    expect(reduce(s, "B", { type: "setReady", ready: false }, ctx)).toBeNull();
    expect(
      reduce(s, "A", { type: "updateSettings", settings: { firstPlayer: "B", targetScore: 5 } }, ctx),
    ).toBeNull();
    expect(reduce(s, "A", { type: "rematch" }, ctx)).toBeNull();
  });
});

describe("出会った問題と手札の持ち越し", () => {
  it("出会った問題は配らない", () => {
    const seenAt = Object.fromEntries(cards.slice(0, 30).map((c) => [String(c.id), 1]));
    const s = started("A", 3, { ...ctx, deal: { seenAt, hands: { A: [], B: [] } }, random: Math.random });
    expect(s.game!.hands.A.every((id) => id > 30)).toBe(true);
  });

  it("持ち越した手札から始め、足りない分だけ補充する", () => {
    const s = started("A", 3, { ...ctx, deal: { seenAt: { "1": 5, "2": 5, "3": 5 }, hands: { A: [1, 2, 3], B: [] } } });
    expect(s.game!.hands.A.slice(0, 3)).toEqual([1, 2, 3]);
    expect(s.game!.hands.A).toHaveLength(HAND_SIZE);
    expect(Object.keys(s.game!.seenAt)).toHaveLength(4); // 新しく出会ったのは1枚だけ
  });

  it("回答者が出会った問題も記録される", () => {
    const s0 = started("A");
    const card = s0.game!.hands.A[0];
    const s = apply(s0, [
      ["A", { type: "selectCard", cardId: card }],
      ["B", { type: "guess", answer: true, bet: 1 }],
    ]);
    expect(s.game!.seenAt[String(card)]).toBeGreaterThan(0);
  });

  it("新しい問題がなくなったら、この対戦より前に出会った問題を古い順に配る", () => {
    const small = makeCards(10);
    // 1〜10 すべて出会い済み。古い順は 10, 9, 8, ...
    const seenAt = Object.fromEntries(small.map((c) => [String(c.id), 100 - c.id]));
    const r = refillHand({ hands: { A: [], B: [] }, seenAt, startedAt: 1000 }, "A", small, () => 0, 2000);
    expect(r.hands.A).toEqual([10, 9, 8, 7]);
    expect(r.seenAt["10"]).toBe(2000);
  });

  it("同じ対戦の中で出会った問題は、問題が足りなくても配り直さない", () => {
    const small = makeCards(6);
    const seenAt = Object.fromEntries(small.map((c) => [String(c.id), 1500])); // すべてこの対戦中に出会った
    const r = refillHand({ hands: { A: [], B: [1, 2] }, seenAt, startedAt: 1000 }, "A", small, () => 0, 2000);
    expect(r.hands.A).toEqual([3]); // どうしても足りないときだけ1枚
  });

  it("手札のジャンルがなるべくばらける", () => {
    const r = refillHand({ hands: { A: [], B: [] }, seenAt: {}, startedAt: 0 }, "A", cards, Math.random, 1);
    const genres = r.hands.A.map((id) => cards.find((c) => c.id === id)!.genre);
    expect(new Set(genres).size).toBe(HAND_SIZE);
  });

  it("相手の手札にあるカードは配らない", () => {
    const small = makeCards(8);
    const r = refillHand({ hands: { A: [], B: [1, 2, 3, 4] }, seenAt: {}, startedAt: 0 }, "A", small, Math.random, 1);
    expect(r.hands.A.some((id) => id <= 4)).toBe(false);
  });

  it("持ち越しの手札は、存在しない・重複したカードを除く", () => {
    expect(cleanHands({ A: [1, 999, 1, 2], B: [2, 3, "x"] }, cards)).toEqual({ A: [1, 2], B: [3] });
  });

  it("40問を最後まで使っても、1対戦の中で同じ問題は出題されない", () => {
    let s = started("A", 10, { ...ctx, random: Math.random });
    const asked: number[] = [];
    while (s.game!.phase !== "over") {
      const g = s.game!;
      asked.push(g.hands[g.questioner][0]);
      s = playTurn(s, 1, { ...ctx, random: Math.random });
    }
    expect(new Set(asked).size).toBe(asked.length);
  });
});

describe("normalizeRoomState", () => {
  it("壊れた値は初期値になる", () => {
    expect(normalizeRoomState(null)).toEqual(initialRoomState());
    expect(normalizeRoomState({ settings: { firstPlayer: "X", targetScore: "7" } })).toEqual({
      ...initialRoomState(),
      settings: { firstPlayer: "random", targetScore: 7 },
    });
    expect(normalizeRoomState({ game: { phase: "select" } }).game).toBeNull();
  });

  it("正しい対戦状態はそのまま残る", () => {
    const s = started();
    expect(normalizeRoomState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
