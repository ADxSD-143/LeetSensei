import { startLeetCodeAdapter } from '../adapters/leetcode';
import { ext, isFirefox } from '../shared/browser-api';
import { createLogger } from '../shared/logger';
import { STORAGE_KEYS } from '../storage/repository';
import { normalizeSettings } from '../storage/settings';

/**
 * Content script for `https://leetcode.com/problems/*`.
 *
 * Runs in the isolated world, talks to the background worker only, and never
 * reads cookies or touches anything outside the current problem page.
 */

const logger = createLogger('content');

let enabled = true;

async function readEnabled(): Promise<boolean> {
  try {
    const stored = await ext.storage.local.get(STORAGE_KEYS.settings);
    const settings = normalizeSettings((stored as Record<string, unknown>)[STORAGE_KEYS.settings]);
    return settings.detectSubmissions;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  enabled = await readEnabled();

  const adapter = startLeetCodeAdapter({
    isEnabled: () => enabled,
    onAccepted: (event) => {
      logger.info(`Accepted submission ${event.submissionId} detected on ${event.titleSlug}.`);
      void ext.runtime
        .sendMessage({ type: 'submission/accepted', payload: event.raw })
        .catch((error: unknown) => {
          logger.warn('the background worker did not accept the submission', String(error));
        });
    },
    onDiagnostic: (message) => logger.info(message),
  });

  ext.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const change = (changes as Record<string, unknown>)[STORAGE_KEYS.settings];
    if (change === undefined) return;
    void (async () => {
      const next = await readEnabled();
      if (next !== enabled) {
        enabled = next;
        logger.info(next ? 'detection enabled' : 'detection disabled');
      }
    })();
  });

  window.addEventListener('pagehide', () => adapter.stop(), { once: true });
}

if (typeof MutationObserver !== 'undefined') {
  void main().catch((error: unknown) => {
    logger.warn('content script failed to start', String(error));
  });
} else if (isFirefox) {
  logger.debug('content script skipped: environment does not support MutationObserver');
}
