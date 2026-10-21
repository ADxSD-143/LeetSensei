import type { Overview } from '../background/overview';
import type { DeviceFlowStart, DevicePollOutcome } from '../github/auth';
import type { RepoListItem } from '../github/types';
import type { SyncStatusReport } from '../shared/messages';
import type { PendingJob } from '../storage/repository';
import { intervalsToInput, readIntervalsFromInput } from '../storage/settings';
import { errorMessage, openPage, send } from '../ui/api';
import {
  applyTheme,
  badge,
  button,
  clear,
  el,
  externalLink,
  formatDateTime,
  loading,
  note,
  qs,
} from '../ui/dom';

/**
 * Options page: account, destination repository, synchronization behaviour,
 * revision preferences, local data controls and diagnostics.
 */

interface OverviewResponse {
  overview: Overview;
  pending: PendingJob | null;
}

interface Diagnostics {
  logs: { at: string; level: string; scope: string; message: string }[];
  pending: PendingJob | null;
  storageKeys: string[];
  browser: string;
}

const header = qs<HTMLElement>('#header');
const app = qs<HTMLElement>('#app');

let device: DeviceFlowStart | null = null;
let pollTimer: number | null = null;
let repoList: RepoListItem[] = [];
let branchList: string[] = [];

function field(labelText: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  const label = el('label', {
    className: 'ls-field',
    children: [el('span', { text: labelText }), control],
  });
  if (hint !== undefined) label.append(el('span', { className: 'ls-small ls-muted', text: hint }));
  return label;
}

function textInput(value: string, placeholder = ''): HTMLInputElement {
  const input = el('input', { attrs: { type: 'text', value, placeholder } });
  input.value = value;
  return input;
}

function section(title: string, description: string, children: (Node | null)[]): HTMLElement {
  return el('section', {
    className: 'ls-card ls-stack',
    attrs: { 'aria-label': title },
    children: [
      el('div', {
        className: 'ls-stack',
        children: [
          el('h2', { text: title }),
          el('p', { className: 'ls-small ls-muted', text: description }),
        ],
      }),
      ...children,
    ],
  });
}

async function saveSettings(patch: Record<string, unknown>): Promise<void> {
  try {
    await send({ type: 'settings/save', payload: patch });
  } catch (error) {
    window.alert(errorMessage(error));
  }
  await refresh();
}

