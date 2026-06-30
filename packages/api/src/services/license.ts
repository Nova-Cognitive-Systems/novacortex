/**
 * NovaCortex License System
 *
 * Tiers:
 * - unregistered (no key): 1 namespace, no support
 * - free (free key): 3 namespaces, community support (GitHub issues, no SLA)
 * - pro: 10 namespaces, email support (48h response time)
 * - enterprise: unlimited namespaces, priority support (24h response time)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type LicenseTier = 'unregistered' | 'free' | 'pro' | 'enterprise';

export interface License {
  key: string;
  email: string;
  tier: LicenseTier;
  createdAt: string;
  expiresAt?: string;
  features: {
    maxNamespaces: number;
    priority_support: boolean;
    api_rate_limit: number;
    federation: boolean; // Pro+ feature: cross-namespace reads
  };
}

/**
 * Namespace Federation Config
 * Allows agents to read from multiple namespaces while writing to their primary
 */
export interface FederationConfig {
  // Agent ID -> Federation settings
  [agentId: string]: {
    primaryNamespace: string;      // Where this agent writes
    readableNamespaces: string[];  // Additional NS this agent can read from
  };
}

export interface FederationRule {
  agentId: string;
  primaryNamespace: string;
  readableNamespaces: string[];
}

export interface LicenseValidation {
  valid: boolean;
  tier: LicenseTier;
  maxNamespaces: number;
  message?: string;
}

// Namespace limits per tier
const TIER_LIMITS: Record<LicenseTier, number> = {
  unregistered: 1,
  free: 3,
  pro: 10,
  enterprise: 999, // effectively unlimited
};

// License keys are ed25519-signed. The OSS build embeds only the PUBLIC key and
// can therefore VERIFY keys offline but never forge them — issuance requires the
// private key, held solely by the issuer. (The old HMAC scheme embedded a shared
// secret in the OSS build, making keys forgeable; those legacy MS-* keys no longer
// validate.) Override the public key with NOVACORTEX_LICENSE_PUBKEY to run your
// own signing keypair (generate one with scripts/gen-license-keypair.mjs).
const DEFAULT_LICENSE_PUBKEY = 'MCowBQYDK2VwAyEAhvYP4vhJaexSzt0Zzw541kFN7fu0OnhRDEMwnHZlXlQ=';
const KEY_PREFIX = 'nclic';

interface LicensePayload {
  v: number;
  tier: LicenseTier;
  email: string;
  iat: number; // issued-at (unix seconds)
  exp?: number; // optional expiry (unix seconds)
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Public key (verification). Read at call time so NOVACORTEX_LICENSE_PUBKEY can
 * override the embedded default without a rebuild. */
function getLicensePublicKey(): crypto.KeyObject {
  const b64 = process.env['NOVACORTEX_LICENSE_PUBKEY'] || DEFAULT_LICENSE_PUBKEY;
  return crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
}

/** Private signing key — issuer-only, NEVER shipped in the OSS build. */
function getLicenseSigningKey(): crypto.KeyObject | null {
  const pem = process.env['LICENSE_SIGNING_KEY'];
  if (pem) return crypto.createPrivateKey(pem);
  const file = process.env['LICENSE_SIGNING_KEY_FILE'];
  if (file && fs.existsSync(file)) return crypto.createPrivateKey(fs.readFileSync(file, 'utf-8'));
  return null;
}

function tierFeatures(tier: LicenseTier): License['features'] {
  return {
    maxNamespaces: TIER_LIMITS[tier],
    priority_support: tier === 'pro' || tier === 'enterprise',
    api_rate_limit: tier === 'enterprise' ? 10000 : tier === 'pro' ? 1000 : 100,
    federation: tier === 'pro' || tier === 'enterprise',
  };
}

export class LicenseService {
  private licensePath: string;
  private federationPath: string;
  private currentLicense: License | null = null;
  private federationConfig: FederationConfig = {};

  constructor(licensePath?: string) {
    this.licensePath = licensePath || path.join(process.cwd(), '.memory-stack-license');
    this.federationPath = path.join(path.dirname(this.licensePath), '.memory-stack-federation');
    this.loadLicense();
    this.loadFederation();
    this.activateFromEnv();
  }

