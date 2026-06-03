import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
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
            resolveUserIdFromAccessToken: jest.fn(),
            buildOAuthLoginUrl: jest.fn(),
            handleOAuthCallback: jest.fn(),
            getConnectionStatus: jest.fn(),
          },
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
