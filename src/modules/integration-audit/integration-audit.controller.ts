import {
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { requireAdminRole } from '../../utils/require-admin-role';
import { BusinessAccessService } from '../business-access/business-access.service';
import { IntegrationAuditService } from './integration-audit.service';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('integration-audit')
export class IntegrationAuditController {
  constructor(
    private readonly integrationAuditService: IntegrationAuditService,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId')
  async listForBusiness(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('provider') provider?: string,
    @Query('eventType') eventType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('tzOffset') tzOffsetRaw?: string,
    @Req() req: AuthRequest,
  ) {
    requireAdminRole(
      req.user,
      'Only the account owner can view integration logs.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      req.user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }

    const tzOffset = Number(tzOffsetRaw);
    return this.integrationAuditService.listForBusiness(businessId, {
      page,
      provider,
      eventType,
      from,
      to,
      tzOffset: Number.isFinite(tzOffset) ? tzOffset : undefined,
    });
  }
}
