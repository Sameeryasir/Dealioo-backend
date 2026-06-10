import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { render } from '@react-email/render';
import { Queue } from 'bullmq';
import * as React from 'react';
import { DataSource, Repository } from 'typeorm';
import { Customer } from '../../db/entities/customer.entity';
import {
  Coupon,
  CouponPaymentStatus,
} from '../../db/entities/coupon.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { SignupQrWelcomeEmail } from '../../templates/automation/signup-qr-welcome-email';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { CouponService } from './coupon.service';
import {
  isBuiltinSignupPassEmailEnabled,
  resolveSignupQrEmailDelayMs,
  SIGNUP_QR_EMAIL_JOB_OPTIONS,
  SIGNUP_QR_EMAIL_QUEUE,
  SignupQrEmailJobName,
  signupQrEmailJobId,
} from './signup-qr-email.constants';
import type { SendSignupQrEmailJob } from './signup-qr-email.types';

export type ScheduleSignupQrEmailParams = {
  couponId: number;
  funnelId: number;
  customerId: number;
};

@Injectable()
export class SignupQrEmailService {
  private readonly logger = new Logger(SignupQrEmailService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(SIGNUP_QR_EMAIL_QUEUE)
    private readonly signupQrQueue: Queue<SendSignupQrEmailJob>,
    private readonly mailDeliveryService: MailDeliveryService,
    private readonly couponService: CouponService,
    @InjectRepository(Coupon)
    private readonly couponRepository: Repository<Coupon>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
  ) {}

  handlesSignupWelcomeEmail(): boolean {
    return isBuiltinSignupPassEmailEnabled();
  }

  async scheduleSignupQrEmail(
    params: ScheduleSignupQrEmailParams,
  ): Promise<void> {
    if (!this.handlesSignupWelcomeEmail()) {
      return;
    }

    const delayMs = resolveSignupQrEmailDelayMs();
    const jobId = signupQrEmailJobId(params.customerId, params.funnelId);
    const scheduledAt = new Date();

    const shouldQueue = await this.dataSource.transaction(async (manager) => {
      const coupon = await manager.findOne(Coupon, {
        where: { id: params.couponId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!coupon) {
        return false;
      }

      if (
        coupon.signupPassEmailSentAt ||
        coupon.signupPassEmailCancelledAt ||
        coupon.paymentStatus === CouponPaymentStatus.PAID
      ) {
        return false;
      }

      if (coupon.signupPassEmailScheduledAt) {
        return false;
      }

      await manager.update(Coupon, params.couponId, {
        signupPassEmailScheduledAt: scheduledAt,
      });
      return true;
    });

    if (!shouldQueue) {
      this.logger.log(
        `Skipping signup pass email schedule for coupon ${params.couponId} — already handled or paid`,
      );
      return;
    }

    await this.signupQrQueue.add(
      SignupQrEmailJobName.SEND_IF_UNPAID,
      {
        funnelId: params.funnelId,
        customerId: params.customerId,
        couponId: params.couponId,
      },
      {
        jobId,
        delay: delayMs,
        ...SIGNUP_QR_EMAIL_JOB_OPTIONS,
      },
    );

    this.logger.log(
      `Scheduled signup pass email in ${delayMs}ms for coupon ${params.couponId}`,
    );
  }

  async cancelScheduledSignupQrEmail(
    customerId: number,
    funnelId: number,
  ): Promise<void> {
    if (!this.handlesSignupWelcomeEmail()) {
      return;
    }

    const coupon = await this.couponService.findByCustomerAndFunnel(
      customerId,
      funnelId,
    );
    if (!coupon) {
      return;
    }

    const jobId = signupQrEmailJobId(customerId, funnelId);
    const job = await this.signupQrQueue.getJob(jobId);
    if (job) {
      await job.remove();
    }

    if (
      !coupon.signupPassEmailSentAt &&
      !coupon.signupPassEmailCancelledAt
    ) {
      await this.couponRepository.update(coupon.id, {
        signupPassEmailCancelledAt: new Date(),
        signupPassEmailScheduledAt: null,
      });
      this.logger.log(
        `Cancelled pending signup pass email for coupon ${coupon.id}`,
      );
    }
  }

  async sendSignupQrEmailIfStillUnpaid(
    params: ScheduleSignupQrEmailParams,
  ): Promise<void> {
    if (!this.handlesSignupWelcomeEmail()) {
      return;
    }

    const sendApproved = await this.dataSource.transaction(async (manager) => {
      const coupon = await manager.findOne(Coupon, {
        where: { id: params.couponId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!coupon) {
        return false;
      }

      if (
        coupon.signupPassEmailSentAt ||
        coupon.signupPassEmailCancelledAt
      ) {
        return false;
      }

      if (coupon.paymentStatus === CouponPaymentStatus.PAID) {
        await manager.update(Coupon, coupon.id, {
          signupPassEmailCancelledAt: new Date(),
          signupPassEmailScheduledAt: null,
        });
        return false;
      }

      const paymentConfirmed =
        await this.couponService.isPaymentConfirmed(coupon);
      if (paymentConfirmed) {
        await manager.update(Coupon, coupon.id, {
          signupPassEmailCancelledAt: new Date(),
          signupPassEmailScheduledAt: null,
        });
        return false;
      }

      return true;
    });

    if (!sendApproved) {
      this.logger.log(
        `Skipping signup pass email for coupon ${params.couponId} — paid, cancelled, or already sent`,
      );
      return;
    }

    const sent = await this.deliverSignupPassEmail(params);
    if (!sent) {
      return;
    }

    await this.couponRepository.update(params.couponId, {
      signupPassEmailSentAt: new Date(),
      signupPassEmailScheduledAt: null,
    });
  }

  private async deliverSignupPassEmail(
    params: ScheduleSignupQrEmailParams,
  ): Promise<boolean> {
    const customer = await this.customerRepository.findOne({
      where: { id: params.customerId },
    });
    const email = customer?.email?.trim();
    if (!email) {
      this.logger.warn(
        `Skipping signup pass email — missing email for customer ${params.customerId}`,
      );
      return false;
    }

    const funnel = await this.funnelRepository.findOne({
      where: { id: params.funnelId },
      relations: ['campaign'],
    });
    const campaignName =
      funnel?.campaign?.campaignName?.trim() || 'your campaign';
    const customerName = customer?.name?.trim() || 'Guest';

    const passUrl = `${getFrontendBaseUrl()}/pass/guest/${params.customerId}/${params.funnelId}`;

    const subject = `Your QR pass for ${campaignName}`;
    const html = await render(
      React.createElement(SignupQrWelcomeEmail, {
        customerName,
        subject,
        headline: 'Thanks for signing up!',
        campaignName,
        passUrl,
      }),
    );

    const text = [
      `Hi ${customerName},`,
      '',
      `Thank you for signing up for ${campaignName}!`,
      'Your QR pass is ready. Open the link below to view your pass anytime.',
      '',
      `View your pass: ${passUrl}`,
      '',
      'Best regards,',
      'Only Deals Team',
    ].join('\n');

    try {
      await this.mailDeliveryService.sendHtmlEmail({
        to: email,
        subject,
        html,
        text,
        tags: ['signup', 'qr-pass', 'unpaid'],
      });
      this.logger.log(
        `Signup pass email sent to ${email} (coupon ${params.couponId})`,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Failed to send signup pass email to ${email}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
