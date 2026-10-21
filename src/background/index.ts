import { coerceRawSubmission } from '../adapters/leetcode/parse';
import { GITHUB_CLIENT_ID } from '../config';
import { fetchViewer, pollDeviceOnce, startDeviceFlow } from '../github/auth';
import { RestGithubClient } from '../github/client';
import { ext, isFirefox } from '../shared/browser-api';
import { LeetSenseiError, toLeetSenseiError } from '../shared/errors';
import { createLogger, getRecentLogs } from '../shared/logger';
import { isUiMessage, type MessageResponse, type UiMessage } from '../shared/messages';
import { createBrowserStorageArea, type StorageArea } from '../storage/area';
import { STORAGE_KEYS, StateRepository } from '../storage/repository';
import {
  applySettingsPatch,
  defaultSettings,
  normalizeSettings,
  sanitizeBranchName,
  sanitizeRepoPart,
} from '../storage/settings';
import { SyncCoordinator } from './coordinator';

/**
 * Background service worker / event page.
 *
 * Owns all network access and all state mutation. The content script and the
 * extension pages talk to it only through the typed message protocol.
 */

const logger = createLogger('background');

const area: StorageArea = createBrowserStorageArea();
const repository = new StateRepository(area);
const coordinator = new SyncCoordinator({
  repository,
  createClient: (token) => new RestGithubClient({ token }),
  onStatus: (status) => {
    void ext.runtime.sendMessage({ type: 'sync/status', status }).catch(() => undefined);
  },
});

const BADGE_ALARM = 'leetsensei:refresh';

async function refreshBadge(): Promise<void> {
  try {
    const due = await coordinator.dueCount();
    const text = due === 0 ? '' : due > 99 ? '99+' : String(due);
    await ext.action.setBadgeText({ text });
    if (text !== '') await ext.action.setBadgeBackgroundColor({ color: '#0ea5e9' });
  } catch (error) {
    logger.debug('badge refresh failed', toLeetSenseiError(error).message);
  }
}

function ensureAlarm(): void {
  void ext.alarms.create(BADGE_ALARM, { periodInMinutes: 60 });
}

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_ALARM) void refreshBadge();
});
ext.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  void refreshBadge();
});
ext.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void refreshBadge();
});

async function saveToken(token: string, method: 'device' | 'pat'): Promise<unknown> {
  const viewer = await fetchViewer(token);
  await repository.saveAuth({
    token,
    login: viewer.login,
    scopes: viewer.scopes,
    method,
    savedAt: new Date().toISOString(),
  });
  void refreshBadge();
  return { login: viewer.login, scopes: viewer.scopes, method };
}

function sanitizeScope(scope: string): string {
  return scope === 'repo' ? 'repo' : 'public_repo';
}

async function saveSettings(candidate: Record<string, unknown>): Promise<unknown> {
  const current = await repository.loadSettings();
  if (typeof candidate.branch === 'string' && sanitizeBranchName(candidate.branch) === null) {
    throw new LeetSenseiError(
      'validation_failed',
      `"${candidate.branch}" is not a valid branch name.`,
    );
  }
  for (const [key, label] of [
    ['repoOwner', 'owner name'],
    ['repoName', 'repository name'],
  ] as const) {
    const value = candidate[key];
    if (typeof value === 'string' && value.trim() !== '' && sanitizeRepoPart(value) === null) {
      throw new LeetSenseiError('validation_failed', `"${value}" is not a valid GitHub ${label}.`);
    }
  }
  const next = applySettingsPatch(current, candidate);
  await repository.saveSettings(next);
  return next;
}

