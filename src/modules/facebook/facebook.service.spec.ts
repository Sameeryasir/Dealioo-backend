import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { FacebookIntegrationAuditService } from './facebook-integration-audit.service';
import { FacebookService } from './facebook.service';

describe('FacebookService', () => {
  let service: FacebookService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacebookService,
        FacebookIntegrationAuditService,
        {
          provide: getRepositoryToken(Restaurant),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(IntegrationAuditLog),
          useValue: {
            save: jest.fn(),
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
