import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AdminNotification,
  type AdminNotificationSource,
  type AdminNotificationType,
} from '../../db/entities/admin-notification.entity';
import { PusherService } from '../pusher/pusher.service';

export type IntegrationProvider = 'stripe' | 'meta' | 'google' | 'twilio';

const INTEGRATION_LABEL: Record<IntegrationProvider, string> = {
  stripe: 'Stripe',
  meta: 'Meta Ads',
  google: 'Google Ads',
  twilio: 'Twilio',
};

const INTEGRATION_SOURCE: Record<IntegrationProvider, AdminNotificationSource> =
  {
    stripe: 'stripe',
    meta: 'meta',
    google: 'google',
    twilio: 'system',
  };

@Injectable()
export class AdminNotificationWriter {
  private readonly logger = new Logger(AdminNotificationWriter.name);

  constructor(
    @InjectRepository(AdminNotification)
    private readonly adminNotificationRepository: Repository<AdminNotification>,
    private readonly pusherService: PusherService,
  ) {}

  /**
   * Super Admin alert when a business connects Stripe, Meta, Google Ads, or Twilio.
   * Duplicate connects of the same account are ignored via idempotencyKey.
   */
  async notifyIntegrationConnected(input: {
    provider: IntegrationProvider;
    businessId: number;
    businessName: string;
    actorUserId?: number | null;
    idempotencyKey: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    const label = INTEGRATION_LABEL[input.provider];
    await this.create({
      type: 'system',
      eventKey: `${input.provider}_connected`,
      title: `${label} integrated successfully`,
      body: `${input.businessName} integrated ${label} successfully.`,
      severity: 'success',
      actionUrl: `/admin/businesses/${input.businessId}`,
      resourceType: 'business',
      resourceId: String(input.businessId),
      actorUserId: input.actorUserId ?? null,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? null,
      source: INTEGRATION_SOURCE[input.provider],
    });
  }

  /**
   * Super Admin alert when a user pays for a Dealioo subscription plan.
   * Webhook + success-page retries share the same idempotency key.
   */
  async notifySubscriptionPurchased(input: {
    userId: number;
    userName: string;
    planName: string;
    planSlug: string;
    billingCycle: string;
    stripeSubscriptionId: string;
  }): Promise<void> {
    const userName = input.userName.trim() || `User #${input.userId}`;
    const planName = input.planName.trim() || input.planSlug;
    await this.create({
      type: 'subscription',
      eventKey: 'subscription_purchased',
      title: 'New subscription',
      body: `${userName} has subscribed to the ${planName} plan.`,
      severity: 'success',
      actionUrl: `/admin/users/${input.userId}`,
      resourceType: 'user',
      resourceId: String(input.userId),
      actorUserId: input.userId,
      idempotencyKey: `subscription_purchased:${input.userId}:${input.stripeSubscriptionId}`,
      metadata: {
        planSlug: input.planSlug,
        planName,
        billingCycle: input.billingCycle,
        stripeSubscriptionId: input.stripeSubscriptionId,
      },
      source: 'stripe',
    });
  }

  /**
   * Super Admin alert when someone submits the Book a Meeting form.
   */
  async notifyMeetingRequested(input: {
    meetingRequestId: number;
    firstName: string;
    lastName: string;
    email: string;
    businessName: string;
    actorUserId?: number | null;
  }): Promise<void> {
    const fullName =
      `${input.firstName.trim()} ${input.lastName.trim()}`.trim() ||
      input.email.trim() ||
      'Someone';
    const businessName = input.businessName.trim();
    await this.create({
      type: 'user',
      eventKey: 'meeting_requested',
      title: 'New meeting request',
      body: businessName
        ? `${fullName} requested a meeting for ${businessName}.`
        : `${fullName} requested a meeting.`,
      severity: 'info',
      actionUrl: '/admin/meeting-requests',
      resourceType: 'meeting_request',
      resourceId: String(input.meetingRequestId),
      actorUserId: input.actorUserId ?? null,
      idempotencyKey: `meeting_requested:${input.meetingRequestId}`,
      metadata: {
        email: input.email.trim().toLowerCase(),
        businessName,
      },
      source: 'user',
    });
  }

  /**
   * Super Admin alert when a Stripe / Meta / Google Ads / Twilio connect fails.
   * Each failed attempt is a new unread item and is pushed live over Pusher.
   */
  async notifyIntegrationFailed(input: {
    provider: IntegrationProvider;
    businessId: number;
    businessName: string;
    reason: string;
    actorUserId?: number | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    const label = INTEGRATION_LABEL[input.provider];
    const reason = input.reason.trim() || `${label} connection failed.`;
    await this.create({
      type: 'system',
      eventKey: `${input.provider}_failed`,
      title: `${label} integration failed`,
      body: `${input.businessName}: ${reason}`,
      severity: 'error',
      actionUrl: `/admin/businesses/${input.businessId}`,
      resourceType: 'business',
      resourceId: String(input.businessId),
      actorUserId: input.actorUserId ?? null,
      idempotencyKey: `${input.provider}_failed:${input.businessId}:${Date.now()}`,
      metadata: {
        reason,
        ...(input.metadata ?? {}),
      },
      source: INTEGRATION_SOURCE[input.provider],
    });
  }

  private async create(input: {
    type: AdminNotificationType;
    eventKey: string;
    title: string;
    body: string;
    severity: 'info' | 'success' | 'warning' | 'error';
    actionUrl: string | null;
    resourceType: string | null;
    resourceId: string | null;
    actorUserId: number | null;
    idempotencyKey: string;
    metadata: Record<string, unknown> | null;
    source: AdminNotificationSource;
  }): Promise<void> {
    try {
      const saved = await this.adminNotificationRepository.save(
        this.adminNotificationRepository.create(input),
      );
      await this.pusherService.notifyAdminNotificationCreated(saved);
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code === '23505') return;
      this.logger.warn(
        `Failed to write admin notification ${input.eventKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
