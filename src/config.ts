declare const __LEETSENSEI_VERSION__: string;
declare const __LEETSENSEI_GITHUB_CLIENT_ID__: string;
declare const __LEETSENSEI_BROWSER__: string;

/**
 * Build-time constants injected by esbuild. The `typeof` guards keep the module
 * loadable under Vitest, where the defines do not exist.
 */

export const VERSION: string =
  typeof __LEETSENSEI_VERSION__ === 'string' ? __LEETSENSEI_VERSION__ : '0.0.0-dev';

export const BROWSER: string =
  typeof __LEETSENSEI_BROWSER__ === 'string' ? __LEETSENSEI_BROWSER__ : 'unknown';

/**
 * Public GitHub OAuth App client id. This is not a secret and GitHub's device
 * flow needs no client secret, so nothing confidential ships in the bundle.
 * Maintainers register the app and export LEETSENSEI_GITHUB_CLIENT_ID at build
 * time; the options page also accepts a personal access token as a fallback.
 */
export const GITHUB_CLIENT_ID: string =
  typeof __LEETSENSEI_GITHUB_CLIENT_ID__ === 'string' ? __LEETSENSEI_GITHUB_CLIENT_ID__ : '';

export const USER_AGENT = `LeetSensei/${VERSION}`;
