import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { In, Repository } from 'typeorm';
import { CheckoutAccessToken } from '../../db/entities/checkout-access-token.entity';
import { Customer } from '../../db/entities/customer.entity';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';

export type CheckoutResumeContext = {
  customerId: number;
  customerEmail: string;
  customerName: string;
  customerPhone: string | null;
  funnelId: number;
  businessId: number;
  campaignId: number | null;
  funnelPaymentId: number | null;
};

export type IssuedCheckoutLink = {
  token: string;
  checkoutUrl: string;
  session: CheckoutResumeContext;
};

const DEFAULT_TOKEN_TTL_DAYS = 14;

@Injectable()
export class CheckoutResumeService {
  constructor(
    @InjectRepository(CheckoutAccessToken)
    private readonly tokenRepository: Repository<CheckoutAccessToken>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
  ) {}

  async createSession(input: {
    customerId: number;
    funnelId: number;
    businessId: number;
    campaignId: number | null;
  }): Promise<IssuedCheckoutLink> {
    const customer = await this.customerRepository.findOne({
      where: { id: input.customerId },
    });
    if (!customer?.email?.trim()) {
      throw new BadRequestException('Customer email is required for checkout.');
    }

    const pendingPayment = await this.findLatestOpenPayment(
      input.funnelId,
      customer.email.trim(),
    );

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const expiresAt = this.resolveExpiryDate();

    await this.tokenRepository.save(
      this.tokenRepository.create({
        tokenHash,
        customerId: input.customerId,
        funnelId: input.funnelId,
        businessId: input.businessId,
        campaignId: input.campaignId,
        funnelPaymentId: pendingPayment?.id ?? null,
        expiresAt,
      }),
    );

    const session = this.toResumeContext(customer, {
      funnelId: input.funnelId,
      businessId: input.businessId,
      campaignId: input.campaignId,
      funnelPaymentId: pendingPayment?.id ?? null,
    });

    return {
      token,
      checkoutUrl: this.buildCheckoutUrl({
        funnelId: input.funnelId,
        businessId: input.businessId,
        campaignId: input.campaignId,
        token,
      }),
      session,
    };
  }

  async resolveSession(token: string): Promise<CheckoutResumeContext> {
    const row = await this.loadActiveToken(token);
    const customer = row.customer;
    if (!customer?.email?.trim()) {
      throw new NotFoundException('Customer record is no longer available.');
    }

    let funnelPaymentId = row.funnelPaymentId;
    if (funnelPaymentId != null) {
      const payment = await this.funnelPaymentRepository.findOne({
        where: { id: funnelPaymentId },
      });
      // Keep paid IDs so confirmation can verify status — only drop missing rows.
      if (!payment) {
        funnelPaymentId = null;
      }
    }

    if (funnelPaymentId == null) {
      const pendingPayment = await this.findLatestOpenPayment(
        row.funnelId,
        customer.email.trim(),
      );
      if (pendingPayment) {
        funnelPaymentId = pendingPayment.id;
      } else {
        const paidPayment = await this.findLatestPaidPayment(
          row.funnelId,
          customer.email.trim(),
        );
        funnelPaymentId = paidPayment?.id ?? null;
      }
      if (funnelPaymentId !== row.funnelPaymentId) {
        await this.tokenRepository.update(row.id, { funnelPaymentId });
      }
    }

    return this.toResumeContext(customer, {
      funnelId: row.funnelId,
      businessId: row.businessId,
      campaignId: row.campaignId,
      funnelPaymentId,
    });
  }

  async attachPaymentToSession(
    token: string,
    funnelPaymentId: number,
  ): Promise<void> {
    const row = await this.loadActiveToken(token);
    await this.tokenRepository.update(row.id, { funnelPaymentId });
  }

  buildCheckoutUrl(input: {
    funnelId: number;
    businessId: number;
    campaignId: number | null;
    token: string;
  }): string {
    const params = new URLSearchParams();
    params.set('checkoutToken', input.token);
    if (input.campaignId != null && input.campaignId > 0) {
      params.set('campaignId', String(input.campaignId));
    }
    params.set('businessId', String(input.businessId));
    return `${getFrontendBaseUrl()}/funnel/${input.funnelId}/payment?${params.toString()}`;
  }

  appendCheckoutTokenToPath(path: string, token: string): string {
    const url = new URL(path, getFrontendBaseUrl());
    url.searchParams.set('checkoutToken', token);
    return `${url.pathname}${url.search}`;
  }

  private async loadActiveToken(token: string): Promise<CheckoutAccessToken> {
    const normalized = token?.trim();
    if (!normalized) {
      throw new BadRequestException('Checkout token is required.');
    }

    const row = await this.tokenRepository.findOne({
      where: { tokenHash: this.hashToken(normalized) },
      relations: ['customer'],
    });

    if (!row) {
      throw new NotFoundException('This checkout link is invalid or expired.');
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException('This checkout link has expired.');
    }

    return row;
  }

  private toResumeContext(
    customer: Customer,
    scope: {
      funnelId: number;
      businessId: number;
      campaignId: number | null;
      funnelPaymentId: number | null;
    },
  ): CheckoutResumeContext {
    return {
      customerId: customer.id,
      customerEmail: customer.email.trim(),
      customerName: customer.name?.trim() || customer.email.trim(),
      customerPhone: customer.phone?.trim() ?? null,
      funnelId: scope.funnelId,
      businessId: scope.businessId,
      campaignId: scope.campaignId,
      funnelPaymentId: scope.funnelPaymentId,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private resolveExpiryDate(): Date {
    const raw = process.env.CHECKOUT_TOKEN_TTL_DAYS?.trim();
    const parsed = raw ? Number(raw) : DEFAULT_TOKEN_TTL_DAYS;
    const days =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOKEN_TTL_DAYS;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private async findLatestOpenPayment(
    funnelId: number,
    customerEmail: string,
  ): Promise<FunnelPayment | null> {
    return this.funnelPaymentRepository.findOne({
      where: {
        funnelId,
        customerEmail: customerEmail.trim(),
        status: In([
          FunnelPaymentStatus.PENDING,
          FunnelPaymentStatus.FAILED,
          FunnelPaymentStatus.CANCELLED,
        ]),
      },
      order: { createdAt: 'DESC' },
    });
  }

  private async findLatestPaidPayment(
    funnelId: number,
    customerEmail: string,
  ): Promise<FunnelPayment | null> {
    return this.funnelPaymentRepository.findOne({
      where: {
        funnelId,
        customerEmail: customerEmail.trim(),
        status: FunnelPaymentStatus.PAID,
      },
      order: { createdAt: 'DESC' },
    });
  }
}
