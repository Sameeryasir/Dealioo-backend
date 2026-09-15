import {
  Controller,
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
import { isAdminOrSuperAdmin } from '../../utils/user-roles';
import { BusinessAccessService } from '../business-access/business-access.service';
import { BusinessHistoryService } from './business-history.service';
import { GetBusinessHistoryQueryDto } from './dto/get-business-history-query.dto';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('business-history')
export class BusinessHistoryController {
  constructor(
    private readonly businessHistoryService: BusinessHistoryService,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId')
  async getBusinessHistory(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query() query: GetBusinessHistoryQueryDto,
    @Req() req: AuthRequest,
  ) {
    const context = await this.businessAccessService.getAccessContext(
      req.user,
      businessId,
    );

    if (!context) {
      if (!isAdminOrSuperAdmin(req.user)) {
        throw new NotFoundException(
          'Business not found or you do not have access to this business.',
        );
      }
      const business = await this.businessAccessService.findAccessibleBusiness(
        req.user,
        businessId,
      );
      if (!business) {
        throw new NotFoundException(
          'Business not found or you do not have access to this business.',
        );
      }
    } else if (context.access !== 'owner' && context.access !== 'super_admin') {
      await this.businessAccessService.assertAnyPermission(
        req.user,
        businessId,
        ['history'],
        'You do not have permission to view history for this business.',
      );
    }

    return this.businessHistoryService.getBusinessHistory(businessId, {
      page: query.page ?? 1,
      category: query.category ?? 'all',
      eventType: query.eventType,
      actorUserId: query.actorUserId,
      q: query.q,
    });
  }
}
