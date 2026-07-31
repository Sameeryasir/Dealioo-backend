import {
  GoogleAdsApi,
  errors,
  fromMicros,
  type Customer,
} from 'google-ads-api';

export function createGoogleAdsApiClient(input: {
  clientId: string;
  clientSecret: string;
  developerToken: string;
}): GoogleAdsApi {
  return new GoogleAdsApi({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    developer_token: input.developerToken,
  });
}

export function createGoogleAdsCustomer(
  client: GoogleAdsApi,
  input: {
    customerId: string;
    refreshToken: string;
    loginCustomerId?: string;
  },
): Customer {
  return client.Customer({
    customer_id: input.customerId,
    refresh_token: input.refreshToken,
    ...(input.loginCustomerId
      ? { login_customer_id: input.loginCustomerId }
      : {}),
  });
}

export function formatGoogleAdsSdkError(
  err: unknown,
  fallback: string,
): string {
  if (err instanceof errors.GoogleAdsFailure) {
    const messages: string[] = [];

    for (const googleError of err.errors ?? []) {
      const text = googleError.message?.trim();
      const errorCode = googleError.error_code as
        | Record<string, string | number | undefined>
        | undefined;
      const codeValues = errorCode
        ? Object.values(errorCode).map((value) => String(value))
        : [];

      if (
        codeValues.includes('DEVELOPER_TOKEN_PROHIBITED') ||
        text?.includes('DEVELOPER_TOKEN_PROHIBITED') ||
        text?.includes('not allowed with project')
      ) {
        return `${text ?? 'Developer token is not allowed with this Google Cloud project'}. Your developer token is tied to a different Google Cloud project. Use matching OAuth credentials or request a new developer token for this project.`;
      }

      if (text) {
        messages.push(text);
      }
    }

    if (messages.length > 0) {
      return messages.join(' ');
    }
  }

  if (err instanceof Error && err.message.trim()) {
    return err.message.trim();
  }

  return fallback;
}

export { fromMicros };
