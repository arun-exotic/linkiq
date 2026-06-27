import { z } from 'zod';

export const UserResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  createdAt: z.date(),
});

export type UserResponseDto = z.infer<typeof UserResponseSchema>;
