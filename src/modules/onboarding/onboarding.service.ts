import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { BusinessCustomer } from '../../db/entities/business-customer.entity';
import { BusinessInvitation } from '../../db/entities/business-invitation.entity';
import { BusinessOnboardingDraft } from '../../db/entities/business-onboarding-draft.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { OnboardingEvent } from '../../db/entities/onboarding-event.entity';
import { PlanFitAssessment } from '../../db/entities/plan-fit-assessment.entity';
import { SubscriptionPlan } from '../../db/entities/subscription-plan.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscriptionsService } from '../user-subscriptions/user-subscriptions.service';
import { BusinessAccessService } from '../business-access/business-access.service';
import {
  BusinessOnboardingDraftPayload,
  BusinessOnboardingDraftResponse,
  ONBOARDING_VERSION,
  OnboardingChecklistItem,
  OnboardingNextStep,
  OnboardingStatusResponse,
} from './onboarding.types';
import { SavePlanFitDto } from './onboardingDto/save-plan-fit.dto';
import { SavePlanFitProgressDto } from './onboardingDto/save-plan-fit-progress.dto';
import { UpsertBusinessDraftDto } from './onboardingDto/upsert-business-draft.dto';
import {
  fallbackPlanContents,
  type PlanContentInput,
} from './plan-fit/plan-fit-content';
import { PlanFitRecommendationService } from './plan-fit/plan-fit-recommendation.service';
import {
  BusinessCount,
  HelpStyle,
  PaidMarketing,
  PlanFitAnswersInput,
  Priority,
} from './plan-fit/plan-fit.types';
import {
  ADMIN_ROLE,
  MANAGER_ROLE,
  SCANNER_ROLE,
  STAFF_ROLE,
  SUPER_ADMIN_ROLE,
} from '../../utils/user-roles';

export type PlanFitRecommendationPayload = {
  planSlug: string;
  reason: string;
  confidence: string;
  scores: Record<string, number>;
  version: string;
};

export type SavePlanFitResult = {
  answers: PlanFitAnswersInput;
  recommendation: PlanFitRecommendationPayload;
  planFitCompletedAt: string;
  reused?: boolean;
};

export type GetPlanFitResult = {
  answers: PlanFitAnswersInput | null;
  recommendation: PlanFitRecommendationPayload | null;
  planFitAnswers: PlanFitAnswersInput | null;
  planFitRecommendedPlan: string | null;
  planFitCompletedAt: string | null;
  draftAnswers: Partial<PlanFitAnswersInput> | null;
  draftQuestionIndex: number | null;
};

