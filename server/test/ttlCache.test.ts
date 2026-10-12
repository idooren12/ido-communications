import { describe, expect, it } from 'vitest';
import { TtlCache } from '../src/lib/ttlCache';

describe('TtlCache', () => {
  it('expires entries after the TTL', () => {
    let now = 0;
    const cache = new TtlCache<number>(1000, 10, () => now);
    cache.set('a', 1);
    now = 999;
    expect(cache.get('a')).toBe(1);
    now = 1000;
    expect(cache.get('a')).toBeUndefined();
  });

  it('never grows past its size cap, evicting the least recently used', () => {
    const cache = new TtlCache<number>(60_000, 3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a');
    cache.set('d', 4);
    expect(cache.size).toBe(3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
  });
});
