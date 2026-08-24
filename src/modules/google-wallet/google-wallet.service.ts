import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as jwt from 'jsonwebtoken';
import { LessThan, Not, IsNull, Repository } from 'typeorm';
import { Coupon } from '../../db/entities/coupon.entity';
import { GoogleWalletEvent } from '../../db/entities/google-wallet-event.entity';
import { CreateGoogleWalletSaveLinkDto } from './dto/create-google-wallet-save-link.dto';
import { GoogleWalletCallbackDto } from './dto/google-wallet-callback.dto';
import { GoogleWalletCallbackResultDto } from './dto/google-wallet-callback-result.dto';
import { GoogleWalletSaveLinkResultDto } from './dto/google-wallet-save-link-result.dto';
import { fetchGenericObjectState } from './google-wallet-api.client';
import {
  GoogleWalletStatus,
  googleWalletAddedFromStatus,
} from './google-wallet-status';
import { buildGuestPassUrl } from '../../utils/guest-pass-url';

const PENDING_RECONCILE_MIN_AGE_MS = 90_000;

@Injectable()
export class GoogleWalletService {
  private readonly logger = new Logger(GoogleWalletService.name);

  private readonly issuerId: string;
  private readonly classSuffix: string;
  private readonly serviceAccountEmail: string;
  private readonly privateKeyPem: string;
  private readonly origins: string[];
  private readonly publicApiBase: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Coupon)
    private readonly couponRepository: Repository<Coupon>,
    @InjectRepository(GoogleWalletEvent)
    private readonly walletEventRepository: Repository<GoogleWalletEvent>,
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
    this.publicApiBase = this.resolvePublicApiBase();

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

  buildWalletOpenUrl(passId: string, qrToken: string): string {
    const params = new URLSearchParams();
    params.set('passId', passId.trim());
    params.set('token', qrToken.trim());
    return `${this.publicApiBase}/google-wallet/open?${params.toString()}`;
  }

  async openWalletSaveFlow(
    passId: string,
    qrToken: string,
  ): Promise<{ googleSaveUrl: string; openUrl: string }> {
    const coupon = await this.findCouponForOpenFlow(passId, qrToken);
    const token = qrToken.trim();
    const link = await this.createSaveLink({
      passId: String(coupon.id),
      offerName: coupon.campaign?.campaignName?.trim() || 'Your offer',
      businessName: coupon.business?.name?.trim() || 'Dealioo',
      qrOrRedemptionUrl: buildGuestPassUrl(token),
      qrToken: token,
    });

    await this.markWalletPending(coupon.id);

    return {
      googleSaveUrl: link.saveUrl,
      openUrl: link.openUrl,
    };
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
    const openUrl = this.buildWalletOpenUrl(passId, qrToken);

    await this.persistObjectIdForCouponIfAbsent(passId, objectId);

    this.logger.log(
      `Google Wallet save link created objectId=${objectId} classId=${classId} passId=${passId}`,
    );

    return { saveUrl, openUrl, objectId, classId };
  }

  async handleCallback(
    dto: GoogleWalletCallbackDto,
  ): Promise<GoogleWalletCallbackResultDto> {
    const parsed = this.parseCallbackBody(dto);
    const { eventType, objectId, classId, nonce } = parsed;

    this.logger.log(
      `Google Wallet callback parsed eventType=${eventType || 'unknown'} objectId=${objectId || 'n/a'} classId=${classId || 'n/a'} nonce=${nonce ? 'present' : 'none'}`,
    );

    if (!objectId) {
      this.logger.warn(
        'Google Wallet callback: no objectId parsed — coupon flags not updated (check signed payload / delivery)',
      );
      return { success: true, updated: false, reason: 'missing_object_id' };
    }

    if (nonce) {
      const duplicate = await this.walletEventRepository.findOne({
        where: { nonce },
      });
      if (duplicate) {
        this.logger.log(
          `Google Wallet callback duplicate nonce=${nonce} objectId=${objectId} — skipped`,
        );
        return {
          success: true,
          updated: false,
          reason: 'duplicate_nonce',
          eventType: eventType || null,
        };
      }
    }

    const pass = await this.findCouponForWalletObjectId(objectId);
    const receivedAt = new Date();

    try {
      await this.walletEventRepository.save({
        objectId,
        couponId: pass?.id ?? null,
        eventType: eventType || null,
        nonce: nonce || null,
        rawPayload: JSON.stringify(dto),
        receivedAt,
      });
    } catch (err) {
      this.logger.warn(
        `Google Wallet callback event persist failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!pass) {
      this.logger.warn(
        `Google Wallet callback: no coupon for objectId=${objectId}`,
      );
      return {
        success: true,
        updated: false,
        reason: 'coupon_not_found',
        eventType: eventType || null,
      };
    }

    const reconciled = await this.reconcileCouponWalletState(
      pass.id,
      objectId,
      eventType || null,
      receivedAt,
    );

    if (!reconciled) {
      return {
        success: true,
        updated: false,
        reason: 'reconciliation_failed',
        eventType: eventType || null,
        couponId: pass.id,
      };
    }

    return {
      success: true,
      updated: true,
      reconciled: true,
      eventType: eventType || null,
      couponId: pass.id,
      googleWalletAdded: googleWalletAddedFromStatus(reconciled.status),
      googleWalletStatus: reconciled.status,
    };
  }

  async reconcileStalePendingCoupons(): Promise<number> {
    const cutoff = new Date(Date.now() - PENDING_RECONCILE_MIN_AGE_MS);
    const pending = await this.couponRepository.find({
      where: {
        googleWalletStatus: GoogleWalletStatus.PENDING,
        googleWalletPendingAt: LessThan(cutoff),
        googleWalletObjectId: Not(IsNull()),
      },
      take: 25,
      order: { googleWalletPendingAt: 'ASC' },
    });

    let updated = 0;

    for (const coupon of pending) {
      const objectId = coupon.googleWalletObjectId?.trim();
      if (!objectId) {
        continue;
      }
      const result = await this.reconcileCouponWalletState(
        coupon.id,
        objectId,
        'fallback_reconcile',
        new Date(),
      );
      if (result) {
        updated += 1;
      }
    }

    return updated;
  }

  async markWalletPending(couponId: number): Promise<void> {
    const now = new Date();
    await this.couponRepository.update(
      { id: couponId },
      {
        googleWalletStatus: GoogleWalletStatus.PENDING,
        googleWalletPendingAt: now,
        googleWalletLastEvent: 'open',
        googleWalletLastEventAt: now,
      },
    );
    this.logger.log(`Google Wallet status PENDING for couponId=${couponId}`);
  }

  private async reconcileCouponWalletState(
    couponId: number,
    objectId: string,
    eventType: string | null,
    receivedAt: Date,
  ): Promise<{ status: GoogleWalletStatus } | null> {
    const coupon = await this.couponRepository.findOne({
      where: { id: couponId },
    });
    if (!coupon) {
      return null;
    }

    let walletState: { hasUsers: boolean; found: boolean };
    try {
      walletState = await fetchGenericObjectState({
        objectId,
        serviceAccountEmail: this.serviceAccountEmail,
        privateKeyPem: this.privateKeyPem,
      });
    } catch (err) {
      this.logger.error(
        `Google Wallet reconciliation failed couponId=${couponId} objectId=${objectId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    const nextStatus = walletState.hasUsers
      ? GoogleWalletStatus.ADDED
      : coupon.googleWalletStatus === GoogleWalletStatus.ADDED ||
          coupon.googleWalletAdded
        ? GoogleWalletStatus.REMOVED
        : GoogleWalletStatus.NOT_ADDED;

    const wasAdded =
      coupon.googleWalletStatus === GoogleWalletStatus.ADDED ||
      coupon.googleWalletAdded === true;

    const updatePayload: Partial<Coupon> = {
      googleWalletObjectId: objectId,
      googleWalletStatus: nextStatus,
      googleWalletAdded: googleWalletAddedFromStatus(nextStatus),
      googleWalletLastEvent: eventType,
      googleWalletLastEventAt: receivedAt,
      googleWalletLastSyncedAt: receivedAt,
      googleWalletPendingAt: null,
    };

    if (nextStatus === GoogleWalletStatus.ADDED) {
      updatePayload.googleWalletAddedAt = receivedAt;
      updatePayload.googleWalletRemovedAt = null;
    } else if (
      nextStatus === GoogleWalletStatus.REMOVED &&
      wasAdded
    ) {
      updatePayload.googleWalletRemovedAt = receivedAt;
    }

    await this.couponRepository.update({ id: couponId }, updatePayload);

    this.logger.log(
      `Google Wallet reconciled couponId=${couponId} objectId=${objectId} eventType=${eventType || 'unknown'} status=${nextStatus} hasUsers=${walletState.hasUsers}`,
    );

    return { status: nextStatus };
  }

  private async findCouponForOpenFlow(
    passId: string,
    qrToken: string,
  ): Promise<Coupon> {
    const couponId = Number(passId);
    const token = qrToken.trim();
    if (!Number.isFinite(couponId) || couponId < 1 || !token) {
      throw new NotFoundException('Pass not found');
    }

    const coupon = await this.couponRepository.findOne({
      where: { id: couponId },
      relations: ['campaign', 'business'],
    });
    if (!coupon || coupon.qrToken?.trim() !== token) {
      throw new UnauthorizedException('Invalid pass access');
    }
    return coupon;
  }

  private parseCallbackBody(dto: GoogleWalletCallbackDto): {
    eventType: string;
    objectId: string;
    classId: string;
    nonce: string;
  } {
    let eventType = String(dto.eventType ?? '').trim().toLowerCase();
    let objectId = String(dto.objectId ?? '').trim();
    let classId = String(dto.classId ?? '').trim();
    let nonce = String(dto.nonce ?? '').trim();

    const signedMessage = dto.signedMessage?.trim();
    if (signedMessage) {
      try {
        const decoded = JSON.parse(signedMessage) as GoogleWalletCallbackDto;
        eventType =
          eventType || String(decoded.eventType ?? '').trim().toLowerCase();
        objectId = objectId || String(decoded.objectId ?? '').trim();
        classId = classId || String(decoded.classId ?? '').trim();
        nonce = nonce || String(decoded.nonce ?? '').trim();
        this.logger.log(
          `Google Wallet callback signedMessage parsed eventType=${eventType || '(empty)'} objectId=${objectId || '(empty)'} nonce=${nonce ? 'present' : 'none'}`,
        );
      } catch {
        this.logger.warn(
          'Google Wallet callback signedMessage was not plain JSON (may need signature unseal)',
        );
      }
    }

    return { eventType, objectId, classId, nonce };
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

  private resolvePublicApiBase(): string {
    const configured =
      this.configService.get<string>('PUBLIC_BASE_URL')?.trim() ||
      this.configService.get<string>('NEXT_PUBLIC_API_URL')?.trim() ||
      'http://localhost:4001/api';
    return configured.replace(/\/$/, '');
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
