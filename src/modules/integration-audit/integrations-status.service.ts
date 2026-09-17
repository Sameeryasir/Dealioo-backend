import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '../../db/entities/user.entity';
import { BusinessAccessService } from '../business-access/business-access.service';
import { FacebookService } from '../facebook/facebook.service';
import { GoogleAdsService } from '../google-ads/google-ads.service';
import { StripeService } from '../stripe/stripe.service';
import type { IntegrationsStatusDto } from './dto/integrations-status.dto';

@Injectable()
export class IntegrationsStatusService {
  constructor(
    private readonly businessAccessService: BusinessAccessService,
    private readonly stripeService: StripeService,
    private readonly facebookService: FacebookService,
    private readonly googleAdsService: GoogleAdsService,
  ) {}

  async getStatus(user: User, businessId: number): Promise<IntegrationsStatusDto> {
    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }

    const stripe = this.stripeService.getConnectionStatus(business);
    const facebook = this.facebookService.getConnectionStatus(business);
    const googleAds = this.googleAdsService.getConnectionStatus(business);

    const [stripeAccountName, metaAdAccountName, googleCustomerName] =
      await Promise.all([
        stripe.connected && stripe.stripeAccountId
          ? this.stripeService.resolveAccountDisplayName(stripe.stripeAccountId)
          : Promise.resolve(null),
        facebook.connected && facebook.metaAdAccountId
          ? this.facebookService.resolveSelectedAdAccountName(business)
          : Promise.resolve(null),
        googleAds.connected && googleAds.googleCustomerId
          ? this.googleAdsService.resolveSelectedCustomerName(business)
          : Promise.resolve(null),
      ]);

    return {
      stripe: {
        connected: stripe.connected,
        status: stripe.status,
        stripeAccountId: stripe.stripeAccountId?.trim() || null,
        stripeAccountName,
      },
      facebook: {
        connected: facebook.connected,
        status: facebook.status,
        metaOauthScopes: facebook.metaOauthScopes,
        missingRequiredScopes: facebook.missingRequiredScopes,
        metaAdAccountId: facebook.metaAdAccountId?.trim() || null,
        metaAdAccountName,
      },
      googleAds: {
        connected: googleAds.connected,
        status: googleAds.status,
        googleOauthScopes: googleAds.googleOauthScopes,
        missingRequiredScopes: googleAds.missingRequiredScopes,
        googleCustomerId: googleAds.googleCustomerId?.trim() || null,
        googleCustomerName,
      },
    };
  }
}
