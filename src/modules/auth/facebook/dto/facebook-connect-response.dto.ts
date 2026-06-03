import { FacebookPageDto } from './facebook-page.dto';

export class FacebookConnectResponseDto {
  success: boolean;
  connected: boolean;
  facebook_user_id: string | null;
  facebook_user_name: string | null;
  pages: FacebookPageDto[];
}
