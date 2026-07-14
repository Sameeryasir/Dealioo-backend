import { readFileSync } from 'fs';
import {
  CAMPAIGNS_UPLOAD_SUBDIR,
  normalizeCampaignImageUrlForMeta,
  resolveLocalUploadFilePath,
} from '../../utils/disk-file-upload-multer';
import { mapMetaMarketingApiError } from '../facebook/facebook-meta-token.service';
import {
  assertDirectMetaImageUrl,
  assertDirectMetaVideoUrl,
  MetaApiStepError,
  normalizeAdAccountId,
} from './facebook-campaign-meta';
import { MetaCreationStep } from './meta-campaign.constants';
import {
  logMetaApiRequest,
  logMetaApiResponse,
  logMetaPublishStep,
} from './meta-publish-trace';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bizSdk = require('facebook-nodejs-business-sdk') as {
  FacebookAdsApi: new (
    accessToken: string,
    locale?: string,
    crashLog?: boolean,
  ) => MetaSdkApi;
  AdAccount: new (
    id?: string | null,
    data?: Record<string, unknown>,
    parentId?: string | null,
    api?: MetaSdkApi,
  ) => MetaSdkAdAccount;
};

type MetaSdkApi = {
  accessToken: string;
};

type MetaSdkAdAccount = {
  createCampaign: (
    fields: string[],
    params: Record<string, unknown>,
  ) => Promise<{ id?: string }>;
  createAdSet: (
    fields: string[],
    params: Record<string, unknown>,
  ) => Promise<{ id?: string }>;
  createAdImage: (
    fields: string[],
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  createAdVideo: (
    fields: string[],
    params: Record<string, unknown>,
  ) => Promise<{ id?: string }>;
  createAdCreative: (
    fields: string[],
    params: Record<string, unknown>,
  ) => Promise<{ id?: string }>;
  createAd: (
    fields: string[],
    params: Record<string, unknown>,
  ) => Promise<{ id?: string }>;
};

function createAdAccount(accessToken: string, adAccountId: string): MetaSdkAdAccount {
  const api = new bizSdk.FacebookAdsApi(accessToken, 'en_US', false);
  return new bizSdk.AdAccount(
    normalizeAdAccountId(adAccountId),
    {},
    null,
    api,
  );
}

function extractObjectId(result: { id?: string } | null | undefined): string | null {
  const id = result?.id;
  if (typeof id === 'string' && id.trim()) return id.trim();
  if (id != null && String(id).trim()) return String(id).trim();
  return null;
}

function extractAdImageHash(result: Record<string, unknown>): string | null {
  const images = (result.images ??
    (result._data as { images?: unknown } | undefined)?.images) as
    | Record<string, { hash?: string }>
    | undefined;
  if (!images || typeof images !== 'object') return null;
  for (const row of Object.values(images)) {
    const hash = row?.hash?.trim();
    if (hash) return hash;
  }
  return null;
}

function mapSdkError(err: unknown, step: MetaCreationStep): MetaApiStepError {
  const anyErr = err as {
    message?: string;
    status?: number;
    response?: {
      message?: string;
      error_user_msg?: string;
      error_user_title?: string;
      code?: number;
      error?: {
        message?: string;
        error_user_msg?: string;
        error_user_title?: string;
        code?: number;
      };
    };
  };

  const nested = anyErr.response?.error;
  const flat = anyErr.response;
  const userMsg =
    nested?.error_user_msg?.trim() ||
    flat?.error_user_msg?.trim() ||
    nested?.error_user_title?.trim() ||
    flat?.error_user_title?.trim();
  const apiMsg =
    nested?.message?.trim() ||
    flat?.message?.trim() ||
    anyErr.message?.trim();
  const rawMessage =
    userMsg || apiMsg || 'Facebook API request failed.';
  const code = nested?.code ?? flat?.code ?? null;
  const message = mapMetaMarketingApiError(rawMessage, code ?? undefined);
  const raw = JSON.stringify(anyErr.response ?? { message: rawMessage });

  if (code === 190) {
    return new MetaApiStepError(
      step,
      code,
      rawMessage,
      raw,
      `${message} Reconnect Facebook in Settings → Integrations.`,
    );
  }

  return new MetaApiStepError(step, code, rawMessage, raw, message);
}

async function runSdkCreate(
  step: MetaCreationStep,
  pathHint: string,
  body: Record<string, unknown>,
  action: () => Promise<{ id?: string } | Record<string, unknown>>,
  extractId: (result: Record<string, unknown>) => string | null = (r) =>
    extractObjectId(r as { id?: string }),
): Promise<string> {
  logMetaPublishStep(step, 'start', { path: pathHint, transport: 'business-sdk' });
  logMetaApiRequest(step, 'POST', pathHint, body);

  try {
    const result = (await action()) as Record<string, unknown>;
    const id = extractId(result);
    logMetaApiResponse(step, 200, result);
    if (!id) {
      logMetaPublishStep(step, 'error', { reason: 'missing_id' });
      throw new MetaApiStepError(
        step,
        null,
        'Facebook did not return an id for this step.',
        JSON.stringify(result),
        'Facebook did not return an id for this step.',
      );
    }
    logMetaPublishStep(step, 'success', { id });
    return id;
  } catch (err) {
    if (err instanceof MetaApiStepError) throw err;
    const mapped = mapSdkError(err, step);
    logMetaApiResponse(step, mapped.metaErrorCode ?? 400, mapped.rawResponse);
    logMetaPublishStep(step, 'error', {
      metaErrorCode: mapped.metaErrorCode,
      metaErrorMessage: mapped.metaErrorMessage,
    });
    throw mapped;
  }
}

export async function sdkCreateCampaign(
  accessToken: string,
  adAccountId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const account = createAdAccount(accessToken, adAccountId);
  return runSdkCreate(
    'campaign',
    `/${normalizeAdAccountId(adAccountId)}/campaigns`,
    payload,
    () => account.createCampaign([], payload),
  );
}

export async function sdkCreateAdSet(
  accessToken: string,
  adAccountId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const account = createAdAccount(accessToken, adAccountId);
  return runSdkCreate(
    'adset',
    `/${normalizeAdAccountId(adAccountId)}/adsets`,
    payload,
    () => account.createAdSet([], payload),
  );
}

export async function sdkUploadAdImageBytes(
  accessToken: string,
  adAccountId: string,
  bytesBase64: string,
): Promise<string> {
  const account = createAdAccount(accessToken, adAccountId);
  const payload = { bytes: bytesBase64 };
  return runSdkCreate(
    'media',
    `/${normalizeAdAccountId(adAccountId)}/adimages`,
    { bytes: '[base64]' },
    () => account.createAdImage([], payload),
    (result) => extractAdImageHash(result),
  );
}

export async function sdkUploadAdImageHash(
  accessToken: string,
  adAccountId: string,
  imageUrl: string,
): Promise<string> {
  const trimmed =
    normalizeCampaignImageUrlForMeta(imageUrl)?.trim() ?? imageUrl.trim();
  const localPath = resolveLocalUploadFilePath(
    trimmed,
    CAMPAIGNS_UPLOAD_SUBDIR,
  );

  const account = createAdAccount(accessToken, adAccountId);
  const pathHint = `/${normalizeAdAccountId(adAccountId)}/adimages`;

  if (localPath) {
    const bytes = readFileSync(localPath).toString('base64');
    const payload = { bytes };
    return runSdkCreate(
      'media',
      pathHint,
      payload,
      () => account.createAdImage([], payload),
      (result) => extractAdImageHash(result),
    );
  }

  assertDirectMetaImageUrl(trimmed);

  try {
    const payload = { url: trimmed };
    return await runSdkCreate(
      'media',
      pathHint,
      payload,
      () => account.createAdImage([], payload),
      (result) => extractAdImageHash(result),
    );
  } catch (firstErr) {
    const res = await fetch(trimmed, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      throw firstErr instanceof MetaApiStepError
        ? firstErr
        : mapSdkError(firstErr, 'media');
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const payload = { bytes: buffer.toString('base64') };
    return runSdkCreate(
      'media',
      pathHint,
      payload,
      () => account.createAdImage([], payload),
      (result) => extractAdImageHash(result),
    );
  }
}

export async function sdkUploadAdVideoId(
  accessToken: string,
  adAccountId: string,
  videoUrl: string,
): Promise<string> {
  const trimmed = videoUrl.trim();
  assertDirectMetaVideoUrl(trimmed);
  const account = createAdAccount(accessToken, adAccountId);
  const payload = { file_url: trimmed };
  return runSdkCreate(
    'media',
    `/${normalizeAdAccountId(adAccountId)}/advideos`,
    payload,
    () => account.createAdVideo([], payload),
  );
}

export async function sdkCreateAdCreative(
  accessToken: string,
  adAccountId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const account = createAdAccount(accessToken, adAccountId);
  return runSdkCreate(
    'creative',
    `/${normalizeAdAccountId(adAccountId)}/adcreatives`,
    payload,
    () => account.createAdCreative([], payload),
  );
}

export async function sdkCreateAd(
  accessToken: string,
  adAccountId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const account = createAdAccount(accessToken, adAccountId);
  return runSdkCreate(
    'ad',
    `/${normalizeAdAccountId(adAccountId)}/ads`,
    payload,
    () => account.createAd([], payload),
  );
}
