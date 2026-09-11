import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { BusinessAccessService } from '../business-access/business-access.service';
import { GetCampaignAddonCountsQueryDto } from './addonSuggestionDto/get-campaign-addon-counts-query.dto';
import { GetCampaignAddonSuggestionsQueryDto } from './addonSuggestionDto/get-campaign-addon-suggestions-query.dto';
import { AddonSuggestionService } from './addon-suggestion.service';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

function parseOptionalQueryDate(
  value: string | undefined,
  fieldName: 'from' | 'to',
): Date | null {
  const raw = value?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(
      `Invalid "${fieldName}" date. Use a valid ISO date/time.`,
    );
  }
  return parsed;
}

@Controller('addon-suggestion')
export class AddonSuggestionController {
  constructor(
    private readonly addonSuggestionService: AddonSuggestionService,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/by-campaign')
  async getAddonCountsByCampaign(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query() query: GetCampaignAddonCountsQueryDto,
    @Req() req: AuthRequest,
  ) {
    await this.businessAccessService.assertAnyPermission(
      req.user,
      businessId,
      ['activity'],
      'You do not have permission to view add-on suggestions for this business.',
    );

    const from = parseOptionalQueryDate(query.from, 'from');
    const to = parseOptionalQueryDate(query.to, 'to');
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('"from" must be before or equal to "to".');
    }

    return this.addonSuggestionService.getAddonCountsByCampaign({
      businessId,
      from,
      to,
      campaignId: query.campaignId ?? null,
      limit: query.limit ?? 20,
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/suggestions')
  async getSuggestionsByCampaign(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query() query: GetCampaignAddonSuggestionsQueryDto,
    @Req() req: AuthRequest,
  ) {
    await this.businessAccessService.assertAnyPermission(
      req.user,
      businessId,
      ['activity'],
      'You do not have permission to view add-on suggestions for this business.',
    );

    const from = parseOptionalQueryDate(query.from, 'from');
    const to = parseOptionalQueryDate(query.to, 'to');
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('"from" must be before or equal to "to".');
    }

    return this.addonSuggestionService.getSuggestionsByCampaign({
      businessId,
      from,
      to,
      campaignId: query.campaignId ?? null,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 10,
    });
  }
}
