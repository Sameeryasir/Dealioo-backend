export const FUNNEL_GOOGLE_UPLOAD_QUEUE = 'funnel-google-upload';

export enum FunnelGoogleUploadJobName {
  SEND_EVENT = 'send-event',
}

export type FunnelGoogleUploadJobPayload = {
  eventRowId: string;
  eventId: string;
};

export function funnelGoogleUploadJobId(eventId: string): string {
  return `funnel-google-upload-${eventId}`;
}
