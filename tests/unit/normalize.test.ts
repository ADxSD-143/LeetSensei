import { describe, expect, it } from 'vitest';
import { LeetSenseiError } from '../../src/shared/errors';
import {
  isAcceptedStatus,
  isFinalStatus,
  isPendingStatus,
  normalizeSubmission,
} from '../../src/core/normalize';
import { makeRaw } from '../helpers';

describe('submission status', () => {
  it('accepts only the Accepted status', () => {
    expect(isAcceptedStatus('Accepted')).toBe(true);
    expect(isAcceptedStatus('  Accepted  ')).toBe(true);
    expect(isAcceptedStatus('accepted')).toBe(false);
    expect(isAcceptedStatus('Wrong Answer')).toBe(false);
  });

  it('treats judging states as non-final', () => {
    for (const status of ['', 'Pending', 'Started', 'Judging', 'queued']) {
      expect(isPendingStatus(status)).toBe(true);
      expect(isFinalStatus(status)).toBe(false);
    }
    expect(isFinalStatus('Accepted')).toBe(true);
    expect(isFinalStatus('Runtime Error')).toBe(true);
  });
});

describe('normalizeSubmission', () => {
  it('produces a canonical record for an Accepted submission', async () => {
    const submission = await normalizeSubmission(makeRaw());
    expect(submission).toMatchObject({
      submissionId: '123456789',
      problemId: '0217',
      slug: '0217-contains-duplicate',
      title: 'Contains Duplicate',
      titleSlug: 'contains-duplicate',
      difficulty: 'Easy',
      tags: ['Array', 'Hash Table'],
      categories: ['Array', 'Hash-Table'],
      metadataIncomplete: false,
    });
    expect(submission.language).toEqual({ id: 'python3', label: 'Python 3', extension: 'py' });
    expect(submission.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(submission.blobSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it.each([
    'Wrong Answer',
    'Runtime Error',
    'Time Limit Exceeded',
    'Compilation Error',
    'Memory Limit Exceeded',
    'Pending',
    'Internal Error',
    '',
  ])('refuses to sync a "%s" submission', async (status) => {
    await expect(normalizeSubmission(makeRaw({ status }))).rejects.toMatchObject({
      code: 'not_accepted',
    });
  });

  it('reports an unsupported language instead of guessing', async () => {
    await expect(normalizeSubmission(makeRaw({ language: 'brainfuck' }))).rejects.toMatchObject({
      code: 'unsupported_language',
    });
  });

  it('reports a missing submission id', async () => {
    await expect(normalizeSubmission(makeRaw({ submissionId: '   ' }))).rejects.toMatchObject({
      code: 'extraction_failed',
    });
  });

  it('reports empty source code', async () => {
    await expect(normalizeSubmission(makeRaw({ code: '   \n  ' }))).rejects.toMatchObject({
      code: 'extraction_failed',
    });
  });

  it('handles missing metadata without inventing values', async () => {
    const submission = await normalizeSubmission(
      makeRaw({ problemId: null, difficulty: null, tags: [] }),
    );
    expect(submission.metadataIncomplete).toBe(true);
    expect(submission.problemId).toBe('contains-duplicate');
    expect(submission.slug).toBe('contains-duplicate');
    expect(submission.difficulty).toBe('Unknown');
    expect(submission.tags).toEqual([]);
    expect(submission.categories).toEqual(['Uncategorized']);
    expect(submission.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('honours a custom fallback category', async () => {
    const submission = await normalizeSubmission(makeRaw({ tags: [] }), {
      fallbackCategory: 'Needs-Topics',
    });
    expect(submission.categories).toEqual(['Needs-Topics']);
  });

  it('normalises line endings and strips a byte order mark', async () => {
    const submission = await normalizeSubmission(makeRaw({ code: '\uFEFFint a;\r\nint b;\r\n' }));
    expect(submission.code).toBe('int a;\nint b;\n');
  });

  it('produces identical hashes for equivalent content', async () => {
    const windows = await normalizeSubmission(makeRaw({ code: 'a\r\nb\r\n' }));
    const unix = await normalizeSubmission(makeRaw({ code: 'a\nb' }));
    expect(windows.contentHash).toBe(unix.contentHash);
    expect(windows.blobSha).toBe(unix.blobSha);
  });

  it('sorts and de-duplicates tags', async () => {
    const submission = await normalizeSubmission(
      makeRaw({ tags: ['Hash Table', 'Array', 'Array', '  ', 'Trie'] }),
    );
    expect(submission.tags).toEqual(['Hash Table', 'Array', 'Trie']);
    expect(submission.categories).toEqual(['Array', 'Hash-Table', 'Trie']);
  });

  it('derives the problem url from the title slug when it is missing', async () => {
    const submission = await normalizeSubmission(makeRaw({ url: null }));
    expect(submission.url).toBe('https://leetcode.com/problems/contains-duplicate/');
  });

  it('surfaces a typed error object', async () => {
    const error = await normalizeSubmission(makeRaw({ status: 'Wrong Answer' })).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(LeetSenseiError);
    expect((error as LeetSenseiError).details.status).toBe('Wrong Answer');
  });
});
