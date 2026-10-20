import { describe, expect, it } from 'vitest';
import {
  ERROR_MESSAGES,
  LeetSenseiError,
  isRetryable,
  messageForError,
  toLeetSenseiError,
} from '../../src/shared/errors';

describe('LeetSenseiError', () => {
  it('carries a code, a message and retryability', () => {
    const error = new LeetSenseiError('rate_limited', 'slow down', { retryable: true });
    expect(error.code).toBe('rate_limited');
    expect(error.message).toBe('slow down');
    expect(error.retryable).toBe(true);
    expect(error.name).toBe('LeetSenseiError');
  });

  it('defaults to non retryable', () => {
    expect(new LeetSenseiError('forbidden', 'nope').retryable).toBe(false);
  });

  it('serialises without leaking anything unexpected', () => {
    const error = new LeetSenseiError('conflict', 'pick one', { details: { path: 'a/b.py' } });
    expect(error.toJSON()).toEqual({
      name: 'LeetSenseiError',
      code: 'conflict',
      message: 'pick one',
      retryable: false,
      details: { path: 'a/b.py' },
    });
  });

  it('keeps the cause', () => {
    const cause = new Error('socket');
    const error = new LeetSenseiError('network_error', 'failed', { cause, retryable: true });
    expect(error.cause).toBe(cause);
  });
});

describe('toLeetSenseiError', () => {
  it('passes known errors through', () => {
    const original = new LeetSenseiError('no_changes', 'nothing to do');
    expect(toLeetSenseiError(original)).toBe(original);
  });

  it('wraps plain errors and unknown values', () => {
    expect(toLeetSenseiError(new Error('boom'))).toMatchObject({
      code: 'internal',
      message: 'boom',
    });
    expect(toLeetSenseiError('boom')).toMatchObject({ code: 'internal', message: 'boom' });
    expect(toLeetSenseiError(undefined)).toMatchObject({ code: 'internal', message: 'undefined' });
  });
});

describe('isRetryable', () => {
  it('accepts explicit and taxonomy retryable codes', () => {
    expect(isRetryable(new LeetSenseiError('network_error', 'x'))).toBe(true);
    expect(isRetryable(new LeetSenseiError('rate_limited', 'x'))).toBe(true);
    expect(isRetryable(new LeetSenseiError('remote_changed', 'x'))).toBe(true);
    expect(isRetryable(new LeetSenseiError('forbidden', 'x'))).toBe(false);
    expect(isRetryable(new LeetSenseiError('no_changes', 'x', { retryable: true }))).toBe(true);
    expect(isRetryable(new Error('x'))).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});

describe('messages', () => {
  it('has user facing copy for every code', () => {
    for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
      expect(message.length).toBeGreaterThanOrEqual(8);
      expect(code).toMatch(/^[a-z_]+$/);
    }
  });

  it('prefers the specific message', () => {
    expect(messageForError(new LeetSenseiError('conflict', 'specific'))).toBe('specific');
  });

  it('falls back to the taxonomy copy', () => {
    expect(messageForError(new LeetSenseiError('not_connected', ''))).toBe(
      ERROR_MESSAGES.not_connected,
    );
  });
});
