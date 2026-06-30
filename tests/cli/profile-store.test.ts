import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ProfileStore,
  ConfigCorruptedError,
} from '../../packages/cli/src/config/profile-store.js';

describe('ProfileStore', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-cli-test-'));
    configPath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('read() returns an empty config when the file does not exist', async () => {
    const store = new ProfileStore(configPath);
    const cfg = await store.read();
    expect(cfg.version).toBe(1);
    expect(cfg.profiles).toEqual({});
    expect(cfg.activeProfile).toBe('');
  });

  it('write() persists atomically and sets chmod 600 on unix', async () => {
    const store = new ProfileStore(configPath);
    await store.write({
      version: 1,
      activeProfile: 'default',
      profiles: {
        default: {
          name: 'default',
          url: 'http://localhost:3001',
          token: 'nc_pat_abc',
          kind: 'selfhosted',
          createdAt: new Date().toISOString(),
        },
      },
    });
    expect(fs.existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.activeProfile).toBe('default');
    if (process.platform !== 'win32') {
      const mode = fs.statSync(configPath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('read() throws ConfigCorruptedError on broken JSON', async () => {
    fs.writeFileSync(configPath, '{not json');
    const store = new ProfileStore(configPath);
    await expect(store.read()).rejects.toBeInstanceOf(ConfigCorruptedError);
  });

  it('read() throws ConfigCorruptedError on unknown version', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ version: 99, profiles: {} }));
    const store = new ProfileStore(configPath);
    await expect(store.read()).rejects.toBeInstanceOf(ConfigCorruptedError);
  });

  it('setActiveProfile() throws on unknown profile', async () => {
    const store = new ProfileStore(configPath);
    await store.write({
      version: 1,
      activeProfile: '',
      profiles: {
        default: {
          name: 'default',
          url: 'http://x',
          token: 't',
          kind: 'selfhosted',
          createdAt: new Date().toISOString(),
        },
      },
    });
    await expect(store.setActiveProfile('nope')).rejects.toThrow(/unknown profile/);
  });

  it('deleteProfile() throws on deleting the active profile without force', async () => {
    const store = new ProfileStore(configPath);
    const initial = {
      version: 1 as const,
      activeProfile: 'default',
      profiles: {
        default: {
          name: 'default',
          url: 'http://x',
          token: 't',
          kind: 'selfhosted' as const,
          createdAt: new Date().toISOString(),
        },
      },
    };
    await store.write(initial);
    await expect(store.deleteProfile('default')).rejects.toThrow(/active profile/);
    await store.deleteProfile('default', true);
    const after = await store.read();
    expect(after.profiles).toEqual({});
  });
});
