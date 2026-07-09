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

export function pusherBusinessChatChannel(businessId: number): string {
  return `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-chat-${businessId}`;
}

export function parseBusinessIdFromChatChannel(
  channelName: string,
): number | null {
  const prefix = `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-chat-`;
  if (!channelName.startsWith(prefix)) {
    return null;
  }

  const businessId = Number(channelName.slice(prefix.length));
  return Number.isFinite(businessId) && businessId > 0 ? businessId : null;
}
