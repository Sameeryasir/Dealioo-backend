import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Brackets, MoreThan, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import { AdminNotification } from '../../db/entities/admin-notification.entity';
import { Automation } from '../../db/entities/automation.entity';
import { Business } from '../../db/entities/business.entity';
import { BusinessCustomer } from '../../db/entities/business-customer.entity';
import { BusinessOnboardingDraft } from '../../db/entities/business-onboarding-draft.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { BusinessMemberPermission } from '../../db/entities/business-member-permission.entity';
import { Role } from '../../db/entities/role.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { isSuperAdmin } from '../../utils/user-roles';
import {
  ALL_BUSINESS_MEMBER_PERMISSIONS,
} from '../member/member.constants';
import { BUSINESS_MEMBER_STATUS } from '../member/business-member-status';
import { CreateBusinessDto } from './businessDto/create-business.dto';
import { UpdateBusinessDto } from './businessDto/update-business.dto';
import { AssociateTwilioPhoneNumberDto } from './businessDto/associate-twilio-phone-number.dto';
import { ConnectTwilioCredentialsDto } from './businessDto/connect-twilio-credentials.dto';
import { PurchaseTwilioPhoneNumberDto } from './businessDto/purchase-twilio-phone-number.dto';
import { SearchTwilioAvailableNumbersDto } from './businessDto/search-twilio-available-numbers.dto';
import {
  BUSINESSES_UPLOAD_SUBDIR,
} from '../../utils/disk-file-upload-multer';
import { persistUploadedFile } from '../../utils/persist-uploaded-file';
import { SpacesService } from '../spaces/spaces.service';
import { BusinessAccessService } from '../business-access/business-access.service';
import { BusinessHistoryService } from '../business-history/business-history.service';
import { AdminNotificationWriter } from '../admin-notifications/admin-notifications.writer';
import { PusherService } from '../pusher/pusher.service';
import {
  maskTwilioAccountSid,
  normalizePhoneNumber,
  TwilioService,
} from '../sms/twilio.service';
import { decryptSecret, encryptSecret } from '../../utils/token-encryption.util';
import { BusinessTwilioIntegration } from '../../db/entities/business-twilio-integration.entity';
import {
  isValidBusinessSlug,
  slugifyBusinessName,
} from '../../utils/business-slug';
import {
  toBusinessDetailResponse,
  type BusinessDetailResponse,
} from './business-detail-response';
import {
  sanitizeBusinessListItem,
  type PublicBusinessListItem,
} from './sanitize-business-list-item';
import {
  BUSINESS_ONBOARDING_QUEUE,
  type BusinessOnboardingPostCreateJob,
} from './business-onboarding-queue.constants';

