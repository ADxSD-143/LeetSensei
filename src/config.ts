declare const __LEETSENSEI_VERSION__: string;
declare const __LEETSENSEI_GITHUB_CLIENT_ID__: string;
declare const __LEETSENSEI_BROWSER__: string;
declare const __LEETSENSEI_ALLOW_PAT__: boolean;

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
 * time. Release builds require it; development builds may fall back to a
 * personal access token (see ALLOW_PAT).
 */
export const GITHUB_CLIENT_ID: string =
  typeof __LEETSENSEI_GITHUB_CLIENT_ID__ === 'string' ? __LEETSENSEI_GITHUB_CLIENT_ID__ : '';

/**
 * Whether this build offers the personal-access-token fallback.
 *
 * Release builds set this to false so store users are only ever offered the
 * GitHub device flow. It defaults to true outside a build (Vitest) so the
 * development path keeps working.
 */
export const ALLOW_PAT: boolean =
  typeof __LEETSENSEI_ALLOW_PAT__ === 'boolean' ? __LEETSENSEI_ALLOW_PAT__ : true;

export const USER_AGENT = `LeetSensei/${VERSION}`;
