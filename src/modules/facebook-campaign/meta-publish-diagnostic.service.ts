import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetaCampaignDraft } from '../../db/entities/meta-campaign-draft.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import {
  FacebookMetaTokenService,
  META_REQUIRED_SCOPES,
} from '../facebook/facebook-meta-token.service';
import { AdCreativeStepDataDto } from './dto/ad-creative-step-data.dto';
import { AdSetStepDataDto } from './dto/adset-step-data.dto';
import { CampaignStepDataDto } from './dto/meta-campaign-draft-response.dto';
import {
  PublishDiagnosticStepDto,
  PublishMetaCampaignDiagnosticDto,
} from './dto/publish-meta-campaign-diagnostic.dto';
import { graphGetWithToken, normalizeAdAccountId } from './facebook-campaign-meta';
import {
  assertAdCreativeMedia,
  assertInstagramActorIfNeeded,
} from './meta-ad-creative-draft-validation';
import { logMetaApiRequest, logMetaApiResponse } from './meta-publish-trace';

type MetaPageListResponse = {
  data?: Array<{ id?: string; name?: string }>;
};

type MetaAdAccountsResponse = {
  data?: Array<{ id?: string; name?: string; account_status?: number }>;
};

@Injectable()
export class MetaPublishDiagnosticService {
  private readonly logger = new Logger(MetaPublishDiagnosticService.name);

  constructor(
    @InjectRepository(MetaCampaignDraft)
    private readonly draftRepository: Repository<MetaCampaignDraft>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    private readonly metaTokenService: FacebookMetaTokenService,
  ) {}

