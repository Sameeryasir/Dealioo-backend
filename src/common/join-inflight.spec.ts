import { joinInflight } from './join-inflight';

describe('joinInflight', () => {
  it('runs one compute when the same key is requested together', async () => {
    const inflight = new Map<string, Promise<number>>();
    let calls = 0;
    const start = () => {
      calls += 1;
      return Promise.resolve(7);
    };

    const [first, second] = await Promise.all([
      joinInflight(inflight, 'k', start),
      joinInflight(inflight, 'k', start),
    ]);

    expect(first).toBe(7);
    expect(second).toBe(7);
    expect(calls).toBe(1);
    expect(inflight.size).toBe(0);
  });
});
