import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { getFrontendBaseUrl } from '../../../utils/frontend-base-url';
import { FacebookConnectResponseDto } from './dto/facebook-connect-response.dto';
import { FacebookService } from './facebook.service';

@Controller('auth/facebook')
export class FacebookController {
  constructor(private readonly facebookService: FacebookService) {}

  @Get('login')
  async login(
    @Query('access_token') accessToken: string,
    @Res() res: Response,
  ) {
    const userId =
      await this.facebookService.resolveUserIdFromAccessToken(accessToken);
    const url = this.facebookService.buildOAuthLoginUrl(userId);
    return res.redirect(url);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const wantsJson =
      req.headers.accept?.includes('application/json') ?? false;

    try {
      const result = await this.facebookService.handleOAuthCallback(
        code,
        state,
        error,
        errorDescription,
      );

      if (wantsJson) {
        return res.json(result);
      }

      const pagesParam = encodeURIComponent(String(result.pages.length));
      return res.redirect(
        `${getFrontendBaseUrl()}/auth/facebook/success?connected=true&pages=${pagesParam}`,
      );
    } catch (err) {
      if (wantsJson) {
        throw err;
      }

      const message =
        err instanceof Error ? err.message : 'Facebook connection failed';
      return res.redirect(
        `${getFrontendBaseUrl()}/auth/facebook/success?connected=false&error=${encodeURIComponent(message)}`,
      );
    }
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status')
  async status(
    @Req() req: { user: { id: number } },
  ): Promise<FacebookConnectResponseDto> {
    return this.facebookService.getConnectionStatus(req.user.id);
  }
}
