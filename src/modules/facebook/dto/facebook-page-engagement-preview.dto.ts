export class FacebookPageEngagementPreviewDto {
  id: string;
  name: string | null;
  about: string | null;
  category: string | null;
  description: string | null;
  website: string | null;
  phone: string | null;
  singleLineAddress: string | null;
  link: string | null;
  pictureUrl: string | null;
  /** True only when Meta returned pages_read_engagement Page identity fields. */
  detailsLoaded: boolean;
  errorCode: string | null;
  engagementError: string | null;
}
