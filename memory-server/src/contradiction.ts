import { MemoryEntry } from "./types.js";

const NEGATION_WORDS = ["not", "never", "no", "cannot", "can't", "won't", "without"];

export interface ContradictionResult {
  hasContradiction: boolean;
  conflictingId?: string;
  suggestion?: string;
}

function hasNegation(content: string): boolean {
  const lower = content.toLowerCase();
  return NEGATION_WORDS.some((word) => lower.includes(word));
}

export function detectContradiction(
  newContent: string,
  existingEntities: MemoryEntry[],
): ContradictionResult {
  const newHasNegation = hasNegation(newContent);

  for (const entity of existingEntities) {
    const existingHasNegation = hasNegation(entity.content);
    if (newHasNegation !== existingHasNegation) {
      return {
        hasContradiction: true,
        conflictingId: entity.id,
        suggestion: "Review both entries and reconcile the conflicting claim.",
      };
    }
  }

  return { hasContradiction: false };
}
