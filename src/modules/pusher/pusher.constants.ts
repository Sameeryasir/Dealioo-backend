export const PUSHER_EVENT = {
  EXECUTION_COMPLETED: 'execution-completed',
  EXECUTION_FAILED: 'execution-failed',
  CHAT_MESSAGE_SENT: 'chat-message-sent',
} as const;

export function pusherExecutionChannel(executionId: number): string {
  return `automation-execution-${executionId}`;
}

export function pusherAutomationChannel(automationId: number): string {
  return `automation-${automationId}`;
}

export function pusherRestaurantChatChannel(restaurantId: number): string {
  return `restaurant-chat-${restaurantId}`;
}
