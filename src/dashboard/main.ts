import type { Overview, ProblemSummary, RevisionRow } from '../background/overview';
import type { ReviewRating } from '../core/model';
import type { DueState } from '../core/schedule';
import type { RevisionStore } from '../core/revisions';
import type { PendingJob } from '../storage/repository';
import { errorMessage, openPage, send } from '../ui/api';
import {
  applyTheme,
  badge,
  button,
  clear,
  el,
  emptyState,
  externalLink,
  formatDate,
  formatDateTime,
  loading,
  note,
  qs,
  toDateInputValue,
  type Tone,
} from '../ui/dom';

/**
 * Dashboard: solved problems, the revision queue, review history and the
 * conflict resolution surface. Text is always set as text content.
 */

interface OverviewResponse {
  overview: Overview;
  pending: PendingJob | null;
  revisions: RevisionStore;
}

type TabId = 'problems' | 'reviews' | 'conflicts' | 'history';

interface Filters {
  query: string;
  tag: string;
  language: string;
  due: 'all' | 'due' | 'overdue' | 'upcoming' | 'incomplete';
}

const header = qs<HTMLElement>('#header');
const app = qs<HTMLElement>('#app');

const filters: Filters = { query: '', tag: '', language: '', due: 'all' };
let activeTab: TabId = 'problems';

const DUE_TONE: Record<DueState, Tone> = {
  overdue: 'err',
  'due-today': 'warn',
  upcoming: 'neutral',
};

const DUE_LABEL: Record<DueState, string> = {
  overdue: 'Overdue',
  'due-today': 'Due today',
  upcoming: 'Upcoming',
};

function phaseTone(phase: Overview['status']['phase']): Tone {
  if (phase === 'failed') return 'err';
  if (phase === 'done') return 'ok';
  if (phase === 'awaiting-decision') return 'warn';
  return 'info';
}

