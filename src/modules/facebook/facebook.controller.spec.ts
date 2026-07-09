import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { BusinessService } from '../business/business.service';
import { FacebookController } from './facebook.controller';
import { FacebookService } from './facebook.service';

describe('FacebookController', () => {
  let controller: FacebookController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FacebookController],
      providers: [
        {
          provide: FacebookService,
          useValue: {
            connect: jest.fn(),
            createOAuthConnectUrl: jest.fn(),
            handleOAuthCallback: jest.fn(),
            getConnectionStatus: jest.fn(),
            getAdCampaignStats: jest.fn(),
          },
        },
        {
          provide: BusinessService,
          useValue: { findOwnedByUserId: jest.fn() },
        },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<FacebookController>(FacebookController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
