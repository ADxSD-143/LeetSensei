// Builds the extension for Chrome and Firefox.
//
// Usage:
//   node scripts/build.mjs                  # both browsers, production
//   node scripts/build.mjs --browser=chrome # one browser
//   node scripts/build.mjs --watch          # rebuild on change (chrome)
//   node scripts/build.mjs --no-minify      # readable output, for store source review
//   node scripts/build.mjs --zip            # also produce release archives
//   node scripts/build.mjs --release --browser=chrome --zip
//                                           # store build: requires a client id and
//                                           # disables the personal-access-token path
import { build, context } from 'esbuild';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, validateManifestShape } from '../src/manifest/build-manifest.ts';
import { createZip } from './zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const args = process.argv.slice(2);
const flag = (name) => args.some((arg) => arg === `--${name}`);
const option = (name, fallback) => {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
};

const watch = flag('watch');
const zip = flag('zip');
const release = flag('release');
const requested = option('browser', '');
const browsers = requested ? [requested] : ['chrome', 'firefox'];
for (const browser of browsers) {
  if (browser !== 'chrome' && browser !== 'firefox') {
    console.error(`Unknown browser "${browser}". Expected "chrome" or "firefox".`);
    process.exit(2);
  }
}

if (release && (browsers.length !== 1 || browsers[0] !== 'chrome')) {
  console.error('--release produces the Chrome Web Store package. Pass --browser=chrome.');
  process.exit(2);
}

/**
 * Release builds must ship a public OAuth client id, otherwise every user gets
 * an extension that cannot connect. Development builds may omit it and fall
 * back to the personal-access-token path instead.
 */
function resolveClientId(raw, isRelease) {
  const trimmed = (raw ?? '').trim();
  if (!isRelease) return trimmed;

  if (trimmed === '') {
    console.error(
      [
        'Release build aborted: LEETSENSEI_GITHUB_CLIENT_ID is not set.',
        '',
        'Register a GitHub OAuth App with "Device flow" enabled, then set its public',
        'client id and rebuild. See docs/RELEASE.md.',
      ].join('\n'),
    );
    process.exit(2);
  }
  if (!/^[A-Za-z0-9._-]{10,64}$/.test(trimmed)) {
    console.error(
      `Release build aborted: LEETSENSEI_GITHUB_CLIENT_ID "${trimmed}" does not look like a GitHub client id.`,
    );
    process.exit(2);
  }
  return trimmed;
}

const pkg = await readFileJson(join(ROOT, 'package.json'));
const githubClientId = resolveClientId(process.env.LEETSENSEI_GITHUB_CLIENT_ID, release);

/** Extension entry points, bundled as classic scripts (no ES module output). */
const ENTRIES = {
  background: 'src/background/index.ts',
  content: 'src/content/index.ts',
  popup: 'src/popup/main.ts',
  dashboard: 'src/dashboard/main.ts',
  options: 'src/options/main.ts',
};

/** Static assets copied verbatim next to the bundles. */
const STATIC_FILES = [
  'src/popup/popup.html',
  'src/popup/popup.css',
  'src/dashboard/dashboard.html',
  'src/dashboard/dashboard.css',
  'src/options/options.html',
  'src/options/options.css',
  'src/ui/theme.css',
];

async function readFileJson(path) {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(path, 'utf8'));
}

function esbuildOptions(browser, outdir, minify) {
  return {
    entryPoints: Object.fromEntries(
      Object.entries(ENTRIES).map(([name, path]) => [name, join(ROOT, path)]),
    ),
    outdir,
    bundle: true,
    format: 'iife',
    target: browser === 'firefox' ? ['firefox115'] : ['chrome111'],
    platform: 'browser',
    sourcemap: minify ? false : 'inline',
    minify,
    legalComments: 'none',
    logLevel: 'warning',
    define: {
      __LEETSENSEI_VERSION__: JSON.stringify(pkg.version),
      __LEETSENSEI_GITHUB_CLIENT_ID__: JSON.stringify(githubClientId),
      __LEETSENSEI_BROWSER__: JSON.stringify(browser),
      // Store builds only ever offer the device flow.
      __LEETSENSEI_ALLOW_PAT__: JSON.stringify(!release),
    },
  };
}

async function copyStatic(outdir) {
  const copied = [];
  for (const file of STATIC_FILES) {
    const source = join(ROOT, file);
    if (!existsSync(source)) {
      throw new Error(`Missing build asset: ${file}`);
    }
    const target = join(outdir, file.split('/').pop());
    await cp(source, target);
    copied.push(relative(outdir, target).replaceAll('\\', '/'));
  }
  await cp(join(ROOT, 'icons'), join(outdir, 'icons'), { recursive: true });
  copied.push('icons/*.png');

  // Original vector artwork: logo family and the layered hero.
  const artDir = join(ROOT, 'src/ui/art');
  if (!existsSync(artDir)) {
    throw new Error('Missing artwork directory: src/ui/art');
  }
  await cp(artDir, join(outdir, 'art'), { recursive: true });
  copied.push('art/*.svg');

  return copied;
}

async function buildBrowser(browser, minify) {
  const outdir = join(DIST, browser);
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  const options = esbuildOptions(browser, outdir, minify);
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log(`[${browser}] watching for changes`);
  } else {
    await build(options);
  }

  await copyStatic(outdir);

  const manifest = buildManifest({ browser, version: pkg.version });
  const problems = validateManifestShape(manifest);
  if (problems.length > 0) {
    throw new Error(`Invalid ${browser} manifest:\n  - ${problems.join('\n  - ')}`);
  }
  await writeFile(join(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const files = await readdir(outdir, { withFileTypes: true });
  console.log(`[${browser}] built ${files.length} top-level entries -> ${relative(ROOT, outdir)}`);
  return { browser, outdir };
}

function archive(target) {
  const zipPath = `${target.outdir}.zip`;
  try {
    const { entries, bytes } = createZip(target.outdir, zipPath);
    console.log(
      `[${target.browser}] packaged ${relative(ROOT, zipPath)} (${entries} entries, ${(bytes / 1024).toFixed(0)} KB)`,
    );
  } catch (error) {
    console.error(`[${target.browser}] packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}

const production = !watch;
const minify = production && !flag('no-minify');
const targets = [];
for (const browser of browsers) {
  targets.push(await buildBrowser(browser, minify));
}

if (!watch && zip) {
  for (const target of targets) archive(target);
}

if (!watch) {
  console.log('\nDone. Load the unpacked extension from dist/<browser>/.');
}
