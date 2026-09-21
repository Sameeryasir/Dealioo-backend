import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '../../db/entities/user.entity';
import { BusinessAccessService } from '../business-access/business-access.service';
import { FacebookService } from '../facebook/facebook.service';
import { GoogleAdsService } from '../google-ads/google-ads.service';
import { StripeService } from '../stripe/stripe.service';
import type { IntegrationsStatusDto } from './dto/integrations-status.dto';

@Injectable()
export class IntegrationsStatusService {
  private readonly statusCache = new Map<
    number,
    { at: number; value: IntegrationsStatusDto }
  >();
  private static readonly STATUS_CACHE_TTL_MS = 90_000;
  private readonly nameWarmInflight = new Set<number>();

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

    const fast: IntegrationsStatusDto = {
      stripe: {
        connected: stripe.connected,
        status: stripe.status,
        stripeAccountId: stripe.stripeAccountId?.trim() || null,
        stripeAccountName: null,
      },
      facebook: {
        connected: facebook.connected,
        status: facebook.status,
        metaOauthScopes: facebook.metaOauthScopes,
        missingRequiredScopes: facebook.missingRequiredScopes,
        metaAdAccountId: facebook.metaAdAccountId?.trim() || null,
        metaAdAccountName: null,
      },
      googleAds: {
        connected: googleAds.connected,
        status: googleAds.status,
        googleOauthScopes: googleAds.googleOauthScopes,
        missingRequiredScopes: googleAds.missingRequiredScopes,
        googleCustomerId: googleAds.googleCustomerId?.trim() || null,
        googleCustomerName: null,
      },
    };

    const cached = this.statusCache.get(businessId);
    if (
      cached &&
      Date.now() - cached.at < IntegrationsStatusService.STATUS_CACHE_TTL_MS &&
      this.sameConnectionIds(cached.value, fast)
    ) {
      return cached.value;
    }

    this.warmDisplayNames(businessId, business, fast);

    return fast;
  }

  invalidateBusiness(businessId: number): void {
    this.statusCache.delete(businessId);
    this.nameWarmInflight.delete(businessId);
  }

  private sameConnectionIds(
    cached: IntegrationsStatusDto,
    current: IntegrationsStatusDto,
  ): boolean {
    return (
      cached.stripe.stripeAccountId === current.stripe.stripeAccountId &&
      cached.stripe.connected === current.stripe.connected &&
      cached.facebook.metaAdAccountId === current.facebook.metaAdAccountId &&
      cached.facebook.connected === current.facebook.connected &&
      cached.googleAds.googleCustomerId === current.googleAds.googleCustomerId &&
      cached.googleAds.connected === current.googleAds.connected
    );
  }

  private warmDisplayNames(
    businessId: number,
    business: Awaited<
      ReturnType<BusinessAccessService['findAccessibleBusiness']>
    >,
    base: IntegrationsStatusDto,
  ): void {
    if (!business || this.nameWarmInflight.has(businessId)) return;
    this.nameWarmInflight.add(businessId);

    void (async () => {
      try {
        const [stripeAccountName, metaAdAccountName, googleCustomerName] =
          await Promise.all([
            base.stripe.connected && base.stripe.stripeAccountId
              ? this.stripeService.resolveAccountDisplayName(
                  base.stripe.stripeAccountId,
                )
              : Promise.resolve(null),
            base.facebook.connected && base.facebook.metaAdAccountId
              ? this.facebookService.resolveSelectedAdAccountName(business)
              : Promise.resolve(null),
            base.googleAds.connected && base.googleAds.googleCustomerId
              ? this.googleAdsService.resolveSelectedCustomerName(business)
              : Promise.resolve(null),
          ]);

        this.statusCache.set(businessId, {
          at: Date.now(),
          value: {
            stripe: { ...base.stripe, stripeAccountName },
            facebook: { ...base.facebook, metaAdAccountName },
            googleAds: { ...base.googleAds, googleCustomerName },
          },
        });
      } catch {
      } finally {
        this.nameWarmInflight.delete(businessId);
      }
    })();
  }
}
