export class GoogleWalletSaveLinkResultDto {
  /** Direct Google Save-to-Wallet URL (internal redirect target). */
  saveUrl!: string;
  /** Dealioo URL that marks PENDING then redirects to Google. */
  openUrl!: string;
  objectId!: string;
  classId!: string;
}
