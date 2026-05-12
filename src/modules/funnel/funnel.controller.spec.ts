import { Test, TestingModule } from '@nestjs/testing';
import { FunnelController } from './funnel.controller';
import { FunnelService } from './funnel.service';

describe('FunnelController', () => {
  let controller: FunnelController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FunnelController],
      providers: [
        {
          provide: FunnelService,
          useValue: {
            createFunnel: jest.fn(),
            getFunnelById: jest.fn(),
            getFunnelsByCampaignId: jest.fn(),
            updateFunnel: jest.fn(),
            deleteFunnel: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<FunnelController>(FunnelController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
