import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import * as jwt from 'jsonwebtoken';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtStrategy } from './jwt/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Otp } from '../../db/entities/otp.entity';
import { RefreshToken } from '../../db/entities/refresh-token.entity';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([User, Role, Otp, RefreshToken]),
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          throw new Error('JWT_SECRET is not defined in environment variables');
        }
        const expiresIn = (process.env.JWT_ACCESS_EXPIRES_IN ??
          process.env.JWT_EXPIRES_IN ??
          '15m') as jwt.SignOptions['expiresIn'];
        return {
          secret,
          signOptions: {
            expiresIn,
          },
        };
      },
    }),
  ],
  providers: [AuthService, JwtStrategy, GoogleStrategy, GoogleAuthGuard],
  controllers: [AuthController],
  exports: [PassportModule, JwtModule, JwtStrategy],
})
export class AuthModule {}
