export const PUSHER_EVENT = {
  EXECUTION_COMPLETED: 'execution-completed',
  EXECUTION_FAILED: 'execution-failed',
  CHAT_CONVERSATION_UPDATED: 'chat-conversation-updated',
  CHAT_MESSAGE_SENT: 'chat-message-sent',
  ACTIVITY_CAMPAIGN_UPDATED: 'activity-campaign-updated',
  META_PUBLISH_PROGRESS: 'meta-publish-progress',
  AI_EDIT_UI_RESULT: 'ai-edit-ui-result',
  ADMIN_NOTIFICATION_CREATED: 'admin-notification-created',
  MEMBER_JOINED: 'member-joined',
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

export function pusherBusinessActivityChannel(businessId: number): string {
  return `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-activity-${businessId}`;
}

export function pusherBusinessMetaPublishChannel(businessId: number): string {
  return `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-meta-publish-${businessId}`;
}

export function pusherBusinessAiEditUiChannel(businessId: number): string {
  return `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-ai-edit-ui-${businessId}`;
}

export function pusherBusinessMembersChannel(businessId: number): string {
  return `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-members-${businessId}`;
}

export function pusherAdminNotificationsChannel(): string {
  return `${PUSHER_PRIVATE_CHANNEL_PREFIX}admin-notifications`;
}

export function isAdminNotificationsChannel(channelName: string): boolean {
  return channelName === pusherAdminNotificationsChannel();
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

  const activityPrefix = `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-activity-`;
  if (channelName.startsWith(activityPrefix)) {
    const businessId = Number(channelName.slice(activityPrefix.length));
    return Number.isFinite(businessId) && businessId > 0 ? businessId : null;
  }

  const metaPublishPrefix = `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-meta-publish-`;
  if (channelName.startsWith(metaPublishPrefix)) {
    const businessId = Number(channelName.slice(metaPublishPrefix.length));
    return Number.isFinite(businessId) && businessId > 0 ? businessId : null;
  }

  const aiEditUiPrefix = `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-ai-edit-ui-`;
  if (channelName.startsWith(aiEditUiPrefix)) {
    const businessId = Number(channelName.slice(aiEditUiPrefix.length));
    return Number.isFinite(businessId) && businessId > 0 ? businessId : null;
  }

  const membersPrefix = `${PUSHER_PRIVATE_CHANNEL_PREFIX}business-members-`;
  if (channelName.startsWith(membersPrefix)) {
    const businessId = Number(channelName.slice(membersPrefix.length));
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

  if (channelName === pusherBusinessActivityChannel(businessId)) {
    return true;
  }

  if (channelName === pusherBusinessMetaPublishChannel(businessId)) {
    return true;
  }

  if (channelName === pusherBusinessAiEditUiChannel(businessId)) {
    return true;
  }

  if (channelName === pusherBusinessMembersChannel(businessId)) {
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
