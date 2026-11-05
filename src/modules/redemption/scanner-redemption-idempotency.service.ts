import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { EntityManager, Repository } from 'typeorm';
import {
  ScannerRedemptionRequest,
  ScannerRedemptionRequestStatus,
} from '../../db/entities/scanner-redemption-request.entity';
import { ScannerErrorCode, ScannerErrorMessage } from './scanner-error-codes';

type ScanResult = {
  success: boolean;
  message?: string;
  errorCode?: string;
  customerName?: string;
  campaignName?: string;
  couponStatus?: string;
  redeemedAt?: string;
  totalVisits?: number;
  rewardsAvailable?: number;
  previouslyRedeemedCount?: number;
};

@Injectable()
export class ScannerRedemptionIdempotencyService {
  constructor(
    @InjectRepository(ScannerRedemptionRequest)
    private readonly requestRepository: Repository<ScannerRedemptionRequest>,
  ) {}

  buildRequestHash(input: {
    couponIds: number[];
    orderSubtotal?: number;
    extraItemsAmount?: number;
    extraItemNames?: string[];
    extraItems?: Array<{ name: string; unitPrice: number; qty: number }>;
    visitSource?: string;
  }): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          couponIds: [...input.couponIds].sort((a, b) => a - b),
          orderSubtotal: input.orderSubtotal ?? null,
          extraItemsAmount: input.extraItemsAmount ?? null,
          extraItemNames: input.extraItemNames ?? [],
          extraItems: input.extraItems ?? [],
          visitSource: input.visitSource ?? null,
        }),
      )
      .digest('hex');
  }

  async findCompleted(
    businessId: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ScanResult | null> {
    const existing = await this.requestRepository.findOne({
      where: { businessId, idempotencyKey },
    });
    if (!existing) {
      return null;
    }
    if (existing.requestHash !== requestHash) {
      throw new ConflictException({
        code: ScannerErrorCode.DUPLICATE_PURCHASE,
        message: ScannerErrorMessage.DUPLICATE_PURCHASE,
      });
    }
    if (
      existing.status === ScannerRedemptionRequestStatus.COMPLETED &&
      existing.responseJson
    ) {
      return existing.responseJson as ScanResult;
    }
    return null;
  }

  async reserveInTransaction(
    manager: EntityManager,
    params: {
      businessId: number;
      staffUserId: number | null;
      idempotencyKey: string;
      requestHash: string;
    },
  ): Promise<ScanResult | 'proceed'> {
    const raced = await manager.findOne(ScannerRedemptionRequest, {
      where: {
        businessId: params.businessId,
        idempotencyKey: params.idempotencyKey,
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (raced) {
      if (raced.requestHash !== params.requestHash) {
        throw new ConflictException({
          code: ScannerErrorCode.DUPLICATE_PURCHASE,
          message: ScannerErrorMessage.DUPLICATE_PURCHASE,
        });
      }
      if (
        raced.status === ScannerRedemptionRequestStatus.COMPLETED &&
        raced.responseJson
      ) {
        return raced.responseJson as ScanResult;
      }
      return 'proceed';
    }

    await manager.save(
      manager.create(ScannerRedemptionRequest, {
        businessId: params.businessId,
        staffUserId: params.staffUserId,
        idempotencyKey: params.idempotencyKey,
        requestHash: params.requestHash,
        status: ScannerRedemptionRequestStatus.IN_PROGRESS,
        responseJson: null,
      }),
    );
    return 'proceed';
  }

  async completeInTransaction(
    manager: EntityManager,
    params: {
      businessId: number;
      idempotencyKey: string;
      response: ScanResult;
    },
  ): Promise<void> {
    await manager.update(
      ScannerRedemptionRequest,
      {
        businessId: params.businessId,
        idempotencyKey: params.idempotencyKey,
      },
      {
        status: ScannerRedemptionRequestStatus.COMPLETED,
        responseJson: params.response,
      },
    );
  }
}
