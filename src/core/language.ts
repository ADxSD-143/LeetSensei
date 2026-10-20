import type { LanguageInfo } from './model';

/**
 * LeetCode language id -> file extension.
 *
 * The list is deliberately explicit: an unknown language is reported as
 * unsupported rather than guessed, because writing code to a wrong extension
 * would corrupt the user's repository.
 */
const LANGUAGE_TABLE: Record<string, { label: string; extension: string; id?: string }> = {
  assembly: { label: 'Assembly', extension: 'asm' },
  bash: { label: 'Bash', extension: 'sh' },
  c: { label: 'C', extension: 'c' },
  'c#': { label: 'C#', extension: 'cs', id: 'csharp' },
  'c++': { label: 'C++', extension: 'cpp', id: 'cpp' },
  clojure: { label: 'Clojure', extension: 'clj' },
  cobol: { label: 'COBOL', extension: 'cob' },
  cpp: { label: 'C++', extension: 'cpp' },
  csharp: { label: 'C#', extension: 'cs' },
  dart: { label: 'Dart', extension: 'dart' },
  d: { label: 'D', extension: 'd' },
  elixir: { label: 'Elixir', extension: 'ex' },
  erlang: { label: 'Erlang', extension: 'erl' },
  'f#': { label: 'F#', extension: 'fs', id: 'fsharp' },
  fsharp: { label: 'F#', extension: 'fs' },
  go: { label: 'Go', extension: 'go' },
  golang: { label: 'Go', extension: 'go' },
  groovy: { label: 'Groovy', extension: 'groovy' },
  haskell: { label: 'Haskell', extension: 'hs' },
  java: { label: 'Java', extension: 'java' },
  javascript: { label: 'JavaScript', extension: 'js' },
  julia: { label: 'Julia', extension: 'jl' },
  kotlin: { label: 'Kotlin', extension: 'kt' },
  lua: { label: 'Lua', extension: 'lua' },
  mssql: { label: 'MS SQL Server', extension: 'sql' },
  mysql: { label: 'MySQL', extension: 'sql' },
  objectivec: { label: 'Objective-C', extension: 'm' },
  oraclesql: { label: 'Oracle SQL', extension: 'sql' },
  pandas: { label: 'Pandas', extension: 'py' },
  perl: { label: 'Perl', extension: 'pl' },
  php: { label: 'PHP', extension: 'php' },
  postgresql: { label: 'PostgreSQL', extension: 'sql' },
  purescript: { label: 'PureScript', extension: 'purs' },
  python: { label: 'Python', extension: 'py' },
  python3: { label: 'Python 3', extension: 'py' },
  pythondata: { label: 'Python (pandas)', extension: 'py' },
  racket: { label: 'Racket', extension: 'rkt' },
  r: { label: 'R', extension: 'r' },
  ruby: { label: 'Ruby', extension: 'rb' },
  rust: { label: 'Rust', extension: 'rs' },
  scala: { label: 'Scala', extension: 'scala' },
  swift: { label: 'Swift', extension: 'swift' },
  typescript: { label: 'TypeScript', extension: 'ts' },
};

/** Trims, lowercases and removes separators so `Python 3` and `python3` match. */
export function normalizeLanguageId(raw: string): string {
  return raw
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
}

export function resolveLanguage(raw: string): LanguageInfo | null {
  const id = normalizeLanguageId(raw);
  const entry = LANGUAGE_TABLE[id];
  if (!entry) return null;
  return { id: entry.id ?? id, label: entry.label, extension: entry.extension };
}

export function supportedLanguageIds(): string[] {
  const ids = new Set<string>();
  for (const [key, entry] of Object.entries(LANGUAGE_TABLE)) {
    ids.add(entry.id ?? key);
  }
  return [...ids].sort();
}

export function solutionFileName(extension: string): string {
  return `solution.${extension}`;
}
