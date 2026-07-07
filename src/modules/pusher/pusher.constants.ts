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

export const PUSHER_PRIVATE_CHANNEL_PREFIX = 'private-';

export function pusherRestaurantChatChannel(restaurantId: number): string {
  return `${PUSHER_PRIVATE_CHANNEL_PREFIX}restaurant-chat-${restaurantId}`;
}

export function parseRestaurantIdFromChatChannel(
  channelName: string,
): number | null {
  const prefix = `${PUSHER_PRIVATE_CHANNEL_PREFIX}restaurant-chat-`;
  if (!channelName.startsWith(prefix)) {
    return null;
  }

  const restaurantId = Number(channelName.slice(prefix.length));
  return Number.isFinite(restaurantId) && restaurantId > 0 ? restaurantId : null;
}
