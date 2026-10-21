/**
 * Tiny DOM helpers.
 *
 * Every text value goes through `textContent`; nothing in LeetSensei ever
 * builds HTML from page or API data, so untrusted problem titles can never be
 * interpreted as markup.
 */

export type Tone = 'neutral' | 'ok' | 'warn' | 'err' | 'info';

export interface ElOptions {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  children?: (Node | null | undefined)[];
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [key, value] of Object.entries(options.attrs ?? {})) {
    node.setAttribute(key, value);
  }
  for (const child of options.children ?? []) {
    if (child) node.append(child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function qs<T extends Element>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`Missing element: ${selector}`);
  return found;
}

export function badge(text: string, tone: Tone = 'neutral'): HTMLSpanElement {
  const className = tone === 'neutral' ? 'ls-badge' : `ls-badge ls-badge--${tone}`;
  return el('span', { className, text });
}

export function button(
  label: string,
  onClick: () => void,
  options: { variant?: 'primary' | 'danger'; small?: boolean; title?: string } = {},
): HTMLButtonElement {
  const classes = ['ls-btn'];
  if (options.variant === 'primary') classes.push('ls-btn--primary');
  if (options.variant === 'danger') classes.push('ls-btn--danger');
  if (options.small === true) classes.push('ls-btn--small');
  const node = el('button', {
    className: classes.join(' '),
    text: label,
    attrs: { type: 'button', ...(options.title ? { title: options.title } : {}) },
  });
  node.addEventListener('click', onClick);
  return node;
}

export function note(message: string, tone: 'info' | 'warn' | 'err' = 'info'): HTMLDivElement {
  const className = tone === 'info' ? 'ls-note' : `ls-note ls-note--${tone}`;
  return el('div', { className, text: message, attrs: { role: 'status' } });
}

export function emptyState(message: string): HTMLDivElement {
  return el('div', { className: 'ls-empty', text: message });
}

export function loading(message = 'Loading...'): HTMLDivElement {
  return el('div', { className: 'ls-loading', text: message });
}

export function formatDateTime(iso: string | null): string {
  if (iso === null || iso === '') return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null): string {
  if (iso === null || iso === '') return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function toDateInputValue(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function humanBytes(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`;
}

export function externalLink(href: string, label: string): HTMLAnchorElement {
  const anchor = el('a', {
    text: label,
    attrs: { href, target: '_blank', rel: 'noopener noreferrer' },
  });
  return anchor;
}

/** Applies the stored theme preference to the document root. */
export function applyTheme(preference: 'auto' | 'light' | 'dark'): void {
  const root = document.documentElement;
  if (preference === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}
