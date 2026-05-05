import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Funnel } from '../../db/entities/funnel.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { FunnelService } from './funnel.service';

describe('FunnelService', () => {
  let service: FunnelService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FunnelService,
        {
          provide: getRepositoryToken(Funnel),
          useValue: {
            create: jest.fn((x) => x),
            save: jest.fn(async (x) => x),
            find: jest.fn(async () => []),
          },
        },
        {
          provide: getRepositoryToken(Restaurant),
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FunnelService>(FunnelService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