async function handle(message: UiMessage): Promise<unknown> {
  switch (message.type) {
    case 'submission/accepted': {
      const raw = coerceRawSubmission(message.payload);
      if (raw === null) {
        throw new LeetSenseiError('extraction_failed', 'The detected submission was malformed.');
      }
      const status = await coordinator.handleAccepted(raw);
      void refreshBadge();
      return status;
    }
    case 'sync/status-request': {
      const syncState = await repository.loadSyncState();
      return syncState.status;
    }
    case 'sync/conflict-decision': {
      const status = await coordinator.resolveConflict(
        message.payload.path,
        message.payload.decision,
      );
      void refreshBadge();
      return status;
    }
    case 'sync/retry': {
      const status = await coordinator.retryLast();
      void refreshBadge();
      return status;
    }
    case 'revision/review': {
      const result = await coordinator.reviewProblem(
        message.payload.problemId,
        message.payload.rating,
      );
      void refreshBadge();
      return result;
    }
    case 'revision/set-next':
      return coordinator.setNextReview(message.payload.problemId, message.payload.nextReviewAt);
    case 'revision/backup':
      return coordinator.backupRevisions();
    case 'data/overview':
      return {
        overview: await coordinator.getOverview(),
        pending: await coordinator.getPendingJob(),
        revisions: (await repository.loadRevisions()).value,
      };
    case 'data/diagnostics':
      return {
        logs: getRecentLogs(),
        pending: await coordinator.getPendingJob(),
        storageKeys: await area.keys(),
        browser: isFirefox ? 'firefox' : 'chrome',
      };
    case 'github/device-start':
      return startDeviceFlow({
        clientId: GITHUB_CLIENT_ID,
        scope: sanitizeScope(message.payload.scope),
      });
    case 'github/device-poll': {
      const outcome = await pollDeviceOnce({
        clientId: GITHUB_CLIENT_ID,
        scope: 'public_repo',
        deviceCode: message.payload.deviceCode,
      });
      if (outcome.status !== 'ok') return outcome;
      const saved = await saveToken(outcome.token, 'device');
      return { status: 'ok' as const, ...(saved as Record<string, unknown>) };
    }
    case 'github/pat-save': {
      const token = message.payload.token.trim();
      if (token === '') {
        throw new LeetSenseiError('validation_failed', 'Paste a token first.');
      }
      return saveToken(token, 'pat');
    }
    case 'github/verify': {
      const auth = await repository.loadAuth();
      if (auth.token === null) {
        throw new LeetSenseiError('auth_required', 'Connect a GitHub account first.');
      }
      const viewer = await fetchViewer(auth.token);
      await repository.saveAuth({ ...auth, login: viewer.login, scopes: viewer.scopes });
      return viewer;
    }
    case 'github/list-repos':
      return coordinator.listRepos();
    case 'github/list-branches':
      return coordinator.listBranches(message.payload.owner, message.payload.repo);
    case 'settings/load':
      return repository.loadSettings();
    case 'settings/save': {
      const payload = message.payload;
      if (typeof payload !== 'object' || payload === null) {
        return repository.loadSettings();
      }
      return saveSettings(payload as Record<string, unknown>);
    }
    case 'data/restore':
      return coordinator.restoreFromRemote();
    case 'data/disconnect':
      return coordinator.disconnect();
    case 'data/clear':
      return coordinator.clearLocalData();
    case 'data/export':
      return coordinator.exportData();
    default: {
      const exhaustive: never = message;
      throw new LeetSenseiError(
        'validation_failed',
        `Unsupported message: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

ext.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isUiMessage(message)) return undefined;
  if (!isHandleable(message)) return undefined;

  handle(message).then(
    (data) => {
      sendResponse({ ok: true, data } satisfies MessageResponse);
    },
    (error: unknown) => {
      const known = toLeetSenseiError(error);
      sendResponse({ ok: false, error: known.message, code: known.code } satisfies MessageResponse);
    },
  );
  // Keeps the message channel open for the async reply.
  return true;
});

const HANDLEABLE = new Set<string>([
  'submission/accepted',
  'sync/status-request',
  'sync/conflict-decision',
  'sync/retry',
  'revision/review',
  'revision/set-next',
  'revision/backup',
  'data/overview',
  'data/diagnostics',
  'github/device-start',
  'github/device-poll',
  'github/pat-save',
  'github/verify',
  'github/list-repos',
  'github/list-branches',
  'settings/load',
  'settings/save',
  'data/restore',
  'data/disconnect',
  'data/clear',
  'data/export',
]);

function isHandleable(message: UiMessage): boolean {
  return HANDLEABLE.has(message.type);
}

void (async () => {
  const existing = await area.get<unknown>(STORAGE_KEYS.settings);
  await repository.saveSettings(
    existing === undefined ? defaultSettings() : normalizeSettings(existing),
  );
  ensureAlarm();
  await refreshBadge();
})().catch((error: unknown) => {
  logger.warn('background initialisation failed', toLeetSenseiError(error).message);
});
