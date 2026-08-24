import { google } from 'googleapis';

const WALLET_ISSUER_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';

export type GoogleWalletObjectState = {
  hasUsers: boolean;
  found: boolean;
};

export async function fetchGenericObjectState(input: {
  objectId: string;
  serviceAccountEmail: string;
  privateKeyPem: string;
}): Promise<GoogleWalletObjectState> {
  const auth = new google.auth.JWT({
    email: input.serviceAccountEmail,
    key: input.privateKeyPem,
    scopes: [WALLET_ISSUER_SCOPE],
  });

  const client = google.walletobjects({ version: 'v1', auth });

  try {
    const response = await client.genericobject.get({
      resourceId: input.objectId,
    });
    return {
      hasUsers: response.data.hasUsers === true,
      found: true,
    };
  } catch (err: unknown) {
    const status = (err as { code?: number }).code;
    if (status === 404) {
      return { hasUsers: false, found: false };
    }
    throw err;
  }
}
