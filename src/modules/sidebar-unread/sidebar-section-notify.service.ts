import { Injectable } from '@nestjs/common';
import type { SidebarUnreadSection } from '../../db/entities/business-user-sidebar-section-read-state.entity';
import { PusherService } from '../pusher/pusher.service';

export type SidebarSectionNotifyInput = {
  businessId: number;
  section: SidebarUnreadSection;
  actorUserId?: number | null;
  occurredAt?: Date | string | null;
  description?: string | null;
};

@Injectable()
export class SidebarSectionNotifyService {
  constructor(private readonly pusherService: PusherService) {}

  notify(input: SidebarSectionNotifyInput): void {
    const businessId = Number(input.businessId);
    if (!Number.isFinite(businessId) || businessId < 1) return;

    const actorUserId = this.normalizeActorUserId(input.actorUserId);
    const occurredAt = this.toIso(input.occurredAt);

    const description =
      typeof input.description === 'string' && input.description.trim()
        ? input.description.trim()
        : null;

    void this.pusherService.notifySidebarSectionUpdated({
      businessId,
      section: input.section,
      actorUserId,
      occurredAt,
      description,
    });
  }

  notifyOrders(params: {
    businessId: number;
    actorUserId?: number | null;
    occurredAt?: Date | string | null;
  }): void {
    this.notify({
      businessId: params.businessId,
      section: 'orders',
      actorUserId: params.actorUserId,
      occurredAt: params.occurredAt,
    });
  }

  notifyActivity(params: {
    businessId: number;
    actorUserId?: number | null;
    metadata?: Record<string, unknown> | null;
    occurredAt?: Date | string | null;
  }): void {
    this.notify({
      businessId: params.businessId,
      section: 'activity',
      actorUserId:
        params.actorUserId ??
        extractActorUserIdFromMetadata(params.metadata),
      occurredAt: params.occurredAt,
    });
  }

  notifyHistory(params: {
    businessId: number;
    actorUserId?: number | null;
    occurredAt?: Date | string | null;
    description?: string | null;
  }): void {
    this.notify({
      businessId: params.businessId,
      section: 'history',
      actorUserId: params.actorUserId,
      occurredAt: params.occurredAt,
      description: params.description,
    });
  }

  normalizeActorUserId(value: unknown): number | null {
    if (value == null || value === '') return null;
    const id = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  private toIso(value: Date | string | null | undefined): string {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value);
      if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
    }
    return new Date().toISOString();
  }
}

export function extractActorUserIdFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): number | null {
  if (!metadata) return null;
  for (const key of [
    'actorUserId',
    'staffUserId',
    'paymentCollectedBy',
  ] as const) {
    const raw = metadata[key];
    if (raw == null || raw === '') continue;
    const id = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return null;
}
