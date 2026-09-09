type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

export class TtlCache {
  private readonly store = new Map<string, CacheEntry>();

  get<T>(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    const safeTtl = Math.max(1_000, Math.round(ttlMs));
    this.store.set(key, {
      expiresAt: Date.now() + safeTtl,
      value,
    });
  }

  async getOrSet<T>(
    key: string,
    ttlMs: number,
    compute: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    this.set(key, value, ttlMs);
    return value;
  }
}

export const dashboardTtlCache = new TtlCache();

export const DASHBOARD_CACHE_TTL_MS = 45_000;
