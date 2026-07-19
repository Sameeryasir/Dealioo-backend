import {
  AUTOMATION_RECIPIENT_PAGE_SIZE,
  AUTOMATION_SEND_CHUNK_SIZE,
  forEachRecipientPageChunks,
  predictSendChunkCount,
  sliceIntoSendChunks,
} from './automation-recipient-batch.util';

describe('automation-recipient-batch.util', () => {
  it('uses shared 200 / 50 defaults', () => {
    expect(AUTOMATION_RECIPIENT_PAGE_SIZE).toBe(200);
    expect(AUTOMATION_SEND_CHUNK_SIZE).toBe(50);
  });

  it('predicts chunk count from total recipients', () => {
    expect(predictSendChunkCount(0)).toBe(1);
    expect(predictSendChunkCount(200)).toBe(4);
    expect(predictSendChunkCount(201)).toBe(5);
  });

  it('slices a page of 200 into 4 chunks of 50', () => {
    const page = Array.from({ length: 200 }, (_, i) => ({ customerId: i + 1 }));
    const chunks = sliceIntoSendChunks(page);
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toHaveLength(50);
    expect(chunks[3]).toHaveLength(50);
    expect(chunks[3][49]?.customerId).toBe(200);
  });

  it('pages with seed + fetch and reports totalChunks', async () => {
    const seed = Array.from({ length: 200 }, (_, i) => ({ customerId: i + 1 }));
    const second = Array.from({ length: 30 }, (_, i) => ({
      customerId: 200 + i + 1,
    }));
    const seen: number[][] = [];

    const { totalChunks } = await forEachRecipientPageChunks({
      seedPage: seed,
      fetchPage: async (afterCustomerId) => {
        expect(afterCustomerId).toBe(200);
        return second;
      },
      onChunk: async (chunk) => {
        seen.push(chunk.map((row) => row.customerId!));
      },
    });

    expect(totalChunks).toBe(5);
    expect(seen).toHaveLength(5);
    expect(seen[0]).toHaveLength(50);
    expect(seen[4]).toHaveLength(30);
  });
});
