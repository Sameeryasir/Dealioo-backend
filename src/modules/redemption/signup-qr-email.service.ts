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
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import { getPurposeEmailDefaults } from '../automation/automation-email-catalog';
import { PaymentConfirmationEmail } from '../../templates/automation/payment-confirmation-email';
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

  async sendSignupPassEmailOnPayment(
    customerId: number,
    funnelId: number,
    funnelPaymentId?: number,
    options?: { skipDelivery?: boolean },
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

    await this.removePendingSignupPassEmailJob(customerId, funnelId);

    if (options?.skipDelivery) {
      await this.couponRepository.update(coupon.id, {
        signupPassEmailCancelledAt: new Date(),
        signupPassEmailScheduledAt: null,
      });
      this.logger.log(
        `Skipping builtin payment pass email for coupon ${coupon.id} — prepaid automation handles it`,
      );
      return;
    }

    const sendApproved = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(Coupon, {
        where: { id: coupon.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) {
        return false;
      }

      return !locked.signupPassEmailSentAt;
    });

    if (!sendApproved) {
      this.logger.log(
        `Skipping signup pass email on payment for coupon ${coupon.id} — already sent`,
      );
      return;
    }

    const sent = await this.deliverPaymentPassEmail({
      couponId: coupon.id,
      funnelId,
      customerId,
      funnelPaymentId,
    });
    if (!sent) {
      return;
    }

    await this.couponRepository.update(coupon.id, {
      signupPassEmailSentAt: new Date(),
      signupPassEmailScheduledAt: null,
      signupPassEmailCancelledAt: null,
    });

    this.logger.log(
      `Payment pass email sent for coupon ${coupon.id}`,
    );
  }

  private async removePendingSignupPassEmailJob(
    customerId: number,
    funnelId: number,
  ): Promise<void> {
    const jobId = signupQrEmailJobId(customerId, funnelId);
    const job = await this.signupQrQueue.getJob(jobId);
    if (job) {
      await job.remove();
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

  private async deliverPaymentPassEmail(
    params: ScheduleSignupQrEmailParams & { funnelPaymentId?: number },
  ): Promise<boolean> {
    const customer = await this.customerRepository.findOne({
      where: { id: params.customerId },
    });
    const email = customer?.email?.trim();
    if (!email) {
      this.logger.warn(
        `Skipping payment pass email — missing email for customer ${params.customerId}`,
      );
      return false;
    }

    const coupon = await this.couponRepository.findOne({
      where: { id: params.couponId },
    });
    if (!coupon) {
      this.logger.warn(
        `Skipping payment pass email — coupon ${params.couponId} not found`,
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
    const defaults = getPurposeEmailDefaults(
      AutomationPurpose.FUNNEL_PAYMENT,
      campaignName,
    );

    const passUrl =
      params.funnelPaymentId != null
        ? `${getFrontendBaseUrl()}/pass/${params.funnelPaymentId}`
        : `${getFrontendBaseUrl()}/pass/guest/${params.customerId}/${params.funnelId}`;

    const qr = await this.couponService.buildQrPayload(coupon);

    const subject = defaults.subject ?? 'Your payment is confirmed';
    const html = await render(
      React.createElement(PaymentConfirmationEmail, {
        customerName,
        customerEmail: email,
        subject,
        headline: defaults.headline,
        message: defaults.message,
        ctaLabel: 'View QR code online',
        ctaUrl: passUrl,
        qrImageDataUrl: qr.qrDataUrl,
      }),
    );

    const text = [
      `Hi ${customerName},`,
      '',
      defaults.message ??
        'Thank you for trusting us. Your payment is confirmed.',
      '',
      'Your coupon QR code is included in this email. You can also open it online:',
      '',
      `View QR code: ${passUrl}`,
      '',
      'Best regards,',
      'Dealioo Team',
    ].join('\n');

    try {
      await this.mailDeliveryService.sendHtmlEmail({
        to: email,
        subject,
        html,
        text,
        tags: ['payment', 'qr-pass'],
      });
      this.logger.log(
        `Payment pass email sent to ${email} (coupon ${params.couponId})`,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Failed to send payment pass email to ${email}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
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
      'Dealioo Team',
    ].join('\n');

    try {
      await this.mailDeliveryService.sendHtmlEmail({
        to: email,
        subject,
        html,
        text,
        tags: ['signup', 'qr-pass'],
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
