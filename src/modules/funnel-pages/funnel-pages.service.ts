import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelPage } from '../../db/entities/funnel-page.entity';
import {
  FUNNEL_PAGE_TYPES,
  FunnelPageType,
  isFunnelPageType,
} from '../../db/entities/funnel-page-type';
import { FunnelPageVersion } from '../../db/entities/funnel-page-version.entity';

export type SyncFunnelPagesInput = {
  funnelId: number;
  businessId: number | null;
  pages: Record<string, unknown>;
  onlyTypes?: FunnelPageType[];
  createdById?: number | null;
  operationId?: string | null;
  bumpRevision?: boolean;
};

@Injectable()
export class FunnelPagesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(FunnelPage)
    private readonly funnelPageRepository: Repository<FunnelPage>,
    @InjectRepository(FunnelPageVersion)
    private readonly funnelPageVersionRepository: Repository<FunnelPageVersion>,
  ) {}

  assembleFromRows(rows: FunnelPage[]): Record<string, unknown> {
    const pages: Record<string, unknown> = {};
    for (const type of FUNNEL_PAGE_TYPES) {
      pages[type] = {};
    }
    for (const row of rows) {
      pages[row.pageType] = structuredClone(row.schema ?? {});
    }
    return pages;
  }

  async loadAssembledPages(funnelId: number): Promise<Record<string, unknown>> {
    const rows = await this.funnelPageRepository.find({
      where: { funnelId },
    });
    return this.assembleFromRows(rows);
  }

  async loadSubsetPages(
    funnelId: number,
    types: FunnelPageType[],
  ): Promise<Record<string, unknown>> {
    if (types.length === 0) {
      return {};
    }

    const rows = await this.funnelPageRepository.find({
      where: { funnelId, pageType: In(types) },
    });

    const subset: Record<string, unknown> = {};
    for (const type of types) {
      const row = rows.find((r) => r.pageType === type);
      subset[type] = structuredClone(row?.schema ?? {});
    }
    return subset;
  }

  resolveAffectedPageTypes(
    pageId: string | undefined,
    userInstruction: string,
    patchKeys?: string[],
  ): FunnelPageType[] {
    if (patchKeys != null && patchKeys.length > 0) {
      const fromPatch = patchKeys.filter(isFunnelPageType);
      if (fromPatch.length > 0) {
        return fromPatch;
      }
    }

    const text = userInstruction.toLowerCase();
    const multiPage =
      /\b(all pages|every page|across (all|every)|branding|all cta|all buttons|every cta|colours|colors)\b/.test(
        text,
      );

    if (multiPage) {
      return [...FUNNEL_PAGE_TYPES];
    }

    if (pageId && isFunnelPageType(pageId)) {
      return [pageId];
    }

    const mentioned = FUNNEL_PAGE_TYPES.filter((type) =>
      text.includes(type),
    );
    if (mentioned.length > 0) {
      return mentioned;
    }

    return pageId && isFunnelPageType(pageId)
      ? [pageId]
      : [...FUNNEL_PAGE_TYPES];
  }

  pickSubsetSchema(
    pages: Record<string, unknown> | undefined,
    types: FunnelPageType[],
  ): Record<string, unknown> {
    const source = pages ?? {};
    const subset: Record<string, unknown> = {};
    for (const type of types) {
      const value = source[type];
      subset[type] =
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? structuredClone(value as Record<string, unknown>)
          : {};
    }
    return subset;
  }

  async syncPages(input: SyncFunnelPagesInput): Promise<{
    assembledPages: Record<string, unknown>;
    changedTypes: FunnelPageType[];
  }> {
    const typesToWrite =
      input.onlyTypes ??
      FUNNEL_PAGE_TYPES.filter((type) => type in (input.pages ?? {}));

    const changedTypes: FunnelPageType[] = [];

    await this.dataSource.transaction(async (manager) => {
      const pageRepo = manager.getRepository(FunnelPage);
      const versionRepo = manager.getRepository(FunnelPageVersion);
      const funnelRepo = manager.getRepository(Funnel);

      for (const pageType of typesToWrite) {
        const nextSchema = this.asPageObject(input.pages[pageType]);
        let page = await pageRepo.findOne({
          where: { funnelId: input.funnelId, pageType },
        });

        if (!page) {
          page = pageRepo.create({
            funnelId: input.funnelId,
            pageType,
            schema: nextSchema,
            currentVersion: 1,
          });
          page = await pageRepo.save(page);
          await versionRepo.save(
            versionRepo.create({
              funnelPageId: page.id,
              funnelId: input.funnelId,
              pageType,
              businessId: input.businessId,
              versionNumber: 1,
              schema: structuredClone(nextSchema),
              operationId: input.operationId ?? null,
              createdById: input.createdById ?? null,
            }),
          );
          changedTypes.push(pageType);
          continue;
        }

        if (this.stableStringify(page.schema) === this.stableStringify(nextSchema)) {
          continue;
        }

        const nextVersion = page.currentVersion + 1;
        page.schema = nextSchema;
        page.currentVersion = nextVersion;
        await pageRepo.save(page);
        await versionRepo.save(
          versionRepo.create({
            funnelPageId: page.id,
            funnelId: input.funnelId,
            pageType,
            businessId: input.businessId,
            versionNumber: nextVersion,
            schema: structuredClone(nextSchema),
            operationId: input.operationId ?? null,
            createdById: input.createdById ?? null,
          }),
        );
        changedTypes.push(pageType);
      }

      for (const pageType of FUNNEL_PAGE_TYPES) {
        const exists = await pageRepo.exist({
          where: { funnelId: input.funnelId, pageType },
        });
        if (!exists) {
          const created = await pageRepo.save(
            pageRepo.create({
              funnelId: input.funnelId,
              pageType,
              schema: {},
              currentVersion: 1,
            }),
          );
          await versionRepo.save(
            versionRepo.create({
              funnelPageId: created.id,
              funnelId: input.funnelId,
              pageType,
              businessId: input.businessId,
              versionNumber: 1,
              schema: {},
              operationId: null,
              createdById: input.createdById ?? null,
            }),
          );
        }
      }

      if (input.bumpRevision !== false) {
        const funnel = await funnelRepo.findOne({
          where: { id: input.funnelId },
        });
        if (funnel) {
          if (input.businessId != null) {
            funnel.businessId = input.businessId;
          }
          if (changedTypes.length > 0) {
            funnel.contentRevision = (funnel.contentRevision ?? 0) + 1;
          }
          await funnelRepo.save(funnel);
        }
      }
    });

    const assembledPages = await this.loadAssembledPages(input.funnelId);
    return { assembledPages, changedTypes };
  }

  async initializeEmptyPages(input: {
    funnelId: number;
    businessId: number | null;
    createdById?: number | null;
  }): Promise<void> {
    await this.syncPages({
      funnelId: input.funnelId,
      businessId: input.businessId,
      pages: {
        landing: {},
        signup: {},
        payment: {},
        confirmation: {},
      },
      createdById: input.createdById ?? null,
      bumpRevision: true,
    });
  }

  private asPageObject(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return structuredClone(value as Record<string, unknown>);
    }
    return {};
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(value ?? {});
  }
}
