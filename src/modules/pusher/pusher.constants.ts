export const PUSHER_EVENT = {
  EXECUTION_COMPLETED: 'execution-completed',
  EXECUTION_FAILED: 'execution-failed',
} as const;

export function pusherExecutionChannel(executionId: number): string {
  return `automation-execution-${executionId}`;
}
