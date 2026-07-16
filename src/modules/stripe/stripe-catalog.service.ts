import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { campaignPriceToStripeAmount } from '../../utils/campaign-price-to-stripe-amount';
import { warnStripePayment } from '../payment/payment-logger';
import { StripeService } from './stripe.service';

export type CampaignStripeCatalog = {
  stripeProductId: string;
  stripePriceId: string;
  amount: number;
  currency: string;
  productName: string;
  description: string;
};

@Injectable()
export class StripeCatalogService {
  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    private readonly stripeService: StripeService,
  ) {}

  async ensureCampaignCatalogOnConnectedAccount(opts: {
    campaign: Campaign;
    stripeAccountId: string;
    currency?: string;
  }): Promise<CampaignStripeCatalog> {
    const campaign = opts.campaign;
    const stripeAccountId = opts.stripeAccountId.trim();
    const currency = (opts.currency?.trim() || 'usd').toLowerCase();
    const description = this.buildProductName(campaign);

    let stripePriceId = campaign.stripePriceId?.trim() || null;
    let stripeProductId = campaign.stripeProductId?.trim() || null;

    if (!stripePriceId) {
      const unitAmount = campaignPriceToStripeAmount(campaign.price, currency);
      if (!Number.isFinite(unitAmount) || unitAmount < 1) {
        throw new BadRequestException(
          'Campaign price is missing or invalid for Stripe product creation.',
        );
      }

      const created =
        await this.stripeService.createProductAndPriceOnConnectedAccount({
          stripeAccountId,
          name: description,
          description: this.buildProductDescription(campaign),
          imageUrl: campaign.imageUrl,
          websiteUrl: campaign.websiteUrl,
          unitAmount,
          currency,
        });

      stripePriceId = created.stripePriceId;
      stripeProductId = created.stripeProductId;

      await this.campaignRepository.update(campaign.id, {
        stripePriceId,
        stripeProductId,
      });
    }

    const price = await this.stripeService.retrievePriceOnConnectedAccount(
      stripeAccountId,
      stripePriceId,
    );

    if (price.active === false) {
      throw new BadRequestException(
        'This campaign’s Stripe price is inactive. Update the campaign product in Stripe.',
      );
    }

    const amount = price.unit_amount;
    if (amount == null || !Number.isFinite(amount) || amount < 1) {
      throw new BadRequestException(
        'This campaign’s Stripe price has no valid amount.',
      );
    }

    let productName = description;
    if (
      price.product &&
      typeof price.product === 'object' &&
      'name' in price.product &&
      typeof price.product.name === 'string' &&
      price.product.name.trim()
    ) {
      productName = price.product.name.trim();
    }

    const productIdFromPrice =
      typeof price.product === 'string'
        ? price.product
        : price.product &&
            typeof price.product === 'object' &&
            'id' in price.product
          ? String(price.product.id)
          : stripeProductId;

    if (!productIdFromPrice) {
      throw new NotFoundException(
        'Stripe product id missing for this campaign catalog price.',
      );
    }

    return {
      stripeProductId: productIdFromPrice,
      stripePriceId,
      amount,
      currency: (price.currency || currency).trim().toLowerCase(),
      productName,
      description,
    };
  }

  async createCatalogForNewCampaign(opts: {
    campaign: Campaign;
    stripeAccountId?: string | null;
  }): Promise<void> {
    const stripeAccountId = opts.stripeAccountId?.trim();
    if (!stripeAccountId) return;

    try {
      const catalog = await this.ensureCampaignCatalogOnConnectedAccount({
        campaign: opts.campaign,
        stripeAccountId,
        currency: 'usd',
      });
      opts.campaign.stripeProductId = catalog.stripeProductId;
      opts.campaign.stripePriceId = catalog.stripePriceId;
      await this.campaignRepository.save(opts.campaign);
    } catch (err) {
      warnStripePayment({
        phase: 'campaign_catalog_create',
        outcome: 'skipped_after_error',
        businessId: opts.campaign.businessId,
        campaignId: opts.campaign.id,
        stripeAccountId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private buildProductName(campaign: Campaign): string {
    const name = campaign.campaignName?.trim();
    if (name) return name;
    const offer = campaign.offer?.trim();
    if (offer) return offer;
    return `Campaign ${campaign.id}`;
  }

  private buildProductDescription(campaign: Campaign): string {
    const parts: string[] = [];
    const offer = campaign.offer?.trim();
    if (offer) parts.push(offer);
    const website = campaign.websiteUrl?.trim();
    if (website) parts.push(`Website: ${website}`);
    if (parts.length === 0) {
      return `Dealioo campaign #${campaign.id}`;
    }
    return parts.join('\n').slice(0, 1000);
  }
}
