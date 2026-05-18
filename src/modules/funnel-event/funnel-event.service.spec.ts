import { Test, TestingModule } from '@nestjs/testing';
import { FunnelEventService } from './funnel-event.service';

describe('FunnelEventService', () => {
  let service: FunnelEventService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FunnelEventService],
    }).compile();

    service = module.get<FunnelEventService>(FunnelEventService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
