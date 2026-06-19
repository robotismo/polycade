/**
 * High-score persistence. Everything goes through the `ScoreStore` interface so
 * a cloud leaderboard (v2) can replace the localStorage implementation without
 * any game or shell code changing.
 */

export interface ScoreEntry {
  gameId: string;
  score: number;
  /** Epoch ms. Injected by the caller so the store itself stays pure/testable. */
  ts: number;
  initials?: string;
}

export interface ScoreStore {
  /** Best score for a game, or 0 if none. */
  getBest(gameId: string): number;
  /** Top N entries for a game, highest first. */
  getTop(gameId: string, n?: number): ScoreEntry[];
  /** Record a score; returns the updated top-N for that game. */
  submit(entry: ScoreEntry): ScoreEntry[];
  /** Wipe one game's scores, or all if no id given. */
  clear(gameId?: string): void;
}

const KEY = 'polycade.scores.v1';
const MAX_PER_GAME = 10;

type ScoreTable = Record<string, ScoreEntry[]>;

/** Pure ranking helper, unit-tested independently of storage. */
export function rankInto(
  table: ScoreTable,
  entry: ScoreEntry,
  maxPerGame = MAX_PER_GAME,
): ScoreEntry[] {
  const list = (table[entry.gameId] ?? []).slice();
  list.push(entry);
  list.sort((a, b) => b.score - a.score || a.ts - b.ts);
  const trimmed = list.slice(0, maxPerGame);
  table[entry.gameId] = trimmed;
  return trimmed;
}

/** Minimal storage shape so tests can inject an in-memory backend. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryKeyValue implements KeyValue {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

export class LocalScoreStore implements ScoreStore {
  private backend: KeyValue;

  constructor(backend?: KeyValue) {
    this.backend = backend ?? safeLocalStorage();
  }

  private read(): ScoreTable {
    try {
      const raw = this.backend.getItem(KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as ScoreTable) : {};
    } catch {
      return {};
    }
  }

  private write(table: ScoreTable): void {
    try {
      this.backend.setItem(KEY, JSON.stringify(table));
    } catch {
      /* storage full / disabled — scores simply don't persist this session */
    }
  }

  getBest(gameId: string): number {
    return this.read()[gameId]?.[0]?.score ?? 0;
  }

  getTop(gameId: string, n = MAX_PER_GAME): ScoreEntry[] {
    return (this.read()[gameId] ?? []).slice(0, n);
  }

  submit(entry: ScoreEntry): ScoreEntry[] {
    const table = this.read();
    const top = rankInto(table, entry);
    this.write(table);
    return top;
  }

  clear(gameId?: string): void {
    if (!gameId) {
      this.backend.removeItem(KEY);
      return;
    }
    const table = this.read();
    delete table[gameId];
    this.write(table);
  }
}

function safeLocalStorage(): KeyValue {
  try {
    const ls = globalThis.localStorage;
    const probe = '__polycade_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return new MemoryKeyValue();
  }
}
