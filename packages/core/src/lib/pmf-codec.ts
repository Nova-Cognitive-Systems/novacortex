/**
 * PMF v1.1 codecs: binary encoding (MessagePack, ~60% smaller than JSON) and
 * authenticated encryption (AES-256-GCM with scrypt KDF) for at-rest/in-transit
 * protection of exported memory. Encryption uses only Node's crypto — no deps.
 */
import { encode, decode } from '@msgpack/msgpack';
import { randomBytes, scrypt as scryptCb, createCipheriv, createDecipheriv } from 'crypto';
import { promisify } from 'util';
import type { PortableMemoryFormat } from '../types/memory.js';

// Async scrypt so key derivation runs on the libuv threadpool instead of blocking
// the event loop (sync scrypt is ~30-100ms/call and would stall all requests).
const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

// ---- Binary (MessagePack) ----

export function encodePmfBinary(pmf: PortableMemoryFormat): Uint8Array {
  return encode(pmf);
}

export function decodePmfBinary(bytes: Uint8Array): PortableMemoryFormat {
  return decode(bytes) as PortableMemoryFormat;
}

// ---- Encryption (AES-256-GCM) ----

const ENC_MAGIC = Buffer.from('NCENC1'); // 6 bytes
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Encrypt arbitrary PMF bytes (JSON or MessagePack) with a password.
 * Envelope: MAGIC(6) | salt(16) | iv(12) | tag(16) | ciphertext.
 */
export async function encryptPmf(plaintext: Uint8Array, password: string): Promise<Buffer> {
  if (!password) throw new Error('encryptPmf: password required');
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(password, salt, 32);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENC_MAGIC, salt, iv, tag, ciphertext]);
}

/** Returns true if the buffer is an NCENC1 encrypted PMF envelope. */
export function isEncryptedPmf(buf: Uint8Array): boolean {
  return buf.length > ENC_MAGIC.length && Buffer.from(buf.subarray(0, ENC_MAGIC.length)).equals(ENC_MAGIC);
}

export async function decryptPmf(envelope: Uint8Array, password: string): Promise<Uint8Array> {
  if (!password) throw new Error('decryptPmf: password required');
  const buf = Buffer.from(envelope);
  if (!isEncryptedPmf(buf)) throw new Error('decryptPmf: not an NCENC1 envelope');
  let o = ENC_MAGIC.length;
  const salt = buf.subarray(o, (o += SALT_LEN));
  const iv = buf.subarray(o, (o += IV_LEN));
  const tag = buf.subarray(o, (o += TAG_LEN));
  const ciphertext = buf.subarray(o);
  const key = await scrypt(password, salt as Buffer, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
