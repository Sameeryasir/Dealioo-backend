import { z } from 'zod';

export const aiEditUiResponseSchema = z
  .object({
    schema: z.record(z.string(), z.unknown()),
    success: z.boolean().optional(),
    message: z.string().min(1).max(2000).optional(),
  })
  .strict();

export type AiEditUiResponse = z.infer<typeof aiEditUiResponseSchema>;
