import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FeeService } from './fee.service';

describe('FeeService', () => {
  let service: FeeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'PLATFORM_FEE_FIXED_MINOR') return '200';
              if (key === 'PLATFORM_FEE_PERCENT_BPS') return '0';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(FeeService);
  });

  it('calculates fixed platform fee in minor units', () => {
    const result = service.calculatePlatformFee({
      chargeAmountMinor: 1000,
      currency: 'usd',
    });
    expect(result.applicationFeeAmount).toBe(200);
    expect(result.model).toBe('fixed');
  });

  it('keeps fee below charge amount', () => {
    const result = service.calculatePlatformFee({
      chargeAmountMinor: 50,
      currency: 'usd',
    });
    expect(result.applicationFeeAmount).toBeLessThan(50);
  });
});
