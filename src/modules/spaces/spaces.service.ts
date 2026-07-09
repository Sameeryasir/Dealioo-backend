import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { sanitizeStoredUploadFileName } from '../../utils/disk-file-upload-multer';

@Injectable()
export class SpacesService {
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly region: string;
  private readonly publicBaseUrl: string;

  constructor() {
    const accessKey =
      process.env.DO_SPACES_ACCESS_KEY?.trim() ??
      process.env.DO_SPACES_KEY?.trim();
    const secretKey =
      process.env.DO_SPACES_SECRET_KEY?.trim() ??
      process.env.DO_SPACES_SECRET?.trim();
    const bucket = process.env.DO_SPACES_BUCKET?.trim() ?? '';
    const region = process.env.DO_SPACES_REGION?.trim() ?? 'nyc3';
    const endpointFromEnv = process.env.DO_SPACES_ENDPOINT?.trim();

    this.bucket = bucket;
    this.region = region;
    this.publicBaseUrl = endpointFromEnv
      ? endpointFromEnv.replace(/\/$/, '')
      : `https://${bucket}.${region}.digitaloceanspaces.com`;

    if (!accessKey || !secretKey || !bucket) {
      this.client = null;
      return;
    }

    const s3Endpoint = endpointFromEnv?.includes('.digitaloceanspaces.com')
      ? `https://${region}.digitaloceanspaces.com`
      : (endpointFromEnv ?? `https://${region}.digitaloceanspaces.com`);

    this.client = new S3Client({
      region: 'us-east-1',
      endpoint: s3Endpoint,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: false,
    });
  }

  isConfigured(): boolean {
    return this.client !== null && this.bucket.length > 0;
  }

  buildPublicUrl(objectKey: string): string {
    const key = objectKey.replace(/^\/+/, '');
    return `${this.publicBaseUrl}/${key}`;
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException(
        'DigitalOcean Spaces is not configured.',
      );
    }

    if (!file?.buffer?.length) {
      throw new InternalServerErrorException(
        'Upload buffer is missing. Use memory storage for Spaces uploads.',
      );
    }

    const safeFolder = folder.replace(/^\/+|\/+$/g, '');
    const storedName = sanitizeStoredUploadFileName(file.originalname);
    const objectKey = `${safeFolder}/${storedName}`;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: file.buffer,
          ACL: 'public-read',
          ContentType: file.mimetype,
        }),
      );

      return this.buildPublicUrl(objectKey);
    } catch {
      throw new InternalServerErrorException('Unable to upload file.');
    }
  }

  async deleteFile(key: string): Promise<void> {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException(
        'DigitalOcean Spaces is not configured.',
      );
    }

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key.replace(/^\/+/, ''),
      }),
    );
  }
}
