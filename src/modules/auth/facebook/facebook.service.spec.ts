import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FacebookConnection } from '../../../db/entities/facebook-connection.entity';
import { FacebookPage } from '../../../db/entities/facebook-page.entity';
import { User } from '../../../db/entities/user.entity';
import { FacebookService } from './facebook.service';

describe('FacebookService', () => {
  let service: FacebookService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacebookService,
        {
          provide: getRepositoryToken(FacebookConnection),
          useValue: { findOne: jest.fn(), create: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(FacebookPage),
          useValue: { delete: jest.fn(), create: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<FacebookService>(FacebookService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
