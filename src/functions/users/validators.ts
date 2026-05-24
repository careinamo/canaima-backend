import { z } from 'zod';

export const updateUserProfileSchema = z.object({
  firstName: z.string().min(1).max(255).optional(),
  lastName: z.string().min(1).max(255).optional(),
  imageUrl: z.string().url().optional(),
});

export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
