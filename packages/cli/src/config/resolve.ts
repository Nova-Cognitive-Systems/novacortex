import { ProfileStore, defaultConfigPath } from './profile-store.js';
import type { Profile } from './schema.js';
import { NotLoggedInError, ProfileNotFoundError } from '../lib/errors.js';

/**
 * Resolve the profile to use for a command, honoring in this order:
 *   1. NOVACORTEX_URL + NOVACORTEX_TOKEN env vars (synthetic profile)
 *   2. Explicit --profile flag or NOVACORTEX_PROFILE env var
 *   3. activeProfile in the config file
 */
export async function resolveActiveProfile(explicit?: string): Promise<Profile> {
  if (process.env['NOVACORTEX_URL'] && process.env['NOVACORTEX_TOKEN']) {
    return {
      name: '$env',
      url: process.env['NOVACORTEX_URL']!,
      token: process.env['NOVACORTEX_TOKEN']!,
      kind: 'selfhosted',
      createdAt: new Date().toISOString(),
    };
  }

  const envProfile = process.env['NOVACORTEX_PROFILE'];
  const name = explicit ?? envProfile;

  const store = new ProfileStore(defaultConfigPath());
  const cfg = await store.read();
  const target = name ?? cfg.activeProfile;

  if (!target) {
    throw new NotLoggedInError('No active profile configured');
  }
  const profile = cfg.profiles[target];
  if (!profile) {
    throw new ProfileNotFoundError(`Profile '${target}' not found`);
  }
  return profile;
}
