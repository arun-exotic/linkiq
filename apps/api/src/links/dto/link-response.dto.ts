import { z } from 'zod';

export const LinkResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  shortUrl: z.string(),
  destination: z.string(),
  title: z.string().nullable(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
  clickCount: z.number().int().optional(),
});

export type LinkResponseDto = z.infer<typeof LinkResponseSchema>;
