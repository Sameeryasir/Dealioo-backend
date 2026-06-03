import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { MetaService } from './meta.service';

describe('MetaService', () => {
  let service: MetaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetaService,
        {
          provide: getRepositoryToken(Restaurant),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MetaService>(MetaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
