import {
  AUTOMATION_RECIPIENT_PAGE_SIZE,
  AUTOMATION_SEND_CHUNK_SIZE,
  forEachRecipientPageChunks,
  predictSendChunkCount,
  sliceIntoSendChunks,
} from './automation-recipient-batch.util';

describe('automation-recipient-batch.util', () => {
  it('uses shared 300 / 50 defaults', () => {
    expect(AUTOMATION_RECIPIENT_PAGE_SIZE).toBe(300);
    expect(AUTOMATION_SEND_CHUNK_SIZE).toBe(50);
  });

  it('predicts chunk count from total recipients', () => {
    expect(predictSendChunkCount(0)).toBe(1);
    expect(predictSendChunkCount(200)).toBe(4);
    expect(predictSendChunkCount(301)).toBe(7);
  });

  it('slices a page of 300 into 6 chunks of 50', () => {
    const page = Array.from({ length: 300 }, (_, i) => ({ customerId: i + 1 }));
    const chunks = sliceIntoSendChunks(page);
    expect(chunks).toHaveLength(6);
    expect(chunks[0]).toHaveLength(50);
    expect(chunks[5]).toHaveLength(50);
    expect(chunks[5][49]?.customerId).toBe(300);
  });

  it('pages with seed + fetch and reports totalChunks', async () => {
    const seed = Array.from({ length: 300 }, (_, i) => ({ customerId: i + 1 }));
    const second = Array.from({ length: 30 }, (_, i) => ({
      customerId: 300 + i + 1,
    }));
    const seen: number[][] = [];

    const { totalChunks } = await forEachRecipientPageChunks({
      seedPage: seed,
      fetchPage: async (afterCustomerId) => {
        expect(afterCustomerId).toBe(300);
        return second;
      },
      onChunk: async (chunk) => {
        seen.push(chunk.map((row) => row.customerId));
      },
    });

    expect(totalChunks).toBe(7);
    expect(seen).toHaveLength(7);
    expect(seen[0]).toHaveLength(50);
    expect(seen[6]).toHaveLength(30);
  });

  it('prefetches the next page while processing the current page', async () => {
    const first = Array.from({ length: 300 }, (_, i) => ({
      customerId: i + 1,
    }));
    const second = Array.from({ length: 10 }, (_, i) => ({
      customerId: 300 + i + 1,
    }));
    let fetchCalls = 0;
    let fetchedDuringFirstPage = false;

    const { totalChunks } = await forEachRecipientPageChunks({
      seedPage: first,
      fetchPage: async (afterCustomerId) => {
        fetchCalls += 1;
        expect(afterCustomerId).toBe(300);
        fetchedDuringFirstPage = true;
        return second;
      },
      onChunk: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
    });

    expect(fetchedDuringFirstPage).toBe(true);
    expect(fetchCalls).toBe(1);
    expect(totalChunks).toBe(7);
  });
});
