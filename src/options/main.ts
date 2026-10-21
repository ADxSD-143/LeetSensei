import type { Overview } from '../background/overview';
import type { AccessCheck } from '../background/coordinator';
import type { DeviceFlowStart, DevicePollOutcome } from '../github/auth';
import type { RepoListItem } from '../github/types';
import { ALLOW_PAT } from '../config';
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
let pollError: string | null = null;
let repoList: RepoListItem[] = [];
let branchList: string[] = [];

// Guided setup state. Kept outside the render cycle so a re-render (which the
// background pushes on every status change) never loses the user's choices.
let reposLoading = false;
let reposError: string | null = null;
let reposRequestedFor: string | null = null;
let branchesRequestedFor: string | null = null;
let selectedRepo: string | null = null;
let selectedBranch = '';
let accessCheck: AccessCheck | null = null;
let accessError: string | null = null;

function resetPicker(): void {
  repoList = [];
  branchList = [];
  reposRequestedFor = null;
  branchesRequestedFor = null;
  reposLoading = false;
  reposError = null;
  selectedRepo = null;
  selectedBranch = '';
  accessCheck = null;
  accessError = null;
}

const ACCOUNT_DESCRIPTION = ALLOW_PAT
  ? 'LeetSensei uses GitHub OAuth device flow, which needs no client secret. This development build also accepts a personal access token.'
  : 'LeetSensei uses GitHub OAuth device flow. No password, token, or client secret is stored in the extension.';

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
    return section('GitHub account', ACCOUNT_DESCRIPTION, children);
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

  if (ALLOW_PAT) {
    const tokenInput = el('input', {
      attrs: { type: 'password', placeholder: 'ghp_... or github_pat_...', autocomplete: 'off' },
    });
    children.push(
      el('details', {
        children: [
          el('summary', { text: 'Development: use a personal access token instead' }),
          el('div', {
            className: 'ls-stack',
            children: [
              el('p', {
                className: 'ls-small ls-muted',
                text: 'Development builds only. Create a fine-grained token with Contents: read and write on the destination repository. It is stored in this browser profile and sent to api.github.com only.',
              }),
              field('Token', tokenInput),
              el('div', {
                className: 'ls-actions',
                children: [
                  button(
                    'Save token',
                    () =>
                      void run(async () => {
                        await send({
                          type: 'github/pat-save',
                          payload: { token: tokenInput.value },
                        });
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
  }

  return section('GitHub account', ACCOUNT_DESCRIPTION, children);
}

async function startDevice(scope: string = 'public_repo'): Promise<void> {
  try {
    stopPolling();
    pollError = null;
    resetPicker();
    device = await send<DeviceFlowStart>({
      type: 'github/device-start',
      payload: { scope: scope === 'repo' ? 'repo' : 'public_repo' },
    });
    await refresh();
    // Poll immediately: the only thing the user must do is approve on GitHub.
    beginPolling();
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
        resetPicker();
        await refresh();
        return;
      }
      if (outcome.status === 'error') {
        stopPolling();
        device = null;
        pollError = outcome.message;
        await refresh();
        return;
      }
      pollTimer = window.setTimeout(() => void tick(), intervalMs);
    } catch (error) {
      stopPolling();
      pollError = errorMessage(error);
      await refresh();
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

// ------------------------------------------------------------- guided setup
//
// The first-run path is deliberately three steps and free of GitHub jargon:
// Connect GitHub -> choose repository and branch -> Ready. Everything that a
// returning user might tweak lives under "Advanced settings" below.

function stepIndicator(active: 1 | 2 | 3): HTMLElement {
  const labels = ['Connect GitHub', 'Choose repository', 'Ready'];
  return el('ol', {
    className: 'ls-steps',
    attrs: { 'aria-label': 'Setup progress' },
    children: labels.map((label, index) => {
      const step = index + 1;
      const state = step === active ? ' ls-step--active' : step < active ? ' ls-step--done' : '';
      return el('li', {
        className: `ls-step${state}`,
        attrs: { 'aria-current': step === active ? 'step' : 'false' },
        children: [
          el('span', { className: 'ls-step__number', text: String(step) }),
          el('span', { text: label }),
        ],
      });
    }),
  });
}

function setupCard(overview: Overview): HTMLElement {
  if (overview.setup === 'needs-github') return connectStep();
  if (overview.setup === 'needs-repository') return repositoryStep(overview);
  return readyStep(overview);
}

function cancelDevice(): void {
  stopPolling();
  device = null;
  void refresh();
}

async function copyAndOpen(current: DeviceFlowStart): Promise<void> {
  try {
    await navigator.clipboard.writeText(current.userCode);
  } catch {
    // Clipboard access can be denied; the code is on screen either way.
  }
  window.open(current.verificationUri, '_blank', 'noopener');
}

function connectStep(): HTMLElement {
  const children: (Node | null)[] = [stepIndicator(1)];

  if (device === null) {
    children.push(
      el('p', {
        className: 'ls-small ls-muted',
        text: 'LeetSensei saves your Accepted solutions to a GitHub repository you choose. Sign in once — there is no password to type here and no token to copy.',
      }),
      el('div', {
        className: 'ls-actions',
        children: [
          button('Connect GitHub', () => void startDevice('public_repo'), { variant: 'primary' }),
        ],
      }),
    );
  } else {
    const current = device;
    children.push(
      el('h3', { text: 'Enter this code on GitHub' }),
      el('div', { className: 'ls-code', text: current.userCode }),
      el('p', {
        className: 'ls-small ls-muted',
        text: 'Approve the request in the GitHub tab. This page finishes by itself as soon as you do.',
      }),
      el('div', {
        className: 'ls-actions',
        children: [
          button('Copy code & open GitHub', () => void copyAndOpen(current), {
            variant: 'primary',
          }),
          button('Cancel', () => cancelDevice(), { small: true }),
        ],
      }),
      el('div', { className: 'ls-small ls-muted', text: 'Waiting for approval…' }),
    );
  }

  if (pollError !== null) children.push(note(pollError, 'err'));

  return section('Connect GitHub', 'Step 1 of 3.', children);
}

function ensureRepositories(overview: Overview): void {
  const key = overview.login ?? 'account';
  if (reposLoading || reposRequestedFor === key) return;
  reposRequestedFor = key;

  void (async () => {
    reposLoading = true;
    reposError = null;
    await refresh();
    try {
      repoList = await send<RepoListItem[]>({ type: 'github/list-repos' });
    } catch (error) {
      reposError = errorMessage(error);
    } finally {
      reposLoading = false;
      await refresh();
    }
  })();
}

async function loadBranchesFor(repoFullName: string): Promise<void> {
  if (branchesRequestedFor === repoFullName) return;
  const [owner, repo] = repoFullName.split('/');
  if (owner === undefined || repo === undefined) return;
  branchesRequestedFor = repoFullName;

  try {
    branchList = await send<string[]>({ type: 'github/list-branches', payload: { owner, repo } });
    if (selectedBranch !== '' && !branchList.includes(selectedBranch)) selectedBranch = '';
  } catch (error) {
    accessError = errorMessage(error);
  }
  await refresh();
}

function repositoryStep(overview: Overview): HTMLElement {
  ensureRepositories(overview);
  const children: (Node | null)[] = [stepIndicator(2)];

  const finish = button('Finish setup', () => void finishSetup(), { variant: 'primary' });
  const syncFinishState = (): void => {
    finish.disabled = selectedRepo === null || selectedBranch === '';
  };
  syncFinishState();

  if (reposLoading) {
    children.push(loading('Loading your repositories…'));
  } else if (repoList.length === 0) {
    children.push(
      note(
        reposError ??
          'No repositories with write access were found. Create one on GitHub, or type it in below.',
        'warn',
      ),
    );
  } else {
    const repoSelect = el('select', { attrs: { 'aria-label': 'Destination repository' } });
    repoSelect.append(el('option', { text: 'Select a repository…', attrs: { value: '' } }));
    for (const repo of repoList) {
      repoSelect.append(
        el('option', {
          text: `${repo.fullName}${repo.isPrivate ? ' (private)' : ''}`,
          attrs: { value: repo.fullName },
        }),
      );
    }
    repoSelect.value = selectedRepo ?? '';
    repoSelect.addEventListener('change', () => {
      selectedRepo = repoSelect.value === '' ? null : repoSelect.value;
      selectedBranch = '';
      branchList = [];
      branchesRequestedFor = null;
      if (selectedRepo === null) {
        void refresh();
        return;
      }
      const preset = repoList.find((repo) => repo.fullName === selectedRepo)?.defaultBranch ?? '';
      if (preset !== '') selectedBranch = preset;
      void loadBranchesFor(selectedRepo);
    });
    children.push(field('Repository', repoSelect, 'Only repositories you can push to are listed.'));
  }

  if (selectedRepo !== null) {
    const branchSelect = el('select', { attrs: { 'aria-label': 'Branch' } });
    branchSelect.append(el('option', { text: 'Select a branch…', attrs: { value: '' } }));
    for (const branch of branchList) {
      branchSelect.append(el('option', { text: branch, attrs: { value: branch } }));
    }
    branchSelect.value = selectedBranch;
    branchSelect.addEventListener('change', () => {
      selectedBranch = branchSelect.value;
      syncFinishState();
    });
    children.push(
      field(
        'Branch',
        branchSelect,
        'LeetSensei only ever appends commits; it never force-pushes or rewrites history.',
      ),
    );
  }

  children.push(el('div', { className: 'ls-actions', children: [finish] }));

  if (accessError !== null) children.push(note(accessError, 'err'), privateRepoTip());
  children.push(manualEntryDetails());

  return section(
    'Choose where solutions go',
    'Step 2 of 3 · Pick the repository and branch LeetSensei should write to.',
    children,
  );
}

function manualEntryDetails(): HTMLElement {
  const ownerInput = textInput('', 'your-github-username');
  const repoInput = textInput('', 'solutions');
  const branchInput = textInput('main', 'main');

  return el('details', {
    children: [
      el('summary', { text: 'Enter a repository manually' }),
      el('div', {
        className: 'ls-stack',
        children: [
          el('div', {
            className: 'ls-field-row',
            children: [
              field('Owner', ownerInput),
              field('Repository', repoInput),
              field('Branch', branchInput),
            ],
          }),
          el('div', {
            className: 'ls-actions',
            children: [
              button(
                'Use this repository',
                () =>
                  void verifyAndSave(
                    ownerInput.value.trim(),
                    repoInput.value.trim(),
                    branchInput.value.trim() || 'main',
                  ),
                { small: true },
              ),
            ],
          }),
        ],
      }),
    ],
  });
}

function privateRepoTip(): HTMLElement {
  return el('div', {
    className: 'ls-stack',
    children: [
      el('p', {
        className: 'ls-small ls-muted',
        text: 'Is your repository private? LeetSensei starts with public-repository access only. Allow private repositories and sign in again — nothing wider is requested until you ask for it.',
      }),
      el('div', {
        className: 'ls-actions',
        children: [
          button('Allow private repositories', () => void startDevice('repo'), { small: true }),
        ],
      }),
    ],
  });
}

async function finishSetup(): Promise<void> {
  if (selectedRepo === null || selectedBranch === '') {
    accessError = 'Choose a repository and a branch first.';
    await refresh();
    return;
  }
  const [owner, repo] = selectedRepo.split('/');
  if (owner === undefined || repo === undefined) {
    accessError = 'That repository name is not valid.';
    await refresh();
    return;
  }
  await verifyAndSave(owner, repo, selectedBranch);
}

/**
 * Verifies the destination before saving it, so "Ready" always means the
 * repository is reachable, writable and the branch exists. A 404 here almost
 * always means a private repository the current token cannot see.
 */
async function verifyAndSave(owner: string, repo: string, branch: string): Promise<void> {
  accessError = null;
  try {
    const check = await send<AccessCheck>({
      type: 'github/check-access',
      payload: { owner, repo, branch },
    });
    if (!check.canPush) {
      accessError = `LeetSensei can read ${owner}/${repo} but cannot write to it. Choose a repository you can push to.`;
    } else if (!check.branchExists) {
      accessError = `The branch "${branch}" does not exist in ${owner}/${repo}. Pick an existing branch.`;
    } else {
      await send({
        type: 'settings/save',
        payload: { repoOwner: owner, repoName: repo, branch },
      });
      accessCheck = check;
      selectedRepo = `${owner}/${repo}`;
      selectedBranch = branch;
    }
  } catch (error) {
    accessError = errorMessage(error);
  }
  await refresh();
}

function readyStep(overview: Overview): HTMLElement {
  const destination = overview.repo;
  const children: (Node | null)[] = [
    stepIndicator(3),
    note(
      destination === null
        ? 'Ready.'
        : `Ready. Accepted solutions will be saved to ${destination.owner}/${destination.repo} on branch ${destination.branch}.`,
      'ok',
    ),
  ];

  if (accessCheck !== null) {
    children.push(
      el('div', {
        className: 'ls-row ls-row--wrap',
        children: [
          badge('repository reachable', 'ok'),
          accessCheck.canPush ? badge('write access', 'ok') : badge('no write access', 'err'),
          accessCheck.branchExists ? badge('branch found', 'ok') : badge('branch missing', 'err'),
        ],
      }),
    );
  }

  children.push(
    el('div', {
      className: 'ls-actions',
      children: [
        button('Open dashboard', () => openPage('dashboard'), { variant: 'primary' }),
        button('Solve a problem on LeetCode', () =>
          window.open('https://leetcode.com/problemset/', '_blank', 'noopener'),
        ),
      ],
    }),
  );

  if (accessError !== null) children.push(note(accessError, 'err'), privateRepoTip());

  children.push(
    el('div', {
      className: 'ls-actions',
      children: [
        button(
          'Verify again',
          () => {
            if (destination === null) return;
            void verifyAndSave(destination.owner, destination.repo, destination.branch);
          },
          { small: true },
        ),
        button('Disconnect', () => void disconnect(), { small: true, variant: 'danger' }),
      ],
    }),
  );

  return section(
    'Ready',
    'Step 3 of 3 · LeetSensei is watching LeetCode for Accepted submissions.',
    children,
  );
}

function statusCard(overview: Overview): HTMLElement {
  return el('section', {
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
}

function advancedSettings(overview: Overview): HTMLElement {
  return el('details', {
    className: 'ls-card',
    children: [
      el('summary', { text: 'Advanced settings' }),
      el('div', {
        className: 'ls-stack',
        children: [
          accountSection(overview),
          repositorySection(overview),
          syncSection(overview),
          revisionSection(overview),
          dataSection(overview),
          diagnosticsSection(),
          privacySection(),
        ],
      }),
    ],
  });
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
            el('div', {
              className: 'ls-brand-info',
              children: [
                el('div', {
                  className: 'ls-brand-title',
                  children: [
                    el('span', { text: 'LeetSensei' }),
                    el('span', {
                      className: 'ls-tag-badge',
                      text: '設定',
                      attrs: { 'aria-hidden': 'true' },
                    }),
                  ],
                }),
                el('div', {
                  className: 'ls-brand-sub',
                  text: `Shadow Ronin · settings · v${overview.version}`,
                }),
              ],
            }),
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

  app.append(setupCard(overview));

  const banner = conflictBanner(pending);
  if (banner !== null) app.append(banner);

  if (overview.setup === 'ready') app.append(statusCard(overview));

  app.append(advancedSettings(overview));
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
