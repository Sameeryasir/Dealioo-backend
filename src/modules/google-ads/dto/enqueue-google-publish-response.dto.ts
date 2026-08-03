export class EnqueueGooglePublishResponseDto {
  status: 'publishing';
  draftId: string;
  jobId: string;
  publishStatus: 'QUEUED';
  publishStep: 'queued';
  publishProgress: number;
  version: number;
  alreadyQueued: boolean;
  message: string;
}
