import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GoogleWalletCallbackDto } from './dto/google-wallet-callback.dto';
import { GoogleWalletCallbackResultDto } from './dto/google-wallet-callback-result.dto';
import { GoogleWalletService } from './google-wallet.service';

@Controller('google-wallet')
export class GoogleWalletController {
  private readonly logger = new Logger(GoogleWalletController.name);

  constructor(private readonly googleWalletService: GoogleWalletService) {}

  @Get('open')
  async openWalletSave(
    @Query('passId') passId?: string,
    @Query('token') token?: string,
    @Res() res?: Response,
  ): Promise<void> {
    const { googleSaveUrl } = await this.googleWalletService.openWalletSaveFlow(
      passId?.trim() ?? '',
      token?.trim() ?? '',
    );
    res!.redirect(302, googleSaveUrl);
  }

  @Post('callback')
  @HttpCode(200)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async handleCallback(
    @Body() dto: GoogleWalletCallbackDto,
    @Headers('user-agent') userAgent?: string,
    @Req() req?: Request,
  ): Promise<GoogleWalletCallbackResultDto> {
    const bodyKeys = dto && typeof dto === 'object' ? Object.keys(dto) : [];
    this.logger.log(
      `Google Wallet webhook HIT path=${req?.originalUrl ?? '/api/google-wallet/callback'} ua=${userAgent ?? '(none)'} bodyKeys=${bodyKeys.join(',') || '(empty)'}`,
    );

    const result = await this.googleWalletService.handleCallback(dto);

    this.logger.log(
      `Google Wallet webhook RESPONSE ${JSON.stringify(result)}`,
    );
    return result;
  }
}