  /**
   * Activate license from LICENSE_KEY environment variable.
   * Env var takes precedence over file-based license.
   */
  private activateFromEnv(): void {
    const envKey = process.env['LICENSE_KEY'];
    if (!envKey) return;

    const validation = this.validateKey(envKey);
    if (!validation.valid) {
      console.warn('LICENSE_KEY env var contains an invalid license key');
      return;
    }

    const license: License = {
      key: envKey,
      email: this.currentLicense?.email || 'env@license.local',
      tier: validation.tier,
      createdAt: this.currentLicense?.createdAt || new Date().toISOString(),
      features: {
        maxNamespaces: validation.maxNamespaces,
        priority_support: validation.tier === 'pro' || validation.tier === 'enterprise',
        api_rate_limit: validation.tier === 'enterprise' ? 10000 : validation.tier === 'pro' ? 1000 : 100,
        federation: validation.tier === 'pro' || validation.tier === 'enterprise',
      },
    };

    this.currentLicense = license;
    // Persist to file so other parts of the system can access it
    try {
      fs.writeFileSync(this.licensePath, JSON.stringify(license, null, 2));
    } catch (e) {
      // Non-fatal: license is still active in memory
      console.warn('Could not persist env license to file:', e);
    }
  }

  /**
   * Generate a new license key
   */
  generateKey(email: string, tier: LicenseTier, options: { expiresAt?: Date } = {}): License {
    const signingKey = getLicenseSigningKey();
    if (!signingKey) {
      throw new Error(
        'License issuance requires the private signing key (set LICENSE_SIGNING_KEY or LICENSE_SIGNING_KEY_FILE). ' +
          'The OSS build can verify keys but cannot mint them — issue keys with scripts/issue-license.mjs.'
      );
    }

    const iat = Math.floor(Date.now() / 1000);
    const payload: LicensePayload = {
      v: 1,
      tier,
      email: email.toLowerCase(),
      iat,
      ...(options.expiresAt ? { exp: Math.floor(options.expiresAt.getTime() / 1000) } : {}),
    };
    const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
    const signature = crypto.sign(null, Buffer.from(payloadB64), signingKey);
    const key = `${KEY_PREFIX}.${payloadB64}.${base64url(signature)}`;

    return {
      key,
      email: email.toLowerCase(),
      tier,
      createdAt: new Date(iat * 1000).toISOString(),
      ...(options.expiresAt ? { expiresAt: options.expiresAt.toISOString() } : {}),
      features: tierFeatures(tier),
    };
  }

  /**
   * Validate a license key
   */
  validateKey(key: string): LicenseValidation {
    if (!key) {
      return {
        valid: true,
        tier: 'unregistered',
        maxNamespaces: TIER_LIMITS.unregistered,
        message: 'No license key - running in unregistered mode',
      };
    }

    const invalid = (message: string): LicenseValidation => ({
      valid: false,
      tier: 'unregistered',
      maxNamespaces: TIER_LIMITS.unregistered,
      message,
    });

    // Format: nclic.<base64url(payload)>.<base64url(ed25519 signature)>
    const parts = key.split('.');
    if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
      return invalid('Invalid license key format');
    }
    const [, payloadB64, sigB64] = parts;

    // Verify the ed25519 signature against the embedded public key (offline,
    // unforgeable without the issuer's private key).
    let signatureOk = false;
    try {
      signatureOk = crypto.verify(null, Buffer.from(payloadB64!), getLicensePublicKey(), fromBase64url(sigB64!));
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) {
      return invalid('Invalid license key signature');
    }

    let payload: LicensePayload;
    try {
      payload = JSON.parse(fromBase64url(payloadB64!).toString('utf-8'));
    } catch {
      return invalid('Invalid license payload');
    }

    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return invalid('License key has expired');
    }

