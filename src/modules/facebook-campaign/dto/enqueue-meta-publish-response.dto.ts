export class EnqueueMetaPublishResponseDto {
  status: 'publishing';
  draftId: string;
  jobId: string;
  publishStatus: 'QUEUED';
  message: string;
}
