#!/usr/bin/env node
/**
 * Issue a signed NovaCortex license key (issuer-only — needs the private key).
 *
 *   node scripts/issue-license.mjs --email you@example.com --tier pro [--expires 2027-01-01]
 *
 * The private key is read from (in order):
 *   1. $LICENSE_SIGNING_KEY        (PEM contents)
 *   2. $LICENSE_SIGNING_KEY_FILE   (path to a PEM file)
 *   3. config/.license-signing-key.pem
 *
 * Tiers: free | pro | enterprise. Give the printed key to the customer; they set
 * it via the LICENSE_KEY env var or POST /license/activate.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const email = arg('email');
const tier = arg('tier', 'pro');
const expires = arg('expires'); // optional ISO date

if (!email) {
  console.error('Usage: node scripts/issue-license.mjs --email <email> --tier <free|pro|enterprise> [--expires YYYY-MM-DD]');
  process.exit(1);
}
if (!['free', 'pro', 'enterprise'].includes(tier)) {
  console.error(`Invalid tier "${tier}". Must be free | pro | enterprise.`);
  process.exit(1);
}

function loadPrivateKey() {
  if (process.env.LICENSE_SIGNING_KEY) return crypto.createPrivateKey(process.env.LICENSE_SIGNING_KEY);
  const file = process.env.LICENSE_SIGNING_KEY_FILE || path.join(process.cwd(), 'config', '.license-signing-key.pem');
  if (!fs.existsSync(file)) {
    console.error(`No signing key found. Set LICENSE_SIGNING_KEY / LICENSE_SIGNING_KEY_FILE, or run scripts/gen-license-keypair.mjs first (expected ${file}).`);
    process.exit(1);
  }
  return crypto.createPrivateKey(fs.readFileSync(file, 'utf-8'));
}

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const signingKey = loadPrivateKey();
const payload = {
  v: 1,
  tier,
  email: email.toLowerCase(),
  iat: Math.floor(Date.now() / 1000),
  ...(expires ? { exp: Math.floor(new Date(expires).getTime() / 1000) } : {}),
};
const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
const sig = crypto.sign(null, Buffer.from(payloadB64), signingKey);
const key = `nclic.${payloadB64}.${base64url(sig)}`;

console.log(`Issued ${tier} license for ${email}${expires ? ` (expires ${expires})` : ''}:`);
console.log('');
console.log(key);
