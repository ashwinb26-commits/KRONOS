/**
 * Small crypto helpers built on WebCrypto, which is what the Workers runtime
 * provides. No Node built-ins, no third-party dependency.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Standard base64 of a UTF-8 string. btoa alone mangles anything above U+00FF. */
export function utf8ToBase64(value: string): string {
  const bytes = encoder.encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToUtf8(value: string): string {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return decoder.decode(bytes);
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signHmac(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

/** Constant-time verification via WebCrypto's own verify. */
export async function verifyHmac(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    const key = await hmacKey(secret);
    return await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signature) as unknown as ArrayBuffer,
      encoder.encode(message),
    );
  } catch {
    return false;
  }
}

/**
 * Length-independent constant-time string comparison.
 *
 * Both inputs are hashed first so the comparison runs over fixed-length digests
 * and the loop cannot leak the length of the secret.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const viewA = new Uint8Array(digestA);
  const viewB = new Uint8Array(digestB);
  let difference = 0;
  for (let i = 0; i < viewA.length; i += 1) difference |= viewA[i] ^ viewB[i];
  return difference === 0;
}

/** Decode a PEM block into raw DER bytes. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Sign a GitHub App JWT with RS256.
 *
 * WebCrypto can only import PKCS#8, so a PKCS#1 key ("BEGIN RSA PRIVATE KEY")
 * is rejected with an instruction rather than a type error.
 */
export async function signRs256Jwt(
  privateKeyPem: string,
  payload: Record<string, unknown>,
): Promise<string> {
  if (/BEGIN RSA PRIVATE KEY/.test(privateKeyPem)) {
    throw new Error(
      'The GitHub App key is in PKCS#1 format. Convert it with: openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in key.pem -out key-pkcs8.pem',
    );
  }

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem) as unknown as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}
