import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { InvitationService } from './invitation.service';
import { CreateBusinessInvitationDto } from './invitationDto/create-business-invitation.dto';
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

  @UseGuards(AuthGuard('jwt'))
  @Post('businesses/:businessId/invitations')
  async createInvitation(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() dto: CreateBusinessInvitationDto,
    @Req() req: { user: AuthRequestUser },
  ) {
    return this.invitationService.createInvitation(businessId, dto, req.user);
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
