// Verifies the built extension directories. Runs after `npm run build`.
//
// This is the check that stands in for "did the package actually come out right":
// every path the manifest references must exist, the bundles must be classic
// scripts, and nothing dangerous may appear in the shipped code.
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BROWSERS = ['chrome', 'firefox'];

const failures = [];
const notes = [];

const fail = (message) => failures.push(message);
const note = (message) => notes.push(message);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Collects every path the manifest points at. */
function referencedPaths(manifest) {
  const paths = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value !== '') paths.add(value.replace(/^\//, ''));
  };

  const background = manifest.background ?? {};
  add(background.service_worker);
  for (const script of background.scripts ?? []) add(script);

  for (const entry of manifest.content_scripts ?? []) {
    for (const script of entry.js ?? []) add(script);
    for (const style of entry.css ?? []) add(style);
  }

  add(manifest.action?.default_popup);
  add(manifest.options_ui?.page);
  add(manifest.side_panel?.default_path);

  for (const size of Object.values(manifest.icons ?? {})) add(size);
  for (const size of Object.values(manifest.action?.default_icon ?? {})) add(size);

  return [...paths];
}

/** Extracts local href/src references from an HTML file. */
function htmlReferences(html) {
  const paths = [];
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const value = match[1];
    if (value === undefined) continue;
    if (/^(https?:|data:|#|mailto:)/.test(value)) continue;
    paths.push(value.replace(/^\//, ''));
  }
  return paths;
}

const DANGEROUS = [
  { pattern: /\beval\s*\(/, label: 'eval(' },
  { pattern: /new\s+Function\s*\(/, label: 'new Function(' },
  { pattern: /unpkg\.com|cdn\.jsdelivr|cdnjs\.cloudflare/, label: 'remote script CDN' },
  { pattern: /<all_urls>/, label: '<all_urls>' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/, label: 'hard-coded GitHub token' },
  { pattern: /\bclient_secret\b/, label: 'client_secret reference' },
  { pattern: /\/\/#\s*sourceMappingURL=data:/, label: 'inline source map in a release bundle' },
];

for (const browser of BROWSERS) {
  const outdir = join(ROOT, 'dist', browser);
  if (!existsSync(outdir)) {
    fail(`[${browser}] dist/${browser} does not exist — run the build first`);
    continue;
  }

  const manifestPath = join(outdir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    fail(`[${browser}] manifest.json is missing`);
    continue;
  }

  const manifest = await readJson(manifestPath);

  if (manifest.manifest_version !== 3) fail(`[${browser}] manifest_version must be 3`);
  if (manifest.permissions?.includes('<all_urls>')) fail(`[${browser}] <all_urls> in permissions`);
  if (manifest.host_permissions?.includes('<all_urls>')) {
    fail(`[${browser}] <all_urls> in host_permissions`);
  }

  const csp = manifest.content_security_policy?.extension_pages ?? '';
  if (csp.includes('unsafe-eval')) fail(`[${browser}] CSP allows unsafe-eval`);
  if (csp.includes('unsafe-inline')) fail(`[${browser}] CSP allows unsafe-inline`);

  if (browser === 'firefox') {
    if (typeof manifest.background?.scripts?.[0] !== 'string') {
      fail('[firefox] background.scripts is required');
    }
    if (manifest.background?.service_worker !== undefined) {
      fail('[firefox] must not declare background.service_worker');
    }
    if (typeof manifest.browser_specific_settings?.gecko?.id !== 'string') {
      fail('[firefox] browser_specific_settings.gecko.id is required');
    }
  } else {
    if (typeof manifest.background?.service_worker !== 'string') {
      fail('[chrome] background.service_worker is required');
    }
    if (manifest.background?.scripts !== undefined) {
      fail('[chrome] must not declare background.scripts');
    }
  }

  const referenced = referencedPaths(manifest);
  for (const path of referenced) {
    if (!existsSync(join(outdir, path)))
      fail(`[${browser}] manifest references missing file: ${path}`);
  }

  // Every HTML page's local references must resolve too.
  for (const path of referenced.filter((entry) => entry.endsWith('.html'))) {
    const html = await readFile(join(outdir, path), 'utf8');
    for (const ref of htmlReferences(html)) {
      if (!existsSync(join(outdir, ref))) {
        fail(`[${browser}] ${path} references missing file: ${ref}`);
      }
    }
    if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) {
      fail(`[${browser}] ${path} contains an inline script, which the CSP forbids`);
    }
  }

  // Shipped code must be safe and must be classic scripts.
  const entries = await readdir(outdir, { withFileTypes: true });
  let scriptCount = 0;
  let totalBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(outdir, entry.name);
    const info = await stat(path);
    totalBytes += info.size;

    if (/\.(js|html|css|json)$/.test(entry.name)) {
      const content = await readFile(path, 'utf8');
      for (const { pattern, label } of DANGEROUS) {
        if (pattern.test(content)) fail(`[${browser}] ${entry.name} contains ${label}`);
      }
      if (entry.name.endsWith('.js')) {
        scriptCount += 1;
        if (/^\s*(import|export)\s/m.test(content)) {
          fail(`[${browser}] ${entry.name} uses ES module syntax; bundles must be classic scripts`);
        }
      }
    }
  }

  if (scriptCount < 5) {
    fail(`[${browser}] expected at least 5 bundles, found ${scriptCount}`);
  }
  note(
    `[${browser}] ${referenced.length} manifest paths resolve, ${scriptCount} bundles, ${(totalBytes / 1024).toFixed(0)} KB`,
  );
}

for (const message of notes) console.log(message);

if (failures.length > 0) {
  console.error('\nBuild output verification failed:');
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log('\nBuild output verified: no missing files, no unsafe patterns, classic scripts only.');
