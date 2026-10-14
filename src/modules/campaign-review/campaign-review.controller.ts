import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { BusinessAccessService } from '../business-access/business-access.service';
import { campaignReviewsPermissionKeys } from '../member/member.constants';
import {
  ListCampaignReviewsQueryDto,
  SubmitCampaignFeedbackDto,
} from './campaign-review.dto';
import { CampaignReviewService } from './campaign-review.service';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('campaign-reviews')
export class CampaignReviewController {
  constructor(
    private readonly campaignReviewService: CampaignReviewService,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  @Get('feedback/:token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getPublicFeedback(@Param('token') token: string) {
    return this.campaignReviewService.getPublicFeedback(token);
  }

  @Post('feedback/:token')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  submitPublicFeedback(
    @Param('token') token: string,
    @Body() dto: SubmitCampaignFeedbackDto,
  ) {
    return this.campaignReviewService.submitPublicFeedback(token, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('campaign/:campaignId')
  async listForCampaign(
    @Param('campaignId') campaignIdRaw: string,
    @Query() query: ListCampaignReviewsQueryDto,
    @Req() req: AuthRequest,
  ) {
    const campaignId = Number.parseInt(campaignIdRaw, 10);
    await this.campaignReviewService.assertCampaignBelongsToBusiness(
      campaignId,
      query.businessId,
    );
    await this.businessAccessService.assertAnyPermission(
      req.user,
      query.businessId,
      campaignReviewsPermissionKeys(),
      'You do not have permission to view campaign reviews.',
    );
    return this.campaignReviewService.listCampaignReviews(
      campaignId,
      query.page ?? 1,
      query.limit ?? 10,
      {
        from: query.from,
        to: query.to,
        q: query.q,
        rating: query.rating,
      },
    );
  }
}
