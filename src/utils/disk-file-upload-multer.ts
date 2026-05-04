import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';

export const DOCUMENT_IMAGE_UPLOAD_MIMES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const DEFAULT_DISK_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export const MENUS_UPLOAD_SUBDIR = 'menus';

export const RESTAURANTS_UPLOAD_SUBDIR = 'restaurants';

export function publicUploadFileUrl(
  subdir: string,
  storedFileName: string,
): string {
  return `/uploads/${subdir}/${storedFileName}`;
}

export type DiskFileUploadMulterOptions = {
  maxFileBytes?: number;
  allowedMimeTypes?: readonly string[];
};

export function createDiskFileUploadMulterOptions(
  subdir: string,
  options?: DiskFileUploadMulterOptions,
) {
  const maxFileBytes = options?.maxFileBytes ?? DEFAULT_DISK_UPLOAD_MAX_BYTES;
  const allowedMimeTypes =
    options?.allowedMimeTypes ?? DOCUMENT_IMAGE_UPLOAD_MIMES;

  return {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const dir = join(process.cwd(), 'uploads', subdir);
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(
          Math.random() * 1e9,
        )}${extname(file.originalname)}`;
        cb(null, uniqueName);
      },
    }),
    fileFilter: (req, file, cb) => {
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return cb(
          new Error('Only PDF, PNG, JPG, and DOCX files are allowed'),
          false,
        );
      }
      cb(null, true);
    },
    limits: {
      fileSize: maxFileBytes,
    },
  };
}
