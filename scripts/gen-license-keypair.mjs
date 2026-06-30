#!/usr/bin/env node
/**
 * Generate an ed25519 license signing keypair.
 *
 *   node scripts/gen-license-keypair.mjs
 *
 * - Writes the PRIVATE key to config/.license-signing-key.pem (gitignored, 0600).
 *   Keep this secret — store it in a password manager / secret store. Anyone with
 *   it can mint valid licenses.
 * - Prints the PUBLIC key (SPKI base64). Embed it in the OSS build by setting
 *   DEFAULT_LICENSE_PUBKEY in packages/api/src/services/license.ts, or ship it via
 *   the NOVACORTEX_LICENSE_PUBKEY env var. The public key is safe to publish.
 *
 * Rotating keys invalidates all previously issued license keys.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubDerB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

const outDir = path.join(process.cwd(), 'config');
fs.mkdirSync(outDir, { recursive: true });
const privPath = path.join(outDir, '.license-signing-key.pem');
fs.writeFileSync(privPath, privPem, { mode: 0o600 });

console.log(`Private key written to ${privPath} (gitignored, 0600) — keep it secret.`);
console.log('');
console.log('Public key (SPKI base64) — embed in the OSS build / NOVACORTEX_LICENSE_PUBKEY:');
console.log(pubDerB64);
