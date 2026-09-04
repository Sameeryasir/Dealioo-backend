import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { QueryFailedError, Repository } from 'typeorm';
import { StripeWebhookEvent } from '../../db/entities/stripe-webhook-event.entity';
import { errorStripePayment, logStripePayment } from './payment-logger';

type StripeWebhookEventPayload = ReturnType<
  InstanceType<typeof Stripe>['webhooks']['constructEvent']
>;

export type WebhookHandler = (
  event: StripeWebhookEventPayload,
  connectedAccountId?: string,
) => Promise<void>;

@Injectable()
export class StripeWebhookService {
  constructor(
    @InjectRepository(StripeWebhookEvent)
    private readonly webhookEventRepository: Repository<StripeWebhookEvent>,
  ) {}

  async processOnce(
    event: StripeWebhookEventPayload,
    handler: WebhookHandler,
  ): Promise<{ received: boolean; skipped: boolean }> {
    return this.webhookEventRepository.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        event.id,
      ]);

      const repo = manager.getRepository(StripeWebhookEvent);
      let ledger = await repo.findOne({
        where: { stripeEventId: event.id },
      });

      if (ledger?.processedAt) {
        logStripePayment({
          phase: 'webhook_skip_duplicate',
          outcome: 'already_processed',
          eventId: event.id,
          eventType: event.type,
        });
        return { received: true, skipped: true };
      }

      if (!ledger) {
        ledger = repo.create({
          stripeEventId: event.id,
          eventType: event.type,
          processedAt: null,
          lastError: null,
        });
        try {
          await repo.save(ledger);
        } catch (err) {
          if (err instanceof QueryFailedError) {
            const again = await repo.findOne({
              where: { stripeEventId: event.id },
            });
            if (again?.processedAt) {
              return { received: true, skipped: true };
            }
            ledger = again ?? ledger;
          } else {
            throw err;
          }
        }
      }

      if (!ledger?.id) {
        throw new Error('Webhook ledger row missing after insert.');
      }

      try {
        await handler(event, event.account ?? undefined);
        await repo.update(ledger.id, {
          processedAt: new Date(),
          lastError: null,
        });
        logStripePayment({
          phase: 'webhook_processed',
          outcome: 'success',
          eventId: event.id,
          eventType: event.type,
        });
        return { received: true, skipped: false };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await repo.update(ledger.id, {
          lastError: message.slice(0, 2000),
        });
        errorStripePayment({
          phase: 'webhook_handler_failed',
          outcome: 'error',
          eventId: event.id,
          eventType: event.type,
          error: message,
        });
        throw err;
      }
    });
  }
}
