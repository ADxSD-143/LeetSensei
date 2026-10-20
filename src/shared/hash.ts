/**
 * Content hashing.
 *
 * - `sha256Hex` is LeetSensei's own integrity hash for managed files.
 * - `gitBlobSha1` reproduces Git's blob object id so the planner can compare
 *   planned content against a remote file without downloading it.
 */

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

async function digest(algorithm: 'SHA-256' | 'SHA-1', bytes: Uint8Array): Promise<ArrayBuffer> {
  const source = new Uint8Array(bytes);
  return crypto.subtle.digest(algorithm, source);
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await digest('SHA-256', encoder.encode(text)));
}

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

/** Git blob object id: sha1("blob " + byteLength + "\0" + content). */
export async function gitBlobSha1(text: string): Promise<string> {
  const body = encoder.encode(text);
  const header = encoder.encode(`blob ${body.byteLength}\u0000`);
  const combined = new Uint8Array(header.byteLength + body.byteLength);
  combined.set(header, 0);
  combined.set(body, header.byteLength);
  return toHex(await digest('SHA-1', combined));
}

/** Base64 of the UTF-8 bytes, as expected by the GitHub blobs API. */
export function toBase64(text: string): string {
  const bytes = encoder.encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