function accountSection(overview: Overview): HTMLElement {
  const children: (Node | null)[] = [];

  if (overview.connected) {
    children.push(
      el('div', {
        className: 'ls-row ls-row--wrap',
        children: [
          el('div', {
            className: 'ls-row',
            children: [
              el('span', { className: 'ls-dot ls-dot--ok' }),
              el('strong', { text: overview.login ?? 'connected' }),
            ],
          }),
          badge(overview.authMethod === 'pat' ? 'personal access token' : 'device flow', 'info'),
        ],
      }),
      el('div', {
        className: 'ls-small ls-muted',
        text: `Stored locally in this browser profile. Never written to the repository, never logged.`,
      }),
      el('div', {
        className: 'ls-actions',
        children: [
          button(
            'Verify token',
            () =>
              void run(async () => {
                const viewer = await send<{ login: string; scopes: string[] }>({
                  type: 'github/verify',
                });
                window.alert(
                  `Signed in as ${viewer.login}. Scopes: ${viewer.scopes.join(', ') || 'none reported'}.`,
                );
              }),
          ),
          button('Disconnect', () => void disconnect(), { variant: 'danger' }),
        ],
      }),
    );
    return section(
      'GitHub account',
      'LeetSensei uses GitHub OAuth device flow, which needs no client secret in the extension. A personal access token is accepted as a fallback.',
      children,
    );
  }

  const scopeSelect = el('select', {
    children: [
      el('option', {
        text: 'public_repo - public destination repository only',
        attrs: { value: 'public_repo' },
      }),
      el('option', {
        text: 'repo - also required for a private repository',
        attrs: { value: 'repo' },
      }),
    ],
  });
  scopeSelect.value = overview.settings.authScope;

  children.push(
    note('No account connected. Nothing is uploaded until you connect one.'),
    el('div', {
      className: 'ls-field-row',
      children: [
        field(
          'Permission scope',
          scopeSelect,
          'Choose repo only if your destination repository is private.',
        ),
      ],
    }),
    el('div', {
      className: 'ls-actions',
      children: [
        button('Start GitHub sign-in', () => void startDevice(scopeSelect.value), {
          variant: 'primary',
        }),
      ],
    }),
  );

  if (device !== null) {
    children.push(
      el('div', {
        className: 'ls-stack',
        children: [
          el('h3', { text: 'Finish signing in' }),
          el('div', { className: 'ls-code', text: device.userCode }),
          el('div', {
            className: 'ls-small',
            children: [
              el('span', { text: 'Open ' }),
              externalLink(device.verificationUri, device.verificationUri),
              el('span', { text: ' and enter the code above, then approve the request.' }),
            ],
          }),
          el('div', {
            className: 'ls-actions',
            children: [
              button('I approved it - continue', () => void beginPolling(), { variant: 'primary' }),
              button('Cancel', () => stopPolling()),
            ],
          }),
        ],
      }),
    );
  }

  const tokenInput = el('input', {
    attrs: { type: 'password', placeholder: 'ghp_... or github_pat_...', autocomplete: 'off' },
  });
  children.push(
    el('details', {
      children: [
        el('summary', { text: 'Advanced: use a personal access token instead' }),
        el('div', {
          className: 'ls-stack',
          children: [
            el('p', {
              className: 'ls-small ls-muted',
              text: 'Create a fine-grained token with Contents: read and write on the destination repository only. It is stored in this browser profile and sent to api.github.com only.',
            }),
            field('Token', tokenInput),
            el('div', {
              className: 'ls-actions',
              children: [
                button(
                  'Save token',
                  () =>
                    void run(async () => {
                      await send({ type: 'github/pat-save', payload: { token: tokenInput.value } });
                      tokenInput.value = '';
                    }),
                ),
              ],
            }),
          ],
        }),
      ],
    }),
  );

  return section(
    'GitHub account',
    'LeetSensei uses GitHub OAuth device flow, which needs no client secret in the extension. A personal access token is accepted as a fallback.',
    children,
  );
}

async function startDevice(scope: string): Promise<void> {
  try {
    device = await send<DeviceFlowStart>({ type: 'github/device-start', payload: { scope } });
    await refresh();
  } catch (error) {
    window.alert(errorMessage(error));
  }
}

function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function beginPolling(): void {
  stopPolling();
  const current = device;
  if (current === null) return;
  const intervalMs = Math.max(5, current.interval) * 1000;

  const tick = async (): Promise<void> => {
    if (device === null) return;
    try {
      const outcome = await send<DevicePollOutcome>({
        type: 'github/device-poll',
        payload: { deviceCode: device.deviceCode },
      });
      if (outcome.status === 'ok') {
        stopPolling();
        device = null;
        await refresh();
        return;
      }
      if (outcome.status === 'error') {
        stopPolling();
        device = null;
        window.alert(outcome.message);
        await refresh();
        return;
      }
      pollTimer = window.setTimeout(() => void tick(), intervalMs);
    } catch (error) {
      stopPolling();
      window.alert(errorMessage(error));
    }
  };

  void tick();
}

async function disconnect(): Promise<void> {
  if (
    !window.confirm(
      'Disconnect GitHub and delete the stored token? Your synced solutions and local revision data are kept.',
    )
  ) {
    return;
  }
  await run(async () => {
    await send({ type: 'data/disconnect' });
    repoList = [];
    branchList = [];
  });
}

