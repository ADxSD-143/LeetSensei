/**
 * Problem README rendering and merge.
 *
 * The README is a pre-filled template. Everything the user is expected to write
 * (approach, complexity, notes) lives inside marked regions and is preserved
 * across syncs, so no AI service and no re-typing is ever required.
 */

export const APPROACH_PLACEHOLDER =
  '_Describe your approach here. LeetSensei keeps this section on every sync._';
export const NOTES_PLACEHOLDER = '_Optional: pitfalls, edge cases, or anything worth remembering._';
export const UNKNOWN_VALUE = '_unknown_';

export type EditableSectionId = 'approach' | 'notes' | 'time' | 'space';

export interface EditableSections {
  approach?: string;
  notes?: string;
  time?: string;
  space?: string;
}

export interface ReadmeInput {
  problemId: string;
  title: string;
  url: string;
  difficulty: string;
  tags: string[];
  languages: { label: string; fileName: string }[];
  categories: string[];
  metadataIncomplete: boolean;
  syncedAt: string;
  warnings?: string[];
}

const marker = (id: EditableSectionId, closing = false): string =>
  `<!-- ${closing ? '/' : ''}leetsensei:${id} -->`;

function formatList(values: readonly string[], wrap: string): string {
  if (values.length === 0) return '—';
  return values.map((value) => `${wrap}${value}${wrap}`).join(', ');
}

/** `0217` (the folder prefix) is displayed as the real problem number `217`. */
export function displayProblemId(problemId: string): string | null {
  if (!/^\d+$/.test(problemId)) return null;
  return problemId.replace(/^0+(?=\d)/, '');
}

export function renderReadme(input: ReadmeInput): string {
  const numericId = displayProblemId(input.problemId);
  const heading = numericId === null ? input.title : `${numericId}. ${input.title}`;
  const solutions = input.languages.map((language) => `\`${language.fileName}\``);

  const lines: string[] = [
    `# ${heading}`,
    '',
    `[Open on LeetCode](${input.url})`,
    '',
    `- **Problem ID:** ${numericId ?? '_not available_'}`,
    `- **Difficulty:** ${input.difficulty}`,
    `- **Topics:** ${formatList(input.tags, '`')}`,
    `- **Solutions:** ${formatList(solutions, '')}`,
    `- **Categories:** ${formatList(input.categories, '`')}`,
    `- **Last synced:** ${input.syncedAt}`,
    '',
  ];

  if (input.metadataIncomplete) {
    lines.push(
      '> **Metadata warning.** LeetCode did not return every detail for this submission.',
      '> Verify the topics and difficulty above before relying on them.',
      '',
    );
  }
  for (const warning of input.warnings ?? []) {
    lines.push(`> ${warning}`, '');
  }

  lines.push(
    '## Approach',
    '',
    marker('approach'),
    APPROACH_PLACEHOLDER,
    marker('approach', true),
    '',
    '## Complexity',
    '',
    `- **Time:** ${marker('time')}${UNKNOWN_VALUE}${marker('time', true)}`,
    `- **Space:** ${marker('space')}${UNKNOWN_VALUE}${marker('space', true)}`,
    '',
    '## Notes',
    '',
    marker('notes'),
    NOTES_PLACEHOLDER,
    marker('notes', true),
    '',
    '---',
    '',
    '_Managed by [LeetSensei](https://github.com/ADxSD-143/LeetSensei). Only the marked regions are preserved on sync; everything else is regenerated._',
    '',
  );

  return lines.join('\n');
}

function extractRegion(source: string, id: EditableSectionId): string | undefined {
  const open = marker(id);
  const close = marker(id, true);
  const start = source.indexOf(open);
  if (start < 0) return undefined;
  const end = source.indexOf(close, start + open.length);
  if (end < 0) return undefined;
  return source.slice(start + open.length, end).trim();
}

function extractSection(source: string, heading: string): string | undefined {
  const lines = source.split('\n');
  const index = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
  if (index < 0) return undefined;
  const collected: string[] = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? '';
    if (/^#{1,6}\s/.test(line)) break;
    if (/^-{3,}\s*$/.test(line)) break;
    collected.push(line);
  }
  const text = collected.join('\n').trim();
  return text === '' ? undefined : text;
}

function extractInlineField(source: string, field: string): string | undefined {
  const match = new RegExp(`^-\\s*\\*\\*${field}:\\*\\*\\s*(.+)$`, 'im').exec(source);
  const value = match?.[1]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function isPlaceholder(value: string | undefined, placeholders: readonly string[]): boolean {
  if (value === undefined) return true;
  const trimmed = value.trim();
  if (trimmed === '') return true;
  return placeholders.some((placeholder) => trimmed === placeholder);
}

export function extractEditableSections(source: string): EditableSections {
  const sections: EditableSections = {};
  const approach = extractRegion(source, 'approach') ?? extractSection(source, '## Approach');
  const notes = extractRegion(source, 'notes') ?? extractSection(source, '## Notes');
  const time = extractRegion(source, 'time') ?? extractInlineField(source, 'Time');
  const space = extractRegion(source, 'space') ?? extractInlineField(source, 'Space');
  if (!isPlaceholder(approach, [APPROACH_PLACEHOLDER])) sections.approach = approach?.trim();
  if (!isPlaceholder(notes, [NOTES_PLACEHOLDER])) sections.notes = notes?.trim();
  if (!isPlaceholder(time, [UNKNOWN_VALUE])) sections.time = time?.trim();
  if (!isPlaceholder(space, [UNKNOWN_VALUE])) sections.space = space?.trim();
  return sections;
}

function replaceRegion(
  source: string,
  id: EditableSectionId,
  value: string,
  options: { inline: boolean },
): string {
  const open = marker(id);
  const close = marker(id, true);
  const start = source.indexOf(open);
  if (start < 0) return source;
  const end = source.indexOf(close, start + open.length);
  if (end < 0) return source;
  const replacement = options.inline ? value : `\n${value}\n`;
  return source.slice(0, start + open.length) + replacement + source.slice(end);
}

/**
 * Overlays the user's editable sections from `existing` onto a freshly
 * generated README. Returns `fresh` unchanged when there is nothing to keep.
 */
export function mergeReadme(existing: string | null, fresh: string): string {
  if (existing === null || existing.trim() === '') return fresh;
  const sections = extractEditableSections(existing);
  let merged = fresh;
  if (sections.approach !== undefined) {
    merged = replaceRegion(merged, 'approach', sections.approach, { inline: false });
  }
  if (sections.time !== undefined) {
    merged = replaceRegion(merged, 'time', sections.time, { inline: true });
  }
  if (sections.space !== undefined) {
    merged = replaceRegion(merged, 'space', sections.space, { inline: true });
  }
  if (sections.notes !== undefined) {
    merged = replaceRegion(merged, 'notes', sections.notes, { inline: false });
  }
  return merged;
}

const collapse = (value: string | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Verifies that merging did not drop any non-empty user section. Used to decide
 * whether a README that changed remotely can be updated automatically instead
 * of being raised as a conflict.
 */
export function readmeMergeIsLossless(existing: string, merged: string): boolean {
  const before = extractEditableSections(existing);
  const after = extractEditableSections(merged);
  const ids: EditableSectionId[] = ['approach', 'notes', 'time', 'space'];
  for (const id of ids) {
    const original = collapse(before[id]);
    if (original === '') continue;
    if (collapse(after[id]) !== original) return false;
  }
  return true;
}
