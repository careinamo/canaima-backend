import { z } from 'zod';

export const createOrganizationSchema = z.object({
  clerkOrgId: z.string().min(1, 'clerkOrgId is required'),
  name: z.string().min(1, 'name is required').max(255),
  teamSize: z.number().int().min(1).optional(),
  currency: z.string().length(3, 'currency must be ISO 4217 code').default('USD'),
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  teamSize: z.number().int().min(1).optional(),
  currency: z.string().length(3).optional(),
  settings: z.record(z.any()).optional(),
  plan: z.enum(['free', 'starter', 'pro', 'enterprise']).optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
