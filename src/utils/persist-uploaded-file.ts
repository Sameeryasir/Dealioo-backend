import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { SpacesService } from '../modules/spaces/spaces.service';

export type PersistUploadedFileMode = 'relative' | 'absolute';

export async function persistUploadedFile(
  spacesService: SpacesService,
  file: Express.Multer.File | undefined,
  folder: string,
  _mode: PersistUploadedFileMode = 'relative',
): Promise<string | null> {
  if (!file) {
    return null;
  }

  if (!spacesService.isConfigured()) {
    throw new ServiceUnavailableException(
      'File storage is not configured. Set DigitalOcean Spaces credentials in .env.',
    );
  }

  if (!file.buffer?.length) {
    throw new BadRequestException('Upload failed.');
  }

  return spacesService.uploadFile(file, folder);
}
