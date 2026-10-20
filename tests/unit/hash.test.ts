import { describe, expect, it } from 'vitest';
import { gitBlobSha1, sha256Hex, toBase64, utf8ByteLength } from '../../src/shared/hash';

describe('sha256Hex', () => {
  it('matches the published test vector', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is stable and content sensitive', async () => {
    expect(await sha256Hex('a')).toBe(await sha256Hex('a'));
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'));
  });
});

describe('gitBlobSha1', () => {
  it('matches Git object ids', async () => {
    expect(await gitBlobSha1('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha1('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('uses the byte length rather than the character count', async () => {
    expect(utf8ByteLength('héllo')).toBe(6);
    const short = await gitBlobSha1('aa');
    const unicode = await gitBlobSha1('é');
    expect(short).not.toBe(unicode);
  });
});

describe('toBase64', () => {
  it('encodes UTF-8 bytes', () => {
    expect(toBase64('hello')).toBe('aGVsbG8=');
    expect(toBase64('')).toBe('');
    expect(toBase64('é')).toBe('w6k=');
  });
});
