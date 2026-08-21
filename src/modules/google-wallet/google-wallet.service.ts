import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as jwt from 'jsonwebtoken';
import { Repository } from 'typeorm';
import { Coupon } from '../../db/entities/coupon.entity';
import { CreateGoogleWalletSaveLinkDto } from './dto/create-google-wallet-save-link.dto';
import { GoogleWalletCallbackDto } from './dto/google-wallet-callback.dto';
import { GoogleWalletCallbackResultDto } from './dto/google-wallet-callback-result.dto';
import { GoogleWalletSaveLinkResultDto } from './dto/google-wallet-save-link-result.dto';

@Injectable()
export class GoogleWalletService {
  private readonly logger = new Logger(GoogleWalletService.name);

  private readonly issuerId: string;
  private readonly classSuffix: string;
  private readonly serviceAccountEmail: string;
  private readonly privateKeyPem: string;
  private readonly origins: string[];

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Coupon)
    private readonly couponRepository: Repository<Coupon>,
  ) {
    this.issuerId =
      this.configService.get<string>('GOOGLE_WALLET_ISSUER_ID')?.trim() || '';
    this.classSuffix =
      this.configService.get<string>('GOOGLE_WALLET_CLASS_ID')?.trim() || '';
    this.serviceAccountEmail =
      this.configService
        .get<string>('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL')
        ?.trim() || '';
    this.privateKeyPem = this.normalizePrivateKey(
      this.configService.get<string>('GOOGLE_WALLET_PRIVATE_KEY') || '',
    );
    this.origins = this.resolveOrigins();

    if (
      !this.issuerId ||
      !this.classSuffix ||
      !this.serviceAccountEmail ||
      !this.privateKeyPem
    ) {
      throw new Error(
        'GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_CLASS_ID, GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL, and GOOGLE_WALLET_PRIVATE_KEY must be set.',
      );
    }
  }

  async createSaveLink(
    pass: CreateGoogleWalletSaveLinkDto,
  ): Promise<GoogleWalletSaveLinkResultDto> {
    const passId = pass.passId?.trim();
    const offerName = pass.offerName?.trim();
    const businessName = pass.businessName?.trim();
    const qrOrRedemptionUrl = pass.qrOrRedemptionUrl?.trim();
    const qrToken = pass.qrToken?.trim();

    if (!passId || !offerName || !businessName || !qrOrRedemptionUrl || !qrToken) {
      throw new InternalServerErrorException(
        'Google Wallet pass requires passId, offerName, businessName, qrOrRedemptionUrl, and qrToken.',
      );
    }

    const classSuffix = this.classSuffix.includes('.')
      ? this.classSuffix.split('.').pop()!
      : this.classSuffix;
    const objectId = await this.resolveStableObjectId(passId);
    const classId = `${this.issuerId}.${classSuffix}`;

    const couponIdNum = Number(passId);
    const barcodePayload = JSON.stringify({
      couponId: Number.isFinite(couponIdNum) ? couponIdNum : passId,
      token: qrToken,
    });

    const genericObject = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      cardTitle: {
        defaultValue: {
          language: 'en-US',
          value: businessName,
        },
      },
      header: {
        defaultValue: {
          language: 'en-US',
          value: offerName,
        },
      },
      barcode: {
        type: 'QR_CODE',
        value: barcodePayload,
        alternateText: offerName,
      },
      textModulesData: [
        {
          id: 'business',
          header: 'Business',
          body: businessName,
        },
        {
          id: 'offer',
          header: 'Offer',
          body: offerName,
        },
      ],
      linksModuleData: {
        uris: [
          {
            uri: qrOrRedemptionUrl,
            description: 'Open Dealioo pass',
            id: 'dealioo_pass',
          },
        ],
      },
    };

    const claims = {
      iss: this.serviceAccountEmail,
      aud: 'google',
      typ: 'savetowallet',
      origins: this.origins,
      payload: {
        genericObjects: [genericObject],
      },
    };

    let signedJwt: string;
    try {
      signedJwt = jwt.sign(claims, this.privateKeyPem, {
        algorithm: 'RS256',
      });
    } catch (err) {
      this.logger.error(
        `Google Wallet JWT sign failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException(
        'Could not sign Google Wallet pass. Check GOOGLE_WALLET_PRIVATE_KEY.',
      );
    }

    const saveUrl = `https://pay.google.com/gp/v/save/${signedJwt}`;

    await this.persistObjectIdForCouponIfAbsent(passId, objectId);

    this.logger.log(
      `Google Wallet save link created objectId=${objectId} classId=${classId} passId=${passId}`,
    );

    return { saveUrl, objectId, classId };
  }

  async handleCallback(
    dto: GoogleWalletCallbackDto,
  ): Promise<GoogleWalletCallbackResultDto> {
    const parsed = this.parseCallbackBody(dto);
    const eventType = parsed.eventType;
    const objectId = parsed.objectId;

    this.logger.log(
      `Google Wallet callback parsed eventType=${eventType || 'unknown'} objectId=${objectId || 'n/a'} classId=${parsed.classId || 'n/a'}`,
    );

    if (!objectId) {
      this.logger.warn(
        'Google Wallet callback: no objectId parsed — coupon flags not updated (check signed payload / delivery)',
      );
      return { success: true, updated: false, reason: 'missing_object_id' };
    }

    if (eventType === 'save') {
      this.logger.log(`User added pass to Google Wallet: ${objectId}`);

      const pass = await this.findCouponForWalletObjectId(objectId);

      if (pass) {
        await this.couponRepository.update(
          { id: pass.id },
          {
            googleWalletObjectId: objectId,
            googleWalletAdded: true,
            googleWalletAddedAt: new Date(),
            googleWalletRemovedAt: null,
          },
        );
        this.logger.log(
          `Google Wallet SAVE applied couponId=${pass.id} googleWalletAdded=true`,
        );
        return {
          success: true,
          updated: true,
          eventType: 'save',
          couponId: pass.id,
        };
      }

      this.logger.warn(
        `Google Wallet save callback: no coupon for objectId=${objectId}`,
      );
      return {
        success: true,
        updated: false,
        reason: 'coupon_not_found',
        eventType: 'save',
      };
    }

    if (eventType === 'del') {
      this.logger.log(`User removed pass from Google Wallet: ${objectId}`);

      const pass = await this.findCouponForWalletObjectId(objectId);
      if (!pass) {
        this.logger.warn(
          `Google Wallet del callback: no coupon for objectId=${objectId}`,
        );
        return {
          success: true,
          updated: false,
          reason: 'coupon_not_found',
          eventType: 'del',
        };
      }

      await this.couponRepository.update(
        { id: pass.id },
        {
          googleWalletAdded: false,
          googleWalletRemovedAt: new Date(),
        },
      );
      this.logger.log(
        `Google Wallet DEL applied couponId=${pass.id} objectId=${objectId}`,
      );
      return {
        success: true,
        updated: true,
        eventType: 'del',
        couponId: pass.id,
      };
    }

    this.logger.warn(
      `Google Wallet callback: unhandled eventType=${eventType || '(empty)'} objectId=${objectId}`,
    );
    return {
      success: true,
      updated: false,
      reason: 'unhandled_event_type',
      eventType: eventType || null,
    };
  }

  private parseCallbackBody(dto: GoogleWalletCallbackDto): {
    eventType: string;
    objectId: string;
    classId: string;
  } {
    let eventType = String(dto.eventType ?? '').trim().toLowerCase();
    let objectId = String(dto.objectId ?? '').trim();
    let classId = String(dto.classId ?? '').trim();

    const signedMessage = dto.signedMessage?.trim();
    if (signedMessage) {
      try {
        const decoded = JSON.parse(signedMessage) as GoogleWalletCallbackDto;
        eventType =
          eventType || String(decoded.eventType ?? '').trim().toLowerCase();
        objectId = objectId || String(decoded.objectId ?? '').trim();
        classId = classId || String(decoded.classId ?? '').trim();
        this.logger.log(
          `Google Wallet callback signedMessage parsed eventType=${eventType || '(empty)'} objectId=${objectId || '(empty)'}`,
        );
      } catch {
        this.logger.warn(
          'Google Wallet callback signedMessage was not plain JSON (may need signature unseal)',
        );
      }
    }

    return { eventType, objectId, classId };
  }

  private async resolveStableObjectId(passId: string): Promise<string> {
    const couponId = Number(passId);
    if (Number.isFinite(couponId) && couponId >= 1) {
      const coupon = await this.couponRepository.findOne({
        where: { id: couponId },
        select: ['id', 'googleWalletObjectId'],
      });
      const existing = coupon?.googleWalletObjectId?.trim();
      if (existing) {
        this.logger.log(
          `Google Wallet reusing objectId=${existing} for coupon ${couponId}`,
        );
        return existing;
      }
    }

    const safePassId = passId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
    return `${this.issuerId}.dealioo_${safePassId}`;
  }

  private async persistObjectIdForCouponIfAbsent(
    passId: string,
    objectId: string,
  ): Promise<void> {
    const couponId = Number(passId);
    if (!Number.isFinite(couponId) || couponId < 1) {
      return;
    }

    try {
      await this.couponRepository
        .createQueryBuilder()
        .update(Coupon)
        .set({ googleWalletObjectId: objectId })
        .where('id = :id', { id: couponId })
        .andWhere('google_wallet_object_id IS NULL')
        .execute();
    } catch (err) {
      this.logger.warn(
        `Could not store googleWalletObjectId for coupon ${couponId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async findCouponForWalletObjectId(
    objectId: string,
  ): Promise<Coupon | null> {
    const byExact = await this.couponRepository.findOne({
      where: { googleWalletObjectId: objectId },
    });
    if (byExact) {
      return byExact;
    }

    const match = objectId.match(/\.dealioo_(\d+)(?:_|$)/);
    if (!match) {
      return null;
    }

    const couponId = Number(match[1]);
    if (!Number.isFinite(couponId) || couponId < 1) {
      return null;
    }

    const byCouponId = await this.couponRepository.findOne({
      where: { id: couponId },
    });
    if (byCouponId) {
      this.logger.log(
        `Google Wallet callback matched coupon ${couponId} via objectId suffix (exact objectId row missing)`,
      );
    }
    return byCouponId;
  }

  private normalizePrivateKey(raw: string): string {
    let key = raw.trim();
    if (
      (key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))
    ) {
      key = key.slice(1, -1);
    }
    return key.replace(/\\n/g, '\n').trim();
  }

  private resolveOrigins(): string[] {
    const frontendRaw =
      this.configService.get<string>('FRONTEND_URL')?.trim() || '';
    const fromFrontend = frontendRaw
      .split(',')
      .map((part) => part.trim().replace(/\/$/, ''))
      .filter(Boolean);

    const defaults = ['http://localhost:3002', 'https://www.dealioo.io'];
    return [...new Set([...fromFrontend, ...defaults])];
  }
}
