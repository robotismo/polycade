import { describe, it, expect } from 'vitest';
import {
  rankInto,
  LocalScoreStore,
  MemoryKeyValue,
  type ScoreEntry,
} from '../../src/score/store';

const entry = (gameId: string, score: number, ts: number): ScoreEntry => ({ gameId, score, ts });

describe('rankInto', () => {
  it('orders by score descending', () => {
    const table: Record<string, ScoreEntry[]> = {};
    rankInto(table, entry('a', 10, 1));
    rankInto(table, entry('a', 30, 2));
    rankInto(table, entry('a', 20, 3));
    expect(table.a.map((e) => e.score)).toEqual([30, 20, 10]);
  });

  it('breaks ties by earlier timestamp first', () => {
    const table: Record<string, ScoreEntry[]> = {};
    rankInto(table, entry('a', 10, 5));
    rankInto(table, entry('a', 10, 2));
    expect(table.a.map((e) => e.ts)).toEqual([2, 5]);
  });

  it('keeps only the top N', () => {
    const table: Record<string, ScoreEntry[]> = {};
    for (let i = 0; i < 25; i++) rankInto(table, entry('a', i, i), 10);
    expect(table.a).toHaveLength(10);
    expect(table.a[0].score).toBe(24);
    expect(table.a[9].score).toBe(15);
  });

  it('keeps games independent', () => {
    const table: Record<string, ScoreEntry[]> = {};
    rankInto(table, entry('a', 5, 1));
    rankInto(table, entry('b', 99, 1));
    expect(table.a[0].score).toBe(5);
    expect(table.b[0].score).toBe(99);
  });
});

describe('LocalScoreStore', () => {
  it('records and reports best per game', () => {
    const store = new LocalScoreStore(new MemoryKeyValue());
    expect(store.getBest('updraft')).toBe(0);
    store.submit(entry('updraft', 7, 100));
    store.submit(entry('updraft', 3, 200));
    store.submit(entry('coil', 12, 150));
    expect(store.getBest('updraft')).toBe(7);
    expect(store.getBest('coil')).toBe(12);
  });

  it('persists across store instances sharing a backend (reload round-trip)', () => {
    const backend = new MemoryKeyValue();
    new LocalScoreStore(backend).submit(entry('rally', 42, 1));
    const reloaded = new LocalScoreStore(backend);
    expect(reloaded.getBest('rally')).toBe(42);
  });

  it('returns top-N highest first', () => {
    const store = new LocalScoreStore(new MemoryKeyValue());
    [5, 9, 1, 7].forEach((s, i) => store.submit(entry('shatter', s, i)));
    expect(store.getTop('shatter', 3).map((e) => e.score)).toEqual([9, 7, 5]);
  });

  it('clears one game without touching others', () => {
    const store = new LocalScoreStore(new MemoryKeyValue());
    store.submit(entry('a', 1, 1));
    store.submit(entry('b', 2, 1));
    store.clear('a');
    expect(store.getBest('a')).toBe(0);
    expect(store.getBest('b')).toBe(2);
  });

  it('survives corrupt storage gracefully', () => {
    const backend = new MemoryKeyValue();
    backend.setItem('polycade.scores.v1', '{not json');
    const store = new LocalScoreStore(backend);
    expect(store.getBest('a')).toBe(0);
    expect(() => store.submit(entry('a', 1, 1))).not.toThrow();
  });
});
