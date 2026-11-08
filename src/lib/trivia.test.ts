import { describe, expect, it } from "vitest";
import { GENRES } from "@/lib/domain/game";
import { TRIVIA, getCard } from "./trivia";

describe("問題データ", () => {
  it("ID と文が重複していない", () => {
    expect(new Set(TRIVIA.map((c) => c.id)).size).toBe(TRIVIA.length);
    expect(new Set(TRIVIA.map((c) => c.text)).size).toBe(TRIVIA.length);
  });

  it("すべての問題に、正しいジャンル・本当かウソか・解説がある", () => {
    const genres = new Set(GENRES.map((g) => g.id));
    for (const c of TRIVIA) {
      expect(genres.has(c.genre), `${c.id} のジャンル`).toBe(true);
      expect(typeof c.isTrue, `${c.id} の答え`).toBe("boolean");
      expect(c.text.length, `${c.id} の文`).toBeGreaterThan(5);
      expect(c.explanation.length, `${c.id} の解説`).toBeGreaterThan(10);
      expect(c.explanation, `${c.id} の解説が問題文の繰り返しになっていない`).not.toBe(c.text);
    }
  });

  it("各ジャンルに十分な問題があり、本当とウソの数が偏っていない", () => {
    for (const g of GENRES) {
      const list = TRIVIA.filter((c) => c.genre === g.id);
      expect(list.length, g.label).toBeGreaterThanOrEqual(30);
      const trueRate = list.filter((c) => c.isTrue).length / list.length;
      expect(trueRate, `${g.label} の本当の割合`).toBeGreaterThan(0.35);
      expect(trueRate, `${g.label} の本当の割合`).toBeLessThan(0.65);
    }
  });

  it("ID で問題を引ける", () => {
    expect(getCard(TRIVIA[0].id)).toBe(TRIVIA[0]);
    expect(getCard(999999)).toBeNull();
    expect(getCard(null)).toBeNull();
  });
});
