export const PUSHER_EVENT = {
  EXECUTION_COMPLETED: 'execution-completed',
  EXECUTION_FAILED: 'execution-failed',
  CHAT_CONVERSATION_UPDATED: 'chat-conversation-updated',
  CHAT_MESSAGE_SENT: 'chat-message-sent',
} as const;

export function pusherExecutionChannel(executionId: number): string {
  return `automation-execution-${executionId}`;
}

export function pusherAutomationChannel(automationId: number): string {
  return `automation-${automationId}`;
}

export const PUSHER_PRIVATE_CHANNEL_PREFIX = 'private-';

export function pusherBusinessConversationsChannel(businessId: number): string {
  return `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-conversations-${businessId}`;
}

export function pusherConversationMessagesChannel(
  businessId: number,
  conversationId: number,
): string {
  return `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-conversation-messages-${businessId}-${conversationId}`;
}

export function parseBusinessIdFromChatChannel(
  channelName: string,
): number | null {
  const conversationsPrefix = `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-conversations-`;
  if (channelName.startsWith(conversationsPrefix)) {
    const businessId = Number(channelName.slice(conversationsPrefix.length));
    return Number.isFinite(businessId) && businessId > 0 ? businessId : null;
  }

  const conversationMessagesMatch = channelName.match(
    /^private-business-conversation-messages-(\d+)-(\d+)$/,
  );
  if (conversationMessagesMatch) {
    const businessId = Number(conversationMessagesMatch[1]);
    const conversationId = Number(conversationMessagesMatch[2]);
    if (
      Number.isFinite(businessId) &&
      businessId > 0 &&
      Number.isFinite(conversationId) &&
      conversationId > 0
    ) {
      return businessId;
    }
    return null;
  }

  return null;
}

export function isAuthorizedBusinessChatChannel(
  channelName: string,
  businessId: number,
): boolean {
  if (channelName === pusherBusinessConversationsChannel(businessId)) {
    return true;
  }

  const conversationMessagesMatch = channelName.match(
    new RegExp(
      `^private-business-conversation-messages-${businessId}-(\\d+)$`,
    ),
  );
  if (!conversationMessagesMatch) {
    return false;
  }

  const conversationId = Number(conversationMessagesMatch[1]);
  return Number.isFinite(conversationId) && conversationId > 0;
}
