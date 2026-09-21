/**
 * Fill funnel page marketing copy from each campaign's name.
 *
 * What it does:
 * 1. Loads all non-deleted campaigns with their funnels + funnel pages
 * 2. Builds headline / subheadline / body / CTA text from campaignName
 *    (uses offer + description when present)
 * 3. Merges that text into landing, signup, payment, and confirmation schemas
 * 4. Writes a funnel_page_versions row and bumps funnel content_revision
 *
 * By default only fills blank text fields. Pass --force to overwrite existing copy.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/fill-funnel-pages-from-campaign-names.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register scripts/fill-funnel-pages-from-campaign-names.ts
 *   npx ts-node -r tsconfig-paths/register scripts/fill-funnel-pages-from-campaign-names.ts --force
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { IsNull } from 'typeorm';
import AppDataSource from '../src/data-source';
import { Campaign, CampaignType } from '../src/db/entities/campaign.entity';
import { Funnel } from '../src/db/entities/funnel.entity';
import { FunnelPage } from '../src/db/entities/funnel-page.entity';
import {
  FunnelPageType,
  FUNNEL_PAGE_TYPES,
  FUNNEL_PAGE_TYPES_WITHOUT_PAYMENT,
} from '../src/db/entities/funnel-page-type';
import { FunnelPageVersion } from '../src/db/entities/funnel-page-version.entity';
import {
  buildCampaignFunnelCopy,
  type CampaignFunnelPageCopy,
} from '../src/modules/funnel-pages/campaign-funnel-copy.util';

config();

type PageCopy = CampaignFunnelPageCopy;

type CampaignCopyPack = {
  landing: PageCopy;
  signup: PageCopy;
  payment: PageCopy;
  confirmation: PageCopy;
};

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

function buildCopyForCampaign(campaign: Campaign): CampaignCopyPack {
  return buildCampaignFunnelCopy({
    campaignName: campaign.campaignName,
    offer: campaign.offer,
    description: campaign.description,
  });
}

function mergePageCopy(
  schema: Record<string, unknown>,
  copy: PageCopy,
  force: boolean,
): { next: Record<string, unknown>; changed: boolean } {
  const next: Record<string, unknown> = { ...schema };
  let changed = false;

  const apply = (key: keyof PageCopy, value: string | undefined) => {
    if (value == null) return;
    if (!force && !isBlank(schema[key])) return;
    if (schema[key] === value) return;
    next[key] = value;
    changed = true;
  };

  apply('pageTitle', copy.pageTitle);
  apply('headline', copy.headline);
  apply('subheadline', copy.subheadline);
  apply('body', copy.body);
  apply('ctaLabel', copy.ctaLabel);

  // Keep editor-side aliases in sync when those keys already exist.
  if ('heading' in schema || force) {
    if (force || isBlank(schema.heading)) {
      if (schema.heading !== copy.headline) {
        next.heading = copy.headline;
        changed = true;
      }
    }
  }
  if ('subheading' in schema || force) {
    if (force || isBlank(schema.subheading)) {
      if (schema.subheading !== copy.subheadline) {
        next.subheading = copy.subheadline;
        changed = true;
      }
    }
  }
  if ('buttonText' in schema || force) {
    if (force || isBlank(schema.buttonText)) {
      if (schema.buttonText !== copy.ctaLabel) {
        next.buttonText = copy.ctaLabel;
        changed = true;
      }
    }
  }

  return { next, changed };
}

function copyForPageType(
  pack: CampaignCopyPack,
  pageType: FunnelPageType,
): PageCopy | null {
  switch (pageType) {
    case FunnelPageType.LANDING:
      return pack.landing;
    case FunnelPageType.SIGNUP:
      return pack.signup;
    case FunnelPageType.PAYMENT:
      return pack.payment;
    case FunnelPageType.CONFIRMATION:
      return pack.confirmation;
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  await AppDataSource.initialize();

  const campaignRepo = AppDataSource.getRepository(Campaign);
  const funnelRepo = AppDataSource.getRepository(Funnel);
  const pageRepo = AppDataSource.getRepository(FunnelPage);
  const versionRepo = AppDataSource.getRepository(FunnelPageVersion);

  console.log(
    dryRun
      ? 'Dry run — no DB writes will be made.'
      : 'Updating funnel page text from campaign names…',
  );
  console.log(
    `Mode: ${force ? 'overwrite existing copy (--force)' : 'fill blank fields only'}`,
  );
  console.log(
    `DB: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  );

  const campaigns = await campaignRepo.find({
    where: { deletedAt: IsNull() },
    order: { id: 'ASC' },
  });

  if (campaigns.length === 0) {
    console.log('No campaigns found.');
    await AppDataSource.destroy();
    return;
  }

  let campaignsTouched = 0;
  let pagesUpdated = 0;
  let pagesSkipped = 0;
  let pagesCreated = 0;
  let campaignsWithoutFunnel = 0;

  for (const campaign of campaigns) {
    const funnel = await funnelRepo.findOne({
      where: { campaignId: campaign.id, deletedAt: IsNull() },
    });

    if (!funnel) {
      campaignsWithoutFunnel += 1;
      console.log(
        `  skip campaign #${campaign.id} "${campaign.campaignName}" — no funnel`,
      );
      continue;
    }

    let pages = await pageRepo.find({
      where: { funnelId: funnel.id },
      order: { pageType: 'ASC' },
    });

    const requiredTypes =
      campaign.campaignType === CampaignType.POSTPAID
        ? FUNNEL_PAGE_TYPES_WITHOUT_PAYMENT
        : FUNNEL_PAGE_TYPES;
    const existingTypes = new Set(pages.map((page) => page.pageType));
    const missingTypes = requiredTypes.filter((type) => !existingTypes.has(type));

    if (missingTypes.length > 0) {
      if (dryRun) {
        console.log(
          `  campaign #${campaign.id} "${campaign.campaignName}" → would create pages: ${missingTypes.join(', ')}`,
        );
        pagesCreated += missingTypes.length;
        // Synthetic pages so dry-run can still preview the copy merge.
        pages = [
          ...pages,
          ...missingTypes.map(
            (pageType) =>
              ({
                id: `dry-run-${funnel.id}-${pageType}`,
                funnelId: funnel.id,
                pageType,
                schema: {},
                currentVersion: 1,
              }) as FunnelPage,
          ),
        ];
      } else {
        await AppDataSource.transaction(async (manager) => {
          const txPageRepo = manager.getRepository(FunnelPage);
          const txVersionRepo = manager.getRepository(FunnelPageVersion);

          for (const pageType of missingTypes) {
            const created = await txPageRepo.save(
              txPageRepo.create({
                funnelId: funnel.id,
                pageType,
                schema: {},
                currentVersion: 1,
              }),
            );
            await txVersionRepo.save(
              txVersionRepo.create({
                funnelPageId: created.id,
                funnelId: funnel.id,
                pageType,
                businessId: funnel.businessId,
                versionNumber: 1,
                schema: {},
                operationId: 'fill-funnel-pages-from-campaign-names',
                createdById: null,
              }),
            );
            pagesCreated += 1;
            console.log(
              `  campaign #${campaign.id} "${campaign.campaignName}" → created ${pageType} page`,
            );
          }
        });

        pages = await pageRepo.find({
          where: { funnelId: funnel.id },
          order: { pageType: 'ASC' },
        });
      }
    }

    if (pages.length === 0) {
      console.log(
        `  skip campaign #${campaign.id} "${campaign.campaignName}" — funnel has no pages`,
      );
      continue;
    }

    const pack = buildCopyForCampaign(campaign);
    const changedPages: Array<{
      page: FunnelPage;
      nextSchema: Record<string, unknown>;
    }> = [];

    for (const page of pages) {
      const copy = copyForPageType(pack, page.pageType);
      if (!copy) {
        pagesSkipped += 1;
        continue;
      }

      const schema =
        page.schema && typeof page.schema === 'object' && !Array.isArray(page.schema)
          ? { ...(page.schema as Record<string, unknown>) }
          : {};

      const { next, changed } = mergePageCopy(schema, copy, force);
      if (!changed) {
        pagesSkipped += 1;
        continue;
      }

      changedPages.push({ page, nextSchema: next });
    }

    if (changedPages.length === 0) {
      continue;
    }

    campaignsTouched += 1;
    console.log(
      `  campaign #${campaign.id} "${campaign.campaignName}" → ${changedPages.length} page(s)`,
    );

    if (dryRun) {
      for (const item of changedPages) {
        console.log(
          `    would update ${item.page.pageType}: headline="${String(item.nextSchema.headline ?? '')}"`,
        );
        pagesUpdated += 1;
      }
      continue;
    }

    await AppDataSource.transaction(async (manager) => {
      const txPageRepo = manager.getRepository(FunnelPage);
      const txVersionRepo = manager.getRepository(FunnelPageVersion);
      const txFunnelRepo = manager.getRepository(Funnel);

      for (const item of changedPages) {
        const nextVersion = item.page.currentVersion + 1;
        item.page.schema = item.nextSchema;
        item.page.currentVersion = nextVersion;
        await txPageRepo.save(item.page);

        await txVersionRepo.save(
          txVersionRepo.create({
            funnelPageId: item.page.id,
            funnelId: funnel.id,
            pageType: item.page.pageType,
            businessId: funnel.businessId,
            versionNumber: nextVersion,
            schema: structuredClone(item.nextSchema),
            operationId: 'fill-funnel-pages-from-campaign-names',
            createdById: null,
          }),
        );

        pagesUpdated += 1;
        console.log(
          `    updated ${item.page.pageType} → v${nextVersion} headline="${String(item.nextSchema.headline ?? '')}"`,
        );
      }

      funnel.contentRevision = (funnel.contentRevision ?? 0) + 1;
      await txFunnelRepo.save(funnel);
    });
  }

  console.log('');
  console.log(
    `Done. campaigns=${campaigns.length} touched=${campaignsTouched} pagesCreated=${pagesCreated} pagesUpdated=${pagesUpdated} pagesSkipped=${pagesSkipped} withoutFunnel=${campaignsWithoutFunnel}`,
  );

  await AppDataSource.destroy();
}

main().catch(async (error) => {
  console.error(error);
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  process.exit(1);
});
