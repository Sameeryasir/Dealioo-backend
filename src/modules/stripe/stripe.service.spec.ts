import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { StripeService } from './stripe.service';

describe('StripeService', () => {
  let service: StripeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'STRIPE_CONNECT_CLIENT_ID') return 'ca_test_client';
              if (key === 'STRIPE_CONNECT_REDIRECT_URI')
                return 'http://localhost:3001/stripe/callback/oauth';
              if (key === 'STRIPE_CLIENT_ID') return undefined;
              if (key === 'STRIPE_REDIRECT_URL') return undefined;
              return undefined;
            }),
            getOrThrow: jest.fn((key: string) => {
              if (key === 'STRIPE_SECRET_KEY') return 'sk_test_placeholder';
              if (key === 'STRIPE_CONNECT_CLIENT_ID') return 'ca_test_client';
              if (key === 'STRIPE_CONNECT_REDIRECT_URI')
                return 'http://localhost:3001/stripe/callback/oauth';
              return 'placeholder';
            }),
          },
        },
        {
          provide: getRepositoryToken(Business),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
