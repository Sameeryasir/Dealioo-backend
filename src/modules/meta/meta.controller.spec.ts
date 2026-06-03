import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { RestaurantService } from '../restaurant/restaurant.service';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';

describe('MetaController', () => {
  let controller: MetaController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetaController],
      providers: [
        {
          provide: MetaService,
          useValue: {
            connect: jest.fn(),
            createOAuthConnectUrl: jest.fn(),
            handleOAuthCallback: jest.fn(),
            getConnectionStatus: jest.fn(),
          },
        },
        {
          provide: RestaurantService,
          useValue: { findOwnedByUserId: jest.fn() },
        },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MetaController>(MetaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
