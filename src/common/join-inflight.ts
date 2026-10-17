export function joinInflight<T>(
  inflight: Map<string, Promise<T>>,
  key: string,
  start: () => Promise<T>,
): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing;

  const work = start();
  inflight.set(key, work);
  void work.finally(() => {
    if (inflight.get(key) === work) {
      inflight.delete(key);
    }
  });
  return work;
}
