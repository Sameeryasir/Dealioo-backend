import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../db/entities/user.entity';
import { JwtAccessPayload } from './jwt-access-payload.interface';

const USER_VALIDATE_CACHE_TTL_MS = 60_000;

type CachedAuthUser = {
  id: number;
  email: string;
  role: { id: number; name: string };
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly validateCache = new Map<
    number,
    { user: CachedAuthUser; expiresAt: number }
  >();

  constructor(
    private configService: ConfigService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not defined in environment variables');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: JwtAccessPayload) {
    const cached = this.validateCache.get(payload.sub);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      relations: ['role'],
      select: {
        id: true,
        email: true,
        isActive: true,
        role: { id: true, name: true },
      },
    });

    if (
      !user ||
      !user.isActive ||
      user.email !== payload.email ||
      user.role.name !== payload.role
    ) {
      throw new UnauthorizedException('User not found');
    }

    const authUser: CachedAuthUser = {
      id: user.id,
      email: user.email,
      role: { id: user.role.id, name: user.role.name },
    };

    this.validateCache.set(payload.sub, {
      user: authUser,
      expiresAt: Date.now() + USER_VALIDATE_CACHE_TTL_MS,
    });

    return authUser;
  }
}
