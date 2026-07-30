export const MediaType = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
} as const;

export type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType];

export const MediaStatus = {
  UPLOADING: 'UPLOADING',
  UPLOADED: 'UPLOADED',
  META_UPLOADED: 'META_UPLOADED',
  FAILED: 'FAILED',
} as const;

export type MediaStatusValue = (typeof MediaStatus)[keyof typeof MediaStatus];

export function normalizeMediaType(
  value: string | null | undefined,
): MediaTypeValue {
  const raw = (value ?? '').trim().toUpperCase();
  if (raw === MediaType.VIDEO || raw === 'VIDEO') return MediaType.VIDEO;
  return MediaType.IMAGE;
}

export function toStorageMediaType(
  value: string | null | undefined,
): 'image' | 'video' {
  return normalizeMediaType(value) === MediaType.VIDEO ? 'video' : 'image';
}
