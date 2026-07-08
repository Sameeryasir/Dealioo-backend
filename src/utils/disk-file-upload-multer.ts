import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { basename, extname, join } from 'path';
import { getFrontendBaseUrl } from './frontend-base-url';

export const DOCUMENT_IMAGE_UPLOAD_MIMES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const DEFAULT_DISK_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export function getDiskUploadMaxBytes(): number {
  const raw = process.env.UPLOAD_MAX_FILE_BYTES?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_DISK_UPLOAD_MAX_BYTES;
}

export const RESTAURANT_LOGO_UPLOAD_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export const MENUS_UPLOAD_SUBDIR = 'menus';

export const CAMPAIGNS_UPLOAD_SUBDIR = 'campaigns';

export const RESTAURANTS_UPLOAD_SUBDIR = 'restaurants';

export function publicUploadFileUrl(
  subdir: string,
  storedFileName: string,
): string {
  return `/uploads/${subdir}/${storedFileName}`;
}

export function getUploadPublicBaseUrl(): string {
  return getFrontendBaseUrl().replace(/\/$/, '');
}

export function getPublicAssetsBaseUrl(): string {
  return getUploadPublicBaseUrl();
}

export function sanitizeStoredUploadFileName(originalName: string): string {
  const ext = extname(originalName).toLowerCase() || '.jpg';
  const base =
    basename(originalName, extname(originalName))
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'upload';
  return `${Date.now()}-${base}${ext}`;
}

export function buildRestaurantLogoFileName(originalName: string): string {
  return sanitizeStoredUploadFileName(originalName);
}

export function absoluteCampaignUploadFileUrl(storedFileName: string): string {
  const fileName = storedFileName.trim().replace(/^\/+/, '');
  if (!fileName) {
    return getPublicAssetsBaseUrl();
  }
  return `${getPublicAssetsBaseUrl()}/uploads/${CAMPAIGNS_UPLOAD_SUBDIR}/${fileName}`;
}

export function absolutePublicUploadFileUrl(
  subdir: string,
  storedFileName: string,
): string {
  if (subdir === CAMPAIGNS_UPLOAD_SUBDIR) {
    return absoluteCampaignUploadFileUrl(storedFileName);
  }
  return `${getPublicAssetsBaseUrl()}${publicUploadFileUrl(subdir, storedFileName)}`;
}

function normalizeUploadPathname(pathname: string): string {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
  if (path.startsWith('/backend/uploads/')) {
    return path.slice('/backend'.length);
  }
  return path;
}

export function normalizeCampaignImageUrlForMeta(
  url: string | null | undefined,
): string | null {
  if (url == null || url === '') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const normalizedPath = normalizeUploadPathname(parsed.pathname);
      if (normalizedPath.startsWith(`/uploads/${CAMPAIGNS_UPLOAD_SUBDIR}/`)) {
        const fileName = normalizedPath.slice(
          `/uploads/${CAMPAIGNS_UPLOAD_SUBDIR}/`.length,
        );
        if (fileName && !fileName.includes('/')) {
          return absoluteCampaignUploadFileUrl(fileName);
        }
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }

  if (trimmed.startsWith('/backend/uploads/')) {
    const base = getPublicAssetsBaseUrl().replace(/\/backend$/, '');
    return `${base}${trimmed}`;
  }

  if (trimmed.startsWith('/uploads/')) {
    return `${getPublicAssetsBaseUrl()}${trimmed}`;
  }

  if (!trimmed.includes('/')) {
    return absoluteCampaignUploadFileUrl(trimmed);
  }

  return trimmed;
}

export function toAbsoluteAssetUrlIfRelative(
  url: string | null | undefined,
): string | null {
  if (url == null || url === '') return null;
  const normalized = normalizeCampaignImageUrlForMeta(url);
  if (normalized?.includes(`/uploads/${CAMPAIGNS_UPLOAD_SUBDIR}/`)) {
    return normalized;
  }
  const t = url.trim();
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  if (t.startsWith('/uploads/')) return `${getPublicAssetsBaseUrl()}${t}`;
  return normalized ?? t;
}

export function resolveLocalUploadFilePath(
  url: string,
  subdir: string,
): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  let pathname: string;
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      pathname = normalizeUploadPathname(new URL(trimmed).pathname);
    } else if (trimmed.startsWith('/')) {
      pathname = normalizeUploadPathname(trimmed);
    } else {
      return null;
    }
  } catch {
    return null;
  }

  const prefix = `/uploads/${subdir}/`;
  if (!pathname.startsWith(prefix)) return null;

  const filename = pathname.slice(prefix.length);
  if (!filename || filename.includes('..') || filename.includes('/')) {
    return null;
  }

  const localPath = join(process.cwd(), 'uploads', subdir, filename);
  return existsSync(localPath) ? localPath : null;
}

export type DiskFileUploadMulterOptions = {
  maxFileBytes?: number;
  allowedMimeTypes?: readonly string[];
  fileFilterErrorMessage?: string;
  buildStoredFileName?: (file: Express.Multer.File) => string;
};

export function createDiskFileUploadMulterOptions(
  subdir: string,
  options?: DiskFileUploadMulterOptions,
) {
  const maxFileBytes = options?.maxFileBytes ?? getDiskUploadMaxBytes();
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
        const storedName = options?.buildStoredFileName
          ? options.buildStoredFileName(file)
          : `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;
        cb(null, storedName);
      },
    }),
    fileFilter: (req, file, cb) => {
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return cb(
          new Error(
            options?.fileFilterErrorMessage ??
              'Only PDF, PNG, JPG, and DOCX files are allowed',
          ),
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
