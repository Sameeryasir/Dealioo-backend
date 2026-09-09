import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { VisitAddonItem } from '../../db/entities/visit-addon-item.entity';
import { AddonSuggestionController } from './addon-suggestion.controller';
import { AddonSuggestionService } from './addon-suggestion.service';

@Module({
  imports: [TypeOrmModule.forFeature([VisitAddonItem, Campaign])],
  controllers: [AddonSuggestionController],
  providers: [AddonSuggestionService],
  exports: [AddonSuggestionService],
})
export class AddonSuggestionModule {}
