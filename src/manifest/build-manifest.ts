/**
 * Cross-browser WebExtension manifest builder.
 *
 * Kept self-contained (no imports) so it can be imported directly by both the
 * Node build script and the Vitest unit tests.
 */

export type TargetBrowser = 'chrome' | 'firefox';

export interface ManifestOptions {
  browser: TargetBrowser;
  version: string;
  name?: string;
  description?: string;
  homepage?: string;
  firefoxId?: string;
}

export const DEFAULT_NAME = 'LeetSensei';
export const DEFAULT_DESCRIPTION =
  'Sync Accepted LeetCode solutions to GitHub, organized by official topic tags, with revision tracking.';
export const DEFAULT_HOMEPAGE = 'https://github.com/ADxSD-143/LeetSensei';
export const DEFAULT_FIREFOX_ID = 'leetsensei@adxsd-143.github.io';

/** Hosts the extension itself never talks to; kept together for review. */
export const LEETCODE_MATCHES = ['https://leetcode.com/problems/*'];
export const HOST_PERMISSIONS = [
  'https://leetcode.com/*',
  'https://api.github.com/*',
  'https://github.com/*',
];

export const CONTENT_SECURITY_POLICY = "script-src 'self'; object-src 'none'; base-uri 'none'";

export function buildManifest(options: ManifestOptions): Record<string, unknown> {
  const {
    browser,
    version,
    name = DEFAULT_NAME,
    description = DEFAULT_DESCRIPTION,
    homepage = DEFAULT_HOMEPAGE,
    firefoxId = DEFAULT_FIREFOX_ID,
  } = options;

  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name,
    version,
    description,
    homepage_url: homepage,
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_popup: 'popup.html',
      default_title: name,
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      },
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    content_scripts: [
      {
        matches: LEETCODE_MATCHES,
        js: ['content.js'],
        run_at: 'document_idle',
      },
    ],
    permissions: ['storage', 'alarms'],
    host_permissions: HOST_PERMISSIONS,
    content_security_policy: {
      extension_pages: CONTENT_SECURITY_POLICY,
    },
  };

  if (browser === 'firefox') {
    manifest.background = { scripts: ['background.js'] };
    manifest.browser_specific_settings = {
      gecko: {
        id: firefoxId,
        strict_min_version: '115.0',
      },
    };
  } else {
    manifest.background = { service_worker: 'background.js' };
    manifest.minimum_chrome_version = '111';
  }

  return manifest;
}

/**
 * Structural self-check used by the build script and unit tests. Returns a list
 * of human-readable problems; an empty array means the manifest is acceptable.
 */
export function validateManifestShape(manifest: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const require = (condition: unknown, message: string): void => {
    if (!condition) problems.push(message);
  };

  require(manifest.manifest_version === 3, 'manifest_version must be 3');
  require(typeof manifest.name === 'string' && manifest.name !== '', 'name is required');
  require(typeof manifest.version === 'string' &&
    /^\d+(\.\d+){1,3}$/.test(manifest.version), 'version must look like 1.2.3');
  require(Array.isArray(manifest.permissions), 'permissions must be an array');
  require(Array.isArray(manifest.host_permissions), 'host_permissions must be an array');
  require(Array.isArray(manifest.content_scripts), 'content_scripts must be an array');

  const csp = manifest.content_security_policy as { extension_pages?: unknown } | undefined;
  require(typeof csp === 'object' &&
    csp !== null &&
    typeof csp.extension_pages === 'string', 'content_security_policy.extension_pages is required');
  require(typeof csp?.extension_pages === 'string' &&
    !csp.extension_pages.includes('unsafe-eval'), 'CSP must not allow unsafe-eval');

  const background = manifest.background as Record<string, unknown> | undefined;
  require(typeof background === 'object' && background !== null, 'background is required');
  if (background) {
    const hasWorker = typeof background.service_worker === 'string';
    const hasScripts = Array.isArray(background.scripts) && background.scripts.length > 0;
    require(hasWorker !==
      hasScripts, 'background must declare exactly one of service_worker or scripts');
  }

  const permissions = manifest.permissions as unknown[] | undefined;
  require(Array.isArray(permissions) &&
    !permissions.includes('<all_urls>'), 'permissions must not include <all_urls>');

  const hosts = manifest.host_permissions as unknown[] | undefined;
  if (Array.isArray(hosts)) {
    for (const host of hosts) {
      require(host !== '<all_urls>', 'host_permissions must not include <all_urls>');
      require(typeof host === 'string' &&
        !host.includes('*://*/'), `host permission "${String(host)}" is too broad`);
    }
  }

  return problems;
}
