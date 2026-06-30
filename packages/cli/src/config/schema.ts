import { z } from 'zod';

export const ProfileKindSchema = z.enum(['selfhosted', 'saas']);
export type ProfileKind = z.infer<typeof ProfileKindSchema>;

export const ProfileSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  token: z.string().min(1),
  kind: ProfileKindSchema,
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
  serverInfo: z
    .object({
      version: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      tokenName: z.string().optional(),
    })
    .optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ConfigV1Schema = z.object({
  version: z.literal(1),
  activeProfile: z.string(),
  profiles: z.record(z.string(), ProfileSchema),
});
export type ConfigV1 = z.infer<typeof ConfigV1Schema>;

export function emptyConfig(): ConfigV1 {
  return { version: 1, activeProfile: '', profiles: {} };
}
