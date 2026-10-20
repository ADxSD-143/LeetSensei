import { describe, expect, it } from 'vitest';
import {
  APPROACH_PLACEHOLDER,
  NOTES_PLACEHOLDER,
  UNKNOWN_VALUE,
  extractEditableSections,
  displayProblemId,
  mergeReadme,
  readmeMergeIsLossless,
  renderReadme,
} from '../../src/core/readme';
import { NOW } from '../helpers';

function baseReadme(): string {
  return renderReadme({
    problemId: '0217',
    title: 'Contains Duplicate',
    url: 'https://leetcode.com/problems/contains-duplicate/',
    difficulty: 'Easy',
    tags: ['Array', 'Hash Table'],
    languages: [
      { label: 'Python 3', fileName: 'solution.py' },
      { label: 'C++', fileName: 'solution.cpp' },
    ],
    categories: ['Array', 'Hash-Table'],
    metadataIncomplete: false,
    syncedAt: NOW,
  });
}

const setApproach = (markdown: string, text: string): string =>
  markdown.replace(
    `<!-- leetsensei:approach -->\n${APPROACH_PLACEHOLDER}\n<!-- /leetsensei:approach -->`,
    `<!-- leetsensei:approach -->\n${text}\n<!-- /leetsensei:approach -->`,
  );

const setNotes = (markdown: string, text: string): string =>
  markdown.replace(
    `<!-- leetsensei:notes -->\n${NOTES_PLACEHOLDER}\n<!-- /leetsensei:notes -->`,
    `<!-- leetsensei:notes -->\n${text}\n<!-- /leetsensei:notes -->`,
  );

describe('renderReadme', () => {
  it('contains the required problem information', () => {
    const markdown = baseReadme();
    expect(markdown).toContain('# 217. Contains Duplicate');
    expect(markdown).toContain(
      '[Open on LeetCode](https://leetcode.com/problems/contains-duplicate/)',
    );
    expect(markdown).toContain('- **Problem ID:** 217');
    expect(markdown).toContain('- **Difficulty:** Easy');
    expect(markdown).toContain('- **Topics:** `Array`, `Hash Table`');
    expect(markdown).toContain('- **Solutions:** `solution.py`, `solution.cpp`');
    expect(markdown).toContain('## Approach');
    expect(markdown).toContain('- **Time:**');
    expect(markdown).toContain('- **Space:**');
    expect(markdown).toContain('## Notes');
  });

  it('omits the numeric prefix when the id is unknown', () => {
    const markdown = renderReadme({
      problemId: 'contains-duplicate',
      title: 'Contains Duplicate',
      url: 'https://leetcode.com/problems/contains-duplicate/',
      difficulty: 'Unknown',
      tags: [],
      languages: [{ label: 'Python 3', fileName: 'solution.py' }],
      categories: ['Uncategorized'],
      metadataIncomplete: true,
      syncedAt: NOW,
    });
    expect(markdown).toContain('# Contains Duplicate');
    expect(markdown).toContain('- **Problem ID:** _not available_');
    expect(markdown).toContain('Metadata warning');
  });

  it('renders the placeholder when there are no tags', () => {
    const markdown = renderReadme({
      problemId: '1',
      title: 'One',
      url: 'u',
      difficulty: 'Easy',
      tags: [],
      languages: [],
      categories: [],
      metadataIncomplete: false,
      syncedAt: NOW,
    });
    expect(markdown).toContain('- **Topics:** —');
  });

  it('is deterministic', () => {
    expect(baseReadme()).toBe(baseReadme());
  });

  it('displays the real problem number without the folder padding', () => {
    expect(displayProblemId('0217')).toBe('217');
    expect(displayProblemId('1')).toBe('1');
    expect(displayProblemId('10000')).toBe('10000');
    expect(displayProblemId('contains-duplicate')).toBeNull();
    expect(displayProblemId('0000')).toBe('0');
  });
});

