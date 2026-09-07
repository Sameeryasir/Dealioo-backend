export class AutomationRetryableError extends Error {
  readonly retryable = true as const;

  constructor(message: string) {
    super(message);
    this.name = 'AutomationRetryableError';
  }
}

export function isAutomationRetryableError(
  error: unknown,
): error is AutomationRetryableError {
  return (
    error instanceof AutomationRetryableError ||
    (typeof error === 'object' &&
      error != null &&
      (error as { retryable?: unknown }).retryable === true)
  );
}
