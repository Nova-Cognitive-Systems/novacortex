import fs from 'fs';
import path from 'path';
import { ConfigV1Schema, emptyConfig, type ConfigV1, type Profile } from './schema.js';

export class ConfigCorruptedError extends Error {
  readonly code = 'config_corrupted';
  constructor(public readonly filePath: string, reason: string) {
    super(`Config at ${filePath} is corrupted: ${reason}`);
    this.name = 'ConfigCorruptedError';
  }
}

export class ProfileStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<ConfigV1> {
    if (!fs.existsSync(this.filePath)) return emptyConfig();
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (e) {
      throw new ConfigCorruptedError(this.filePath, `read failed: ${String(e)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new ConfigCorruptedError(this.filePath, `invalid JSON: ${String(e)}`);
    }
    const result = ConfigV1Schema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigCorruptedError(this.filePath, result.error.message);
    }
    return result.data;
  }

  async write(cfg: ConfigV1): Promise<void> {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.filePath);
  }

  async upsertProfile(profile: Profile, makeActive = false): Promise<void> {
    const cfg = await this.read();
    cfg.profiles[profile.name] = profile;
    if (makeActive || !cfg.activeProfile) cfg.activeProfile = profile.name;
    await this.write(cfg);
  }

  async setActiveProfile(name: string): Promise<void> {
    const cfg = await this.read();
    if (!cfg.profiles[name]) throw new Error(`unknown profile: ${name}`);
    cfg.activeProfile = name;
    await this.write(cfg);
  }

  async deleteProfile(name: string, force = false): Promise<void> {
    const cfg = await this.read();
    if (!cfg.profiles[name]) throw new Error(`unknown profile: ${name}`);
    if (cfg.activeProfile === name && !force) {
      throw new Error('Cannot delete the active profile without force');
    }
    delete cfg.profiles[name];
    if (cfg.activeProfile === name) cfg.activeProfile = '';
    await this.write(cfg);
  }

  async renameProfile(oldName: string, newName: string): Promise<void> {
    const cfg = await this.read();
    const existing = cfg.profiles[oldName];
    if (!existing) throw new Error(`unknown profile: ${oldName}`);
    if (cfg.profiles[newName]) throw new Error(`profile already exists: ${newName}`);
    delete cfg.profiles[oldName];
    cfg.profiles[newName] = { ...existing, name: newName };
    if (cfg.activeProfile === oldName) cfg.activeProfile = newName;
    await this.write(cfg);
  }
}

/** Default config file path for the current platform. */
export function defaultConfigPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(process.env['USERPROFILE'] ?? '.', 'AppData', 'Roaming');
    return path.join(appData, 'novacortex', 'config.json');
  }
  const xdg = process.env['XDG_CONFIG_HOME'];
  const home = process.env['HOME'] ?? '.';
  return path.join(xdg ?? path.join(home, '.config'), 'novacortex', 'config.json');
}