  async runPublishDiagnostic(
    user: User,
    restaurantId: number,
    draftId: string,
  ): Promise<PublishMetaCampaignDiagnosticDto> {
    requireAdminRole(
      user,
      'You do not have permission to audit Facebook campaign publishing.',
    );

    const steps: PublishDiagnosticStepDto[] = [];
    let firstFailingStep: string | undefined;

    const markStep = (step: PublishDiagnosticStepDto) => {
      steps.push(step);
      if (step.status === 'failed' && !firstFailingStep) {
        firstFailingStep = step.name;
      }
    };

    markStep({
      name: 'backend_endpoint',
      label: 'Backend publish endpoint',
      status: 'success',
      message: 'Diagnostic endpoint reached successfully.',
    });

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId, owner: { id: user.id } },
    });

    if (!restaurant) {
      markStep({
        name: 'restaurant_access',
        label: 'Restaurant access',
        status: 'failed',
        message: 'Restaurant not found or you do not own this restaurant.',
      });
      return this.buildReport(
        restaurantId,
        draftId,
        steps,
        firstFailingStep,
        restaurant,
        null,
        {},
        [],
        false,
      );
    }

    markStep({
      name: 'restaurant_access',
      label: 'Restaurant access',
      status: 'success',
    });

    const draft = await this.draftRepository.findOne({
      where: {
        id: draftId.trim(),
        restaurantId,
        userId: user.id,
      },
    });

    if (!draft) {
      markStep({
        name: 'draft_loaded',
        label: 'Draft loaded',
        status: 'failed',
        message: 'Campaign draft not found.',
      });
      return this.buildReport(
        restaurantId,
        draftId,
        steps,
        firstFailingStep,
        restaurant,
        null,
        {},
        [],
        false,
      );
    }

    markStep({
      name: 'draft_loaded',
      label: 'Draft loaded',
      status: 'success',
      details: { draftStatus: draft.status },
    });

    const campaign = draft.campaignData as CampaignStepDataDto | null;
    const adSet = draft.adSetData as AdSetStepDataDto | null;
    const creative = draft.adCreativeData as AdCreativeStepDataDto | null;

    if (!campaign || !adSet || !creative) {
      markStep({
        name: 'draft_steps_complete',
        label: 'Draft steps complete',
        status: 'failed',
        message:
          'Complete all builder steps (Campaign, Ad Set, Ad / Creative) before publishing.',
        details: {
          hasCampaign: Boolean(campaign),
          hasAdSet: Boolean(adSet),
          hasCreative: Boolean(creative),
        },
      });
    } else {
      markStep({
        name: 'draft_steps_complete',
        label: 'Draft steps complete',
        status: 'success',
      });

      try {
        assertAdCreativeMedia(creative as never);
        assertInstagramActorIfNeeded(
          adSet.placements,
          creative.instagramActorId,
        );
        markStep({
          name: 'draft_payload_validation',
          label: 'Draft payload validation',
          status: 'success',
        });
      } catch (err) {
        markStep({
          name: 'draft_payload_validation',
          label: 'Draft payload validation',
          status: 'failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const metaUserId = restaurant.metaUserId?.trim() ?? null;
    const adAccountId = restaurant.metaAdAccountId?.trim() ?? null;
    const accessToken = this.metaTokenService.decryptRestaurantToken(restaurant);

    markStep({
      name: 'facebook_connection',
      label: 'Facebook connection record',
      status: accessToken && metaUserId ? 'success' : 'failed',
      message:
        accessToken && metaUserId
          ? 'Facebook connection and token found on restaurant.'
          : 'Facebook is not connected or token is missing.',
      details: {
        metaUserId,
        adAccountId,
        hasEncryptedToken: Boolean(restaurant.metaAccessToken),
        metaConnectionStatus: restaurant.metaConnectionStatus,
      },
    });

    let permissionsMap: Record<string, string> = {};
    let adAccounts: MetaAdAccountsResponse['data'] = [];
    let selectedAdAccountFound = false;
    let tokenValid = false;
    let tokenExpiresAt: string | null =
      restaurant.metaTokenExpiresAt?.toISOString?.() ?? null;

    if (!accessToken || !metaUserId) {
      return this.buildReport(
        restaurantId,
        draftId,
        steps,
        firstFailingStep,
        restaurant,
        draft,
        permissionsMap,
        adAccounts ?? [],
        selectedAdAccountFound,
      );
    }

    try {
      const debug = await this.metaTokenService.debugUserAccessToken(accessToken);
      tokenValid = Boolean(debug?.is_valid);
      if (debug?.expires_at && debug.expires_at > 0) {
        tokenExpiresAt = new Date(debug.expires_at * 1000).toISOString();
      }

      markStep({
        name: 'token_validation',
        label: 'Token validation (debug_token)',
        status: tokenValid ? 'success' : 'failed',
        message: tokenValid
          ? 'Meta access token is valid.'
          : 'Meta access token is invalid or expired.',
        details: {
          metaUserId: debug?.user_id ?? metaUserId,
          appId: debug?.app_id ?? null,
          tokenType: debug?.type ?? null,
          expiresAt: tokenExpiresAt,
          debugScopes: debug?.scopes ?? [],
        },
      });
    } catch (err) {
      markStep({
        name: 'token_validation',
        label: 'Token validation (debug_token)',
        status: 'failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      logMetaApiRequest('permissions', 'GET', '/me/permissions');
      const permResponse =
        await this.metaTokenService.fetchMePermissions(accessToken);
      logMetaApiResponse('permissions', 200, permResponse);

      permissionsMap = permResponse;
      const missing = META_REQUIRED_SCOPES.filter(
        (scope) => permResponse[scope] !== 'granted',
      );

      markStep({
        name: 'permissions',
        label: 'Meta permissions (/me/permissions)',
        status: missing.length === 0 ? 'success' : 'failed',
        message:
          missing.length === 0
            ? 'All required permissions are granted.'
            : `Missing permissions: ${missing.join(', ')}. Force reconnect required.`,
        details: { permissions: permResponse, missing },
      });
    } catch (err) {
      markStep({
        name: 'permissions',
        label: 'Meta permissions (/me/permissions)',
        status: 'failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    if (!adAccountId) {
      markStep({
        name: 'ad_account_selected',
        label: 'Ad account selected',
        status: 'failed',
        message:
          'No Facebook ad account selected. Choose an ad account after connecting.',
      });
    } else {
      markStep({
        name: 'ad_account_selected',
        label: 'Ad account selected',
        status: 'success',
        details: { adAccountId },
      });

      try {
        const normalized = normalizeAdAccountId(adAccountId);
        logMetaApiRequest('adaccounts', 'GET', '/me/adaccounts', {
          fields: 'id,name,account_status',
        });
        const accountsResponse = await graphGetWithToken<MetaAdAccountsResponse>(
          '/me/adaccounts',
          accessToken,
          { fields: 'id,name,account_status', limit: '100' },
        );
        adAccounts = accountsResponse.data ?? [];
        logMetaApiResponse('adaccounts', 200, { count: adAccounts.length });

        selectedAdAccountFound = adAccounts.some(
          (row) =>
            row.id?.trim() === normalized ||
            row.id?.trim() === adAccountId ||
            row.id?.replace(/^act_/, '') === normalized.replace(/^act_/, ''),
        );

        markStep({
          name: 'ad_account_access',
          label: 'Ad account belongs to connected user',
          status: selectedAdAccountFound ? 'success' : 'failed',
          message: selectedAdAccountFound
            ? `Selected ad account ${normalized} is accessible.`
            : `Selected ad account ${normalized} was not found in /me/adaccounts for this user.`,
          details: {
            selectedAdAccountId: normalized,
            accessibleCount: adAccounts.length,
            accessibleIds: adAccounts.map((a) => a.id).filter(Boolean),
          },
        });

        if (selectedAdAccountFound) {
          const account = await graphGetWithToken<{
            account_status?: number;
            name?: string;
          }>(`/${normalized}`, accessToken, {
            fields: 'account_status,name',
          });

          const active =
            account.account_status == null || account.account_status === 1;
          markStep({
            name: 'ad_account_active',
            label: 'Ad account active',
            status: active ? 'success' : 'failed',
            message: active
              ? `Ad account "${account.name ?? normalized}" is active.`
              : 'This Meta ad account is disabled. Fix billing or status in Ads Manager.',
            details: {
              accountStatus: account.account_status,
              accountName: account.name,
            },
          });
        }
      } catch (err) {
        markStep({
          name: 'ad_account_access',
          label: 'Ad account belongs to connected user',
          status: 'failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (creative?.facebookPageId) {
      try {
        logMetaApiRequest('pages', 'GET', '/me/accounts');
        const pages = await graphGetWithToken<MetaPageListResponse>(
          '/me/accounts',
          accessToken,
          { fields: 'id,name', limit: '50' },
        );
        logMetaApiResponse('pages', 200, { count: pages.data?.length ?? 0 });

        const pageOk = (pages.data ?? []).some(
          (p) => p.id?.trim() === creative.facebookPageId.trim(),
        );

        markStep({
          name: 'facebook_page',
          label: 'Facebook Page accessible',
          status: pageOk ? 'success' : 'failed',
          message: pageOk
            ? `Page ${creative.facebookPageId} is linked to this Meta account.`
            : 'Selected Facebook Page is not linked to this Meta account.',
          details: { facebookPageId: creative.facebookPageId },
        });
      } catch (err) {
        markStep({
          name: 'facebook_page',
          label: 'Facebook Page accessible',
          status: 'failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const storedIds = {
      metaCampaignId: draft.metaCampaignId,
      metaAdsetId: draft.metaAdsetId,
      metaCreativeId: draft.metaCreativeId,
      metaAdId: draft.metaAdId,
    };

    markStep({
      name: 'stored_meta_ids',
      label: 'Stored Meta IDs in database',
      status: 'success',
      message: 'Partial publish state from previous attempts.',
      details: storedIds,
    });

    const pipelineSteps = [
      'campaign_creation',
      'adset_creation',
      'media_upload',
      'creative_creation',
      'ad_creation',
    ] as const;

    for (const pipelineStep of pipelineSteps) {
      markStep({
        name: pipelineStep,
        label: this.pipelineLabel(pipelineStep),
        status: 'skipped',
        message:
          'Run Publish to execute this step. Check server logs for Meta API request/response.',
      });
    }

    this.logger.log(
      `Publish diagnostic for draft ${draftId} restaurant ${restaurantId}: overall=${firstFailingStep ? 'FAILED' : 'OK'} firstFailure=${firstFailingStep ?? 'none'}`,
    );

    return this.buildReport(
      restaurantId,
      draftId,
      steps,
      firstFailingStep,
      restaurant,
      draft,
      permissionsMap,
      adAccounts ?? [],
      selectedAdAccountFound,
    );
  }

  private pipelineLabel(step: string): string {
    switch (step) {
      case 'campaign_creation':
        return 'Meta API: Create Campaign';
      case 'adset_creation':
        return 'Meta API: Create Ad Set';
      case 'media_upload':
        return 'Meta API: Upload Media';
      case 'creative_creation':
        return 'Meta API: Create Creative';
      case 'ad_creation':
        return 'Meta API: Create Ad';
      default:
        return step;
    }
  }

  private buildReport(
    restaurantId: number,
    draftId: string,
    steps: PublishDiagnosticStepDto[],
    firstFailingStep: string | undefined,
    restaurant: Restaurant | null,
    draft: MetaCampaignDraft | null,
    permissions: Record<string, string>,
    adAccounts: Array<{
      id?: string;
      name?: string;
      account_status?: number;
    }>,
    selectedAdAccountFound: boolean,
  ): PublishMetaCampaignDiagnosticDto {
    const campaign = draft?.campaignData as CampaignStepDataDto | undefined;
    const adSet = draft?.adSetData as AdSetStepDataDto | undefined;
    const creative = draft?.adCreativeData as AdCreativeStepDataDto | undefined;

    const overallSuccess = !firstFailingStep;

    return {
      generatedAt: new Date().toISOString(),
      draftId,
      restaurantId,
      overallSuccess,
      firstFailingStep,
      recommendedFix: this.recommendedFix(firstFailingStep, steps),
      steps,
      connection: {
        metaUserId: restaurant?.metaUserId ?? null,
        adAccountId: restaurant?.metaAdAccountId ?? null,
        facebookPageId: creative?.facebookPageId ?? null,
        tokenExpiresAt: restaurant?.metaTokenExpiresAt?.toISOString?.() ?? null,
        tokenValid: steps.find((s) => s.name === 'token_validation')?.status === 'success',
        connectedAt: restaurant?.metaConnectedAt?.toISOString?.() ?? null,
        storedScopes: restaurant?.metaOauthScopes ?? null,
      },
      permissions,
      adAccounts: adAccounts.map((a) => ({
        id: a.id ?? '',
        name: a.name,
        accountStatus: a.account_status,
      })),
      selectedAdAccountFound,
      storedMetaIds: {
        metaCampaignId: draft?.metaCampaignId ?? null,
        metaAdsetId: draft?.metaAdsetId ?? null,
        metaCreativeId: draft?.metaCreativeId ?? null,
        metaAdId: draft?.metaAdId ?? null,
        draftStatus: draft?.status ?? null,
      },
      draftSummary: {
        campaignName: campaign?.name ?? '',
        adSetName: adSet?.name ?? '',
        creativeName: creative?.name ?? '',
        creativeFormat: creative?.creativeFormat ?? '',
        hasImage: Boolean(creative?.imageUrl?.trim()),
        hasVideo: Boolean(creative?.videoUrl?.trim()),
      },
      publishEndpoint: {
        method: 'POST',
        path: `/facebook-campaigns/restaurant/${restaurantId}/drafts/${draftId}/publish`,
      },
    };
  }

  private recommendedFix(
    firstFailingStep: string | undefined,
    steps: PublishDiagnosticStepDto[],
  ): string | undefined {
    if (!firstFailingStep) return undefined;

    const failed = steps.find((s) => s.name === firstFailingStep);
    if (!failed?.message) return 'Fix the first failing step and try again.';

    if (firstFailingStep === 'permissions') {
      return (
        'Disconnect Facebook in Settings → Integrations, reconnect, and approve ads_management, ads_read, and business_management.'
      );
    }
    if (firstFailingStep === 'ad_account_selected') {
      return 'Open Facebook ad account selection and choose the ad account where campaigns should appear.';
    }
    if (firstFailingStep === 'ad_account_access') {
      return 'The selected ad account is not accessible for this Facebook user. Re-select an ad account from the list after reconnecting.';
    }
    if (firstFailingStep === 'token_validation') {
      return 'Reconnect Facebook — the stored access token is invalid or expired.';
    }
    if (firstFailingStep === 'facebook_page') {
      return 'Pick a Facebook Page that belongs to the connected Meta account in the Ad / Creative step.';
    }

    return failed.message;
  }
}
