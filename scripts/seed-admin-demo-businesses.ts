/**
 * Create 3 demo businesses for sameeryasir02@gmail.com (Hand Care, Coffee, Burger).
 * Usage: npx ts-node -r tsconfig-paths/register scripts/seed-admin-demo-businesses.ts
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';
import { Business } from '../src/db/entities/business.entity';
import { BusinessMember } from '../src/db/entities/business-member.entity';
import { BusinessMemberPermission } from '../src/db/entities/business-member-permission.entity';
import { Role } from '../src/db/entities/role.entity';
import { User } from '../src/db/entities/user.entity';
import { BUSINESS_MEMBER_STATUS } from '../src/modules/member/business-member-status';
import { ALL_BUSINESS_MEMBER_PERMISSIONS } from '../src/modules/member/member.constants';
import {
  isValidBusinessSlug,
  slugifyBusinessName,
} from '../src/utils/business-slug';

config();

const OWNER_EMAIL = 'sameeryasir02@gmail.com';

const DEMO_BUSINESSES = [
  {
    name: "Velvet Hand Care",
    businessType: "Retail",
    description:
      "Premium hand creams, lotions, and skincare essentials for everyday care.",
    email: "hello@velvethandcare.pk",
    phoneNumber: "+923001112233",
    websiteUrl: "https://www.velvethandcare.pk",
    city: "Rawalpindi",
    state: "Punjab",
    country: "Pakistan",
    postalCode: "46000",
    branchCount: 1,
  },
  {
    name: "Ember Coffee House",
    businessType: "Cafe",
    description:
      "Specialty coffee, fresh pastries, and a cozy neighborhood cafe experience.",
    email: "hello@embercoffee.pk",
    phoneNumber: "+923004445566",
    websiteUrl: "https://www.embercoffee.pk",
    city: "Rawalpindi",
    state: "Punjab",
    country: "Pakistan",
    postalCode: "46000",
    branchCount: 2,
  },
  {
    name: "Flame Burger Kitchen",
    businessType: "Restaurant",
    description:
      "Flame-grilled burgers, loaded fries, and fast casual dining.",
    email: "hello@flameburger.pk",
    phoneNumber: "+923007778899",
    websiteUrl: "https://www.flameburger.pk",
    city: "Rawalpindi",
    state: "Punjab",
    country: "Pakistan",
    postalCode: "46000",
    branchCount: 1,
  },
] as const;

async function resolveUniqueSlug(
  businessRepo: ReturnType<typeof AppDataSource.getRepository<Business>>,
  source: string,
): Promise<string> {
  const base = slugifyBusinessName(source) || 'business';
  const root = isValidBusinessSlug(base) ? base : 'business';
  let candidate = root;
  let suffix = 2;

  while (await businessRepo.exists({ where: { slug: candidate } })) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function ensureOwnerMembership(
  business: Business,
  owner: User,
  ownerRole: Role | null,
): Promise<void> {
  const memberRepo = AppDataSource.getRepository(BusinessMember);
  const permissionRepo = AppDataSource.getRepository(BusinessMemberPermission);

  let member = await memberRepo.findOne({
    where: {
      business: { id: business.id },
      user: { id: owner.id },
    },
  });

  if (!member) {
    member = await memberRepo.save(
      memberRepo.create({
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
    member = await memberRepo.save(member);
  }

  await permissionRepo.delete({ businessMember: { id: member.id } });
  await permissionRepo.save(
    ALL_BUSINESS_MEMBER_PERMISSIONS.map((permission) =>
      permissionRepo.create({
        businessMember: member!,
        permission,
      }),
    ),
  );
}

async function main() {
  await AppDataSource.initialize();

  const userRepo = AppDataSource.getRepository(User);
  const businessRepo = AppDataSource.getRepository(Business);
  const roleRepo = AppDataSource.getRepository(Role);

  const owner = await userRepo.findOne({
    where: { email: OWNER_EMAIL },
  });

  if (!owner) {
    throw new Error(`User not found: ${OWNER_EMAIL}`);
  }

  const ownerRole = await roleRepo.findOne({ where: { name: 'Owner' } });
  const now = new Date();
  const created: Array<{ id: number; name: string; slug: string }> = [];

  for (const demo of DEMO_BUSINESSES) {
    const existing = await businessRepo.findOne({
      where: {
        owner: { id: owner.id },
        name: demo.name,
      },
    });

    if (existing) {
      await ensureOwnerMembership(existing, owner, ownerRole);
      created.push({
        id: existing.id,
        name: existing.name,
        slug: existing.slug,
      });
      continue;
    }

    const slug = await resolveUniqueSlug(businessRepo, demo.name);
    const business = await businessRepo.save(
      businessRepo.create({
        name: demo.name,
        slug,
        description: demo.description,
        businessType: demo.businessType,
        currency: "PKR",
        email: demo.email,
        phoneNumber: demo.phoneNumber,
        websiteUrl: demo.websiteUrl,
        city: demo.city,
        state: demo.state,
        country: demo.country,
        postalCode: demo.postalCode,
        branchCount: demo.branchCount,
        owner,
        onboardingCompleted: true,
        onboardingCompletedAt: now,
      }),
    );

    await ensureOwnerMembership(business, owner, ownerRole);
    created.push({
      id: business.id,
      name: business.name,
      slug: business.slug,
    });
  }

  console.log(`Owner: ${OWNER_EMAIL} (id ${owner.id})`);
  console.log('Businesses:');
  for (const row of created) {
    console.log(`  - ${row.name} (#${row.id}, slug=${row.slug})`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });
