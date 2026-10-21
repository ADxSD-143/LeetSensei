import type { Overview } from '../background/overview';
import type { SyncStatusReport } from '../shared/messages';
import type { PendingJob } from '../storage/repository';
import { errorMessage, openPage, send } from '../ui/api';
import {
  applyTheme,
  badge,
  button,
  clear,
  el,
  formatDateTime,
  loading,
  note,
  qs,
  type Tone,
} from '../ui/dom';

/**
 * Popup: connection state, the most recent sync result, quick actions and the
 * number of reviews due today.
 */

interface OverviewResponse {
  overview: Overview;
  pending: PendingJob | null;
}

const app = qs<HTMLElement>('#app');

const PHASE_TONE: Record<SyncStatusReport['phase'], Tone> = {
  idle: 'neutral',
  detected: 'info',
  planning: 'info',
  'awaiting-decision': 'warn',
  uploading: 'info',
  done: 'ok',
  failed: 'err',
};

const PHASE_LABEL: Record<SyncStatusReport['phase'], string> = {
  idle: 'Idle',
  detected: 'Detected',
  planning: 'Planning',
  'awaiting-decision': 'Needs a decision',
  uploading: 'Uploading',
  done: 'Synced',
  failed: 'Failed',
};

function header(): HTMLElement {
  const brand = el('div', {
    className: 'ls-brand',
    children: [
      el('img', { attrs: { src: 'icons/icon-32.png', alt: 'LeetSensei' } }),
      el('div', {
        className: 'ls-brand-title',
        children: [
          el('span', { text: 'LeetSensei' }),
          el('span', { className: 'ls-tag-badge', text: '先生' }),
        ],
      }),
    ],
  });
  return el('header', {
    className: 'ls-header',
    children: [
      brand,
      el('div', {
        className: 'ls-actions',
        children: [
          button('Dashboard', () => openPage('dashboard'), { small: true }),
          button('Options', () => openPage('options'), { small: true }),
        ],
      }),
    ],
  });
}

function connectionCard(overview: Overview): HTMLElement {
  const children: (Node | null)[] = [];

  const accountRow = el('div', {
    className: 'ls-row',
    children: [
      el('div', {
        className: 'ls-row',
        children: [
          el('span', { className: 'ls-dot ls-dot--ok' }),
          el('strong', { text: overview.login ?? 'GitHub account' }),
        ],
      }),
      badge(overview.authMethod === 'pat' ? 'token' : 'device flow'),
    ],
  });

  if (overview.setup === 'needs-github') {
    children.push(
      note('Connect GitHub to start saving accepted solutions.'),
      el('div', {
        className: 'ls-actions',
        children: [button('Connect GitHub', () => openPage('options'), { variant: 'primary' })],
      }),
    );
  } else if (overview.setup === 'needs-repository') {
    children.push(
      accountRow,
      note('One more step: choose the repository and branch where solutions should go.'),
      el('div', {
        className: 'ls-actions',
        children: [button('Choose repository', () => openPage('options'), { variant: 'primary' })],
      }),
    );
  } else {
    children.push(accountRow);
  }

  children.push(
    el('div', {
      className: 'ls-small ls-muted',
      text: overview.repo
        ? `Destination: ${overview.repo.owner}/${overview.repo.repo} @ ${overview.repo.branch}`
        : 'No destination repository selected.',
    }),
  );

  return el('section', {
    className: 'ls-card',
    attrs: { 'aria-label': 'GitHub connection' },
    children,
  });
}

function reviewsCard(overview: Overview): HTMLElement {
  const { overdue, dueToday, upcoming } = overview.schedule;
  return el('section', {
    className: 'ls-card',
    attrs: { 'aria-label': 'Revision queue' },
    children: [
      el('h2', { text: 'Revisions' }),
      el('div', {
        className: 'ls-row ls-row--wrap',
        children: [
          badge(`${overdue} overdue`, overdue > 0 ? 'err' : 'neutral'),
          badge(`${dueToday} due today`, dueToday > 0 ? 'warn' : 'neutral'),
          badge(`${upcoming} upcoming`),
        ],
      }),
      el('div', {
        className: 'ls-actions',
        children: [
          button('Open review queue', () => openPage('dashboard'), {
            small: true,
            variant: overdue + dueToday > 0 ? 'primary' : undefined,
          }),
        ],
      }),
    ],
  });
}

function syncCard(overview: Overview): HTMLElement {
  const status = overview.status;
  const children: (Node | null)[] = [
    el('div', {
      className: 'ls-row',
      children: [
        el('h2', { text: 'Last sync' }),
        badge(PHASE_LABEL[status.phase], PHASE_TONE[status.phase]),
      ],
    }),
    el('p', { className: 'ls-small', text: status.message }),
  ];

  if (status.problemSlug !== null) {
    children.push(
      el('div', {
        className: 'ls-mono',
        text: status.problemSlug,
      }),
    );
  }

  if (status.perCategory.length > 0) {
    const list = el('ul', { className: 'ls-list' });
    for (const entry of status.perCategory) {
      list.append(
        el('li', {
          children: [
            el('div', {
              className: 'ls-row',
              children: [
                el('span', { className: 'ls-mono', text: entry.category }),
                badge(entry.ok ? 'written' : 'partial', entry.ok ? 'ok' : 'warn'),
              ],
            }),
            entry.error ? el('div', { className: 'ls-small ls-muted', text: entry.error }) : null,
          ],
        }),
      );
    }
    children.push(list);
  }

  children.push(
    el('div', {
      className: 'ls-small ls-muted',
      text: `Last successful sync: ${formatDateTime(overview.lastSyncedAt)}`,
    }),
  );

  return el('section', {
    className: 'ls-card',
    attrs: { 'aria-label': 'Last sync result' },
    children,
  });
}

function conflictCard(pending: PendingJob): HTMLElement {
  const list = el('ul', { className: 'ls-list' });
  for (const conflict of pending.conflicts) {
    list.append(
      el('li', {
        children: [
          el('div', { className: 'ls-mono', text: conflict.path }),
          el('div', { className: 'ls-small ls-muted', text: conflict.message }),
          el('div', {
            className: 'ls-actions',
            children: [
              button('Replace', () => void decide(conflict.path, 'replace'), {
                small: true,
                variant: 'danger',
              }),
              button('Save version', () => void decide(conflict.path, 'save-version'), {
                small: true,
              }),
              button('Cancel', () => void decide(conflict.path, 'cancel'), { small: true }),
            ],
          }),
        ],
      }),
    );
  }

  return el('section', {
    className: 'ls-card',
    children: [
      el('h2', { text: 'Files that need your decision' }),
      note(
        'These files already exist with different content. LeetSensei will not overwrite them until you choose.',
        'warn',
      ),
      list,
      el('div', {
        className: 'ls-small ls-muted',
        text: `Detected ${formatDateTime(pending.createdAt)} · reviewed in the dashboard`,
      }),
    ],
  });
}

function actionsCard(overview: Overview): HTMLElement {
  return el('section', {
    className: 'ls-card',
    attrs: { 'aria-label': 'Quick actions' },
    children: [
      el('h2', { text: 'Quick actions' }),
      el('div', {
        className: 'ls-actions',
        children: [
          button(
            overview.queuedSubmissions > 0
              ? `Sync now (${overview.queuedSubmissions} waiting)`
              : 'Sync now',
            () => void runAction(() => send({ type: 'sync/retry' })),
            { variant: 'primary' },
          ),
          button('Back up reviews', () => void runAction(() => send({ type: 'revision/backup' })), {
            small: true,
          }),
        ],
      }),
    ],
  });
}

function errorCard(message: string): HTMLElement {
  return el('section', {
    className: 'ls-card',
    children: [
      note(message, 'err'),
      el('div', {
        className: 'ls-actions',
        children: [button('Retry', () => void refresh(), { small: true })],
      }),
    ],
  });
}

function render(overview: Overview, pending: PendingJob | null): void {
  applyTheme(overview.settings.theme);
  clear(app);
  app.setAttribute('aria-busy', 'false');
  app.append(header(), connectionCard(overview));
  if (pending !== null && pending.conflicts.length > 0) app.append(conflictCard(pending));
  app.append(syncCard(overview), reviewsCard(overview), actionsCard(overview));
  app.append(
    el('div', {
      className: 'ls-small ls-muted',
      text: `v${overview.version} · accepts a LeetCode submission only when it is Accepted`,
    }),
  );
}

async function refresh(): Promise<void> {
  clear(app);
  app.setAttribute('aria-busy', 'true');
  app.append(header(), loading('Reading local state...'));
  try {
    const response = await send<OverviewResponse>({ type: 'data/overview' });
    render(response.overview, response.pending);
  } catch (error) {
    clear(app);
    app.setAttribute('aria-busy', 'false');
    app.append(header(), errorCard(errorMessage(error)));
  }
}

async function decide(
  path: string,
  decision: 'replace' | 'save-version' | 'cancel',
): Promise<void> {
  const question =
    decision === 'replace'
      ? `Overwrite ${path} with the new content? The repository copy will be replaced.`
      : decision === 'save-version'
        ? `Keep the repository copy of ${path} as a dated version and write the new content to the canonical path?`
        : `Leave ${path} untouched and skip it?`;
  if (!window.confirm(question)) return;
  await runAction(() => send({ type: 'sync/conflict-decision', payload: { path, decision } }));
}

async function runAction(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    window.alert(errorMessage(error));
  }
  await refresh();
}

void refresh();
