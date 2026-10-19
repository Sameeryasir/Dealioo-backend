import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';
import { Business } from '../src/db/entities/business.entity';
import { BusinessHistory } from '../src/db/entities/business-history.entity';
import { BusinessHistoryEventType } from '../src/db/entities/business-history.entity';
import { BusinessMember } from '../src/db/entities/business-member.entity';
import { BusinessMemberPermission } from '../src/db/entities/business-member-permission.entity';
import { OnboardingEvent } from '../src/db/entities/onboarding-event.entity';
import { Role } from '../src/db/entities/role.entity';
import { SubscriptionPlan } from '../src/db/entities/subscription-plan.entity';
import { User } from '../src/db/entities/user.entity';
import { UserSubscription } from '../src/db/entities/user-subscription.entity';
import { BUSINESS_MEMBER_STATUS } from '../src/modules/member/business-member-status';
import { ALL_BUSINESS_MEMBER_PERMISSIONS } from '../src/modules/member/member.constants';
import { ONBOARDING_VERSION } from '../src/modules/onboarding/onboarding.types';
import { ADMIN_ROLE } from '../src/utils/user-roles';
import { slugifyBusinessName } from '../src/utils/business-slug';

config();

const EMAIL = 'accahammad4@gmail.com';
const PASSWORD = 'AdminUser@1234!';
const DISPLAY_NAME = 'Acca Ahmad';
const PHONE = '+12025550147';
const EXPERT_PLAN_SLUG = 'growth-expert';
const BUSINESS_NAME = 'Acca Ahmad';
const BUSINESS_SLUG = slugifyBusinessName(BUSINESS_NAME);

