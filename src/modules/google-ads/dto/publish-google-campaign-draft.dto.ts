import { IsInt, IsUUID, Min } from 'class-validator';

export class PublishGoogleCampaignDraftDto {
  @IsUUID()
  draftId: string;

  @IsInt()
  @Min(1)
  expectedVersion: number;
}
