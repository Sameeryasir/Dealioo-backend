import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { PlanFitAssessment } from '../../db/entities/plan-fit-assessment.entity';
import { SubscriptionPlan } from '../../db/entities/subscription-plan.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscriptionsService } from '../user-subscriptions/user-subscriptions.service';
import { BusinessAccessService } from '../business-access/business-access.service';
import {
  OnboardingNextStep,
  OnboardingStatusResponse,
} from './onboarding.types';
import { SavePlanFitDto } from './onboardingDto/save-plan-fit.dto';
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
};

export type GetPlanFitResult = {
  answers: PlanFitAnswersInput | null;
  recommendation: PlanFitRecommendationPayload | null;
  planFitAnswers: PlanFitAnswersInput | null;
  planFitRecommendedPlan: string | null;
  planFitCompletedAt: string | null;
};

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(PlanFitAssessment)
    private readonly assessmentRepository: Repository<PlanFitAssessment>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepository: Repository<SubscriptionPlan>,
    @Inject(forwardRef(() => UserSubscriptionsService))
    private readonly userSubscriptionsService: UserSubscriptionsService,
    private readonly businessAccessService: BusinessAccessService,
    private readonly recommendationService: PlanFitRecommendationService,
  ) {}

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

    return {
      answers,
      recommendation,
      planFitAnswers: answers,
      planFitRecommendedPlan:
        recommendation?.planSlug ?? user.planFitRecommendedPlan ?? null,
      planFitCompletedAt: completedAt,
    };
  }

  async savePlanFit(
    userId: number,
    dto: SavePlanFitDto,
  ): Promise<SavePlanFitResult> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const answers = dto.answers as PlanFitAnswersInput;
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
    });

    const payload: PlanFitRecommendationPayload = {
      planSlug: recommendation.planSlug,
      reason: recommendation.reason,
      confidence: recommendation.confidence,
      scores,
      version: recommendation.version,
    };

    return {
      answers,
      recommendation: payload,
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
      latest != null
        ? latest.recommendedPlanSlug === normalized
        : null;

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
  }

  async getStatusForUser(
    userId: number,
    roleName: string,
    businessIdParam?: number,
  ): Promise<OnboardingStatusResponse> {
    const normalizedRole = roleName.trim();

    if (normalizedRole === SCANNER_ROLE || normalizedRole === SUPER_ADMIN_ROLE) {
      return {
        businessId: null,
        twoFactorCompleted: true,
        subscriptionSelected: true,
        businessCreated: true,
        onboardingCompleted: true,
        nextStep: null,
        redirectPath: '/dashboard',
      };
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

      return {
        businessId,
        twoFactorCompleted: true,
        subscriptionSelected: true,
        businessCreated: accessibleIds.length > 0,
        onboardingCompleted: true,
        nextStep: null,
        redirectPath: '/dashboard',
      };
    }

    if (normalizedRole !== ADMIN_ROLE) {
      throw new ForbiddenException(
        'Onboarding status is only available for admin accounts.',
      );
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const twoFactorCompleted = true;
    const subscriptionSelected =
      await this.userSubscriptionsService.userHasActiveSubscription(userId);

    const ownedBusinesses = await this.businessRepository.find({
      where: { owner: { id: userId } },
      order: { id: 'ASC' },
      select: {
        id: true,
        onboardingCompleted: true,
        onboardingCompletedAt: true,
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

    const nextStep = this.resolveNextStep({
      subscriptionSelected,
      businessCreated,
    });
    const onboardingCompleted = subscriptionSelected && businessCreated;

    const redirectPath = this.buildRedirectPath(
      nextStep,
      onboardingCompleted,
    );

    return {
      businessId: targetBusiness?.id ?? ownedBusinesses[0]?.id ?? null,
      twoFactorCompleted,
      subscriptionSelected,
      businessCreated,
      onboardingCompleted,
      nextStep,
      redirectPath,
    };
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
