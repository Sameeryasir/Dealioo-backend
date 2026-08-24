export enum GoogleWalletStatus {
  NOT_ADDED = 'NOT_ADDED',
  PENDING = 'PENDING',
  ADDED = 'ADDED',
  REMOVED = 'REMOVED',
}

export function googleWalletAddedFromStatus(
  status: GoogleWalletStatus,
): boolean {
  return status === GoogleWalletStatus.ADDED;
}
