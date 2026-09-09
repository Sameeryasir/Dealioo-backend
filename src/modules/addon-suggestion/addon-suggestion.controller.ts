import {
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
import { AddonSuggestionService } from './addon-suggestion.service';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

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

    const from = query.from?.trim() ? new Date(query.from) : null;
    const to = query.to?.trim() ? new Date(query.to) : null;

    return this.addonSuggestionService.getAddonCountsByCampaign({
      businessId,
      from:
        from != null && !Number.isNaN(from.getTime()) ? from : null,
      to: to != null && !Number.isNaN(to.getTime()) ? to : null,
      campaignId: query.campaignId ?? null,
      limit: query.limit ?? 20,
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/suggestions')
  async getSuggestionsByCampaign(
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

    const from = query.from?.trim() ? new Date(query.from) : null;
    const to = query.to?.trim() ? new Date(query.to) : null;

    return this.addonSuggestionService.getSuggestionsByCampaign({
      businessId,
      from:
        from != null && !Number.isNaN(from.getTime()) ? from : null,
      to: to != null && !Number.isNaN(to.getTime()) ? to : null,
      campaignId: query.campaignId ?? null,
      limit: query.limit ?? query.pageSize ?? 10,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? query.limit ?? 10,
    });
  }
}
