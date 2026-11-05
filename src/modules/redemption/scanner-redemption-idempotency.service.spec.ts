import { ConflictException } from '@nestjs/common';
import { ScannerRedemptionRequestStatus } from '../../db/entities/scanner-redemption-request.entity';
import { ScannerRedemptionIdempotencyService } from './scanner-redemption-idempotency.service';

describe('ScannerRedemptionIdempotencyService', () => {
  const requestRepository = {
    findOne: jest.fn(),
  };

  let service: ScannerRedemptionIdempotencyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScannerRedemptionIdempotencyService(
      requestRepository as never,
    );
  });

  it('returns a completed response for matching request hash', async () => {
    const response = { success: true, customerName: 'Ada' };
    requestRepository.findOne.mockResolvedValue({
      requestHash: 'abc',
      status: ScannerRedemptionRequestStatus.COMPLETED,
      responseJson: response,
    });

    await expect(
      service.findCompleted(1, 'key-1', 'abc'),
    ).resolves.toEqual(response);
  });

  it('rejects same key with a different payload hash', async () => {
    requestRepository.findOne.mockResolvedValue({
      requestHash: 'abc',
      status: ScannerRedemptionRequestStatus.COMPLETED,
      responseJson: { success: true },
    });

    await expect(service.findCompleted(1, 'key-1', 'different')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('builds a stable request hash', () => {
    const a = service.buildRequestHash({
      couponIds: [2, 1],
      orderSubtotal: 10,
    });
    const b = service.buildRequestHash({
      couponIds: [1, 2],
      orderSubtotal: 10,
    });
    expect(a).toBe(b);
  });
});
