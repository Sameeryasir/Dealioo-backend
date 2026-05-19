import { Test, TestingModule } from '@nestjs/testing';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';

describe('AutomationController', () => {
  let controller: AutomationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AutomationController],
      providers: [
        {
          provide: AutomationService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<AutomationController>(AutomationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
