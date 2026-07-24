import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { OnboardingEvent } from '../../db/entities/onboarding-event.entity';
import {
  BUSINESS_ONBOARDING_QUEUE,
  type BusinessOnboardingPostCreateJob,
} from './business-onboarding-queue.constants';

@Processor(BUSINESS_ONBOARDING_QUEUE)
export class BusinessOnboardingQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(BusinessOnboardingQueueProcessor.name);

  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(OnboardingEvent)
    private readonly eventRepository: Repository<OnboardingEvent>,
  ) {
    super();
  }

  async process(job: Job<BusinessOnboardingPostCreateJob>): Promise<void> {
    if (job.name !== 'post_create_provisioning') {
      return;
    }

    const { businessId, ownerUserId, businessName } = job.data;
    const business = await this.businessRepository.findOne({
      where: { id: businessId },
      select: { id: true, name: true },
    });

    if (!business) {
      this.logger.warn(
        `Skipping post-create jobs; business ${businessId} not found.`,
      );
      return;
    }

    this.logger.log(
      `Provisioning post-create work for business=${businessId} owner=${ownerUserId} name=${businessName}`,
    );

    const key = `business_created:${businessId}`;
    try {
      const exists = await this.eventRepository.exists({
        where: { idempotencyKey: key },
      });
      if (!exists) {
        await this.eventRepository.save(
          this.eventRepository.create({
            userId: ownerUserId,
            eventName: 'business_created',
            idempotencyKey: key,
            metadata: { businessId, businessName: business.name },
          }),
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to record business_created event: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

  }
}
