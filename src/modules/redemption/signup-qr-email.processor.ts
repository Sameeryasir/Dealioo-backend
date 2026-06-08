import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  SIGNUP_QR_EMAIL_QUEUE,
  SignupQrEmailJobName,
} from './signup-qr-email.constants';
import { SignupQrEmailService } from './signup-qr-email.service';
import type { SendSignupQrEmailJob } from './signup-qr-email.types';

@Processor(SIGNUP_QR_EMAIL_QUEUE, { concurrency: 2 })
export class SignupQrEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(SignupQrEmailProcessor.name);

  constructor(private readonly signupQrEmailService: SignupQrEmailService) {
    super();
  }

  async process(job: Job<SendSignupQrEmailJob>): Promise<void> {
    if (job.name !== SignupQrEmailJobName.SEND_IF_UNPAID) {
      return;
    }

    const { funnelId, customerId, couponId } = job.data;
    this.logger.log(
      `Processing delayed signup pass email for coupon ${couponId} (customer ${customerId}, funnel ${funnelId})`,
    );
    await this.signupQrEmailService.sendSignupQrEmailIfStillUnpaid({
      funnelId,
      customerId,
      couponId,
    });
  }
}
