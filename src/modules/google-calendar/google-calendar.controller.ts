import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { isAdminOrSuperAdmin } from '../../utils/user-roles';
import { JwtAuthGuard } from '../auth/jwt/jwt-auth.guard';
import { CreateCalendarEventDto } from './create-calendar-event.dto';
import { GoogleCalendarService } from './google-calendar.service';

type SignedInUser = {
  role?: { name: string } | null;
};

@Controller('google')
export class GoogleCalendarController {
  private readonly logger = new Logger(GoogleCalendarController.name);

  constructor(private readonly googleCalendarService: GoogleCalendarService) {}

  @Get('connect')
  @UseGuards(JwtAuthGuard)
  connect(@Req() req: { user?: SignedInUser }, @Res() res: Response): void {
    if (!isAdminOrSuperAdmin(req.user ?? null)) {
      throw new ForbiddenException(
        'Only an admin can connect the company Google Calendar.',
      );
    }
    res.redirect(this.googleCalendarService.buildConnectUrl());
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@Req() req: { user?: SignedInUser }) {
    assertAdmin(req.user);
    return this.googleCalendarService.connectionStatus();
  }

  @Post('events')
  @UseGuards(JwtAuthGuard)
  createEvent(
    @Req() req: { user?: SignedInUser },
    @Body() dto: CreateCalendarEventDto,
  ) {
    assertAdmin(req.user);
    return this.googleCalendarService.createEvent(dto);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (error || !code || !state) {
      res
        .status(400)
        .type('html')
        .send(
          page(
            'Google Calendar was not connected. You can close this page and try again.',
          ),
        );
      return;
    }

    try {
      const email = await this.googleCalendarService.connectFromCallback(
        code,
        state,
      );
      res
        .status(200)
        .type('html')
        .send(
          page(
            `Google Calendar is connected for ${escapeHtml(email)}. New meeting bookings will be added to that calendar.`,
          ),
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Google Calendar connect failed: ${message}`);
      res
        .status(400)
        .type('html')
        .send(
          page(
            'Google Calendar was not connected. Start the connection again from the admin account.',
          ),
        );
    }
  }
}

function assertAdmin(user: SignedInUser | undefined): void {
  if (!isAdminOrSuperAdmin(user ?? null)) {
    throw new ForbiddenException(
      'Only an admin can connect the company Google Calendar.',
    );
  }
}

function page(message: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;padding:40px"><p>${message}</p></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