export type TrackOnboardingEventInput = {
  userId: number | null;
  eventName: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown> | null;
};

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(PlanFitAssessment)
    private readonly assessmentRepository: Repository<PlanFitAssessment>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepository: Repository<SubscriptionPlan>,
    @InjectRepository(BusinessOnboardingDraft)
    private readonly draftRepository: Repository<BusinessOnboardingDraft>,
    @InjectRepository(OnboardingEvent)
    private readonly eventRepository: Repository<OnboardingEvent>,
    @InjectRepository(BusinessInvitation)
    private readonly invitationRepository: Repository<BusinessInvitation>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(BusinessCustomer)
    private readonly businessCustomerRepository: Repository<BusinessCustomer>,
    @Inject(forwardRef(() => UserSubscriptionsService))
    private readonly userSubscriptionsService: UserSubscriptionsService,
    private readonly businessAccessService: BusinessAccessService,
    private readonly recommendationService: PlanFitRecommendationService,
  ) {}

  async trackEvent(input: TrackOnboardingEventInput): Promise<boolean> {
    const key = input.idempotencyKey.trim().slice(0, 191);
    if (!key || !input.eventName.trim()) {
      return false;
    }

    try {
      const existing = await this.eventRepository.findOne({
        where: { idempotencyKey: key },
        select: { id: true },
      });
      if (existing) {
        return false;
      }

      await this.eventRepository.save(
        this.eventRepository.create({
          userId: input.userId,
          eventName: input.eventName.trim().slice(0, 64),
          idempotencyKey: key,
          metadata: input.metadata ?? null,
        }),
      );
      return true;
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code === '23505') {
        return false;
      }
      this.logger.warn(
        `Failed to track onboarding event ${input.eventName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  async assertOwnerCanAccessPlanSelection(userId: number): Promise<void> {
    const user = await this.requireAdminUser(userId);
    if (await this.userSubscriptionsService.userHasActiveSubscription(user.id)) {
      throw new BadRequestException(
        'You already have an active subscription. Continue to business setup.',
      );
    }
  }

  async assertOwnerCanCreateBusiness(userId: number): Promise<void> {
    await this.requireAdminUser(userId);
    const hasSub =
      await this.userSubscriptionsService.userHasActiveSubscription(userId);
    if (!hasSub) {
      throw new ForbiddenException(
        'An active subscription is required before creating a business.',
      );
    }
  }

  async getPlanFit(userId: number): Promise<GetPlanFitResult> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: {
        id: true,
        planFitAnswers: true,
        planFitRecommendedPlan: true,
        planFitCompletedAt: true,
        planFitScores: true,
        planFitVersion: true,
        planFitConfidence: true,
        planFitDraftAnswers: true,
        planFitDraftQuestionIndex: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const answers = this.parseStoredAnswers(user.planFitAnswers);
    const completedAt = user.planFitCompletedAt
      ? user.planFitCompletedAt.toISOString()
      : null;
    const planContents = await this.loadPlanContents();

    const recommendation =
      answers &&
      user.planFitRecommendedPlan &&
      user.planFitScores &&
      user.planFitConfidence &&
      user.planFitVersion
        ? {
            planSlug: user.planFitRecommendedPlan,
            reason: this.recommendationService.recommend(
              answers,
              planContents,
            ).reason,
            confidence: user.planFitConfidence,
            scores: user.planFitScores,
            version: user.planFitVersion,
          }
        : answers
          ? (() => {
              const rec = this.recommendationService.recommend(
                answers,
                planContents,
              );
              return {
                planSlug: rec.planSlug,
                reason: rec.reason,
                confidence: rec.confidence,
                scores: rec.scores as unknown as Record<string, number>,
                version: rec.version,
              };
            })()
          : null;

    const draftAnswers = this.parsePartialAnswers(user.planFitDraftAnswers);

    return {
      answers,
      recommendation,
      planFitAnswers: answers,
      planFitRecommendedPlan:
        recommendation?.planSlug ?? user.planFitRecommendedPlan ?? null,
      planFitCompletedAt: completedAt,
      draftAnswers,
      draftQuestionIndex:
        typeof user.planFitDraftQuestionIndex === 'number'
          ? user.planFitDraftQuestionIndex
          : null,
    };
  }

  async savePlanFitProgress(
    userId: number,
    dto: SavePlanFitProgressDto,
  ): Promise<{
    draftAnswers: Partial<PlanFitAnswersInput>;
    draftQuestionIndex: number | null;
  }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, planFitDraftAnswers: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const merged: Record<string, string> = {
      ...(user.planFitDraftAnswers ?? {}),
    };
    for (const [key, value] of Object.entries(dto.answers ?? {})) {
      if (typeof value === 'string' && value.trim()) {
        merged[key] = value;
      }
    }

    const questionIndex =
      typeof dto.questionIndex === 'number' ? dto.questionIndex : null;

    await this.userRepository.update(userId, {
      planFitDraftAnswers: merged,
      planFitDraftQuestionIndex: questionIndex,
    });

    await this.trackEvent({
      userId,
      eventName: 'plan_quiz_started',
      idempotencyKey: `plan_quiz_started:${userId}`,
    });

    return {
      draftAnswers: this.parsePartialAnswers(merged) ?? {},
      draftQuestionIndex: questionIndex,
    };
  }

  async savePlanFit(
    userId: number,
    dto: SavePlanFitDto,
  ): Promise<SavePlanFitResult> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: {
        id: true,
        planFitAnswers: true,
        planFitRecommendedPlan: true,
        planFitCompletedAt: true,
        planFitScores: true,
        planFitVersion: true,
        planFitConfidence: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const answers = dto.answers as PlanFitAnswersInput;
    const existing = this.parseStoredAnswers(user.planFitAnswers);

    if (
      existing &&
      user.planFitCompletedAt &&
      user.planFitRecommendedPlan &&
      user.planFitScores &&
      user.planFitConfidence &&
      user.planFitVersion &&
      this.answersEqual(existing, answers)
    ) {
      const planContents = await this.loadPlanContents();
      const reason = this.recommendationService.recommend(
        existing,
        planContents,
      ).reason;
      return {
        answers: existing,
        recommendation: {
          planSlug: user.planFitRecommendedPlan,
          reason,
          confidence: user.planFitConfidence,
          scores: user.planFitScores,
          version: user.planFitVersion,
        },
        planFitCompletedAt: user.planFitCompletedAt.toISOString(),
        reused: true,
      };
    }

    const planContents = await this.loadPlanContents();
    const recommendation = this.recommendationService.recommend(
      answers,
      planContents,
    );
    const completedAt = new Date();
    const scores = recommendation.scores as unknown as Record<string, number>;

    await this.assessmentRepository.save(
      this.assessmentRepository.create({
        userId,
        version: recommendation.version,
        answers: answers as unknown as Record<string, string>,
        scores,
        recommendedPlanSlug: recommendation.planSlug,
        confidence: recommendation.confidence,
        selectedPlanSlug: null,
        recommendationAccepted: null,
      }),
    );

    await this.userRepository.update(userId, {
      planFitAnswers: answers as unknown as Record<string, string>,
      planFitRecommendedPlan: recommendation.planSlug,
      planFitCompletedAt: completedAt,
      planFitScores: scores,
      planFitVersion: recommendation.version,
      planFitConfidence: recommendation.confidence,
      planFitDraftAnswers: null,
      planFitDraftQuestionIndex: null,
    });

    await this.trackEvent({
      userId,
      eventName: 'plan_quiz_completed',
      idempotencyKey: `plan_quiz_completed:${userId}:${recommendation.version}:${recommendation.planSlug}`,
      metadata: { planSlug: recommendation.planSlug },
    });

    return {
      answers,
      recommendation: {
        planSlug: recommendation.planSlug,
        reason: recommendation.reason,
        confidence: recommendation.confidence,
        scores,
        version: recommendation.version,
      },
      planFitCompletedAt: completedAt.toISOString(),
    };
  }

  async recordPlanSelection(
    userId: number,
    selectedPlanSlug: string,
  ): Promise<void> {
    const normalized = selectedPlanSlug.trim().toLowerCase();
    if (!normalized) {
      return;
    }

    const latest = await this.assessmentRepository.findOne({
      where: { userId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    const accepted =
      latest != null ? latest.recommendedPlanSlug === normalized : null;

    if (latest) {
      await this.assessmentRepository.update(latest.id, {
        selectedPlanSlug: normalized,
        recommendationAccepted: accepted,
      });
    }

    await this.userRepository.update(userId, {
      planFitSelectedPlan: normalized,
      planFitRecommendationAccepted: accepted,
    });

    await this.trackEvent({
      userId,
      eventName: 'plan_selected',
      idempotencyKey: `plan_selected:${userId}:${normalized}`,
      metadata: { planSlug: normalized, accepted },
    });
  }

  async getBusinessDraft(
    userId: number,
  ): Promise<BusinessOnboardingDraftResponse | null> {
    await this.assertOwnerCanCreateBusiness(userId);

    const draft = await this.draftRepository.findOne({
      where: { userId },
    });
    if (!draft) {
      return null;
    }

    return this.toDraftResponse(draft);
  }

  async upsertBusinessDraft(
    userId: number,
    dto: UpsertBusinessDraftDto,
  ): Promise<BusinessOnboardingDraftResponse> {
    await this.assertOwnerCanCreateBusiness(userId);

    let draft = await this.draftRepository.findOne({ where: { userId } });
    const nextPayload: Record<string, unknown> = {
      ...(draft?.payload ?? {}),
      ...(dto.payload ?? {}),
    };

    if (!draft) {
      draft = this.draftRepository.create({
        userId,
        step: dto.step?.trim() || 'basics',
        payload: nextPayload,
        logoUrl:
          dto.logoUrl === undefined ? null : (dto.logoUrl?.trim() || null),
      });
    } else {
      draft.step = dto.step?.trim() || draft.step || 'basics';
      draft.payload = nextPayload;
      if (dto.logoUrl !== undefined) {
        draft.logoUrl = dto.logoUrl?.trim() || null;
      }
    }

    const saved = await this.draftRepository.save(draft);
    await this.trackEvent({
      userId,
      eventName: 'business_creation_started',
      idempotencyKey: `business_creation_started:${userId}`,
    });

    return this.toDraftResponse(saved);
  }

  async deleteBusinessDraft(userId: number): Promise<void> {
    await this.draftRepository.delete({ userId });
  }

  async getStatusForUser(
    userId: number,
    roleName: string,
    businessIdParam?: number,
  ): Promise<OnboardingStatusResponse> {
    const normalizedRole = roleName.trim();

    if (normalizedRole === SCANNER_ROLE || normalizedRole === SUPER_ADMIN_ROLE) {
      return this.buildTerminalStatus({
        businessId: null,
        redirectPath: '/dashboard',
      });
    }

    if (
      normalizedRole === MANAGER_ROLE ||
      normalizedRole === STAFF_ROLE
    ) {
      const accessibleIds =
        await this.businessAccessService.listAccessibleBusinessIds(userId);
      const businessId =
        businessIdParam != null && accessibleIds.includes(businessIdParam)
          ? businessIdParam
          : (accessibleIds[0] ?? null);

      return this.buildTerminalStatus({
        businessId,
        redirectPath: '/dashboard',
        businessCreated: accessibleIds.length > 0,
      });
    }

    if (normalizedRole !== ADMIN_ROLE) {
      throw new ForbiddenException(
        'Onboarding status is only available for admin accounts.',
      );
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, onboardingVersion: true, isTwoFactorVerified: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (!user.onboardingVersion) {
      await this.userRepository.update(userId, {
        onboardingVersion: ONBOARDING_VERSION,
      });
      user.onboardingVersion = ONBOARDING_VERSION;
    }

    const twoFactorCompleted = true;
    const subscriptionCompleted =
      await this.userSubscriptionsService.userHasActiveSubscription(userId);

    const ownedBusinesses = await this.businessRepository.find({
      where: { owner: { id: userId } },
      order: { id: 'ASC' },
      select: {
        id: true,
        onboardingCompleted: true,
        onboardingCompletedAt: true,
        stripeAccountId: true,
        metaConnectedAt: true,
        metaAccessToken: true,
        metaConnectionStatus: true,
      },
    });

    const businessCreated = ownedBusinesses.length > 0;

    let targetBusiness = ownedBusinesses[0] ?? null;

    if (businessIdParam != null) {
      const match = ownedBusinesses.find((r) => r.id === businessIdParam);
      if (!match) {
        throw new BadRequestException(
          'Business not found or you do not own this business.',
        );
      }
      targetBusiness = match;
    }

    for (const business of ownedBusinesses) {
      if (!business.onboardingCompleted) {
        await this.markBusinessOnboardingComplete(business.id);
      }
    }

    const hasDraft =
      !businessCreated &&
      (await this.draftRepository.exists({ where: { userId } }));

    const businessIds = ownedBusinesses.map((b) => b.id);
    const metaConnected = ownedBusinesses.some(
      (b) =>
        Boolean(b.metaConnectedAt) ||
        Boolean(b.metaAccessToken) ||
        (b.metaConnectionStatus ?? '').toLowerCase() === 'connected',
    );
    const stripeConnected = ownedBusinesses.some((b) =>
      Boolean(b.stripeAccountId?.trim()),
    );

    let teamInvited = false;
    let firstCampaignCreated = false;
    let customersImported = false;

    if (businessIds.length > 0) {
      const [inviteCount, campaignCount, customerCount] = await Promise.all([
        this.invitationRepository
          .createQueryBuilder('invite')
          .where('invite.business_id IN (:...ids)', { ids: businessIds })
          .getCount(),
        this.campaignRepository.count({
          where: { businessId: In(businessIds) },
        }),
        this.businessCustomerRepository.count({
          where: { businessId: In(businessIds) },
        }),
      ]);
      teamInvited = inviteCount > 0;
      firstCampaignCreated = campaignCount > 0;
      customersImported = customerCount > 0;
    }

    const nextStep = this.resolveNextStep({
      subscriptionSelected: subscriptionCompleted,
      businessCreated,
    });
    const onboardingCompleted = subscriptionCompleted && businessCreated;

    const redirectPath = this.buildRedirectPath(
      nextStep,
      onboardingCompleted,
    );

    const checklist = this.buildChecklist({
      subscriptionCompleted,
      businessCreated,
      metaConnected,
      stripeConnected,
      teamInvited,
      firstCampaignCreated,
      customersImported,
    });

    const progress = this.calculateProgress({
      twoFactorCompleted,
      subscriptionCompleted,
      businessCreated,
      metaConnected,
      stripeConnected,
      teamInvited,
    });

    if (metaConnected) {
      await this.trackEvent({
        userId,
        eventName: 'facebook_connected',
        idempotencyKey: `facebook_connected:${userId}`,
      });
    }
    if (stripeConnected) {
      await this.trackEvent({
        userId,
        eventName: 'stripe_connected',
        idempotencyKey: `stripe_connected:${userId}`,
      });
    }
    if (teamInvited) {
      await this.trackEvent({
        userId,
        eventName: 'team_invited',
        idempotencyKey: `team_invited:${userId}`,
      });
    }

    if (onboardingCompleted) {
      await this.trackEvent({
        userId,
        eventName: 'onboarding_completed',
        idempotencyKey: `onboarding_completed:${userId}`,
      });
    }

    return {
      businessId: targetBusiness?.id ?? ownedBusinesses[0]?.id ?? null,
      twoFactorCompleted,
      subscriptionSelected: subscriptionCompleted,
      subscriptionCompleted,
      businessCreated,
      metaConnected,
      stripeConnected,
      teamInvited,
      firstCampaignCreated,
      customersImported,
      hasBusinessDraft: hasDraft,
      onboardingCompleted,
      onboardingVersion: user.onboardingVersion || ONBOARDING_VERSION,
      nextStep,
      redirectPath,
      progress,
      checklist,
    };
  }

  resolveRedirectPathFromStatus(status: OnboardingStatusResponse): string {
    return status.redirectPath;
  }

  private buildTerminalStatus(input: {
    businessId: number | null;
    redirectPath: string;
    businessCreated?: boolean;
  }): OnboardingStatusResponse {
    const businessCreated = input.businessCreated ?? true;
    return {
      businessId: input.businessId,
      twoFactorCompleted: true,
      subscriptionSelected: true,
      subscriptionCompleted: true,
      businessCreated,
      metaConnected: true,
      stripeConnected: true,
      teamInvited: true,
      firstCampaignCreated: true,
      customersImported: true,
      hasBusinessDraft: false,
      onboardingCompleted: true,
      onboardingVersion: ONBOARDING_VERSION,
      nextStep: null,
      redirectPath: input.redirectPath,
      progress: 100,
      checklist: this.buildChecklist({
        subscriptionCompleted: true,
        businessCreated,
        metaConnected: true,
        stripeConnected: true,
        teamInvited: true,
        firstCampaignCreated: true,
        customersImported: true,
      }),
    };
  }

  private buildChecklist(flags: {
    subscriptionCompleted: boolean;
    businessCreated: boolean;
    metaConnected: boolean;
    stripeConnected: boolean;
    teamInvited: boolean;
    firstCampaignCreated: boolean;
    customersImported: boolean;
  }): OnboardingChecklistItem[] {
    return [
      {
        id: 'subscription',
        label: 'Subscription',
        completed: flags.subscriptionCompleted,
        required: true,
      },
      {
        id: 'business',
        label: 'Business',
        completed: flags.businessCreated,
        required: true,
      },
      {
        id: 'facebook',
        label: 'Connect Facebook',
        completed: flags.metaConnected,
        required: false,
      },
      {
        id: 'stripe',
        label: 'Connect Stripe',
        completed: flags.stripeConnected,
        required: false,
      },
      {
        id: 'team',
        label: 'Invite Team',
        completed: flags.teamInvited,
        required: false,
      },
      {
        id: 'campaign',
        label: 'Create First Campaign',
        completed: flags.firstCampaignCreated,
        required: false,
      },
      {
        id: 'customers',
        label: 'Import Customers',
        completed: flags.customersImported,
        required: false,
      },
    ];
  }

  private calculateProgress(flags: {
    twoFactorCompleted: boolean;
    subscriptionCompleted: boolean;
    businessCreated: boolean;
    metaConnected: boolean;
    stripeConnected: boolean;
    teamInvited: boolean;
  }): number {
    let progress = 0;
    if (flags.twoFactorCompleted) progress += 15;
    if (flags.subscriptionCompleted) progress += 25;
    if (flags.businessCreated) progress += 25;
    if (flags.metaConnected) progress += 12;
    if (flags.stripeConnected) progress += 12;
    if (flags.teamInvited) progress += 11;
    return Math.min(100, progress);
  }

  private async requireAdminUser(userId: number): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: { role: true },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (user.role?.name !== ADMIN_ROLE) {
      throw new ForbiddenException(
        'Only business owners can perform this onboarding action.',
      );
    }
    return user;
  }

  private toDraftResponse(
    draft: BusinessOnboardingDraft,
  ): BusinessOnboardingDraftResponse {
    return {
      step: draft.step,
      payload: (draft.payload ?? {}) as BusinessOnboardingDraftPayload,
      logoUrl: draft.logoUrl,
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  private answersEqual(
    a: PlanFitAnswersInput,
    b: PlanFitAnswersInput,
  ): boolean {
    return (
      a.businesses === b.businesses &&
      a.paidMarketing === b.paidMarketing &&
      a.helpStyle === b.helpStyle &&
      a.priority === b.priority
    );
  }

  private async loadPlanContents(): Promise<PlanContentInput[]> {
    const plans = await this.planRepository.find({
      where: { isActive: true },
      select: { slug: true, name: true, description: true },
      order: { sortOrder: 'ASC' },
    });

    const contents: PlanContentInput[] = [];
    for (const plan of plans) {
      const features: string[] = [];
      const description = plan.description;
      if (description?.features?.length) {
        features.push(...description.features);
      }
      if (description?.featureGroups?.length) {
        for (const group of description.featureGroups) {
          features.push(...(group.items ?? []));
        }
      }
      if (features.length > 0) {
        contents.push({
          slug: plan.slug,
          name: plan.name,
          features,
        });
      }
    }

    return contents.length > 0 ? contents : fallbackPlanContents();
  }

  private parsePartialAnswers(
    raw: Record<string, string> | null | undefined,
  ): Partial<PlanFitAnswersInput> | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const out: Partial<PlanFitAnswersInput> = {};
    if (Object.values(BusinessCount).includes(raw.businesses as BusinessCount)) {
      out.businesses = raw.businesses as BusinessCount;
    }
    if (
      Object.values(PaidMarketing).includes(raw.paidMarketing as PaidMarketing)
    ) {
      out.paidMarketing = raw.paidMarketing as PaidMarketing;
    }
    if (Object.values(HelpStyle).includes(raw.helpStyle as HelpStyle)) {
      out.helpStyle = raw.helpStyle as HelpStyle;
    }
    if (Object.values(Priority).includes(raw.priority as Priority)) {
      out.priority = raw.priority as Priority;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  private parseStoredAnswers(
    raw: Record<string, string> | null,
  ): PlanFitAnswersInput | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const businesses = raw.businesses;
    const paidMarketing = raw.paidMarketing;
    const helpStyle = raw.helpStyle;
    const priority = raw.priority;

    if (
      !Object.values(BusinessCount).includes(businesses as BusinessCount) ||
      !Object.values(PaidMarketing).includes(paidMarketing as PaidMarketing) ||
      !Object.values(HelpStyle).includes(helpStyle as HelpStyle) ||
      !Object.values(Priority).includes(priority as Priority)
    ) {
      return null;
    }

    return {
      businesses: businesses as BusinessCount,
      paidMarketing: paidMarketing as PaidMarketing,
      helpStyle: helpStyle as HelpStyle,
      priority: priority as Priority,
    };
  }

  private async markBusinessOnboardingComplete(
    businessId: number,
  ): Promise<void> {
    await this.businessRepository.update(businessId, {
      onboardingCompleted: true,
      onboardingCompletedAt: new Date(),
    });
  }

  private resolveNextStep(input: {
    subscriptionSelected: boolean;
    businessCreated: boolean;
  }): OnboardingNextStep {
    if (!input.subscriptionSelected) {
      return 'plan_selection';
    }
    if (!input.businessCreated) {
      return 'business_creation';
    }
    return null;
  }

  private buildRedirectPath(
    nextStep: OnboardingNextStep,
    onboardingCompleted: boolean,
  ): string {
    if (onboardingCompleted) {
      return '/dashboard';
    }
    if (nextStep === 'plan_selection') {
      return '/auth/select-plan';
    }
    if (nextStep === 'business_creation') {
      return '/business/register';
    }
    return '/dashboard';
  }
}
