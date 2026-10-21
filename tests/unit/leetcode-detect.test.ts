import { describe, expect, it } from 'vitest';
import {
  classifyResultText,
  evaluateResultNode,
  extractSubmissionId,
  extractTitleSlug,
  isSubmitControl,
  pickResultVerdict,
} from '../../src/adapters/leetcode/detect';

describe('classifyResultText', () => {
  it('recognises the accepted verdict', () => {
    expect(classifyResultText('Accepted')).toBe('accepted');
    expect(classifyResultText('  Accepted  ')).toBe('accepted');
    expect(classifyResultText('Accepted\nRuntime: 62 ms')).toBe('accepted');
  });

  it('recognises every rejection LeetCode can report', () => {
    for (const text of [
      'Wrong Answer',
      'Runtime Error',
      'Time Limit Exceeded',
      'Compilation Error',
      'Memory Limit Exceeded',
      'Output Limit Exceeded',
      'Internal Error',
      'Presentation Error',
    ]) {
      expect(classifyResultText(text)).toBe('rejected');
    }
  });

  it('treats judging states as pending, never as success', () => {
    for (const text of ['Pending', 'Started', 'Judging', 'In Queue']) {
      expect(classifyResultText(text)).toBe('pending');
    }
  });

  it('does not match substrings by accident', () => {
    expect(classifyResultText('Acceptedness')).toBe('none');
    expect(classifyResultText('notaccepted')).toBe('none');
  });

  it('returns none for empty or unknown text', () => {
    expect(classifyResultText(null)).toBe('none');
    expect(classifyResultText('')).toBe('none');
    expect(classifyResultText('   ')).toBe('none');
    expect(classifyResultText('Run Code')).toBe('none');
  });
});

describe('evaluateResultNode', () => {
  it('reads a node text content', () => {
    expect(evaluateResultNode({ textContent: 'Accepted' })).toBe('accepted');
    expect(evaluateResultNode(null)).toBe('none');
    expect(evaluateResultNode({ textContent: null })).toBe('none');
  });
});

describe('pickResultVerdict', () => {
  it('prefers a real verdict over a stale judging node', () => {
    expect(pickResultVerdict([{ textContent: 'Judging' }, { textContent: 'Accepted' }])).toBe(
      'accepted',
    );
    expect(pickResultVerdict([{ textContent: 'Accepted' }, { textContent: 'Wrong Answer' }])).toBe(
      'accepted',
    );
  });

  it('does not let a stale accepted node hide a newer rejection', () => {
    expect(pickResultVerdict([{ textContent: 'Wrong Answer' }, { textContent: 'Judging' }])).toBe(
      'rejected',
    );
  });

  it('returns none when nothing matches', () => {
    expect(pickResultVerdict([])).toBe('none');
    expect(pickResultVerdict([{ textContent: 'Run Code' }])).toBe('none');
  });
});

describe('extractTitleSlug', () => {
  it('reads the slug from a problem path', () => {
    expect(extractTitleSlug('/problems/two-sum/')).toBe('two-sum');
    expect(extractTitleSlug('/problems/contains-duplicate/description/')).toBe(
      'contains-duplicate',
    );
    expect(extractTitleSlug('/problems/3sum-closest/submissions/1234/')).toBe('3sum-closest');
  });

  it('decodes escaped characters', () => {
    expect(extractTitleSlug('/problems/a%20b/')).toBe('a b');
  });

  it('returns null outside a problem page', () => {
    expect(extractTitleSlug('/problemset/all/')).toBeNull();
    expect(extractTitleSlug('/')).toBeNull();
    expect(extractTitleSlug('/problems/')).toBeNull();
  });
});

describe('extractSubmissionId', () => {
  it('reads an id from a link or a bare number', () => {
    expect(extractSubmissionId('/submissions/123456789/')).toBe('123456789');
    expect(extractSubmissionId('https://leetcode.com/submissions/42/')).toBe('42');
    expect(extractSubmissionId('1234567')).toBe('1234567');
  });

  it('rejects anything else', () => {
    expect(extractSubmissionId('submissions/abc/')).toBeNull();
    expect(extractSubmissionId('12')).toBeNull();
    expect(extractSubmissionId('')).toBeNull();
  });
});

describe('isSubmitControl', () => {
  it('matches the submit controls LeetCode uses', () => {
    expect(isSubmitControl('Submit')).toBe(true);
    expect(isSubmitControl('  submit  ')).toBe(true);
    expect(isSubmitControl('Submit Solution')).toBe(true);
  });

  it('ignores other controls', () => {
    expect(isSubmitControl('Run')).toBe(false);
    expect(isSubmitControl('Run Code')).toBe(false);
    expect(isSubmitControl('Submissions')).toBe(false);
    expect(isSubmitControl(null)).toBe(false);
  });
});
