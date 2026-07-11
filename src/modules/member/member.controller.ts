import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { MemberService } from './member.service';
import { InviteMemberDto } from './memberDto/invite-member.dto';
import { AcceptMemberInviteDto } from './memberDto/accept-member-invite.dto';
import { GetMembersQueryDto } from './memberDto/get-members-query.dto';

type AuthRequest = Request & {
  user: {
    id: number;
    email: string;
    role?: { name: string } | null;
  };
};

@Controller('members')
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('invite')
  async inviteMember(
    @Body() dto: InviteMemberDto,
    @Req() req: AuthRequest,
  ) {
    return this.memberService.inviteMember(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  async getMembers(
    @Query() query: GetMembersQueryDto,
    @Req() req: AuthRequest,
  ) {
    return this.memberService.getMembers(query.businessId, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('accept')
  async acceptInvite(
    @Body() dto: AcceptMemberInviteDto,
    @Req() req: AuthRequest,
  ) {
    return this.memberService.acceptInvite(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  async removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
  ) {
    return this.memberService.removeMember(id, req.user);
  }
}
