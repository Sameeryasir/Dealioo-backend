type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

export class TtlCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

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

  delete(key: string): void {
    this.store.delete(key);
  }

  async getOrSet<T>(
    key: string,
    ttlMs: number,
    compute: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    let promise!: Promise<T>;
    promise = (async () => {
      try {
        const value = await compute();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        if (this.inFlight.get(key) === promise) {
          this.inFlight.delete(key);
        }
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}

export const dashboardTtlCache = new TtlCache();

export const DASHBOARD_CACHE_TTL_MS = 10_000;

export const AD_SPEND_CACHE_TTL_MS = 60_000;
