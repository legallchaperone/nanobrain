import { CreditTracker } from "./credit-tracker.js";
import { MemoryStore } from "./memory-store.js";
import { MemoryType } from "./types.js";

export interface WeightedResult {
  id: string;
  name: string;
  type: "entity" | "episode";
  category: string;
  path: string;
  content: string;
  tags: string[];
  relevanceScore: number;
  creditScore: number;
  combinedScore: number;
}

export async function creditWeightedSearch(
  query: string,
  memoryStore: MemoryStore,
  creditTracker: CreditTracker,
  limit = 5,
  type?: MemoryType,
): Promise<WeightedResult[]> {
  const candidates = await memoryStore.search(query, type, Math.max(limit * 4, 10));
  const weighted = candidates.map((candidate) => {
    const creditScore = creditTracker.getScore(candidate.id);
    const combinedScore = candidate.relevanceScore * 0.4 + creditScore * 0.6;
    return {
      ...candidate,
      creditScore,
      combinedScore,
    };
  });

  return weighted
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, Math.max(1, Math.min(20, limit)));
}
