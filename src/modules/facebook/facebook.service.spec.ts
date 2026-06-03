import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { FacebookService } from './facebook.service';

describe('FacebookService', () => {
  let service: FacebookService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacebookService,
        {
          provide: getRepositoryToken(Restaurant),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FacebookService>(FacebookService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
