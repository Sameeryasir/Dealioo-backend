import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { MemberService } from './member.service';
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
  @Get('me')
  async getMyAccess(
    @Query() query: GetMembersQueryDto,
    @Req() req: AuthRequest,
  ) {
    return this.memberService.getMyAccess(query.businessId, req.user);
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
  @Delete(':id')
  async removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
  ) {
    return this.memberService.removeMember(id, req.user);
  }
}