function repositorySection(overview: Overview): HTMLElement {
  const ownerInput = textInput(overview.settings.repoOwner, 'your-github-username');
  const repoInput = textInput(overview.settings.repoName, 'solutions');

  const repoSelect = el('select');
  repoSelect.append(el('option', { text: 'Select a repository...', attrs: { value: '' } }));
  for (const repo of repoList) {
    repoSelect.append(
      el('option', {
        text: `${repo.fullName}${repo.isPrivate ? ' (private)' : ''}`,
        attrs: { value: repo.fullName },
      }),
    );
  }
  repoSelect.addEventListener('change', () => {
    const [owner, name] = repoSelect.value.split('/');
    if (owner === undefined || name === undefined) return;
    void saveSettings({ repoOwner: owner, repoName: name });
  });

  const branchSelect = el('select');
  branchSelect.append(el('option', { text: 'Select a branch...', attrs: { value: '' } }));
  for (const branch of branchList) {
    branchSelect.append(el('option', { text: branch, attrs: { value: branch } }));
  }
  branchSelect.value = overview.settings.branch;
  branchSelect.addEventListener('change', () => {
    if (branchSelect.value !== '') void saveSettings({ branch: branchSelect.value });
  });

  const children: (Node | null)[] = [
    el('div', {
      className: 'ls-field-row',
      children: [field('Owner', ownerInput), field('Repository', repoInput)],
    }),
    el('div', {
      className: 'ls-actions',
      children: [
        button(
          'Save repository',
          () => void saveSettings({ repoOwner: ownerInput.value, repoName: repoInput.value }),
        ),
        button(
          'Load my repositories',
          () =>
            void run(async () => {
              repoList = await send<RepoListItem[]>({ type: 'github/list-repos' });
              if (repoList.length === 0) {
                window.alert('No repositories with write access were found for this account.');
              }
            }),
          { small: true },
        ),
      ],
    }),
  ];

  if (repoList.length > 0) {
    children.push(field('Pick from your repositories', repoSelect));
  }

  children.push(
    field(
      'Branch',
      branchSelect,
      'LeetSensei only ever appends commits. It never force-pushes or rewrites history.',
    ),
    el('div', {
      className: 'ls-actions',
      children: [
        button(
          'Load branches',
          () =>
            void run(async () => {
              if (overview.settings.repoOwner === '' || overview.settings.repoName === '') {
                window.alert('Set the owner and repository first.');
                return;
              }
              branchList = await send<string[]>({
                type: 'github/list-branches',
                payload: {
                  owner: overview.settings.repoOwner,
                  repo: overview.settings.repoName,
                },
              });
            }),
          { small: true },
        ),
      ],
    }),
  );

  return section(
    'Destination repository',
    'Choose an existing repository and branch. Category folders are created at the repository root, next to a .leetcode-tracker state folder.',
    children,
  );
}

function syncSection(overview: Overview): HTMLElement {
  const autoSync = el('input', { attrs: { type: 'checkbox' } });
  autoSync.checked = overview.settings.autoSync;
  autoSync.addEventListener('change', () => void saveSettings({ autoSync: autoSync.checked }));

  const detect = el('input', { attrs: { type: 'checkbox' } });
  detect.checked = overview.settings.detectSubmissions;
  detect.addEventListener('change', () => void saveSettings({ detectSubmissions: detect.checked }));

  const fallback = textInput(overview.settings.fallbackCategory, 'Uncategorized');
  fallback.addEventListener(
    'change',
    () => void saveSettings({ fallbackCategory: fallback.value }),
  );

  return section(
    'Synchronization',
    'Only submissions LeetCode confirms as Accepted are ever uploaded.',
    [
      el('label', {
        className: 'ls-check',
        children: [
          detect,
          el('span', {
            text: 'Detect Accepted submissions on LeetCode problem pages. Turning this off stops all reading of LeetCode pages.',
          }),
        ],
      }),
      el('label', {
        className: 'ls-check',
        children: [
          autoSync,
          el('span', {
            text: 'Sync automatically when a submission is Accepted. When off, submissions wait in the popup until you press Sync now.',
          }),
        ],
      }),
      el('div', {
        className: 'ls-field-row',
        children: [
          field(
            'Fallback category when LeetCode reports no topic tags',
            fallback,
            'Used only when the official tags are unavailable; the problem README says so.',
          ),
        ],
      }),
      el('div', {
        className: 'ls-actions',
        children: [button('Review now (dashboard)', () => openPage('dashboard'), { small: true })],
      }),
    ],
  );
}

function revisionSection(overview: Overview): HTMLElement {
  const intervals = textInput(
    intervalsToInput(overview.settings.revisionIntervals),
    '1, 3, 7, 14, 30',
  );
  intervals.addEventListener(
    'change',
    () => void saveSettings({ revisionIntervals: readIntervalsFromInput(intervals.value) }),
  );

  return section(
    'Revision preferences',
    'Scheduling is local and deterministic: it never needs a new submission and never uses a hosted service.',
    [
      el('div', {
        className: 'ls-field-row',
        children: [field('Intervals in days', intervals, 'Ascending, comma separated.')],
      }),
      el('ul', {
        className: 'ls-small ls-muted',
        children: [
          el('li', { text: 'Easy moves the problem to the next longer interval.' }),
          el('li', { text: 'Hard keeps the current interval.' }),
          el('li', { text: 'Again resets the problem to the shortest interval.' }),
        ],
      }),
      el('div', {
        className: 'ls-actions',
        children: [
          button(
            'Back up revision state now',
            () =>
              void run(async () => {
                const result = await send<{ ok: boolean; message: string }>({
                  type: 'revision/backup',
                });
                window.alert(result.message);
              }),
          ),
        ],
      }),
    ],
  );
}

function dataSection(overview: Overview): HTMLElement {
  return section(
    'Local data and recovery',
    'LeetSensei stores everything locally first. The repository backup exists so a reinstall or a new machine can recover.',
    [
      el('div', {
        className: 'ls-small ls-muted',
        text: `Problems tracked: ${overview.problems.length} · Revision records: ${overview.revisions.length} · Last successful sync: ${formatDateTime(overview.lastSyncedAt)}`,
      }),
      el('div', {
        className: 'ls-actions',
        children: [
          button(
            'Restore from repository',
            () =>
              void run(async () => {
                const result = await send<{ ok: boolean; message: string }>({
                  type: 'data/restore',
                });
                window.alert(result.message);
              }),
          ),
          button('Export local data (JSON)', () => void exportData()),
          button(
            'Clear all local data',
            () => {
              if (
                !window.confirm(
                  'Delete all locally stored LeetSensei data (settings, manifest, revisions and token)? Repository files are not touched.',
                )
              ) {
                return;
              }
              void run(async () => {
                await send({ type: 'data/clear' });
                window.alert('Local data cleared.');
              });
            },
            { variant: 'danger' },
          ),
        ],
      }),
    ],
  );
}

