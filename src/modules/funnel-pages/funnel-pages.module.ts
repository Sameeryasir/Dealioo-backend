import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelPage } from '../../db/entities/funnel-page.entity';
import { FunnelPageVersion } from '../../db/entities/funnel-page-version.entity';
import { FunnelPagesService } from './funnel-pages.service';

@Module({
  imports: [TypeOrmModule.forFeature([Funnel, FunnelPage, FunnelPageVersion])],
  providers: [FunnelPagesService],
  exports: [FunnelPagesService, TypeOrmModule],
})
export class FunnelPagesModule {}
