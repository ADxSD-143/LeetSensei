import { describe, expect, it } from 'vitest';
import { ALLOW_PAT, BROWSER, GITHUB_CLIENT_ID, USER_AGENT, VERSION } from '../../src/config';

/**
 * The build injects these values with esbuild `define`. Under Vitest the defines
 * do not exist, so these tests pin the fallbacks that keep the module loadable
 * and the development paths usable outside a build.
 */
describe('build-time configuration', () => {
  it('falls back to safe placeholders when the defines are absent', () => {
    expect(VERSION).toBe('0.0.0-dev');
    expect(BROWSER).toBe('unknown');
    expect(GITHUB_CLIENT_ID).toBe('');
  });

  it('derives the user agent from the version', () => {
    expect(USER_AGENT).toBe(`LeetSensei/${VERSION}`);
  });

  it('offers the personal-access-token path in development builds', () => {
    // Release builds set __LEETSENSEI_ALLOW_PAT__ to false; anything else,
    // including the no-define case, keeps the fallback available.
    expect(ALLOW_PAT).toBe(true);
  });
});
