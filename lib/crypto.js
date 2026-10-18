// Encryption for anything sensitive we have to keep (LibreLinkUp logins and
// their short-lived session tokens).
//
// AES-256-GCM with a random 96-bit IV per value. The key lives ONLY in the
// CREDENTIAL_ENCRYPTION_KEY environment variable — never in the database —
// so a leaked/dumped database on its own is just ciphertext.
//
// Each value is also bound to a context string ("AAD", e.g. the slug it
// belongs to). A ciphertext copied onto a different slug fails to decrypt,
// and any tampering is detected by the GCM auth tag.
//
// Format:  v1.<iv>.<tag>.<ciphertext>   (all base64url)
// The "v1" prefix leaves room for key rotation later.
//
// Generate a key (32 random bytes, base64):
//   PowerShell:
//     $b = New-Object byte[] 32
//     [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
//     [Convert]::ToBase64String($b)
//   or: openssl rand -base64 32

const crypto = require('crypto');

const VERSION = 'v1';

function fail(code, message, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function loadKey() {
  const raw = (process.env.CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw fail('not_configured', 'This site is not set up to store logins securely yet.', 503);
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw fail('not_configured', 'CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes.', 503);
  }
  return key;
}

function isConfigured() {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

function encryptJson(value, context) {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(context), 'utf8'));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

function decryptJson(token, context) {
  const key = loadKey();
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw fail('decrypt_failed', 'Stored data could not be read.', 500);
  }
  try {
    const [, iv, tag, data] = parts.map((p, i) => (i === 0 ? p : Buffer.from(p, 'base64url')));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(String(context), 'utf8'));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    // Wrong key, wrong context, or tampered — deliberately no detail.
    throw fail('decrypt_failed', 'Stored data could not be read.', 500);
  }
}

module.exports = { encryptJson, decryptJson, isConfigured };
