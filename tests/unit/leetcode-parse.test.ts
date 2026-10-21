import { describe, expect, it } from 'vitest';
import {
  assembleRawSubmission,
  coerceRawSubmission,
  parseQuestionResponse,
  parseSubmissionDetailsResponse,
  parseSubmissionListResponse,
  parseTimestamp,
  pickUnprocessedSubmission,
} from '../../src/adapters/leetcode/parse';

/** Sanitised fixture shaped like LeetCode's own responses. */
const QUESTION_FIXTURE = {
  data: {
    question: {
      questionId: '217',
      questionFrontendId: '217',
      title: 'Contains Duplicate',
      titleSlug: 'contains-duplicate',
      difficulty: 'Easy',
      topicTags: [
        { name: 'Array', slug: 'array' },
        { name: 'Hash Table', slug: 'hash-table' },
      ],
    },
  },
};

const DETAILS_FIXTURE = {
  data: {
    submissionDetails: {
      id: 123456789,
      statusDisplay: 'Accepted',
      lang: { name: 'python3', verboseName: 'Python 3' },
      code: 'class Solution:\n    pass\n',
      timestamp: 1709618828,
      question: {
        questionId: '217',
        questionFrontendId: '217',
        title: 'Contains Duplicate',
        titleSlug: 'contains-duplicate',
        difficulty: 'Easy',
        topicTags: [{ name: 'Array' }],
      },
    },
  },
};

const LIST_FIXTURE = {
  data: {
    submissionList: {
      submissions: [
        { id: 3, statusDisplay: 'Accepted', lang: 'python3', timestamp: 1709618828 },
        { id: 2, statusDisplay: 'Wrong Answer', lang: 'cpp', timestamp: 1709618000 },
        { id: 1, statusDisplay: 'Accepted', lang: 'java', timestamp: 1709617000 },
      ],
    },
  },
};

describe('parseTimestamp', () => {
  it('handles unix seconds, milliseconds and ISO strings', () => {
    expect(parseTimestamp(1709618828)).toBe(new Date(1709618828 * 1000).toISOString());
    expect(parseTimestamp(1709618828000)).toBe(new Date(1709618828000).toISOString());
    expect(parseTimestamp('1709618828')).toBe(new Date(1709618828 * 1000).toISOString());
    expect(parseTimestamp('2024-03-05T06:07:08.000Z')).toBe('2024-03-05T06:07:08.000Z');
  });

  it('returns null rather than inventing a date', () => {
    expect(parseTimestamp('whenever')).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp(Number.NaN)).toBeNull();
  });
});

describe('parseQuestionResponse', () => {
  it('reads the question metadata and tags', () => {
    expect(parseQuestionResponse(QUESTION_FIXTURE)).toEqual({
      questionId: '217',
      frontendId: '217',
      title: 'Contains Duplicate',
      titleSlug: 'contains-duplicate',
      difficulty: 'Easy',
      tags: ['Array', 'Hash Table'],
    });
  });

  it('tolerates a missing envelope, missing tags and missing fields', () => {
    expect(parseQuestionResponse({ question: { titleSlug: 'two-sum' } })).toMatchObject({
      titleSlug: 'two-sum',
      tags: [],
      difficulty: null,
    });
  });

  it('returns null for unusable input', () => {
    expect(parseQuestionResponse(null)).toBeNull();
    expect(parseQuestionResponse({ data: { question: null } })).toBeNull();
    expect(parseQuestionResponse({ data: { question: {} } })).toBeNull();
    expect(parseQuestionResponse('nope')).toBeNull();
  });
});

describe('parseSubmissionDetailsResponse', () => {
  it('reads code, language and status', () => {
    const details = parseSubmissionDetailsResponse(DETAILS_FIXTURE);
    expect(details).toMatchObject({
      submissionId: '123456789',
      status: 'Accepted',
      language: 'python3',
      code: 'class Solution:\n    pass\n',
    });
    expect(details?.timestamp).toBe(new Date(1709618828 * 1000).toISOString());
    expect(details?.question?.tags).toEqual(['Array']);
  });

  it('tolerates a missing language object', () => {
    const details = parseSubmissionDetailsResponse({
      data: { submissionDetails: { id: 1, statusDisplay: 'Accepted', lang: 'golang' } },
    });
    expect(details?.language).toBe('golang');
  });

  it('returns null when the submission is absent', () => {
    expect(parseSubmissionDetailsResponse({ data: { submissionDetails: null } })).toBeNull();
  });

  it('never invents a status', () => {
    const details = parseSubmissionDetailsResponse({ data: { submissionDetails: { id: 1 } } });
    expect(details?.status).toBeNull();
  });
});