describe('extractEditableSections', () => {
  it('returns nothing for a freshly generated README', () => {
    expect(extractEditableSections(baseReadme())).toEqual({});
  });

  it('ignores placeholders and inline unknown values', () => {
    expect(extractEditableSections(baseReadme()).time).toBeUndefined();
    expect(extractEditableSections(baseReadme()).space).toBeUndefined();
  });

  it('reads user content out of the marked regions', () => {
    let markdown = setApproach(baseReadme(), 'Use a hash set.');
    markdown = setNotes(markdown, 'Watch out for negatives.');
    markdown = markdown.replace(
      `<!-- leetsensei:time -->${UNKNOWN_VALUE}<!-- /leetsensei:time -->`,
      '<!-- leetsensei:time -->O(n)<!-- /leetsensei:time -->',
    );
    const sections = extractEditableSections(markdown);
    expect(sections).toEqual({
      approach: 'Use a hash set.',
      notes: 'Watch out for negatives.',
      time: 'O(n)',
    });
  });

  it('falls back to plain markdown headings when the markers are gone', () => {
    const markdown = [
      '# 217',
      '',
      '## Approach',
      '',
      'Two passes.',
      '',
      '## Notes',
      'Careful.',
      '',
    ].join('\n');
    const sections = extractEditableSections(markdown);
    expect(sections.approach).toBe('Two passes.');
    expect(sections.notes).toBe('Careful.');
  });

  it('falls back to the inline complexity fields', () => {
    const sections = extractEditableSections('- **Time:** O(n log n)\n- **Space:** O(1)\n');
    expect(sections.time).toBe('O(n log n)');
    expect(sections.space).toBe('O(1)');
  });
});

describe('mergeReadme', () => {
  it('returns the fresh template when there is nothing to keep', () => {
    const fresh = baseReadme();
    expect(mergeReadme(null, fresh)).toBe(fresh);
    expect(mergeReadme('   ', fresh)).toBe(fresh);
  });

  it('preserves approach, complexity and notes', () => {
    const fresh = baseReadme();
    let existing = setApproach(fresh, 'Sort first.');
    existing = setNotes(existing, 'Remember duplicates.');
    existing = existing.replace(
      `<!-- leetsensei:space -->${UNKNOWN_VALUE}<!-- /leetsensei:space -->`,
      '<!-- leetsensei:space -->O(1)<!-- /leetsensei:space -->',
    );

    const merged = mergeReadme(existing, fresh);
    expect(merged).toContain('Sort first.');
    expect(merged).toContain('Remember duplicates.');
    expect(merged).toContain('<!-- leetsensei:space -->O(1)<!-- /leetsensei:space -->');
    expect(merged).not.toContain(APPROACH_PLACEHOLDER);
  });

  it('refreshes the generated header while keeping user text', () => {
    const fresh = baseReadme();
    const existing = setApproach(fresh, 'Keep me.').replace(
      '- **Difficulty:** Easy',
      '- **Difficulty:** Hard',
    );
    const merged = mergeReadme(existing, fresh);
    expect(merged).toContain('- **Difficulty:** Easy');
    expect(merged).toContain('Keep me.');
  });

  it('picks up user sections written without markers', () => {
    const existing = ['## Approach', '', 'Hash set.', ''].join('\n');
    const merged = mergeReadme(existing, baseReadme());
    expect(merged).toContain('Hash set.');
  });

  it('is idempotent', () => {
    const fresh = baseReadme();
    const existing = setApproach(fresh, 'Once.');
    const once = mergeReadme(existing, fresh);
    expect(mergeReadme(once, fresh)).toBe(once);
  });
});

describe('readmeMergeIsLossless', () => {
  it('reports a lossless merge when user sections survive', () => {
    const fresh = baseReadme();
    const existing = setApproach(fresh, 'Preserved.');
    expect(readmeMergeIsLossless(existing, mergeReadme(existing, fresh))).toBe(true);
  });

  it('reports a loss when a user section disappears', () => {
    const existing = setApproach(baseReadme(), 'Preserved.');
    const merged = baseReadme();
    expect(readmeMergeIsLossless(existing, merged)).toBe(false);
  });

  it('is lossless when there was nothing to lose', () => {
    expect(readmeMergeIsLossless(baseReadme(), baseReadme())).toBe(true);
  });

  it('compares ignoring whitespace noise', () => {
    const existing = setApproach(baseReadme(), 'line one\n\nline   two');
    const merged = setApproach(baseReadme(), 'line one\nline two');
    expect(readmeMergeIsLossless(existing, merged)).toBe(true);
  });
});
