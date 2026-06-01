import { Test, TestingModule } from '@nestjs/testing';
import { FunnelAnalyticsService } from './funnel-analytics.service';
import { FunnelEventController } from './funnel-event.controller';
import { FunnelEventService } from './funnel-event.service';

describe('FunnelEventController', () => {
  let controller: FunnelEventController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FunnelEventController],
      providers: [
        { provide: FunnelEventService, useValue: {} },
        { provide: FunnelAnalyticsService, useValue: {} },
      ],
    }).compile();

    controller = module.get<FunnelEventController>(FunnelEventController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
