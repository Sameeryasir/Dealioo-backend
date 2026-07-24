export class MetaPublishAttemptDto {
  id: string;
  step: string;
  status: string;
  metaId: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export class MetaPublishStatusDto {
  draftId: string;
  status: string;
  publishStatus: string | null;
  publishStep: string | null;
  publishProgress: number;
  jobId: string | null;
  metaCampaignId: string | null;
  metaAdsetId: string | null;
  metaCreativeId: string | null;
  metaAdId: string | null;
  errorMessage: string | null;
  publishedAt: Date | null;
  attempts: MetaPublishAttemptDto[];
}
