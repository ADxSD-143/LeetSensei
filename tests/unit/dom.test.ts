import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  badge,
  button,
  clear,
  el,
  emptyState,
  externalLink,
  formatDate,
  formatDateTime,
  humanBytes,
  loading,
  note,
  qs,
  toDateInputValue,
} from '../../src/ui/dom';

class FakeElement {
  tagName: string;
  className = '';
  textContent: string | null = '';
  attrs: Record<string, string> = {};
  children: FakeElement[] = [];
  listeners: Record<string, ((e?: unknown) => void)[]> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
  }
  append(...nodes: (FakeElement | null | undefined)[]) {
    for (const node of nodes) {
      if (node) this.children.push(node);
    }
  }
  removeChild(child: FakeElement) {
    const i = this.children.indexOf(child);
    if (i !== -1) this.children.splice(i, 1);
  }
  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  addEventListener(type: string, listener: (e?: unknown) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  dispatchEvent(type: string) {
    for (const listener of this.listeners[type] ?? []) {
      listener();
    }
  }
  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      if (this.attrs['id'] === id) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }
}

describe('pure formatting helpers in dom.ts', () => {
  it('formatDateTime handles null, empty, invalid and valid dates', () => {
    expect(formatDateTime(null)).toBe('never');
    expect(formatDateTime('')).toBe('never');
    expect(formatDateTime('not-a-date')).toBe('unknown');

    const formatted = formatDateTime('2026-01-15T12:30:00.000Z');
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).not.toBe('never');
    expect(formatted).not.toBe('unknown');
  });

  it('formatDate handles null, empty, invalid and valid dates', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDate('garbage')).toBe('—');

    const formatted = formatDate('2026-01-15T12:30:00.000Z');
    expect(typeof formatted).toBe('string');
    expect(formatted).not.toBe('—');
  });

  it('toDateInputValue formats ISO string to YYYY-MM-DD', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue('invalid')).toBe('');

    const value = toDateInputValue('2026-05-09T00:00:00');
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('humanBytes formats file counts correctly', () => {
    expect(humanBytes(0)).toBe('0 files');
    expect(humanBytes(1)).toBe('1 file');
    expect(humanBytes(2)).toBe('2 files');
    expect(humanBytes(10)).toBe('10 files');
  });
});

describe('DOM creation and mutation helpers in dom.ts', () => {
  let originalDocument: unknown;
  let rootElement: FakeElement;

  beforeEach(() => {
    originalDocument = (globalThis as Record<string, unknown>).document;
    rootElement = new FakeElement('HTML');
    const fakeDoc = {
      documentElement: rootElement,
      createElement(tag: string) {
        return new FakeElement(tag);
      },
      querySelector(selector: string) {
        return rootElement.querySelector(selector);
      },
    };
    (globalThis as Record<string, unknown>).document = fakeDoc;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).document = originalDocument;
  });

  it('el constructs an element with class, text, attributes and children', () => {
    const child = el('span', { text: 'child' });
    const parent = el('div', {
      className: 'my-class',
      text: 'parent text',
      attrs: { 'data-test': 'value', id: 'main' },
      children: [child as unknown as Node, null, undefined],
    });

    const fake = parent as unknown as FakeElement;
    expect(fake.className).toBe('my-class');
    expect(fake.textContent).toBe('parent text');
    expect(fake.getAttribute('data-test')).toBe('value');
    expect(fake.getAttribute('id')).toBe('main');
    expect(fake.children.length).toBe(1);
    expect((fake.children[0] as FakeElement).textContent).toBe('child');
  });

  it('clear removes all child elements', () => {
    const parent = el('div', {
      children: [
        el('span', { text: '1' }) as unknown as Node,
        el('span', { text: '2' }) as unknown as Node,
      ],
    }) as unknown as FakeElement;

    expect(parent.children.length).toBe(2);
    clear(parent as unknown as Element);
    expect(parent.children.length).toBe(0);
  });

  it('qs finds elements and throws on missing elements', () => {
    const target = el('div', { attrs: { id: 'target' } }) as unknown as FakeElement;
    rootElement.append(target);

    const found = qs('#target');
    expect(found).toBe(target);

    expect(() => qs('#missing')).toThrowError(/Missing element: #missing/);
  });

  it('badge creates badges with neutral and toned classes', () => {
    const bNeutral = badge('Neutral') as unknown as FakeElement;
    expect(bNeutral.className).toBe('ls-badge');
    expect(bNeutral.textContent).toBe('Neutral');

    const bWarn = badge('Warning', 'warn') as unknown as FakeElement;
    expect(bWarn.className).toBe('ls-badge ls-badge--warn');
    expect(bWarn.textContent).toBe('Warning');
  });

  it('button creates button with variants and click handler', () => {
    const handler = vi.fn();
    const btn = button('Click Me', handler, {
      variant: 'primary',
      small: true,
      title: 'Help text',
    }) as unknown as FakeElement;

    expect(btn.className).toContain('ls-btn');
    expect(btn.className).toContain('ls-btn--primary');
    expect(btn.className).toContain('ls-btn--small');
    expect(btn.textContent).toBe('Click Me');
    expect(btn.getAttribute('title')).toBe('Help text');
    expect(btn.getAttribute('type')).toBe('button');

    btn.dispatchEvent('click');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('note creates status note element', () => {
    const n = note('Important message', 'err') as unknown as FakeElement;
    expect(n.className).toBe('ls-note ls-note--err');
    expect(n.textContent).toBe('Important message');
    expect(n.getAttribute('role')).toBe('status');
  });

  it('emptyState creates empty state placeholder', () => {
    const empty = emptyState('No items found') as unknown as FakeElement;
    expect(empty.className).toBe('ls-empty');
    expect(empty.textContent).toBe('No items found');
  });

  it('loading creates loading placeholder', () => {
    const l1 = loading() as unknown as FakeElement;
    expect(l1.className).toBe('ls-loading');
    expect(l1.textContent).toBe('Loading...');

    const l2 = loading('Custom loading...') as unknown as FakeElement;
    expect(l2.textContent).toBe('Custom loading...');
  });

  it('externalLink creates safe anchor tag', () => {
    const link = externalLink('https://github.com', 'GitHub') as unknown as FakeElement;
    expect(link.getAttribute('href')).toBe('https://github.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('GitHub');
  });

  it('applyTheme updates document root data-theme attribute', () => {
    applyTheme('dark');
    expect(rootElement.getAttribute('data-theme')).toBe('dark');

    applyTheme('light');
    expect(rootElement.getAttribute('data-theme')).toBe('light');

    applyTheme('auto');
    expect(rootElement.getAttribute('data-theme')).toBeNull();
  });
});
