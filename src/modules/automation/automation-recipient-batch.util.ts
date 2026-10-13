export const AUTOMATION_RECIPIENT_PAGE_SIZE = 200;

export const AUTOMATION_SEND_CHUNK_SIZE = 50;

export const UNPAID_RECIPIENT_PAGE_SIZE = AUTOMATION_RECIPIENT_PAGE_SIZE;

export const UNPAID_SEND_CHUNK_SIZE = AUTOMATION_SEND_CHUNK_SIZE;

export type RecipientPageItem = {
  customerId?: number | null;
};

export type RecipientPageChunkMeta = {
  chunkIndex: number;
  pageNumber: number;
};

export function predictSendChunkCount(
  totalRecipients: number,
  chunkSize: number = AUTOMATION_SEND_CHUNK_SIZE,
): number {
  const size = Math.max(1, chunkSize);
  return Math.max(1, Math.ceil(Math.max(0, totalRecipients) / size));
}

export function sliceIntoSendChunks<T>(
  items: T[],
  chunkSize: number = AUTOMATION_SEND_CHUNK_SIZE,
): T[][] {
  const size = Math.max(1, chunkSize);
  if (items.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function forEachRecipientPageChunks<T extends RecipientPageItem>(options: {
  fetchPage: (afterCustomerId: number, limit: number) => Promise<T[]>;
  onChunk: (
    chunk: T[],
    meta: RecipientPageChunkMeta,
  ) => Promise<void | { stop?: boolean }>;
  pageSize?: number;
  chunkSize?: number;
  seedPage?: T[];
  startAfterCustomerId?: number;
}): Promise<{ totalChunks: number; stoppedEarly: boolean; lastCustomerId: number }> {
  const pageSize = Math.max(
    1,
    options.pageSize ?? AUTOMATION_RECIPIENT_PAGE_SIZE,
  );
  const chunkSize = Math.max(1, options.chunkSize ?? AUTOMATION_SEND_CHUNK_SIZE);

  let afterCustomerId = Math.max(0, options.startAfterCustomerId ?? 0);
  let chunkIndex = 0;
  let page = options.seedPage;
  let pageNumber = 0;
  let stoppedEarly = false;
  let lastCustomerId = afterCustomerId;

  while (true) {
    if (!page) {
      page = await options.fetchPage(afterCustomerId, pageSize);
    }

    if (page.length === 0) {
      break;
    }

    pageNumber += 1;

    for (const chunk of sliceIntoSendChunks(page, chunkSize)) {
      const customerIds = chunk
        .map((recipient) => recipient.customerId)
        .filter((id): id is number => id != null && id > 0);
      if (customerIds.length === 0) {
        continue;
      }

      const chunkWithIds = chunk.filter(
        (recipient) =>
          recipient.customerId != null && recipient.customerId > 0,
      );
      const result = await options.onChunk(chunkWithIds, {
        chunkIndex,
        pageNumber,
      });
      chunkIndex += 1;
      const chunkLast = chunkWithIds[chunkWithIds.length - 1]?.customerId;
      if (chunkLast != null && chunkLast > 0) {
        lastCustomerId = chunkLast;
      }
      if (result?.stop === true) {
        stoppedEarly = true;
        break;
      }
    }

    if (stoppedEarly) {
      break;
    }

    const lastId = page[page.length - 1]?.customerId;
    if (lastId == null || lastId <= 0) {
      break;
    }
    afterCustomerId = lastId;
    lastCustomerId = lastId;
    const pageWasFull = page.length >= pageSize;
    page = undefined;
    if (!pageWasFull) {
      break;
    }
  }

  return { totalChunks: chunkIndex, stoppedEarly, lastCustomerId };
}