async function exportData(): Promise<void> {
  try {
    const exported = await send<{ filename: string; json: string }>({ type: 'data/export' });
    const blob = new Blob([exported.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = el('a', { attrs: { href: url, download: exported.filename } });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    window.alert(errorMessage(error));
  }
}

function diagnosticsSection(): HTMLElement {
  const container = el('div', { className: 'ls-stack' });
  container.append(loading('Loading diagnostics...'));

  const load = async (): Promise<void> => {
    clear(container);
    try {
      const diagnostics = await send<Diagnostics>({ type: 'data/diagnostics' });
      container.append(
        el('div', {
          className: 'ls-small ls-muted',
          text: `Browser: ${diagnostics.browser} · Local storage keys: ${diagnostics.storageKeys.length}`,
        }),
      );
      if (diagnostics.logs.length === 0) {
        container.append(
          el('div', { className: 'ls-small ls-muted', text: 'No log entries yet.' }),
        );
      } else {
        const list = el('ul', { className: 'ls-list' });
        for (const entry of [...diagnostics.logs].reverse().slice(0, 50)) {
          list.append(
            el('li', {
              children: [
                el('div', {
                  className: 'ls-row',
                  children: [
                    badge(entry.level, entry.level === 'error' ? 'err' : 'neutral'),
                    el('span', { className: 'ls-small ls-muted', text: entry.scope }),
                  ],
                }),
                el('div', { className: 'ls-small', text: entry.message }),
                el('div', { className: 'ls-small ls-muted', text: formatDateTime(entry.at) }),
              ],
            }),
          );
        }
        container.append(list);
      }
    } catch (error) {
      container.append(note(errorMessage(error), 'err'));
    }
  };

  const wrapper = section(
    'Diagnostics',
    'Logs are kept in memory only, are never uploaded, and have credentials redacted before they are stored.',
    [container],
  );
  wrapper.append(
    el('div', {
      className: 'ls-actions',
      children: [button('Refresh diagnostics', () => void load(), { small: true })],
    }),
  );
  void load();
  return wrapper;
}

function privacySection(): HTMLElement {
  return section('Permissions and privacy', 'Everything this extension can reach, and why.', [
    el('ul', {
      className: 'ls-small',
      children: [
        el('li', {
          text: 'leetcode.com - read the problem page and the submission LeetCode already judged.',
        }),
        el('li', {
          text: 'api.github.com and github.com - authorization and writing to the repository you choose.',
        }),
        el('li', {
          text: 'storage - keep settings, the manifest and revision state in this browser profile.',
        }),
        el('li', {
          text: 'No analytics, no telemetry, no third-party servers, no LeetCode password or cookie access.',
        }),
        el('li', { text: 'Submitted source code is never executed or evaluated by LeetSensei.' }),
      ],
    }),
    el('div', {
      className: 'ls-small',
      children: [
        el('span', { text: 'Full details: ' }),
        externalLink(
          'https://github.com/ADxSD-143/LeetSensei/blob/main/docs/SECURITY.md',
          'docs/SECURITY.md',
        ),
      ],
    }),
  ]);
}

function conflictBanner(pending: PendingJob | null): HTMLElement | null {
  if (pending === null || pending.conflicts.length === 0) return null;
  return el('div', {
    className: 'ls-card',
    children: [
      note(
        `${pending.conflicts.length} file(s) from ${pending.submission.title} are waiting for a decision. Open the dashboard to resolve them.`,
        'warn',
      ),
      el('div', {
        className: 'ls-actions',
        children: [button('Open dashboard', () => openPage('dashboard'), { variant: 'primary' })],
      }),
    ],
  });
}

function phaseBadge(status: SyncStatusReport): HTMLElement {
  return badge(
    status.phase,
    status.phase === 'failed' ? 'err' : status.phase === 'done' ? 'ok' : 'info',
  );
}

function renderHeader(overview: Overview): void {
  clear(header);
  header.append(
    el('div', {
      className: 'ls-header',
      children: [
        el('div', {
          className: 'ls-brand',
          children: [
            el('img', { attrs: { src: 'icons/icon-48.png', alt: '' } }),
            el('span', { text: `LeetSensei ${overview.version}` }),
          ],
        }),
        el('div', {
          className: 'ls-actions',
          children: [button('Open dashboard', () => openPage('dashboard'), { small: true })],
        }),
      ],
    }),
  );
}

function render(overview: Overview, pending: PendingJob | null): void {
  applyTheme(overview.settings.theme);
  renderHeader(overview);
  clear(app);
  app.setAttribute('aria-busy', 'false');

  const status = el('section', {
    className: 'ls-card ls-stack',
    children: [
      el('div', {
        className: 'ls-row',
        children: [el('h2', { text: 'Status' }), phaseBadge(overview.status)],
      }),
      el('p', { className: 'ls-small', text: overview.status.message }),
      el('div', {
        className: 'ls-small ls-muted',
        text: `Destination: ${overview.repo ? `${overview.repo.owner}/${overview.repo.repo} @ ${overview.repo.branch}` : 'not selected'} · Queued submissions: ${overview.queuedSubmissions}`,
      }),
      el('div', {
        className: 'ls-actions',
        children: [
          button(
            'Retry last sync',
            () =>
              void run(async () => {
                await send({ type: 'sync/retry' });
              }),
            { small: true },
          ),
        ],
      }),
    ],
  });

  app.append(status);
  const banner = conflictBanner(pending);
  if (banner !== null) app.append(banner);
  app.append(
    accountSection(overview),
    repositorySection(overview),
    syncSection(overview),
    revisionSection(overview),
    dataSection(overview),
    diagnosticsSection(),
    privacySection(),
  );
}

async function refresh(): Promise<void> {
  app.setAttribute('aria-busy', 'true');
  try {
    const response = await send<OverviewResponse>({ type: 'data/overview' });
    render(response.overview, response.pending);
  } catch (error) {
    clear(app);
    app.setAttribute('aria-busy', 'false');
    app.append(note(errorMessage(error), 'err'));
  }
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    window.alert(errorMessage(error));
  }
  await refresh();
}

void refresh();
