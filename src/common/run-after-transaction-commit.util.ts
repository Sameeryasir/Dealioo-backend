import type { EntityManager, QueryRunner } from 'typeorm';

const AFTER_COMMIT_KEY = '__retentionAfterCommitCallbacks';

type AfterCommitBag = {
  callbacks: Array<() => void>;
  patched: boolean;
};

export function runAfterTransactionCommit(
  manager: EntityManager,
  callback: () => void,
): void {
  const runner = manager.queryRunner;
  if (!runner || !runner.isTransactionActive) {
    callback();
    return;
  }

  ensureCommitHook(runner).callbacks.push(callback);
}

function ensureCommitHook(runner: QueryRunner): AfterCommitBag {
  const data = runner.data as Record<string, unknown>;
  let bag = data[AFTER_COMMIT_KEY] as AfterCommitBag | undefined;
  if (bag?.patched) {
    return bag;
  }

  bag = { callbacks: bag?.callbacks ?? [], patched: true };
  data[AFTER_COMMIT_KEY] = bag;

  const originalCommit = runner.commitTransaction.bind(runner);
  const originalRollback = runner.rollbackTransaction.bind(runner);

  runner.commitTransaction = async () => {
    await originalCommit();
    const callbacks = bag!.callbacks.splice(0, bag!.callbacks.length);
    for (const cb of callbacks) {
      try {
        cb();
      } catch {
      }
    }
  };

  runner.rollbackTransaction = async () => {
    bag!.callbacks.splice(0, bag!.callbacks.length);
    await originalRollback();
  };

  return bag;
}
