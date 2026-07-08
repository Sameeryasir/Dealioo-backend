import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { GoogleAuthProfile } from '../interfaces/google-auth.interface';


export const GoogleProfile = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): GoogleAuthProfile | undefined => {
    const request = ctx.switchToHttp().getRequest<{
      user?: GoogleAuthProfile;
    }>();
    return request.user;
  },
);