    const tier: LicenseTier = payload.tier && TIER_LIMITS[payload.tier] !== undefined ? payload.tier : 'unregistered';
    return {
      valid: true,
      tier,
      maxNamespaces: TIER_LIMITS[tier],
    };
  }

  /**
   * Upgrade a license to a new tier
   */
  upgradeLicense(currentKey: string, newTier: LicenseTier): License | null {
    const validation = this.validateKey(currentKey);
    if (!validation.valid) {
      return null;
    }

    // Get email from stored license or generate placeholder
    const email = this.currentLicense?.email || 'upgrade@memory-stack.local';

    return this.generateKey(email, newTier);
  }

  /**
   * Load license from file
   */
  private loadLicense(): void {
    try {
      if (fs.existsSync(this.licensePath)) {
        const data = fs.readFileSync(this.licensePath, 'utf-8');
        this.currentLicense = JSON.parse(data);
      }
    } catch (e) {
      console.warn('Could not load license file:', e);
      this.currentLicense = null;
    }
  }

  /**
   * Save license to file
   */
  saveLicense(license: License): void {
    try {
      fs.writeFileSync(this.licensePath, JSON.stringify(license, null, 2));
      this.currentLicense = license;
    } catch (e) {
      console.error('Could not save license file:', e);
      throw new Error('Failed to save license');
    }
  }

  /**
   * Get current license
   */
  getCurrentLicense(): License | null {
    return this.currentLicense;
  }

  /**
   * Get current tier and limits
   */
  getCurrentTier(): LicenseValidation {
    if (!this.currentLicense) {
      return {
        valid: true,
        tier: 'unregistered',
        maxNamespaces: TIER_LIMITS.unregistered,
        message: 'No license - unregistered mode',
      };
    }
    return this.validateKey(this.currentLicense.key);
  }

  /**
   * Get namespace limit for current license
   */
  getNamespaceLimit(): number {
    const tier = this.getCurrentTier();
    return tier.maxNamespaces;
  }

  // ============ FEDERATION METHODS (Pro+ Feature) ============

  /**
   * Load federation config from file
   */
  private loadFederation(): void {
    try {
      if (fs.existsSync(this.federationPath)) {
        const data = fs.readFileSync(this.federationPath, 'utf-8');
        this.federationConfig = JSON.parse(data);
      }
    } catch (e) {
      console.warn('Could not load federation config:', e);
      this.federationConfig = {};
    }
  }

  /**
   * Save federation config to file
   */
  private saveFederation(): void {
    try {
      fs.writeFileSync(this.federationPath, JSON.stringify(this.federationConfig, null, 2));
    } catch (e) {
      console.error('Could not save federation config:', e);
      throw new Error('Failed to save federation config');
    }
  }

  /**
   * Check if federation is available (Pro+ feature)
   */
  isFederationEnabled(): boolean {
    const tier = this.getCurrentTier();
    return tier.tier === 'pro' || tier.tier === 'enterprise';
  }

  /**
   * Set federation rules for an agent
   */
  setAgentFederation(rule: FederationRule): { success: boolean; message: string } {
    if (!this.isFederationEnabled()) {
      return {
        success: false,
        message: 'Federation is a Pro feature. Upgrade to enable cross-namespace reads.',
      };
    }

    this.federationConfig[rule.agentId] = {
      primaryNamespace: rule.primaryNamespace,
      readableNamespaces: rule.readableNamespaces,
    };

    this.saveFederation();

    return {
      success: true,
      message: `Agent ${rule.agentId} can now read from: ${[rule.primaryNamespace, ...rule.readableNamespaces].join(', ')}`,
    };
  }

  /**
   * Get federation config for an agent
   */
  getAgentFederation(agentId: string): FederationRule | null {
    const config = this.federationConfig[agentId];
    if (!config) return null;

    return {
      agentId,
      primaryNamespace: config.primaryNamespace,
      readableNamespaces: config.readableNamespaces,
    };
  }

  /**
   * Get all readable namespaces for an agent (primary + federated)
   */
  getReadableNamespaces(agentId: string, fallbackNamespace: string): string[] {
    if (!this.isFederationEnabled()) {
      return [fallbackNamespace];
    }

    const config = this.federationConfig[agentId];
    if (!config) {
      return [fallbackNamespace];
    }

    // Return primary + all readable namespaces (deduplicated)
    return [...new Set([config.primaryNamespace, ...config.readableNamespaces])];
  }

  /**
   * Get primary (write) namespace for an agent
   */
  getPrimaryNamespace(agentId: string, fallbackNamespace: string): string {
    const config = this.federationConfig[agentId];
    return config?.primaryNamespace || fallbackNamespace;
  }

  /**
   * Remove federation config for an agent
   */
  removeAgentFederation(agentId: string): boolean {
    if (this.federationConfig[agentId]) {
      delete this.federationConfig[agentId];
      this.saveFederation();
      return true;
    }
    return false;
  }

  /**
   * Get all federation configs
   */
  getAllFederationConfigs(): FederationConfig {
    return { ...this.federationConfig };
  }
}

// Singleton instance
let licenseServiceInstance: LicenseService | null = null;

export function getLicenseService(): LicenseService {
  if (!licenseServiceInstance) {
    licenseServiceInstance = new LicenseService();
  }
  return licenseServiceInstance;
}

export { TIER_LIMITS };
