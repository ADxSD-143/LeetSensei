import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLogs,
  createLogger,
  getRecentLogs,
  redact,
  redactText,
  setLogLevel,
} from '../../src/shared/logger';

beforeEach(() => {
  // Keep the test output readable; the buffer still records every entry.
  setLogLevel('error');
  clearLogs();
});

describe('redact', () => {
  it('hides values under sensitive keys', () => {
    expect(
      redact({
        token: 'gho_abcdefghijklmnopqrstuvwxyz',
        access_token: 'secret',
        deviceCode: 'abc',
        client_secret: 'xyz',
        userCode: 'WDJB-MJHT',
        cookie: 'session',
        password: 'hunter2',
        keep: 'visible',
      }),
    ).toEqual({
      token: '[redacted]',
      access_token: '[redacted]',
      deviceCode: '[redacted]',
      client_secret: '[redacted]',
      userCode: '[redacted]',
      cookie: '[redacted]',
      password: '[redacted]',
      keep: 'visible',
    });
  });

  it('redacts nested structures and arrays', () => {
    expect(redact({ a: [{ token: 'x' }], b: { c: { password: 'y' } } })).toEqual({
      a: [{ token: '[redacted]' }],
      b: { c: { password: '[redacted]' } },
    });
  });

  it('redacts secret looking text anywhere', () => {
    expect(redactText('using ghp_abcdefghijklmnopqrstuvwx to push')).toBe(
      'using [redacted] to push',
    );
    expect(redactText('Authorization: Bearer abcdefghijklmnopqrst')).toContain('[redacted]');
    expect(redactText('nothing to hide')).toBe('nothing to hide');
  });

  it('leaves primitives alone', () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(true)).toBe(true);
  });

  it('bounds recursion', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } };
    expect(JSON.stringify(redact(deep))).toContain('[deep]');
  });
});

describe('log buffer', () => {
  it('records entries and can be cleared', () => {
    clearLogs();
    const logger = createLogger('test');
    logger.info('hello');
    logger.error('failed', { token: 'gho_abcdefghijklmnopqrstuvwx' });
    const entries = getRecentLogs();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ level: 'info', scope: 'test', message: 'hello' });
    clearLogs();
    expect(getRecentLogs()).toEqual([]);
  });

  it('never stores a raw secret in the buffer', () => {
    clearLogs();
    createLogger('test').warn('token ghp_abcdefghijklmnopqrstuvwx leaked');
    expect(JSON.stringify(getRecentLogs())).not.toContain('ghp_abcdefghijklmnopqrstuvwx');
  });

  it('bounds the buffer size', () => {
    clearLogs();
    const logger = createLogger('test');
    for (let index = 0; index < 260; index += 1) logger.info(`entry ${index}`);
    expect(getRecentLogs().length).toBeLessThanOrEqual(200);
    clearLogs();
  });
});
