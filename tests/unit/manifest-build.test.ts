import { describe, expect, it } from 'vitest';
import { buildManifest, validateManifestShape } from '../../src/manifest/build-manifest';

describe('buildManifest', () => {
  it('produces a valid Chrome MV3 manifest', () => {
    const manifest = buildManifest({ browser: 'chrome', version: '0.1.0' });
    expect(validateManifestShape(manifest)).toEqual([]);
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({ service_worker: 'background.js' });
    expect(manifest.minimum_chrome_version).toBe('111');
    expect(manifest.browser_specific_settings).toBeUndefined();
  });

  it('produces a valid Firefox MV3 manifest', () => {
    const manifest = buildManifest({ browser: 'firefox', version: '0.1.0' });
    expect(validateManifestShape(manifest)).toEqual([]);
    expect(manifest.background).toEqual({ scripts: ['background.js'] });
    expect(manifest.minimum_chrome_version).toBeUndefined();
    expect(
      (manifest.browser_specific_settings as { gecko: { id: string; strict_min_version: string } })
        .gecko.strict_min_version,
    ).toBe('115.0');
  });

  it('only requests the hosts it needs', () => {
    for (const browser of ['chrome', 'firefox'] as const) {
      const hosts = buildManifest({ browser, version: '1.0.0' }).host_permissions as string[];
      expect(hosts).toEqual([
        'https://leetcode.com/*',
        'https://api.github.com/*',
        'https://github.com/*',
      ]);
      expect(hosts.some((host) => host.includes('*://*/'))).toBe(false);
      expect(hosts).not.toContain('<all_urls>');
    }
  });

  it('declares a restrictive content security policy', () => {
    for (const browser of ['chrome', 'firefox'] as const) {
      const csp = buildManifest({ browser, version: '1.0.0' }).content_security_policy as {
        extension_pages: string;
      };
      expect(csp.extension_pages).toContain("script-src 'self'");
      expect(csp.extension_pages).not.toContain('unsafe-eval');
      expect(csp.extension_pages).not.toContain('unsafe-inline');
    }
  });

  it('scopes the content script to the problem pages only', () => {
    const manifest = buildManifest({ browser: 'chrome', version: '1.0.0' });
    const scripts = manifest.content_scripts as { matches: string[]; js: string[] }[];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.matches).toEqual(['https://leetcode.com/problems/*']);
    expect(scripts[0]?.js).toEqual(['content.js']);
  });

  it('declares the three required surfaces', () => {
    const manifest = buildManifest({ browser: 'chrome', version: '1.0.0' });
    expect((manifest.action as { default_popup: string }).default_popup).toBe('popup.html');
    expect((manifest.options_ui as { page: string }).page).toBe('options.html');
    expect(manifest.icons).toBeDefined();
  });
});

describe('validateManifestShape', () => {
  it('rejects a manifest with a background that declares both forms', () => {
    const manifest = buildManifest({ browser: 'chrome', version: '1.0.0' });
    manifest.background = { service_worker: 'background.js', scripts: ['background.js'] };
    expect(validateManifestShape(manifest).join(' ')).toMatch(/exactly one of/);
  });

  it('rejects a broad host permission and a weak CSP', () => {
    const manifest = buildManifest({ browser: 'chrome', version: '1.0.0' });
    manifest.host_permissions = ['<all_urls>'];
    manifest.content_security_policy = { extension_pages: "script-src 'self' 'unsafe-eval'" };
    const problems = validateManifestShape(manifest).join(' ');
    expect(problems).toMatch(/must not include <all_urls>/);
    expect(problems).toMatch(/unsafe-eval/);
  });

  it('rejects a malformed version', () => {
    expect(
      validateManifestShape({
        ...buildManifest({ browser: 'chrome', version: '0.1' }),
        version: 'v1',
      }).join(' '),
    ).toMatch(/version must look like/);
  });
});
