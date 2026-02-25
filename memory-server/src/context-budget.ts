export interface BudgetEntry {
  id: string;
  score: number;
  content: string;
}

export function allocateBudget(entries: BudgetEntry[], maxTokens: number): BudgetEntry[] {
  if (maxTokens <= 0) {
    return [];
  }

  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const selected: BudgetEntry[] = [];
  let usedTokens = 0;

  for (const entry of sorted) {
    const estimatedTokens = Math.ceil(entry.content.length / 4);
    if (estimatedTokens <= 0) {
      continue;
    }
    if (usedTokens + estimatedTokens > maxTokens) {
      continue;
    }
    selected.push(entry);
    usedTokens += estimatedTokens;
  }

  return selected;
}
