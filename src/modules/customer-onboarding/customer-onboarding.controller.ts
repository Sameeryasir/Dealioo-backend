import {
  Body,
  Controller,
  DefaultValuePipe,
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
import { User } from '../../db/entities/user.entity';
import { SuperAdminGuard } from '../platform-admin/super-admin.guard';
import { CustomerOnboardingService } from './customer-onboarding.service';
import { CreateAccountFromMeetingDto } from './dto/create-account-from-meeting.dto';
import { CreateOnboardingBusinessDto } from './dto/create-onboarding-business.dto';
import { UpdateCustomerOnboardingDto } from './dto/update-customer-onboarding.dto';
import { UpdateMeetingOutcomeDto } from './dto/update-meeting-outcome.dto';
import { UpdateOnboardingTaskDto } from './dto/update-onboarding-task.dto';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), SuperAdminGuard)
export class CustomerOnboardingController {
  constructor(
    private readonly customerOnboardingService: CustomerOnboardingService,
  ) {}

  @Patch('meeting-requests/:id/outcome')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  updateMeetingOutcome(
    @Req() req: { user: User },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateMeetingOutcomeDto,
  ) {
    return this.customerOnboardingService.updateMeetingOutcome(
      req.user,
      id,
      body,
    );
  }

  @Post('meeting-requests/:id/onboarding')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  startOnboarding(
    @Req() req: { user: User },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreateAccountFromMeetingDto = {},
  ) {
    return this.customerOnboardingService.startOnboardingFromMeeting(
      req.user,
      id,
      body ?? {},
    );
  }

  @Get('customer-onboardings')
  listOnboardings(
    @Req() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('sort') sort?: string,
  ) {
    const normalizedSort =
      sort === 'newest' || sort === 'oldest' || sort === 'updated'
        ? sort
        : 'updated';
    return this.customerOnboardingService.listOnboardings(
      req.user,
      page,
      limit,
      search,
      status,
      normalizedSort,
    );
  }

  @Get('customer-onboardings/:id')
  getOnboarding(
    @Req() req: { user: User },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.customerOnboardingService.getOnboarding(req.user, id);
  }

  @Patch('customer-onboardings/:id')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  updateOnboarding(
    @Req() req: { user: User },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCustomerOnboardingDto,
  ) {
    return this.customerOnboardingService.updateOnboarding(req.user, id, body);
  }

  @Post('customer-onboardings/:id/prepare-account')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  prepareAccount(
    @Req() req: { user: User },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.customerOnboardingService.prepareAccount(req.user, id);
  }

  @Post('customer-onboardings/:id/create-business')
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  createBusiness(
    @Req() req: { user: User },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreateOnboardingBusinessDto,
  ) {
    return this.customerOnboardingService.createOrLinkBusiness(
      req.user,
      id,
      body,
    );
  }

  @Patch('customer-onboardings/:id/tasks/:taskId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  updateTask(
    @Req() req: { user: User },
    @Param('id', ParseIntPipe) id: number,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() body: UpdateOnboardingTaskDto,
  ) {
    return this.customerOnboardingService.updateTask(
      req.user,
      id,
      taskId,
      body,
    );
  }
}