function filteredProblems(overview: Overview): ProblemSummary[] {
  const query = filters.query.trim().toLowerCase();
  return overview.problems.filter((problem) => {
    if (query !== '') {
      const haystack = [problem.title, problem.slug, problem.difficulty, ...problem.officialTags]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (filters.tag !== '' && !problem.officialTags.includes(filters.tag)) return false;
    if (filters.language !== '' && !problem.languages.includes(filters.language)) return false;
    if (filters.due === 'incomplete' && !problem.metadataIncomplete) return false;
    if (
      filters.due === 'due' &&
      problem.dueState !== 'overdue' &&
      problem.dueState !== 'due-today'
    ) {
      return false;
    }
    if (filters.due === 'overdue' && problem.dueState !== 'overdue') return false;
    if (filters.due === 'upcoming' && problem.dueState !== 'upcoming') return false;
    return true;
  });
}

const TAB_KANJI: Record<TabId, string> = {
  problems: '課題',
  reviews: '鍛錬',
  conflicts: '差分',
  history: '記録',
};

function tabButton(id: TabId, label: string, count?: number): HTMLButtonElement {
  const kanji = TAB_KANJI[id];
  const countStr = count === undefined ? '' : ` (${count})`;
  const node = el('button', {
    className: 'ls-tab',
    children: [
      el('span', { className: 'ls-tab-kanji', text: kanji }),
      el('span', { text: `${label}${countStr}` }),
    ],
    attrs: { type: 'button', role: 'tab', 'aria-selected': String(activeTab === id) },
  });
  node.addEventListener('click', () => {
    activeTab = id;
    void refresh();
  });
  return node;
}

function problemTable(problems: ProblemSummary[]): HTMLElement {
  if (problems.length === 0) {
    return emptyState(
      'No problems match the current filters. Sync an Accepted submission to see it here.',
    );
  }
  const body = el('tbody');
  for (const problem of problems) {
    const titleCell = el('td');
    if (problem.url !== '') titleCell.append(externalLink(problem.url, problem.title));
    else titleCell.append(el('span', { text: problem.title }));
    titleCell.append(
      el('div', {
        className: 'ls-small ls-muted',
        text: `#${problem.problemId} · ${problem.slug}`,
      }),
    );

    body.append(
      el('tr', {
        children: [
          titleCell,
          el('td', {
            children: [
              badge(
                problem.difficulty === 'Easy'
                  ? '易 Easy'
                  : problem.difficulty === 'Hard'
                    ? '難 Hard'
                    : '中 Medium',
                problem.difficulty === 'Easy'
                  ? 'ok'
                  : problem.difficulty === 'Hard'
                    ? 'err'
                    : 'neutral',
              ),
            ],
          }),
          el('td', {
            className: 'ls-small',
            text: problem.officialTags.length > 0 ? problem.officialTags.join(', ') : '—',
          }),
          el('td', {
            className: 'ls-small',
            text: problem.languages.length > 0 ? problem.languages.join(', ') : '—',
          }),
          el('td', { className: 'ls-small', text: String(problem.categories.length) }),
          el('td', { className: 'ls-small', text: String(problem.fileCount) }),
          el('td', {
            className: 'ls-small',
            children: [
              problem.dueState === null
                ? el('span', { text: '—' })
                : badge(DUE_LABEL[problem.dueState], DUE_TONE[problem.dueState]),
              el('div', { className: 'ls-muted', text: formatDate(problem.nextReviewAt) }),
            ],
          }),
          el('td', {
            children: [
              problem.metadataIncomplete
                ? badge('incomplete metadata', 'warn')
                : badge('synced', 'ok'),
            ],
          }),
        ],
      }),
    );
  }

  return el('div', {
    className: 'ls-table-wrap',
    children: [
      el('table', {
        className: 'ls-table',
        children: [
          el('thead', {
            children: [
              el('tr', {
                children: [
                  el('th', { attrs: { scope: 'col' }, text: 'Problem' }),
                  el('th', { attrs: { scope: 'col' }, text: 'Difficulty' }),
                  el('th', { attrs: { scope: 'col' }, text: 'Topics' }),
                  el('th', { attrs: { scope: 'col' }, text: 'Languages' }),
                  el('th', { attrs: { scope: 'col' }, text: 'Categories' }),
                  el('th', { attrs: { scope: 'col' }, text: 'Files' }),
                  el('th', { attrs: { scope: 'col' }, text: 'Next review' }),
                  el('th', { attrs: { scope: 'col' }, text: 'State' }),
                ],
              }),
            ],
          }),
          body,
        ],
      }),
    ],
  });
}

function filtersBar(overview: Overview): HTMLElement {
  const search = el('input', {
    attrs: {
      type: 'search',
      placeholder: 'Search title, slug or topic',
      'aria-label': 'Search problems',
    },
  });
  search.value = filters.query;
  search.addEventListener('input', () => {
    filters.query = search.value;
    void refresh();
  });

  const tags = [...new Set(overview.problems.flatMap((problem) => problem.officialTags))].sort();
  const tagSelect = el('select', { attrs: { 'aria-label': 'Filter by topic' } });
  tagSelect.append(el('option', { text: 'All topics', attrs: { value: '' } }));
  for (const tag of tags) tagSelect.append(el('option', { text: tag, attrs: { value: tag } }));
  tagSelect.value = filters.tag;
  tagSelect.addEventListener('change', () => {
    filters.tag = tagSelect.value;
    void refresh();
  });

  const languages = [...new Set(overview.problems.flatMap((problem) => problem.languages))].sort();
  const languageSelect = el('select', { attrs: { 'aria-label': 'Filter by language' } });
  languageSelect.append(el('option', { text: 'All languages', attrs: { value: '' } }));
  for (const language of languages) {
    languageSelect.append(el('option', { text: language, attrs: { value: language } }));
  }
  languageSelect.value = filters.language;
  languageSelect.addEventListener('change', () => {
    filters.language = languageSelect.value;
    void refresh();
  });

  const dueSelect = el('select', { attrs: { 'aria-label': 'Filter by state' } });
  for (const [value, label] of [
    ['all', 'All states'],
    ['due', 'Due now'],
    ['overdue', 'Overdue'],
    ['upcoming', 'Upcoming'],
    ['incomplete', 'Incomplete metadata'],
  ] as const) {
    dueSelect.append(el('option', { text: label, attrs: { value } }));
  }
  dueSelect.value = filters.due;
  dueSelect.addEventListener('change', () => {
    filters.due = dueSelect.value as Filters['due'];
    void refresh();
  });

  return el('div', {
    className: 'ls-filters',
    children: [search, tagSelect, languageSelect, dueSelect],
  });
}

function reviewRow(row: RevisionRow): HTMLElement {
  const actions = el('div', { className: 'ls-review-actions' });
  for (const [rating, label, btnClass] of [
    ['again', '再 Again', 'ls-btn-again'],
    ['hard', '難 Hard', 'ls-btn-hard'],
    ['easy', '易 Easy', 'ls-btn-easy'],
  ] as const) {
    const btn = button(
      label,
      () =>
        void run(() =>
          send({ type: 'revision/review', payload: { problemId: row.problemId, rating } }),
        ),
      { small: true },
    );
    btn.classList.add(btnClass);
    actions.append(btn);
  }

  const dateInput = el('input', {
    attrs: { type: 'date', 'aria-label': `Next review date for ${row.title}` },
  });
  dateInput.value = toDateInputValue(row.nextReviewAt);
  const setDate = button(
    'Set',
    () =>
      void run(async () => {
        if (dateInput.value === '') return;
        const iso = new Date(`${dateInput.value}T09:00:00`).toISOString();
        await send({
          type: 'revision/set-next',
          payload: { problemId: row.problemId, nextReviewAt: iso },
        });
      }),
    { small: true },
  );

  const controls: (Node | null)[] = [dateInput, setDate];
  if (row.url !== '') {
    controls.push(
      button('Open problem', () => window.open(row.url, '_blank', 'noopener'), { small: true }),
    );
  }

  return el('li', {
    children: [
      el('div', {
        className: 'ls-row ls-row--wrap',
        children: [
          el('div', {
            children: [
              el('strong', { text: row.title }),
              el('div', {
                className: 'ls-small ls-muted',
                text: `#${row.problemId} · ${row.currentIntervalDays}d interval · ${row.reviewCount} review(s)${row.lastRating ? ` · last: ${row.lastRating}` : ''}`,
              }),
            ],
          }),
          badge(DUE_LABEL[row.dueState], DUE_TONE[row.dueState]),
        ],
      }),
      el('div', {
        className: 'ls-small ls-muted',
        text: `Next review ${formatDate(row.nextReviewAt)}${row.lastReviewedAt ? ` · last reviewed ${formatDate(row.lastReviewedAt)}` : ''}`,
      }),
      actions,
      el('div', { className: 'ls-actions', children: controls }),
    ],
  });
}

function reviewQueue(overview: Overview): HTMLElement {
  if (overview.revisions.length === 0) {
    return emptyState(
      'Nothing to revise yet. Solved problems are scheduled for review one day after they sync.',
    );
  }

  const groups: { key: DueState; title: string; rows: RevisionRow[] }[] = [
    { key: 'overdue', title: 'Overdue', rows: [] },
    { key: 'due-today', title: 'Due today', rows: [] },
    { key: 'upcoming', title: 'Upcoming', rows: [] },
  ];
  for (const row of overview.revisions) {
    const group = groups.find((entry) => entry.key === row.dueState);
    group?.rows.push(row);
  }

  const children: HTMLElement[] = [];
  for (const group of groups) {
    children.push(
      el('div', {
        className: 'ls-stack',
        children: [
          el('h3', { text: `${group.title} (${group.rows.length})` }),
          group.rows.length === 0
            ? el('div', { className: 'ls-small ls-muted', text: 'Nothing here.' })
            : el('ul', {
                className: 'ls-list',
                children: group.rows.map((row) => reviewRow(row)),
              }),
        ],
      }),
    );
  }
  children.push(
    el('div', {
      className: 'ls-actions',
      children: [
        button(
          'Back up revision state',
          () =>
            void run(async () => {
              const result = await send<{ message: string }>({ type: 'revision/backup' });
              window.alert(result.message);
            }),
          { small: true },
        ),
      ],
    }),
  );
  return el('div', { className: 'ls-stack', children });
}

function conflictsPanel(pending: PendingJob | null): HTMLElement {
  if (pending === null || pending.conflicts.length === 0) {
    return emptyState(
      'No conflicts. LeetSensei never overwrites a file you edited without asking.',
    );
  }

  const list = el('ul', { className: 'ls-list' });
  for (const conflict of pending.conflicts) {
    const actions = el('div', { className: 'ls-actions' });
    for (const [decision, label, variant] of [
      ['replace', 'Replace', 'danger'],
      ['save-version', 'Save version', undefined],
      ['cancel', 'Cancel', undefined],
    ] as const) {
      actions.append(
        button(
          label,
          () =>
            void run(async () => {
              const question =
                decision === 'replace'
                  ? `Overwrite ${conflict.path}? The repository copy is replaced by the new content.`
                  : decision === 'save-version'
                    ? `Keep the repository copy of ${conflict.path} as a dated version, then write the new content?`
                    : `Leave ${conflict.path} untouched and skip it?`;
              if (!window.confirm(question)) return;
              await send({
                type: 'sync/conflict-decision',
                payload: { path: conflict.path, decision },
              });
            }),
          { small: true, ...(variant ? { variant } : {}) },
        ),
      );
    }

    list.append(
      el('li', {
        children: [
          el('div', { className: 'ls-mono', text: conflict.path }),
          el('div', {
            className: 'ls-row ls-row--wrap',
            children: [
              badge(conflict.state, 'warn'),
              el('span', { className: 'ls-small', text: conflict.message }),
            ],
          }),
          actions,
        ],
      }),
    );
  }

  return el('div', {
    className: 'ls-stack',
    children: [
      note(
        `${pending.submission.title} has ${pending.conflicts.length} destination file(s) that differ from what LeetSensei planned to write.`,
        'warn',
      ),
      list,
    ],
  });
}

function historyPanel(revisions: RevisionStore, overview: Overview): HTMLElement {
  const titles = new Map(overview.problems.map((problem) => [problem.problemId, problem.title]));
  const events: {
    problemId: string;
    at: string;
    rating: ReviewRating;
    before: number;
    after: number;
  }[] = [];
  for (const record of Object.values(revisions.problems)) {
    for (const event of record.history) {
      events.push({
        problemId: record.problemId,
        at: event.at,
        rating: event.rating,
        before: event.intervalBeforeDays,
        after: event.intervalAfterDays,
      });
    }
  }
  if (events.length === 0) {
    return emptyState(
      'No reviews recorded yet. Rate a problem in the review queue to start the history.',
    );
  }
  events.sort((left, right) => (left.at > right.at ? -1 : 1));

  const body = el('tbody');
  for (const event of events.slice(0, 200)) {
    body.append(
      el('tr', {
        children: [
          el('td', { className: 'ls-small', text: formatDateTime(event.at) }),
          el('td', { text: titles.get(event.problemId) ?? event.problemId }),
          el('td', {
            children: [
              badge(
                event.rating,
                event.rating === 'easy' ? 'ok' : event.rating === 'again' ? 'err' : 'warn',
              ),
            ],
          }),
          el('td', {
            className: 'ls-small',
            text: `${event.before}d -> ${event.after}d`,
          }),
        ],
      }),
    );
  }

  return el('div', {
    className: 'ls-table-wrap',
    children: [
      el('table', {
        className: 'ls-table',
        children: [
          el('thead', {
            children: [
              el('tr', {
                children: [
                  el('th', { attrs: { scope: 'col' }, text: 'When' }),
                  el('th', { attrs: { scope: 'col' }, text: 'Problem' }),
                  el('th', { attrs: { scope: 'col' }, text: 'Rating' }),
                  el('th', { attrs: { scope: 'col' }, text: 'Interval' }),
                ],
              }),
            ],
          }),
          body,
        ],
      }),
    ],
  });
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
            el('img', { attrs: { src: 'icons/icon-48.png', alt: 'LeetSensei' } }),
            el('div', {
              className: 'ls-brand-info',
              children: [
                el('div', {
                  className: 'ls-brand-title',
                  children: [
                    el('span', { text: 'LeetSensei' }),
                    el('span', { className: 'ls-tag-badge', text: '先生' }),
                  ],
                }),
                el('div', {
                  className: 'ls-brand-sub',
                  text: `アルゴリズム道場 · Algorithm Dojo v${overview.version}`,
                }),
              ],
            }),
          ],
        }),
        el('div', {
          className: 'ls-actions',
          children: [
            button('Options', () => openPage('options'), { small: true }),
            button('Retry last sync', () => void run(() => send({ type: 'sync/retry' })), {
              small: true,
            }),
          ],
        }),
      ],
    }),
  );
}

