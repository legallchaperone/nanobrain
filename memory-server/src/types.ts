export type MemoryType = "entity" | "episode";

export interface MemoryFrontmatter {
  id: string;
  type: MemoryType;
  category: string;
  tags: string[];
  created: string;
  updated: string;
  pinned: boolean;
}

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  category: string;
  name: string;
  path: string;
  content: string;
  tags: string[];
  created: string;
  updated: string;
  pinned: boolean;
}

export interface SearchResult extends MemoryEntry {
  relevanceScore: number;
}