async function main(): Promise<void> {
  await AppDataSource.initialize();

  const roleRepo = AppDataSource.getRepository(Role);
  const userRepo = AppDataSource.getRepository(User);
  const planRepo = AppDataSource.getRepository(SubscriptionPlan);
  const subscriptionRepo = AppDataSource.getRepository(UserSubscription);
  const businessRepo = AppDataSource.getRepository(Business);
  const memberRepo = AppDataSource.getRepository(BusinessMember);
  const permissionRepo = AppDataSource.getRepository(BusinessMemberPermission);
  const onboardingRepo = AppDataSource.getRepository(OnboardingEvent);
  const historyRepo = AppDataSource.getRepository(BusinessHistory);

  let role = await roleRepo.findOne({ where: { name: ADMIN_ROLE } });
  if (!role) {
    role = await roleRepo.save(roleRepo.create({ name: ADMIN_ROLE }));
    console.log(`INSERT role ${ADMIN_ROLE}`);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const now = new Date();
  const existing = await userRepo
    .createQueryBuilder('user')
    .addSelect('user.passwordHash')
    .leftJoinAndSelect('user.role', 'role')
    .where('LOWER(user.email) = :email', { email: EMAIL })
    .getOne();

  const profile = {
    email: EMAIL,
    name: DISPLAY_NAME,
    firstName: 'Acca',
    lastName: 'Ahmad',
    phone: PHONE,
    passwordHash,
    provider: 'LOCAL' as const,
    role,
    isActive: true,
    emailVerified: true,
    phoneVerified: true,
    onboardingStep: 3,
    onboardingVersion: ONBOARDING_VERSION,
    planFitRecommendedPlan: EXPERT_PLAN_SLUG,
    planFitSelectedPlan: EXPERT_PLAN_SLUG,
    planFitCompletedAt: now,
    planFitRecommendationAccepted: true,
    planFitVersion: ONBOARDING_VERSION,
    planFitConfidence: 'high',
  };

  let user: User;
  if (existing) {
    Object.assign(existing, profile);
    user = await userRepo.save(existing);
    console.log(`UPDATE ${EMAIL} role=${ADMIN_ROLE} id=${user.id}`);
  } else {
    user = await userRepo.save(userRepo.create(profile));
    console.log(`INSERT ${EMAIL} role=${ADMIN_ROLE} id=${user.id}`);
  }

  const plan = await planRepo.findOne({ where: { slug: EXPERT_PLAN_SLUG } });
  if (!plan) {
    throw new Error(
      `Plan "${EXPERT_PLAN_SLUG}" is missing. Run the subscription plan seeder first.`,
    );
  }

  const currentSubscription = await subscriptionRepo.findOne({
    where: { userId: user.id },
    order: { createdAt: 'DESC' },
  });

  if (currentSubscription) {
    currentSubscription.planId = plan.id;
    currentSubscription.plan = plan;
    currentSubscription.billingCycle = 'monthly';
    currentSubscription.status = 'active';
    currentSubscription.cancelAtPeriodEnd = false;
    currentSubscription.startedAt = currentSubscription.startedAt ?? now;
    currentSubscription.cancelledAt = null;
    await subscriptionRepo.save(currentSubscription);
    console.log(
      `UPDATE subscription ${currentSubscription.id} plan=${EXPERT_PLAN_SLUG}`,
    );
  } else {
    const created = await subscriptionRepo.save(
      subscriptionRepo.create({
        user,
        userId: user.id,
        plan,
        planId: plan.id,
        billingCycle: 'monthly',
        status: 'active',
        cancelAtPeriodEnd: false,
        startedAt: now,
        stripeCustomerId: `seed_cus_${user.id}`,
        stripeSubscriptionId: `seed_sub_${user.id}_growth_expert`,
      }),
    );
    console.log(`INSERT subscription ${created.id} plan=${EXPERT_PLAN_SLUG}`);
  }

  let business = await businessRepo.findOne({
    where: { owner: { id: user.id }, slug: BUSINESS_SLUG },
  });

  if (!business) {
    const slugTaken = await businessRepo.findOne({
      where: { slug: BUSINESS_SLUG },
    });
    const slug = slugTaken ? `${BUSINESS_SLUG}-${user.id}` : BUSINESS_SLUG;
    business = await businessRepo.save(
      businessRepo.create({
        name: BUSINESS_NAME,
        slug,
        description: 'Seeded business for the Acca Ahmad admin account.',
        email: EMAIL,
        phoneNumber: PHONE,
        businessType: 'Agency & Services',
        currency: 'USD',
        websiteUrl: 'https://accaahmad.example.com',
        city: 'Austin',
        state: 'Texas',
        postalCode: '78701',
        country: 'United States',
        branchCount: 1,
        owner: user,
        onboardingCompleted: true,
        onboardingCompletedAt: now,
      }),
    );
    console.log(`INSERT business ${business.slug} id=${business.id}`);
  } else {
    business.onboardingCompleted = true;
    business.onboardingCompletedAt = business.onboardingCompletedAt ?? now;
    business = await businessRepo.save(business);
    console.log(`UPDATE business ${business.slug} id=${business.id}`);
  }

  let member = await memberRepo.findOne({
    where: { business: { id: business.id }, user: { id: user.id } },
  });
  if (!member) {
    member = await memberRepo.save(
      memberRepo.create({
        business,
        user,
        role: 'Owner',
        memberRole: role,
        status: BUSINESS_MEMBER_STATUS.ACTIVE,
        invitedBy: null,
        joinedAt: now,
        permissions: [...ALL_BUSINESS_MEMBER_PERMISSIONS],
      }),
    );
    console.log(`INSERT owner membership id=${member.id}`);
  } else {
    member.role = 'Owner';
    member.memberRole = role;
    member.status = BUSINESS_MEMBER_STATUS.ACTIVE;
    member.joinedAt = member.joinedAt ?? now;
    member.permissions = [...ALL_BUSINESS_MEMBER_PERMISSIONS];
    member = await memberRepo.save(member);
    console.log(`UPDATE owner membership id=${member.id}`);
  }

  await permissionRepo.delete({ businessMember: { id: member.id } });
  await permissionRepo.save(
    ALL_BUSINESS_MEMBER_PERMISSIONS.map((permission) =>
      permissionRepo.create({ businessMember: member, permission }),
    ),
  );

  const events: Array<{ name: string; key: string }> = [
    { name: 'plan_selected', key: `plan_selected:${user.id}:${EXPERT_PLAN_SLUG}` },
    { name: 'onboarding_completed', key: `onboarding_completed:${user.id}` },
  ];
  for (const event of events) {
    const already = await onboardingRepo.findOne({
      where: { idempotencyKey: event.key },
    });
    if (already) continue;
    await onboardingRepo.save(
      onboardingRepo.create({
        userId: user.id,
        user,
        eventName: event.name,
        idempotencyKey: event.key,
        metadata: { planSlug: EXPERT_PLAN_SLUG, source: 'seed-acca-expert-admin' },
      }),
    );
    console.log(`INSERT onboarding event ${event.name}`);
  }

  const historyKey = `seed-business-created:${business.id}`;
  const history = await historyRepo.findOne({
    where: { idempotencyKey: historyKey },
  });
  if (!history) {
    await historyRepo.save(
      historyRepo.create({
        businessId: business.id,
        business,
        eventType: BusinessHistoryEventType.BUSINESS_CREATED,
        description: `${BUSINESS_NAME} was created.`,
        actorUserId: user.id,
        actorUser: user,
        occurredAt: now,
        idempotencyKey: historyKey,
      }),
    );
    console.log('INSERT business history');
  }

  console.log(
    `Ready: ${EMAIL} can sign in, owns ${business.name} (${business.slug}), and is on ${plan.name}.`,
  );

  await AppDataSource.destroy();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  process.exit(1);
});