const STARTER_PLAN_SLUG = 'starter';
const STARTER_MAX_BUSINESSES = 1;
const IDEMPOTENT_CREATE_WINDOW_MS = 2 * 60 * 1000;

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);

  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserSubscription)
    private readonly userSubscriptionRepository: Repository<UserSubscription>,
    @InjectRepository(BusinessOnboardingDraft)
    private readonly draftRepository: Repository<BusinessOnboardingDraft>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Automation)
    private readonly automationRepository: Repository<Automation>,
    @InjectRepository(BusinessCustomer)
    private readonly businessCustomerRepository: Repository<BusinessCustomer>,
    @InjectRepository(AdminNotification)
    private readonly adminNotificationRepository: Repository<AdminNotification>,
    @InjectRepository(BusinessMember)
    private readonly businessMemberRepository: Repository<BusinessMember>,
    @InjectRepository(BusinessMemberPermission)
    private readonly businessMemberPermissionRepository: Repository<BusinessMemberPermission>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(BusinessTwilioIntegration)
    private readonly businessTwilioIntegrationRepository: Repository<BusinessTwilioIntegration>,
    private readonly spacesService: SpacesService,
    private readonly businessAccessService: BusinessAccessService,
    private readonly businessHistoryService: BusinessHistoryService,
    private readonly twilioService: TwilioService,
    private readonly pusherService: PusherService,
    private readonly adminNotificationWriter: AdminNotificationWriter,
    @InjectQueue(BUSINESS_ONBOARDING_QUEUE)
    private readonly businessOnboardingQueue: Queue<BusinessOnboardingPostCreateJob>,
  ) {}

  private async notifyBusinessCreated(
    business: Business,
    owner: User,
  ): Promise<void> {
    const ownerBit = owner.email?.trim() ? ` (owner: ${owner.email.trim()})` : '';
    try {
      const saved = await this.adminNotificationRepository.save(
        this.adminNotificationRepository.create({
          type: 'business',
          eventKey: 'business_created',
          title: 'New business registered',
          body: `${business.name} was created${ownerBit}.`,
          severity: 'success',
          actionUrl: `/admin/businesses/${business.id}`,
          resourceType: 'business',
          resourceId: String(business.id),
          actorUserId: owner.id,
          idempotencyKey: `business_created:${business.id}`,
          metadata: {
            businessName: business.name,
            ownerEmail: owner.email ?? null,
          },
          source: 'user',
        }),
      );
      await this.pusherService.notifyAdminNotificationCreated(saved);
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code !== '23505') {
        this.logger.warn(
          `Failed to write admin notification for business ${business.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  async findByUserId(userId: number): Promise<Business | null> {
    return this.businessRepository.findOne({
      where: { owner: { id: userId } },
      order: { id: 'ASC' },
    });
  }

  /** Business must exist and belong to this user (for scoped routes like Stripe dashboard). */
  async findOwnedByUserId(
    userId: number,
    businessId: number,
  ): Promise<Business | null> {
    return this.findBusinessForUser({ id: userId, role: null }, businessId);
  }

  async findBusinessForUser(
    user: Pick<User, 'id'> & { role?: { name: string } | null },
    businessId: number,
  ): Promise<Business | null> {
    return this.businessAccessService.findAccessibleBusiness(user, businessId);
  }

  async createBusiness(
    createBusinessDto: CreateBusinessDto,
    user: User,
    file?: Express.Multer.File,
  ): Promise<Business> {
    requireAdminRole(
      user,
      'You do not have permission to create a business.',
    );

    await this.assertActiveSubscription(user.id);
    await this.assertStarterBusinessLimit(user.id);

    const {
      name,
      slug: slugInput,
      description,
      logoUrl: dtoLogoUrl,
      businessType,
      currency,
      websiteUrl,
      email,
      phoneNumber,
      city,
      state,
      country,
      postalCode,
      branchCount,
      twilioPhoneSid,
      twilioPhoneNumber,
    } = createBusinessDto;

    const owner = await this.userRepository.findOne({ where: { id: user.id } });
    if (!owner) {
      throw new NotFoundException('Owner not found');
    }

    const recentDuplicate = await this.businessRepository.findOne({
      where: {
        owner: { id: user.id },
        name: name.trim(),
        createdAt: MoreThan(new Date(Date.now() - IDEMPOTENT_CREATE_WINDOW_MS)),
      },
      order: { id: 'DESC' },
    });
    if (recentDuplicate) {
      return recentDuplicate;
    }

    const logoUrl = file
      ? await persistUploadedFile(
          this.spacesService,
          file,
          BUSINESSES_UPLOAD_SUBDIR,
        )
      : (dtoLogoUrl ?? null);

    const slug = await this.resolveUniqueBusinessSlug(
      slugInput?.trim() || name,
    );

    const createdAt = new Date();
    const optionalTwilioSid = twilioPhoneSid?.trim() || null;
    const rawTwilioNumber = twilioPhoneNumber?.trim() || '';
    const optionalTwilioNumber = rawTwilioNumber
      ? normalizePhoneNumber(rawTwilioNumber) ?? rawTwilioNumber
      : null;

    const business = this.businessRepository.create({
      name,
      slug,
      description,
      logoUrl,
      businessType: businessType.trim(),
      currency: currency.trim().toUpperCase(),
      websiteUrl,
      email,
      phoneNumber,
      city,
      state,
      country,
      postalCode,
      branchCount,
      owner,
      twilioPhoneSid: optionalTwilioSid,
      twilioPhoneNumber: optionalTwilioNumber,
      twilioConnectedAt:
        optionalTwilioSid && optionalTwilioNumber ? createdAt : null,
      onboardingCompleted: true,
      onboardingCompletedAt: createdAt,
    });

    await this.businessRepository.save(business);

    await this.ensureOwnerMembership(business, owner);

    await this.businessHistoryService.logBusinessCreated({
      businessId: business.id,
      businessName: business.name,
      actorUserId: user.id,
    });

    await this.notifyBusinessCreated(business, user);

    await this.draftRepository.delete({ userId: user.id });

    await this.businessOnboardingQueue.add(
      'post_create_provisioning',
      {
        businessId: business.id,
        ownerUserId: user.id,
        businessName: business.name,
      },
      {
        // BullMQ custom job IDs cannot contain ':'.
        jobId: `business-post-create-${business.id}`,
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    return business;
  }

  private async assertActiveSubscription(userId: number): Promise<void> {
    const hasSub = await this.userSubscriptionRepository
      .createQueryBuilder('sub')
      .where('sub.user_id = :userId', { userId })
      .andWhere('sub.status IN (:...statuses)', {
        statuses: ['active', 'trialing'],
      })
      .getExists();

    if (!hasSub) {
      throw new ForbiddenException(
        'An active subscription is required before creating a business.',
      );
    }
  }

  private async assertStarterBusinessLimit(userId: number): Promise<void> {
    const subscription = await this.userSubscriptionRepository
      .createQueryBuilder('sub')
      .innerJoinAndSelect('sub.plan', 'plan')
      .select(['sub.id', 'plan.id', 'plan.slug'])
      .where('sub.user_id = :userId', { userId })
      .andWhere('sub.status IN (:...statuses)', {
        statuses: ['active', 'trialing'],
      })
      .orderBy('sub.created_at', 'DESC')
      .limit(1)
      .getOne();

    const slug = subscription?.plan?.slug?.trim().toLowerCase() ?? '';
    const isStarter = slug === STARTER_PLAN_SLUG;
    if (!isStarter) return;

    const ownedCount = await this.businessRepository.count({
      where: { owner: { id: userId } },
    });

    if (ownedCount >= STARTER_MAX_BUSINESSES) {
      throw new ForbiddenException(
        'Starter plans allow only one business. Upgrade your plan to add more locations.',
      );
    }
  }

  private async resolveUniqueBusinessSlug(source: string): Promise<string> {
    const base = slugifyBusinessName(source) || 'business';
    const root = isValidBusinessSlug(base) ? base : 'business';

    let candidate = root;
    let suffix = 2;

    while (await this.businessRepository.exists({ where: { slug: candidate } })) {
      candidate = `${root}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  async getAllBusinesses(
    user: User,
    page?: number,
    limit?: number,
    search?: string,
  ): Promise<{
    data: PublicBusinessListItem[];
    meta: PaginationMeta & { ownedTotal: number };
  }> {
    const pagination = normalizePagination(page, limit);
    const trimmedSearch = search?.trim();
    const listAllBusinesses = isSuperAdmin(user);

    const qb = this.businessRepository
      .createQueryBuilder('business')
      .leftJoinAndSelect('business.owner', 'owner');

    if (!listAllBusinesses) {
      this.businessAccessService.applyAccessibleBusinessFilter(qb, user);
    }

    if (trimmedSearch) {
      const escaped = trimmedSearch.replace(/[%_\\]/g, '\\$&');
      const containsPattern = `%${escaped}%`;

      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('business.name ILIKE :containsPattern', {
              containsPattern,
            })
            .orWhere(
              "COALESCE(business.description, '') ILIKE :containsPattern",
              { containsPattern },
            )
            .orWhere("COALESCE(business.email, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere("COALESCE(business.city, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere("COALESCE(business.state, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere("COALESCE(business.country, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere(
              "COALESCE(business.website_url, '') ILIKE :containsPattern",
              { containsPattern },
            );
        }),
      );
    }

    qb.addSelect('LOWER(business.name)', 'business_name_sort')
      .orderBy('business_name_sort', 'ASC')
      .addOrderBy('business.id', 'ASC')
      .skip(pagination.skip)
      .take(pagination.limit);

    const [rows, total] = await qb.getManyAndCount();

    const ownedTotal = listAllBusinesses
      ? total
      : await this.businessRepository.count({
          where: { owner: { id: user.id } },
        });

    return {
      data: rows.map((row) =>
        sanitizeBusinessListItem(row, {
          viewerUserId: user.id,
          isSuperAdmin: listAllBusinesses,
        }),
      ),
      meta: {
        ...buildPaginationMeta(total, pagination.page, pagination.limit),
        ownedTotal,
      },
    };
  }

  /**
   * Business rule: detail payload includes summary counts for the Settings profile card.
   * Counts run in parallel after access check.
   */
  async getBusinessById(
    businessId: number,
    user: User,
  ): Promise<BusinessDetailResponse> {
    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }

    // Count locally (no ActivityModule) to avoid Nest circular module imports.
    const [totalCampaigns, totalCustomers, activeAutomations] =
      await Promise.all([
        this.campaignRepository.count({ where: { businessId } }),
        this.businessCustomerRepository.count({ where: { businessId } }),
        this.automationRepository
          .createQueryBuilder('automation')
          .where('automation.businessId = :businessId', { businessId })
          .andWhere(
            '(automation.isActive = true OR automation.published = true)',
          )
          .getCount(),
      ]);

    return toBusinessDetailResponse(business, {
      totalCampaigns,
      totalCustomers,
      activeAutomations,
    });
  }
  async updateBusiness(
    businessId: number,
    updateBusinessDto: UpdateBusinessDto,
    user: User,
    file?: Express.Multer.File,
  ): Promise<Business> {
    await this.businessAccessService.assertPermission(
      user,
      businessId,
      'settings',
      'You do not have permission to update a business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }
    const {
      name,
      description,
      logoUrl,
      businessType,
      currency,
      websiteUrl,
      email,
      phoneNumber,
      city,
      state,
      country,
      postalCode,
      branchCount,
    } = updateBusinessDto;

    if (name !== undefined) business.name = name;
    if (description !== undefined) business.description = description;
    if (file) {
      business.logoUrl = await persistUploadedFile(
        this.spacesService,
        file,
        BUSINESSES_UPLOAD_SUBDIR,
      );
    } else if (logoUrl !== undefined) {
      business.logoUrl = logoUrl;
    }
    if (businessType !== undefined) {
      business.businessType = businessType.trim();
    }
    if (currency !== undefined) {
      business.currency = currency.trim().toUpperCase();
    }
    if (websiteUrl !== undefined) business.websiteUrl = websiteUrl;
    if (email !== undefined) business.email = email;
    if (phoneNumber !== undefined) business.phoneNumber = phoneNumber;
    if (city !== undefined) business.city = city;
    if (state !== undefined) business.state = state;
    if (country !== undefined) business.country = country;
    if (postalCode !== undefined) business.postalCode = postalCode;
    if (branchCount !== undefined) business.branchCount = branchCount;

    const saved = await this.businessRepository.save(business);

    await this.businessHistoryService.logBusinessUpdated({
      businessId: saved.id,
      businessName: saved.name,
      actorUserId: user.id,
    });

    return saved;
  }
  async deleteBusiness(businessId: number, user: User): Promise<Business> {
    await this.businessAccessService.assertOwner(
      user,
      businessId,
      'Only the business owner can delete a business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    await this.businessHistoryService.logBusinessDeleted({
      businessId: business.id,
      businessName: business.name,
      actorUserId: user.id,
    });

    await this.businessRepository.manager.transaction(async (manager) => {
      await manager.query(
        `
          DELETE FROM customer_visit_campaigns
          WHERE customer_visit_id IN (
            SELECT id FROM customer_visits WHERE business_id = $1
          )
        `,
        [businessId],
      );
      await manager.query(
        `DELETE FROM customer_visits WHERE business_id = $1`,
        [businessId],
      );

      await manager.query(`DELETE FROM coupons WHERE business_id = $1`, [
        businessId,
      ]);

      await manager.query(
        `DELETE FROM funnel_payment WHERE business_id = $1`,
        [businessId],
      );

      await manager.query(
        `DELETE FROM funnel_order WHERE business_id = $1`,
        [businessId],
      );

      await manager.query(
        `DELETE FROM facebook_campaigns WHERE business_id = $1`,
        [businessId],
      );

      await manager.query(
        `DELETE FROM meta_campaign_errors WHERE business_id = $1`,
        [businessId],
      );
      await manager.query(
        `DELETE FROM meta_campaign_media WHERE business_id = $1`,
        [businessId],
      );
      await manager.query(
        `DELETE FROM meta_publish_attempts WHERE business_id = $1`,
        [businessId],
      );
      await manager.query(
        `DELETE FROM meta_campaign_drafts WHERE business_id = $1`,
        [businessId],
      );
      await manager.query(
        `DELETE FROM google_campaign_drafts WHERE business_id = $1`,
        [businessId],
      );
      await manager.query(
        `DELETE FROM meta_ad_campaign_stats_snapshots WHERE business_id = $1`,
        [businessId],
      );
      await manager.query(
        `DELETE FROM meta_funnel_events WHERE business_id = $1`,
        [businessId],
      );
      await manager.query(
        `DELETE FROM scanner_purchase_requests WHERE business_id = $1`,
        [businessId],
      );
      await manager.query(
        `DELETE FROM checkout_access_token WHERE business_id = $1`,
        [businessId],
      );

      await manager.getRepository(Business).delete(businessId);
    });

    return business;
  }

  private async ensureOwnerMembership(
    business: Business,
    owner: User,
  ): Promise<void> {
    const existing = await this.businessMemberRepository.findOne({
      where: {
        business: { id: business.id },
        user: { id: owner.id },
      },
    });

    const ownerRole = await this.roleRepository.findOne({
      where: { name: 'Owner' },
    });

    let member = existing;
    if (!member) {
      member = await this.businessMemberRepository.save(
        this.businessMemberRepository.create({
          business,
          user: owner,
          role: 'Owner',
          memberRole: ownerRole,
          status: BUSINESS_MEMBER_STATUS.ACTIVE,
          invitedBy: null,
          joinedAt: new Date(),
          permissions: [...ALL_BUSINESS_MEMBER_PERMISSIONS],
        }),
      );
    } else {
      member.role = 'Owner';
      member.memberRole = ownerRole;
      member.status = BUSINESS_MEMBER_STATUS.ACTIVE;
      member.joinedAt = member.joinedAt ?? new Date();
      member.permissions = [...ALL_BUSINESS_MEMBER_PERMISSIONS];
      member = await this.businessMemberRepository.save(member);
    }

    await this.businessMemberPermissionRepository.delete({
      businessMember: { id: member.id },
    });
    await this.businessMemberPermissionRepository.save(
      ALL_BUSINESS_MEMBER_PERMISSIONS.map((permission) =>
        this.businessMemberPermissionRepository.create({
          businessMember: member!,
          permission,
        }),
      ),
    );

    await this.businessAccessService.invalidateMembershipCache(
      business.id,
      owner.id,
    );
  }

  async listTwilioPhoneNumbers(
    businessId: number,
    user: User,
  ): Promise<{
    numbers: Array<{
      sid: string;
      phoneNumber: string;
      friendlyName: string | null;
    }>;
    selectedPhoneSid: string | null;
    selectedPhoneNumber: string | null;
    credentialsConnected: boolean;
    accountSidMasked: string | null;
  }> {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      ['campaigns_edit', 'campaigns'],
      'You do not have permission to manage Twilio for this business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }

    const integration = await this.getOrCreateTwilioIntegration(business.id);
    const ownCredentials =
      this.resolveTwilioCredentialsFromIntegration(integration);
    const numbers = ownCredentials
      ? await this.twilioService.listIncomingPhoneNumbers(ownCredentials)
      : [];

    return {
      numbers,
      selectedPhoneSid: business.twilioPhoneSid?.trim() || null,
      selectedPhoneNumber: business.twilioPhoneNumber?.trim() || null,
      credentialsConnected: Boolean(ownCredentials),
      accountSidMasked: maskTwilioAccountSid(integration.twilioAccountSid),
    };
  }

  async connectTwilioCredentials(
    businessId: number,
    dto: ConnectTwilioCredentialsDto,
    user: User,
  ): Promise<{
    credentialsConnected: boolean;
    accountSidMasked: string | null;
    selectedPhoneSid: string | null;
    selectedPhoneNumber: string | null;
  }> {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      ['campaigns_edit', 'campaigns'],
      'You do not have permission to manage Twilio for this business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }

    const accountSid = dto.accountSid.trim();
    const authToken = dto.authToken.trim();

    await this.twilioService.assertCredentialsWork({ accountSid, authToken });

    const integration = await this.getOrCreateTwilioIntegration(business.id);
    const previousSid = integration.twilioAccountSid?.trim() || null;

    integration.twilioAccountSid = accountSid;
    integration.twilioAuthToken = encryptSecret(authToken);
    integration.twilioConnectedAt = new Date();

    if (previousSid && previousSid !== accountSid) {
      business.twilioPhoneSid = null;
      business.twilioPhoneNumber = null;
      integration.twilioPhoneSid = null;
      integration.twilioPhoneNumber = null;
      await this.businessRepository.save(business);
    } else {
      integration.twilioPhoneSid = business.twilioPhoneSid;
      integration.twilioPhoneNumber = business.twilioPhoneNumber;
    }

    await this.businessTwilioIntegrationRepository.save(integration);

    await this.adminNotificationWriter.notifyIntegrationConnected({
      provider: 'twilio',
      businessId: business.id,
      businessName: business.name,
      actorUserId: user.id,
      idempotencyKey: `twilio_credentials:${business.id}:${accountSid}`,
      metadata: {
        twilioAccountSidMasked: maskTwilioAccountSid(accountSid),
      },
    });

    return {
      credentialsConnected: true,
      accountSidMasked: maskTwilioAccountSid(accountSid),
      selectedPhoneSid: business.twilioPhoneSid?.trim() || null,
      selectedPhoneNumber: business.twilioPhoneNumber?.trim() || null,
    };
  }

  async disconnectTwilioCredentials(
    businessId: number,
    user: User,
  ): Promise<{ disconnected: true; inboundWebhookCleared: boolean }> {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      ['campaigns_edit', 'campaigns'],
      'You do not have permission to manage Twilio for this business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }

    const integration = await this.businessTwilioIntegrationRepository.findOne({
      where: { businessId: business.id },
    });

    let inboundWebhookCleared = false;
    const ownCredentials =
      this.resolveTwilioCredentialsFromIntegration(integration);
    const phoneSid =
      integration?.twilioPhoneSid?.trim() ||
      business.twilioPhoneSid?.trim() ||
      '';
    const phoneNumber =
      integration?.twilioPhoneNumber?.trim() ||
      business.twilioPhoneNumber?.trim() ||
      '';
    if (ownCredentials && phoneSid) {
      inboundWebhookCleared =
        await this.twilioService.clearInboundWebhookForNumber({
          accountSid: ownCredentials.accountSid,
          authToken: ownCredentials.authToken,
          phoneSid,
          phoneNumber: phoneNumber || phoneSid,
        });
    }

    business.twilioPhoneSid = null;
    business.twilioPhoneNumber = null;
    business.twilioConnectedAt = null;
    await this.businessRepository.save(business);

    if (integration) {
      integration.twilioAccountSid = null;
      integration.twilioAuthToken = null;
      integration.twilioPhoneSid = null;
      integration.twilioPhoneNumber = null;
      integration.twilioConnectedAt = null;
      await this.businessTwilioIntegrationRepository.save(integration);
    }

    return { disconnected: true, inboundWebhookCleared };
  }

  async searchAvailableTwilioPhoneNumbers(
    businessId: number,
    dto: SearchTwilioAvailableNumbersDto,
    user: User,
  ): Promise<{
    numbers: Array<{
      phoneNumber: string;
      friendlyName: string | null;
      locality: string | null;
      region: string | null;
      isoCountry: string | null;
      numberType: 'Local' | 'Mobile';
      addressRequirement: string;
      monthlyFee: string | null;
      capabilities: {
        sms: boolean;
        mms: boolean;
        voice: boolean;
        fax: boolean;
      };
    }>;
  }> {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      ['campaigns_edit', 'campaigns'],
      'You do not have permission to manage Twilio for this business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }

    const integration = await this.getOrCreateTwilioIntegration(business.id);
    const ownCredentials =
      this.resolveTwilioCredentialsFromIntegration(integration);
    if (!ownCredentials) {
      throw new BadRequestException(
        'Connect your Twilio Account SID and Auth Token before searching numbers.',
      );
    }

    const numbers = await this.twilioService.searchAvailablePhoneNumbers({
      accountSid: ownCredentials.accountSid,
      authToken: ownCredentials.authToken,
      countryCode: dto.country?.trim() || dto.countryCode,
      areaCode: dto.areaCode,
      areaName: dto.areaName,
      contains: dto.contains,
      voice: dto.voice,
      sms: dto.sms,
      mms: dto.mms,
      fax: dto.fax,
      limit: dto.limit,
    });

    return { numbers };
  }

  async purchaseTwilioPhoneNumber(
    businessId: number,
    dto: PurchaseTwilioPhoneNumberDto,
    user: User,
  ): Promise<{
    twilioPhoneSid: string;
    twilioPhoneNumber: string;
    twilioConnectedAt: Date;
  }> {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      ['campaigns_edit', 'campaigns'],
      'You do not have permission to manage Twilio for this business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }

    const integration = await this.getOrCreateTwilioIntegration(business.id);
    const ownCredentials =
      this.resolveTwilioCredentialsFromIntegration(integration);
    if (!ownCredentials) {
      throw new BadRequestException(
        'Connect your Twilio Account SID and Auth Token before buying a number.',
      );
    }

    this.twilioService.assertInboundSmsConfigured();

    const purchased = await this.twilioService.purchasePhoneNumber({
      accountSid: ownCredentials.accountSid,
      authToken: ownCredentials.authToken,
      phoneNumber: dto.phoneNumber,
    });

    const connectedAt = new Date();
    business.twilioPhoneSid = purchased.sid;
    business.twilioPhoneNumber = purchased.phoneNumber;
    business.twilioConnectedAt = connectedAt;
    await this.businessRepository.save(business);

    integration.twilioPhoneSid = purchased.sid;
    integration.twilioPhoneNumber = purchased.phoneNumber;
    integration.twilioConnectedAt = connectedAt;
    await this.businessTwilioIntegrationRepository.save(integration);

    await this.twilioService.syncInboundWebhookForNumber({
      accountSid: ownCredentials.accountSid,
      authToken: ownCredentials.authToken,
      phoneSid: purchased.sid,
      phoneNumber: purchased.phoneNumber,
    });

    await this.adminNotificationWriter.notifyIntegrationConnected({
      provider: 'twilio',
      businessId: business.id,
      businessName: business.name,
      actorUserId: user.id,
      idempotencyKey: `twilio_purchased:${business.id}:${purchased.sid}`,
      metadata: {
        twilioPhoneSid: purchased.sid,
        twilioPhoneNumber: purchased.phoneNumber,
      },
    });

    return {
      twilioPhoneSid: purchased.sid,
      twilioPhoneNumber: purchased.phoneNumber,
      twilioConnectedAt: connectedAt,
    };
  }

  async associateTwilioPhoneNumber(
    businessId: number,
    dto: AssociateTwilioPhoneNumberDto,
    user: User,
  ): Promise<{
    twilioPhoneSid: string;
    twilioPhoneNumber: string;
    twilioConnectedAt: Date;
  }> {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      ['campaigns_edit', 'campaigns'],
      'You do not have permission to manage Twilio for this business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }

    const phoneSid = dto.phoneSid.trim();
    const normalized =
      normalizePhoneNumber(dto.phoneNumber.trim()) ?? dto.phoneNumber.trim();
    if (!phoneSid || !normalized) {
      throw new BadRequestException('A valid Twilio phone number is required.');
    }

    const integration = await this.getOrCreateTwilioIntegration(business.id);
    const ownCredentials =
      this.resolveTwilioCredentialsFromIntegration(integration);
    if (!ownCredentials) {
      throw new BadRequestException(
        'Connect your Twilio Account SID and Auth Token before selecting a number.',
      );
    }

    this.twilioService.assertInboundSmsConfigured();

    const available = await this.twilioService.listIncomingPhoneNumbers(
      ownCredentials,
    );
    const match = available.find(
      (n) =>
        n.sid === phoneSid ||
        n.phoneNumber === normalized ||
        n.phoneNumber === dto.phoneNumber.trim(),
    );
    if (!match) {
      await this.adminNotificationWriter.notifyIntegrationFailed({
        provider: 'twilio',
        businessId: business.id,
        businessName: business.name,
        reason: 'That phone number was not found on the Twilio account.',
        actorUserId: user.id,
      });
      throw new BadRequestException(
        'That phone number was not found on your Twilio account.',
      );
    }

    const connectedAt = new Date();
    business.twilioPhoneSid = match.sid;
    business.twilioPhoneNumber = match.phoneNumber;
    business.twilioConnectedAt = connectedAt;
    await this.businessRepository.save(business);

    integration.twilioPhoneSid = match.sid;
    integration.twilioPhoneNumber = match.phoneNumber;
    integration.twilioConnectedAt = connectedAt;
    await this.businessTwilioIntegrationRepository.save(integration);

    await this.twilioService.syncInboundWebhookForNumber({
      accountSid: ownCredentials.accountSid,
      authToken: ownCredentials.authToken,
      phoneSid: match.sid,
      phoneNumber: match.phoneNumber,
    });

    await this.adminNotificationWriter.notifyIntegrationConnected({
      provider: 'twilio',
      businessId: business.id,
      businessName: business.name,
      actorUserId: user.id,
      idempotencyKey: `twilio_connected:${business.id}:${match.sid}`,
      metadata: {
        twilioPhoneSid: match.sid,
        twilioPhoneNumber: match.phoneNumber,
      },
    });

    return {
      twilioPhoneSid: match.sid,
      twilioPhoneNumber: match.phoneNumber,
      twilioConnectedAt: connectedAt,
    };
  }

  resolveTwilioCredentialsFromIntegration(
    integration: BusinessTwilioIntegration | null,
  ): { accountSid: string; authToken: string } | null {
    if (!integration) return null;
    const accountSid = integration.twilioAccountSid?.trim() || '';
    const storedToken = integration.twilioAuthToken?.trim() || '';
    if (!accountSid || !storedToken) {
      return null;
    }

    try {
      const authToken = decryptSecret(storedToken).trim();
      if (!authToken) return null;
      return { accountSid, authToken };
    } catch (error) {
      this.logger.warn(
        `Could not decrypt Twilio auth token for business ${integration.businessId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async getOrCreateTwilioIntegration(
    businessId: number,
  ): Promise<BusinessTwilioIntegration> {
    let row = await this.businessTwilioIntegrationRepository.findOne({
      where: { businessId },
    });
    if (!row) {
      row = this.businessTwilioIntegrationRepository.create({ businessId });
      row = await this.businessTwilioIntegrationRepository.save(row);
    }
    return row;
  }
}