describe('parseSubmissionListResponse', () => {
  it('reads every entry', () => {
    const entries = parseSubmissionListResponse(LIST_FIXTURE);
    expect(entries.map((entry) => entry.id)).toEqual(['3', '2', '1']);
    expect(entries[0]).toMatchObject({ status: 'Accepted', language: 'python3' });
  });

  it('skips entries without an id and never throws', () => {
    const entries = parseSubmissionListResponse({
      data: { submissionList: { submissions: [{ statusDisplay: 'Accepted' }, { id: 9 }] } },
    });
    expect(entries.map((entry) => entry.id)).toEqual(['9']);
    expect(parseSubmissionListResponse({})).toEqual([]);
    expect(parseSubmissionListResponse(null)).toEqual([]);
  });
});

describe('pickUnprocessedSubmission', () => {
  it('returns the newest entry LeetSensei has not handled', () => {
    const entries = parseSubmissionListResponse(LIST_FIXTURE);
    expect(pickUnprocessedSubmission(entries, new Set())?.id).toBe('3');
    expect(pickUnprocessedSubmission(entries, new Set(['3']))?.id).toBe('2');
    expect(pickUnprocessedSubmission(entries, new Set(['3', '2', '1']))).toBeNull();
  });
});

describe('assembleRawSubmission', () => {
  it('merges the question query, the submission details and the URL', () => {
    const raw = assembleRawSubmission({
      submissionId: '123456789',
      details: parseSubmissionDetailsResponse(DETAILS_FIXTURE),
      question: parseQuestionResponse(QUESTION_FIXTURE),
      titleSlugFromUrl: 'contains-duplicate',
      url: 'https://leetcode.com/problems/contains-duplicate/',
    });
    expect(raw).toMatchObject({
      submissionId: '123456789',
      status: 'Accepted',
      language: 'python3',
      problemId: '217',
      titleSlug: 'contains-duplicate',
      difficulty: 'Easy',
      tags: ['Array', 'Hash Table'],
    });
    expect(raw.url?.endsWith('/problems/contains-duplicate/')).toBe(true);
  });

  it('falls back to the details question and then to the URL slug', () => {
    const fromDetails = assembleRawSubmission({
      submissionId: '1',
      details: parseSubmissionDetailsResponse(DETAILS_FIXTURE),
      question: null,
      titleSlugFromUrl: 'contains-duplicate',
      url: '',
    });
    expect(fromDetails.problemId).toBe('217');
    expect(fromDetails.tags).toEqual(['Array']);

    const fromUrl = assembleRawSubmission({
      submissionId: '2',
      details: null,
      question: null,
      titleSlugFromUrl: 'two-sum',
      url: '',
    });
    expect(fromUrl).toMatchObject({ titleSlug: 'two-sum', problemId: null, tags: [] });
    expect(fromUrl.url).toBe('https://leetcode.com/problems/two-sum/');
  });

  it('marks missing metadata as empty rather than guessing', () => {
    const raw = assembleRawSubmission({
      submissionId: '5',
      details: null,
      question: null,
      titleSlugFromUrl: null,
      url: '',
    });
    expect(raw.status).toBe('');
    expect(raw.code).toBe('');
    expect(raw.tags).toEqual([]);
  });
});

describe('coerceRawSubmission', () => {
  it('accepts a well formed payload', () => {
    expect(
      coerceRawSubmission({
        submissionId: '1',
        status: 'Accepted',
        language: 'python3',
        code: 'x',
        problemId: 217,
        tags: ['Array', 5],
      }),
    ).toMatchObject({ submissionId: '1', problemId: '217', tags: ['Array'] });
  });

  it('rejects payloads without an id or status', () => {
    expect(coerceRawSubmission(null)).toBeNull();
    expect(coerceRawSubmission({ status: 'Accepted' })).toBeNull();
    expect(coerceRawSubmission({ submissionId: '1' })).toBeNull();
    expect(coerceRawSubmission('nope')).toBeNull();
  });

  it('defaults optional fields safely', () => {
    const raw = coerceRawSubmission({ submissionId: '1', status: 'Accepted' });
    expect(raw).toEqual({
      submissionId: '1',
      status: 'Accepted',
      language: '',
      code: '',
      problemId: null,
      problemTitle: null,
      titleSlug: null,
      difficulty: null,
      tags: [],
      submittedAt: null,
      url: null,
    });
  });
});
