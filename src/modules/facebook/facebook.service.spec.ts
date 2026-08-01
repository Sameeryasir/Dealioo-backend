import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';
import { MetaOAuthSession } from '../../db/entities/meta-oauth-session.entity';
import { Business } from '../../db/entities/business.entity';
import { BusinessAccessService } from '../business-access/business-access.service';
import { FacebookIntegrationAuditService } from './facebook-integration-audit.service';
import { FacebookMetaTokenService } from './facebook-meta-token.service';
import { FacebookService } from './facebook.service';

describe('FacebookService', () => {
  let service: FacebookService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacebookService,
        FacebookIntegrationAuditService,
        {
          provide: getRepositoryToken(Business),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(MetaOAuthSession),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn((row) => row),
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(IntegrationAuditLog),
          useValue: {
            save: jest.fn(),
          },
        },
        {
          provide: FacebookMetaTokenService,
          useValue: {
            validateAccessTokenForStorage: jest.fn(),
            assertBusinessMetaCredentials: jest.fn(),
            assertBusinessMetaToken: jest.fn(),
          },
        },
        {
          provide: BusinessAccessService,
          useValue: {
            assertPermission: jest.fn(),
            findAccessibleBusiness: jest.fn(),
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
