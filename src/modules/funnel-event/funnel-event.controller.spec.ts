import { Test, TestingModule } from '@nestjs/testing';
import { FunnelEventController } from './funnel-event.controller';
import { FunnelEventService } from './funnel-event.service';

describe('FunnelEventController', () => {
  let controller: FunnelEventController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FunnelEventController],
    }).compile();

    controller = module.get<FunnelEventController>(FunnelEventController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
