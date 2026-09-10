import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import {
  BusinessPermissionGuard,
  RequireBusinessPermission,
} from '../business-access';
import { InvitationService } from './invitation.service';
import { CreateBusinessInvitationDto } from './invitationDto/create-business-invitation.dto';
import { UpdateBusinessInvitationDto } from './invitationDto/update-business-invitation.dto';
import { ValidateInvitationQueryDto } from './invitationDto/validate-invitation-query.dto';
import { AcceptInvitationDto } from './invitationDto/accept-invitation.dto';

type AuthRequestUser = {
  id: number;
  email: string;
  role?: { name: string } | null;
};

@Controller()
export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  @UseGuards(AuthGuard('jwt'), BusinessPermissionGuard)
  @RequireBusinessPermission('members')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('businesses/:businessId/invitations')
  async createInvitation(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() dto: CreateBusinessInvitationDto,
    @Req() req: { user: AuthRequestUser },
  ) {
    return this.invitationService.createInvitation(businessId, dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'), BusinessPermissionGuard)
  @RequireBusinessPermission('members')
  @Patch('businesses/:businessId/invitations/:invitationId')
  async updateInvitation(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('invitationId', ParseIntPipe) invitationId: number,
    @Body() dto: UpdateBusinessInvitationDto,
    @Req() req: { user: AuthRequestUser },
  ) {
    return this.invitationService.updatePendingInvitation(
      businessId,
      invitationId,
      dto,
      req.user,
    );
  }

  @UseGuards(AuthGuard('jwt'), BusinessPermissionGuard)
  @RequireBusinessPermission('members')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('businesses/:businessId/invitations/:invitationId/resend')
  async resendInvitation(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('invitationId', ParseIntPipe) invitationId: number,
    @Req() req: { user: AuthRequestUser },
  ) {
    return this.invitationService.resendInvitation(
      businessId,
      invitationId,
      req.user,
    );
  }

  @UseGuards(AuthGuard('jwt'), BusinessPermissionGuard)
  @RequireBusinessPermission('members')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('businesses/:businessId/invitations/:invitationId/link')
  async regenerateInvitationLink(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('invitationId', ParseIntPipe) invitationId: number,
    @Req() req: { user: AuthRequestUser },
  ) {
    return this.invitationService.regenerateInvitationLink(
      businessId,
      invitationId,
      req.user,
    );
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('invitations/validate')
  async validateInvitation(@Query() query: ValidateInvitationQueryDto) {
    return this.invitationService.validateInvitation(query.token);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('invitations/accept')
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @Req() req: { user: AuthRequestUser },
  ) {
    return this.invitationService.acceptInvitationForUser(dto.token, req.user);
  }
}
