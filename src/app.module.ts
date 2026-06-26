import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { RestaurantModule } from './modules/restaurant/restaurant.module';
import { LocationModule } from './modules/location/location.module';
import { MenuModule } from './modules/menu/menu.module';
import { MenuItemModule } from './modules/menu-item/menu-item.module';
import { CampaignModule } from './modules/campaign/campaign.module';
import { CustomerModule } from './modules/customer/customer.module';
import { FunnelModule } from './modules/funnel/funnel.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { FacebookModule } from './modules/facebook/facebook.module';
import { FacebookCampaignModule } from './modules/facebook-campaign/facebook-campaign.module';
import { GoogleAdsModule } from './modules/google-ads/google-ads.module';
import { PaymentModule } from './modules/payment/payment.module';
import { FunnelEventModule } from './modules/funnel-event/funnel-event.module';
import { AutomationModule } from './modules/automation/automation.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { RedemptionModule } from './modules/redemption/redemption.module';
import { ActivityModule } from './modules/activity/activity.module';
import { ChatModule } from './modules/chat/chat.module';
import { MailModule } from './modules/mail/mail.module';
import { PusherModule } from './modules/pusher/pusher.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    MailModule,
    PusherModule,
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 200 }],
      errorMessage:
        'You are sending requests too quickly. Please wait and try again.',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: (config.get<string>('DB_TYPE') ?? 'postgres') as 'postgres',
        host: config.getOrThrow<string>('DB_HOST'),
        port: parseInt(config.get<string>('DB_PORT', '5433'), 10),
        username: config.getOrThrow<string>('DB_USERNAME'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        autoLoadEntities:
          config.get<string>('DB_AUTO_LOAD_ENTITIES') === 'true',
        synchronize: config.get<string>('DB_SYNCHRONIZE') === 'true',
        ...(config.get<string>('DB_SSL') === 'true'
          ? { ssl: { rejectUnauthorized: false } }
          : {}),
      }),
    }),
    AuthModule,
    UserModule,
    RestaurantModule,
    LocationModule,
    MenuModule,
    MenuItemModule,
    CampaignModule,
    FunnelModule,
    CustomerModule,
    StripeModule,
    FacebookModule,
    FacebookCampaignModule,
    GoogleAdsModule,
    PaymentModule,
    FunnelEventModule,
    AutomationModule,
    RedemptionModule,
    ActivityModule,
    ChatModule,
    OnboardingModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
