import { z } from 'zod';

const PRIVATE_IP_REGEX =
  /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)/i;

export const CreateLinkSchema = z.object({
  destination: z
    .string()
    .max(2048)
    .refine(
      (val) => val.startsWith('http://') || val.startsWith('https://'),
      'Must be http or https',
    )
    .refine((val) => !PRIVATE_IP_REGEX.test(val), 'Must be a public URL'),
  slug: z.string().max(50).optional(),
  title: z.string().max(120).optional(),
  expiresAt: z.string().datetime().optional(),
});

export type CreateLinkDto = z.infer<typeof CreateLinkSchema>;
