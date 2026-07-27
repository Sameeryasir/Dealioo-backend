import { z } from 'zod';

export const aiEditUiResponseSchema = z
  .object({
    schema: z.record(z.string(), z.unknown()),
  })
  .strict();

export type AiEditUiResponse = z.infer<typeof aiEditUiResponseSchema>;
