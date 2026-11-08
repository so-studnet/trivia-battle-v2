import type { TriviaCard } from "@/lib/domain/game";
import data from "@/data/trivia.json";

/** 出題に使う雑学（120問。半分が本当、半分がウソ） */
export const TRIVIA: readonly TriviaCard[] = data as TriviaCard[];

const byId = new Map(TRIVIA.map((c) => [c.id, c]));

export function getCard(id: number | null | undefined): TriviaCard | null {
  return id == null ? null : (byId.get(id) ?? null);
}