function render(overview: Overview, pending: PendingJob | null, revisions: RevisionStore): void {
  applyTheme(overview.settings.theme);
  renderHeader(overview);
  clear(app);
  app.setAttribute('aria-busy', 'false');

  app.append(
    el('section', {
      className: 'ls-card ls-status-hero ls-stack',
      children: [
        el('div', {
          className: 'ls-row ls-row--wrap',
          children: [
            el('div', {
              className: 'ls-row',
              children: [
                el('span', {
                  className: `ls-dot ${overview.connected ? 'ls-dot--ok' : 'ls-dot--warn'}`,
                }),
                el('strong', {
                  text: overview.connected
                    ? `${overview.login ?? 'GitHub'} · ${overview.repo ? `${overview.repo.owner}/${overview.repo.repo}@${overview.repo.branch}` : 'no repository selected'}`
                    : '未接続 · Not connected to GitHub',
                }),
              ],
            }),
            badge(overview.status.phase, phaseTone(overview.status.phase)),
          ],
        }),
        el('p', { className: 'ls-small', text: overview.status.message }),
        el('div', {
          className: 'ls-row ls-row--wrap',
          children: [
            badge(
              `遅延 ${overview.schedule.overdue} overdue`,
              overview.schedule.overdue > 0 ? 'err' : 'neutral',
            ),
            badge(
              `本日 ${overview.schedule.dueToday} due today`,
              overview.schedule.dueToday > 0 ? 'warn' : 'neutral',
            ),
            badge(`次回 ${overview.schedule.upcoming} upcoming`),
            badge(`修練 ${overview.problems.length} problems`),
            overview.queuedSubmissions > 0
              ? badge(`待機 ${overview.queuedSubmissions} waiting to sync`, 'info')
              : null,
            el('span', {
              className: 'ls-small ls-muted',
              text: `最終同期: ${formatDateTime(overview.lastSyncedAt)}`,
            }),
          ],
        }),
        overview.orphans.length > 0
          ? note(
              `${overview.orphans.length} problem(s) exist in only one of the manifest or the revision store. This is normal after a partial restore; the repository backup can reconcile them.`,
              'warn',
            )
          : null,
      ],
    }),
  );

  const tabs = el('div', {
    className: 'ls-tabs',
    attrs: { role: 'tablist' },
    children: [
      tabButton('problems', 'Problems', overview.problems.length),
      tabButton('reviews', 'Review queue', overview.schedule.overdue + overview.schedule.dueToday),
      tabButton('conflicts', 'Conflicts', pending?.conflicts.length ?? 0),
      tabButton('history', 'History'),
    ],
  });
  app.append(tabs);

  const panel = el('section', { className: 'ls-card ls-stack', attrs: { role: 'tabpanel' } });
  if (activeTab === 'problems') {
    panel.append(filtersBar(overview), problemTable(filteredProblems(overview)));
  } else if (activeTab === 'reviews') {
    panel.append(reviewQueue(overview));
  } else if (activeTab === 'conflicts') {
    panel.append(conflictsPanel(pending));
  } else {
    panel.append(historyPanel(revisions, overview));
  }
  app.append(panel);
}

async function refresh(): Promise<void> {
  app.setAttribute('aria-busy', 'true');
  if (app.childElementCount === 0) app.append(loading('Loading local state...'));
  try {
    const response = await send<OverviewResponse>({ type: 'data/overview' });
    render(response.overview, response.pending, response.revisions);
  } catch (error) {
    clear(app);
    app.setAttribute('aria-busy', 'false');
    app.append(note(errorMessage(error), 'err'));
  }
}

async function run(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    window.alert(errorMessage(error));
  }
  await refresh();
}

void refresh();
