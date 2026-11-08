import { describe, expect, it } from "vitest";
import {
  type Action,
  type RoomState,
  type RuleContext,
  type Seat,
  type TriviaCard,
  drawHand,
  initialRoomState,
  normalizeRoomState,
  reduce,
} from "./game";

const cards: TriviaCard[] = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  text: `雑学${i + 1}`,
  isTrue: (i + 1) % 2 === 1, // 奇数が本当
  explanation: `解説${i + 1}`,
}));

function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

const ctx: RuleContext = { cards, random: () => 0, hasGuest: true };

function apply(state: RoomState, steps: [Seat, Action][], c: RuleContext = ctx): RoomState {
  return steps.reduce((s, [seat, action]) => {
    const next = reduce(s, seat, action, c);
    if (!next) throw new Error(`拒否された: ${seat} ${JSON.stringify(action)}`);
    return next;
  }, state);
}

function started(firstPlayer: "A" | "B" = "A", targetScore = 3): RoomState {
  return apply(initialRoomState(), [
    ["A", { type: "updateSettings", settings: { firstPlayer, targetScore } }],
    ["A", { type: "setReady", ready: true }],
    ["B", { type: "setReady", ready: true }],
    ["A", { type: "start" }],
  ]);
}

describe("ロビー", () => {
  it("両者が準備完了ならホストが開始できる", () => {
    const s = started("B");
    expect(s.game?.phase).toBe("select");
    expect(s.game?.questioner).toBe("B");
    expect(s.game?.hand).toHaveLength(4);
    expect(new Set(s.game?.hand).size).toBe(4);
  });

  it("ゲストは開始できず、準備ができていなければ開始できない", () => {
    let s = apply(initialRoomState(), [["A", { type: "setReady", ready: true }]]);
    expect(reduce(s, "A", { type: "start" }, ctx)).toBeNull();
    s = apply(s, [["B", { type: "setReady", ready: true }]]);
    expect(reduce(s, "B", { type: "start" }, ctx)).toBeNull();
  });

  it("ゲストがいなければ開始できない", () => {
    const s = apply(initialRoomState(), [["A", { type: "setReady", ready: true }]]);
    const withReady = { ...s, ready: { A: true, B: true } };
    expect(reduce(withReady, "A", { type: "start" }, { ...ctx, hasGuest: false })).toBeNull();
  });

  it("設定はホストだけが変えられ、目標点は1〜10に収まる", () => {
    const s0 = initialRoomState();
    expect(
      reduce(s0, "B", { type: "updateSettings", settings: { firstPlayer: "A", targetScore: 5 } }, ctx),
    ).toBeNull();
    const s1 = reduce(
      s0,
      "A",
      { type: "updateSettings", settings: { firstPlayer: "B", targetScore: 99 } },
      ctx,
    );
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
  it("出題者だけが手札から選べる", () => {
    const s = started("A");
    const card = s.game!.hand[0];
    expect(reduce(s, "B", { type: "selectCard", cardId: card }, ctx)).toBeNull();
    const notInHand = cards.find((c) => !s.game!.hand.includes(c.id))!.id;
    expect(reduce(s, "A", { type: "selectCard", cardId: notInHand }, ctx)).toBeNull();
    const s2 = reduce(s, "A", { type: "selectCard", cardId: card }, ctx)!;
    expect(s2.game?.phase).toBe("guess");
    expect(s2.game?.usedIds).toContain(card);
  });

  it("正解なら回答者に、不正解なら出題者に賭けた点が入る", () => {
    const s = started("A", 10);
    const trueCard = s.game!.hand.find((id) => id % 2 === 1)!;
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
    const s = apply(started("A"), [["A", { type: "selectCard", cardId: started("A").game!.hand[0] }]]);
    expect(reduce(s, "A", { type: "guess", answer: true, bet: 1 }, ctx)).toBeNull();
    expect(reduce(s, "B", { type: "guess", answer: true, bet: 4 as 1 }, ctx)).toBeNull();
  });

  it("両者が「次へ」を押すと出題者が交代して新しい手札が配られる", () => {
    const s = started("A", 10);
    const r = apply(s, [
      ["A", { type: "selectCard", cardId: s.game!.hand[0] }],
      ["B", { type: "guess", answer: true, bet: 1 }],
      ["A", { type: "next" }],
    ]);
    expect(r.game?.phase).toBe("result");
    expect(r.game?.acks).toEqual(["A"]);
    expect(reduce(r, "A", { type: "next" }, ctx)).toBeNull(); // 2回押しても進まない
    const n = reduce(r, "B", { type: "next" }, { ...ctx, random: seq(0.5, 0.3) })!;
    expect(n.game).toMatchObject({ phase: "select", questioner: "B", round: 2, cardId: null, acks: [] });
    expect(n.game?.hand).toHaveLength(4);
    expect(n.game?.hand).not.toContain(s.game!.hand[0]);
  });

  it("目標点に届いたらその人の勝ちで終わる", () => {
    const s = started("A", 3);
    const trueCard = s.game!.hand.find((id) => id % 2 === 1)!;
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

describe("drawHand", () => {
  it("使用済みを除いて重複なく配る", () => {
    const { hand, usedIds } = drawHand(cards, [1, 2, 3], Math.random);
    expect(hand).toHaveLength(4);
    expect(new Set(hand).size).toBe(4);
    expect(hand.some((id) => [1, 2, 3].includes(id))).toBe(false);
    expect(usedIds).toEqual([1, 2, 3]);
  });

  it("残りが4枚未満なら使用済みをリセットする", () => {
    const used = cards.slice(0, 7).map((c) => c.id);
    const r = drawHand(cards, used, Math.random);
    expect(r.usedIds).toEqual([]);
    expect(r.hand).toHaveLength(4);
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
