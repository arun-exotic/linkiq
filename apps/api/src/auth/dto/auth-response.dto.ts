import { z } from 'zod';

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
  }),
});

export type AuthResponseDto = z.infer<typeof AuthResponseSchema>;
