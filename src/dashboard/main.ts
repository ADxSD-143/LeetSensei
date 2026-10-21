import type { Overview, ProblemSummary, RevisionRow } from '../background/overview';
import type { ReviewRating } from '../core/model';
import type { DueState } from '../core/schedule';
import type { RevisionStore } from '../core/revisions';
import type { PendingJob } from '../storage/repository';
import { RANKS, XP_BY_RATING } from '../core/progress';
import { errorMessage, openPage, send } from '../ui/api';
import { readOverviewResponse } from '../ui/overview-guard';
import {
  applyTheme,
  badge,
  button,
  clear,
  el,
  externalLink,
  formatDate,
  formatDateTime,
  note,
  qs,
  toDateInputValue,
  type Tone,
} from '../ui/dom';

/**
 * Dashboard: the quest board.
 *
 * Everything is driven by real state from `data/overview` — problems, review
 * history, conflicts and sync status. Rank and XP are derived from the recorded
 * review events (`overview.progress`), never stored separately, so they can
 * never drift from the data. All text is set as text content.
 */

type TabId = 'problems' | 'reviews' | 'conflicts' | 'history';

interface Filters {
  query: string;
  tag: string;
  language: string;
  due: 'all' | 'due' | 'overdue' | 'upcoming' | 'incomplete';
}

const header = qs<HTMLElement>('#header');
const app = qs<HTMLElement>('#app');

// A restored scroll position would hide the hero on open, so this page always
// starts at the top.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

const filters: Filters = { query: '', tag: '', language: '', due: 'all' };
let activeTab: TabId = 'problems';
let hasRevealed = false;
let lastRenderedTab: TabId | null = null;
let flash: { text: string; tone: NoteTone } | null = null;

/** Tones a note can carry; 'neutral' is for badges only. */
type NoteTone = Exclude<Tone, 'neutral'>;

/** Confirmation shown once, after the next render. */
function setFlash(text: string, tone: NoteTone = 'ok'): void {
  flash = { text, tone };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Ink-mist loading state. */
function loadingState(): HTMLElement {
  return el('div', {
    className: 'ls-loading',
    attrs: { role: 'status' },
    children: [
      el('div', {
        className: 'ls-mist',
        attrs: { 'aria-hidden': 'true' },
        children: [el('span'), el('span'), el('span')],
      }),
      el('span', { text: 'Reading the journal…' }),
    ],
  });
}

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

const TAB_META: Record<TabId, { kanji: string; label: string }> = {
  problems: { kanji: '課題', label: 'Quests' },
  reviews: { kanji: '鍛錬', label: 'Objectives' },
  conflicts: { kanji: '差分', label: 'Disputes' },
  history: { kanji: '記録', label: 'Journal' },
};

const DIFFICULTY_SEAL: Record<string, string> = {
  Easy: 'ls-seal--easy',
  Medium: 'ls-seal--medium',
  Hard: 'ls-seal--hard',
};

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function finePointer(): boolean {
  return window.matchMedia('(pointer: fine)').matches;
}

function phaseTone(phase: Overview['status']['phase']): Tone {
  if (phase === 'failed') return 'err';
  if (phase === 'done') return 'ok';
  if (phase === 'awaiting-decision') return 'warn';
  return 'info';
}

function greetingFor(now: Date): { kanji: string; text: string } {
  const hour = now.getHours();
  if (hour < 5) return { kanji: '深夜', text: 'Late night' };
  if (hour < 12) return { kanji: '朝', text: 'Good morning' };
  if (hour < 17) return { kanji: '昼', text: 'Good afternoon' };
  if (hour < 21) return { kanji: '夕', text: 'Good evening' };
  return { kanji: '夜', text: 'Night falls' };
}

/** Clamps a 0..1 ratio for use as a CSS custom property. */
function ratioValue(ratio: number): string {
  return String(Math.max(0, Math.min(1, ratio)));
}

function difficultySeal(difficulty: string): HTMLElement {
  return el('span', {
    className: `ls-seal ${DIFFICULTY_SEAL[difficulty] ?? 'ls-seal--unknown'}`,
    text: difficulty,
  });
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

// ------------------------------------------------------------------- header

function renderHeader(overview: Overview): void {
  clear(header);

  header.append(
    el('div', {
      className: 'ls-header',
      children: [
        el('div', {
          className: 'ls-brand',
          children: [
            el('img', {
              className: hasRevealed ? '' : 'ls-mark-draw',
              attrs: { src: 'icons/icon-48.png', alt: '' },
            }),
            el('div', {
              className: 'ls-brand-info',
              children: [
                el('div', {
                  className: 'ls-brand-title',
                  children: [
                    el('span', { text: 'LeetSensei' }),
                    el('span', {
                      className: hasRevealed ? 'ls-tag-badge' : 'ls-tag-badge ls-seal-pop',
                      text: '先生',
                      attrs: { 'aria-hidden': 'true' },
                    }),
                  ],
                }),
                el('div', {
                  className: 'ls-brand-sub',
                  text: `Shadow Ronin · revision dojo · v${overview.version}`,
                }),
              ],
            }),
          ],
        }),
        el('div', {
          className: 'ls-actions',
          children: [
            button('Options', () => openPage('options'), { small: true }),
            button(
              'Retry sync',
              () =>
                void run(async () => {
                  await send({ type: 'sync/retry' });
                  setFlash('Sync requested', 'info');
                }),
              { small: true },
            ),
          ],
        }),
      ],
    }),
  );
}

// --------------------------------------------------------------------- hero

function heroArt(): HTMLElement {
  const layer = (file: string, modifier: string): HTMLElement =>
    el('img', {
      className: `ls-hero__layer ${modifier}`,
      attrs: { src: `art/${file}`, alt: '', 'aria-hidden': 'true', decoding: 'async' },
    });

  // DOM order is paint order: texture, moon, ridges, mid-fog, temple, ronin, fore-fog.
  return el('div', {
    className: 'ls-hero__art',
    attrs: { 'aria-hidden': 'true' },
    children: [
      layer('ink-texture.svg', 'ls-hero__layer--texture'),
      layer('hero-moon.svg', 'ls-hero__layer--moon'),
      layer('hero-ridges.svg', 'ls-hero__layer--ridges'),
      layer('hero-fog.svg', 'ls-hero__layer--fog-mid'),
      layer('hero-temple.svg', 'ls-hero__layer--temple'),
      layer('hero-ronin.svg', 'ls-hero__layer--ronin'),
      layer('hero-fog.svg', 'ls-hero__layer--fog-fore'),
    ],
  });
}

/** Sparse drifting motes. Pure CSS, and hidden when motion is reduced. */
function motesLayer(): HTMLElement {
  return el('div', {
    className: 'ls-hero__motes',
    attrs: { 'aria-hidden': 'true' },
    children: [el('span'), el('span'), el('span'), el('span'), el('span'), el('span')],
  });
}

function hero(overview: Overview): HTMLElement {
  const now = new Date();
  const greeting = greetingFor(now);
  const dueNow = overview.schedule.overdue + overview.schedule.dueToday;
  const focus = overview.revisions[0] ?? null;
  const needsSetup = overview.setup !== 'ready';

  const summary = needsSetup
    ? 'Connect GitHub and choose where solutions should go to open the dojo.'
    : dueNow > 0
      ? `${dueNow} technique${dueNow === 1 ? '' : 's'} await attention${focus ? ` · next up: ${focus.title}` : ''}.`
      : 'Nothing is due right now. Solve a new problem to feed the journal.';

  const primary = needsSetup
    ? button('Finish setup', () => openPage('options'), { variant: 'primary' })
    : button('Begin today’s training', () => selectTab('reviews'), { variant: 'primary' });

  const secondary = needsSetup
    ? button('Open options', () => openPage('options'))
    : button('Open quest board', () => selectTab('problems'));

  return el('section', {
    className: 'ls-hero ls-reveal',
    attrs: { 'aria-label': 'Today' },
    children: [
      heroArt(),
      motesLayer(),
      el('div', { className: 'ls-hero__moonlight', attrs: { 'aria-hidden': 'true' } }),
      el('div', {
        className: 'ls-hero__glint',
        attrs: { 'aria-hidden': 'true' },
        children: [el('div', { className: 'ls-hero__glint-shimmer' })],
      }),
      el('div', {
        className: 'ls-hero__content',
        children: [
          el('div', {
            className: 'ls-hero__eyebrow',
            children: [
              el('span', { text: greeting.kanji, attrs: { 'aria-hidden': 'true' } }),
              el('span', { text: 'Shadow Ronin' }),
            ],
          }),
          el('h1', { className: 'ls-hero__title', text: `${greeting.text}, ronin.` }),
          el('p', {
            className: 'ls-hero__meta',
            children: [
              el('span', {
                children: [
                  el('strong', {
                    text: now.toLocaleDateString(undefined, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    }),
                  }),
                ],
              }),
              el('span', {
                children: [
                  el('strong', { text: String(overview.problems.length) }),
                  el('span', { text: ' quests' }),
                ],
              }),
              el('span', {
                children: [
                  el('strong', { text: `${overview.progress.streakDays}d` }),
                  el('span', { text: ' streak' }),
                ],
              }),
              badge(overview.status.phase, phaseTone(overview.status.phase)),
            ],
          }),
          el('p', { className: 'ls-hero__summary', text: summary }),
          el('div', { className: 'ls-hero__cta', children: [primary, secondary] }),
        ],
      }),
    ],
  });
}

function rankModal(currentRank: string): HTMLElement {
  const overlay = el('div', {
    className: 'ls-modal-overlay',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rank System' },
  });

  const closeBtn = el('button', {
    className: 'ls-modal__close',
    text: '✕',
    attrs: { type: 'button', 'aria-label': 'Close rank system info' },
  });

  const dismiss = (): void => overlay.remove();
  closeBtn.addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });

  const rankRows = RANKS.map((r, i) => {
    const isCurrent = r.name.toLowerCase() === currentRank.toLowerCase();
    const nextRank = RANKS[i + 1];
    const thresholdText = nextRank
      ? `${r.minXp} – ${nextRank.minXp - 1} XP`
      : `${r.minXp}+ XP (Mastery)`;

    return el('div', {
      className: `ls-rank-ladder__row${isCurrent ? ' ls-rank-ladder__row--active' : ''}`,
      children: [
        el('div', {
          className: 'ls-rank-ladder__badge-col',
          children: [
            el('span', { className: 'ls-rank-ladder__level', text: `Lv.${i + 1}` }),
            el('strong', { className: 'ls-rank-ladder__name', text: r.name }),
            isCurrent
              ? el('span', { className: 'ls-tag-badge', text: '現在 Current' })
              : el('span'),
          ],
        }),
        el('div', { className: 'ls-rank-ladder__xp', text: thresholdText }),
      ],
    });
  });

  const modalBox = el('div', {
    className: 'ls-modal ls-stack',
    children: [
      el('div', {
        className: 'ls-modal__header',
        children: [
          el('div', {
            children: [
              el('span', { className: 'ls-modal__sub', text: '階級道場 · RANK SYSTEM' }),
              el('h2', { className: 'ls-modal__title', text: 'Dojo Ranks & Progression' }),
            ],
          }),
          closeBtn,
        ],
      }),
      el('div', {
        className: 'ls-modal__body ls-stack',
        children: [
          el('p', {
            className: 'ls-small ls-muted',
            text: 'XP is earned by recording spaced-repetition reviews in your local study journal. Progression is deterministic, local, and recomputed directly from your review history.',
          }),
          el('div', {
            className: 'ls-xp-rates',
            children: [
              el('div', { className: 'ls-xp-pill', text: '易 Easy Review: +5 XP' }),
              el('div', { className: 'ls-xp-pill', text: '難 Hard Review: +3 XP' }),
              el('div', { className: 'ls-xp-pill', text: '再 Again: +1 XP' }),
            ],
          }),
          el('div', {
            className: 'ls-rank-ladder',
            children: rankRows,
          }),
        ],
      }),
    ],
  });

  overlay.append(modalBox);
  return overlay;
}

function showRankModal(currentRank: string): void {
  const modal = rankModal(currentRank);
  document.body.append(modal);
}

// ------------------------------------------------------------- status panel

function statusPanel(overview: Overview): HTMLElement {
  const progress = overview.progress;
  const dueNow = overview.schedule.overdue + overview.schedule.dueToday;

  const ring = el('div', {
    className: 'ls-level-ring',
    attrs: { role: 'img', 'aria-label': `Level ${progress.level}, rank ${progress.rank}` },
    children: [
      el('div', {
        className: 'ls-level-ring__inner',
        children: [
          el('span', { className: 'ls-level-ring__value', text: String(progress.level) }),
          el('span', { className: 'ls-level-ring__cap', text: 'rank' }),
        ],
      }),
    ],
  });
  ring.style.setProperty('--p', ratioValue(progress.ratio));

  const fill = el('div', { className: 'ls-meter__fill' });
  fill.style.setProperty('--p', ratioValue(progress.ratio));

  const meter = el('div', {
    className: 'ls-meter',
    attrs: {
      role: 'progressbar',
      'aria-label': 'Rank progress',
      'aria-valuemin': '0',
      'aria-valuemax': String(Math.max(1, progress.rankSpan)),
      'aria-valuenow': String(progress.rankXp),
    },
    children: [fill],
  });

  const rankLine =
    progress.nextRank === null
      ? `${progress.xp} XP · highest rank reached`
      : `${progress.rankXp} / ${progress.rankSpan} XP · ${progress.xpToNextRank} to ${progress.nextRank}`;

  const stat = (value: string, label: string): HTMLElement =>
    el('div', {
      className: 'ls-stat',
      children: [
        el('span', { className: 'ls-stat__value', text: value }),
        el('span', { className: 'ls-stat__label', text: label }),
      ],
    });

  const aboutRankBtn = el('button', {
    className: 'ls-btn ls-btn--small ls-btn--rank-info',
    attrs: { type: 'button', 'aria-haspopup': 'dialog' },
    children: [
      el('span', { className: 'ls-btn__icon', text: '⛩️', attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: 'About Rank' }),
    ],
  });
  aboutRankBtn.addEventListener('click', () => showRankModal(progress.rank));

  const syncLine = [
    overview.connected
      ? `${overview.login ?? 'GitHub'}${overview.repo ? ` · ${overview.repo.owner}/${overview.repo.repo}@${overview.repo.branch}` : ' · no repository selected'}`
      : 'Not connected to GitHub',
    `last sync ${formatDateTime(overview.lastSyncedAt)}`,
    overview.queuedSubmissions > 0 ? `${overview.queuedSubmissions} waiting to sync` : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(' · ');

  return el('section', {
    className: 'ls-card ls-reveal ls-stack',
    attrs: { 'aria-label': 'Status' },
    children: [
      el('div', {
        className: 'ls-status',
        children: [
          el('div', {
            className: 'ls-level',
            children: [
              ring,
              el('div', {
                className: 'ls-level__body',
                children: [
                  el('div', {
                    className: 'ls-row ls-row--align-center',
                    children: [
                      el('span', { className: 'ls-level__rank', text: progress.rank }),
                      aboutRankBtn,
                    ],
                  }),
                  el('span', { className: 'ls-level__next', text: rankLine }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'ls-stats',
            children: [
              stat(`${progress.streakDays}`, 'day streak'),
              stat(`${progress.reviews}`, 'reviews'),
              stat(`${overview.problems.length}`, 'quests'),
              stat(`${dueNow}`, 'due now'),
            ],
          }),
        ],
      }),
      meter,
      el('p', {
        className: 'ls-small ls-muted',
        text: `Rank is calculated from your ${progress.reviews} recorded review${progress.reviews === 1 ? '' : 's'}; nothing extra is stored.`,
      }),
      el('p', { className: 'ls-small ls-muted', text: syncLine }),
    ],
  });
}

// ---------------------------------------------------------------- quest board

function rateQuest(card: HTMLElement, problemId: string, rating: ReviewRating): void {
  // The action is dispatched immediately. The stamp is feedback, and the refresh
  // waits only long enough for it to land (skipped entirely when motion is off).
  const quiet = reducedMotion();
  card.classList.add('is-completing');
  setFlash(`${problemId} rated ${rating} · +${XP_BY_RATING[rating]} XP`);
  void run(async () => {
    await send({ type: 'revision/review', payload: { problemId, rating } });
    if (!quiet) await delay(240);
  });
}

function questCard(problem: ProblemSummary): HTMLElement {
  const dueState = problem.dueState;
  const modifier =
    dueState === 'overdue'
      ? ' ls-quest--overdue'
      : dueState === 'due-today'
        ? ' ls-quest--due'
        : dueState === 'upcoming'
          ? ' ls-quest--upcoming'
          : '';

  const card = el('article', { className: `ls-quest ls-paper ls-tilt${modifier}` });

  const title: HTMLElement =
    problem.url !== ''
      ? externalLink(problem.url, problem.title)
      : el('span', { text: problem.title });
  title.className = 'ls-quest__title';

  const actions: (Node | null)[] = [];
  if (dueState === 'overdue' || dueState === 'due-today') {
    for (const [rating, label, btnClass] of [
      ['again', 'Again', 'ls-btn-again'],
      ['hard', 'Hard', 'ls-btn-hard'],
      ['easy', 'Easy', 'ls-btn-easy'],
    ] as const) {
      const action = button(label, () => rateQuest(card, problem.problemId, rating), {
        small: true,
      });
      action.classList.add(btnClass);
      actions.push(action);
    }
  }
  if (problem.url !== '') {
    actions.push(
      button('Open', () => window.open(problem.url, '_blank', 'noopener'), { small: true }),
    );
  }

  card.append(
    el('div', {
      className: 'ls-quest__head',
      children: [title, difficultySeal(problem.difficulty)],
    }),
    el('div', { className: 'ls-quest__id', text: `#${problem.problemId} · ${problem.slug}` }),
    el('div', {
      className: 'ls-quest__meta',
      children: [
        dueState === null ? null : badge(DUE_LABEL[dueState], DUE_TONE[dueState]),
        problem.nextReviewAt === null
          ? null
          : el('span', { text: `next ${formatDate(problem.nextReviewAt)}` }),
        problem.officialTags.length > 0
          ? el('span', { text: problem.officialTags.slice(0, 3).join(' · ') })
          : null,
        problem.languages.length > 0 ? el('span', { text: problem.languages.join(' / ') }) : null,
        problem.metadataIncomplete ? el('span', { text: 'incomplete metadata' }) : null,
      ],
    }),
  );

  if (actions.length > 0) {
    card.append(el('div', { className: 'ls-quest__actions', children: actions }));
  }

  return card;
}

function emptyQuestBoard(): HTMLElement {
  return el('div', {
    className: 'ls-empty-art',
    children: [
      el('img', { attrs: { src: 'art/logo-emblem.svg', alt: '' } }),
      el('h3', { text: 'No quests recorded' }),
      el('p', {
        text: 'Solve a problem on LeetCode and get it Accepted. LeetSensei files it under every official topic and adds it here for revision.',
      }),
      el('div', {
        className: 'ls-actions',
        children: [
          button(
            'Browse LeetCode',
            () => window.open('https://leetcode.com/problemset/', '_blank', 'noopener'),
            { small: true, variant: 'primary' },
          ),
        ],
      }),
    ],
  });
}

function noResults(): HTMLElement {
  const active = [
    filters.query.trim() === '' ? '' : `“${filters.query.trim()}”`,
    filters.tag,
    filters.language,
    filters.due === 'all' ? '' : filters.due,
  ].filter((entry) => entry !== '');

  return el('div', {
    className: 'ls-empty-art',
    children: [
      el('h3', { text: 'No quests match' }),
      el('p', {
        text:
          active.length === 0
            ? 'No quests match the current filters.'
            : `Filters: ${active.join(' · ')}. Widen them to see more.`,
      }),
      el('div', {
        className: 'ls-actions',
        children: [
          button(
            'Clear filters',
            () => {
              filters.query = '';
              filters.tag = '';
              filters.language = '';
              filters.due = 'all';
              void refresh();
            },
            { small: true },
          ),
        ],
      }),
    ],
  });
}

function questBoard(overview: Overview): HTMLElement {
  if (overview.problems.length === 0) return emptyQuestBoard();
  const problems = filteredProblems(overview);
  if (problems.length === 0) return noResults();
  return el('div', {
    className: 'ls-quests',
    children: problems.map((problem) => questCard(problem)),
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

// ----------------------------------------------------------------- objectives

function reviewRow(row: RevisionRow): HTMLElement {
  const actions = el('div', { className: 'ls-review-actions' });
  for (const [rating, label, btnClass] of [
    ['again', 'Again', 'ls-btn-again'],
    ['hard', 'Hard', 'ls-btn-hard'],
    ['easy', 'Easy', 'ls-btn-easy'],
  ] as const) {
    const btn = button(
      label,
      () => {
        const quiet = reducedMotion();
        btn.closest('li')?.classList.add('is-completing');
        setFlash(`${row.title} rated ${rating} · +${XP_BY_RATING[rating]} XP`);
        void run(async () => {
          await send({ type: 'revision/review', payload: { problemId: row.problemId, rating } });
          if (!quiet) await delay(240);
        });
      },
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
    'Set date',
    () =>
      void run(async () => {
        if (dateInput.value === '') return;
        const iso = new Date(`${dateInput.value}T09:00:00`).toISOString();
        await send({
          type: 'revision/set-next',
          payload: { problemId: row.problemId, nextReviewAt: iso },
        });
        setFlash(`${row.title} scheduled for ${dateInput.value}`);
      }),
    { small: true },
  );

  const controls: (Node | null)[] = [dateInput, setDate];
  if (row.url !== '') {
    controls.push(
      button('Open', () => window.open(row.url, '_blank', 'noopener'), { small: true }),
    );
  }

  return el('li', {
    children: [
      el('div', {
        className: 'ls-objective',
        children: [
          el('div', {
            className: 'ls-objective__body',
            children: [
              el('span', { className: 'ls-objective__title', text: row.title }),
              el('span', {
                className: 'ls-small ls-muted',
                text: `#${row.problemId} · ${row.currentIntervalDays}d interval · ${row.reviewCount} review(s)${row.lastRating ? ` · last: ${row.lastRating}` : ''}`,
              }),
              el('span', {
                className: 'ls-small ls-muted',
                text: `Next ${formatDate(row.nextReviewAt)}${row.lastReviewedAt ? ` · last reviewed ${formatDate(row.lastReviewedAt)}` : ''}`,
              }),
            ],
          }),
          badge(DUE_LABEL[row.dueState], DUE_TONE[row.dueState]),
        ],
      }),
      actions,
      el('div', { className: 'ls-actions', children: controls }),
    ],
  });
}

function reviewQueue(overview: Overview): HTMLElement {
  if (overview.revisions.length === 0) {
    return el('div', {
      className: 'ls-empty-art',
      children: [
        el('h3', { text: 'No training scheduled' }),
        el('p', {
          text: 'Solved problems are scheduled for review one day after they sync. Nothing is due yet.',
        }),
      ],
    });
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
          el('h3', { text: `${group.title} · ${group.rows.length}` }),
          group.rows.length === 0
            ? el('div', { className: 'ls-small ls-muted', text: 'Nothing here.' })
            : el('ul', {
                className: 'ls-list ls-paper-tokens',
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

// ------------------------------------------------------------------ disputes

function conflictsPanel(pending: PendingJob | null): HTMLElement {
  if (pending === null || pending.conflicts.length === 0) {
    return el('div', {
      className: 'ls-empty-art',
      children: [
        el('h3', { text: 'No disputes' }),
        el('p', {
          text: 'LeetSensei never overwrites a file you edited. If a destination file changes, the choice appears here.',
        }),
      ],
    });
  }

  const list = el('ul', { className: 'ls-list ls-paper-tokens' });
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
              setFlash(
                decision === 'replace'
                  ? `Replaced ${conflict.path}`
                  : decision === 'save-version'
                    ? `Saved ${conflict.path} as a dated version`
                    : `Skipped ${conflict.path}`,
                decision === 'cancel' ? 'warn' : 'ok',
              );
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

// ------------------------------------------------------------------- journal

function journalPanel(revisions: RevisionStore, overview: Overview): HTMLElement {
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
    return el('div', {
      className: 'ls-empty-art',
      children: [
        el('h3', { text: 'The journal is empty' }),
        el('p', {
          text: 'Every review you record is written here with the interval it moved to. Rate a problem to start it.',
        }),
      ],
    });
  }
  events.sort((left, right) => (left.at > right.at ? -1 : 1));

  return el('div', {
    className: 'ls-journal ls-paper',
    children: events.slice(0, 200).map((event) =>
      el('div', {
        className: 'ls-journal__row',
        children: [
          el('span', { className: 'ls-journal__when', text: formatDateTime(event.at) }),
          el('span', {
            className: 'ls-journal__title',
            text: titles.get(event.problemId) ?? event.problemId,
          }),
          badge(
            event.rating,
            event.rating === 'easy' ? 'ok' : event.rating === 'again' ? 'err' : 'warn',
          ),
          el('span', {
            className: 'ls-journal__delta',
            text: `${event.before}d → ${event.after}d`,
          }),
        ],
      }),
    ),
  });
}

// -------------------------------------------------------------------- motion

function wireHeroMotion(section: HTMLElement): void {
  if (reducedMotion()) return;

  let height = section.getBoundingClientRect().height || 1;
  let pointerX = 0;
  let pointerY = 0;

  window.addEventListener('resize', () => {
    height = section.getBoundingClientRect().height || 1;
  });

  const write = (): void => {
    // Depth from scroll position, so the scene has depth even when the pointer
    // is still, and on touch devices where there is no hover at all.
    const drift = Math.max(-1, Math.min(1, (window.scrollY / height) * 1.6));
    section.style.setProperty('--px', pointerX.toFixed(3));
    section.style.setProperty('--py', (pointerY + drift).toFixed(3));
  };

  // Written straight from the scroll event: no animation-frame dependency, so it
  // responds immediately and cannot be dropped when frames are not being produced.
  window.addEventListener('scroll', write, { passive: true });
  write();

  // Pointer parallax is a bonus on devices that actually have a hovering pointer,
  // and it is high frequency, so that part is batched to one write per frame.
  if (finePointer()) {
    let frame = 0;
    const schedule = (): void => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          write();
        });
      }
    };

    section.addEventListener('pointermove', (event) => {
      const rect = section.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      schedule();
    });

    section.addEventListener('pointerleave', () => {
      pointerX = 0;
      pointerY = 0;
      schedule();
    });
  }
}

function wireTilt(cards: readonly HTMLElement[]): void {
  if (reducedMotion() || !finePointer()) return;

  for (const card of cards) {
    let frame = 0;
    let tiltX = 0;
    let tiltY = 0;

    const apply = (): void => {
      frame = 0;
      card.style.setProperty('--tilt-x', tiltX.toFixed(2));
      card.style.setProperty('--tilt-y', tiltY.toFixed(2));
    };

    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(apply);
    };

    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      tiltX = -((event.clientY - rect.top) / rect.height - 0.5) * 5;
      tiltY = ((event.clientX - rect.left) / rect.width - 0.5) * 5;
      schedule();
    });

    card.addEventListener('pointerleave', () => {
      tiltX = 0;
      tiltY = 0;
      schedule();
    });
  }
}

// ---------------------------------------------------------------- composition

function selectTab(id: TabId): void {
  activeTab = id;
  void refresh();
}

function tabButton(id: TabId, count?: number): HTMLButtonElement {
  const meta = TAB_META[id];
  const countText = count === undefined ? '' : ` (${count})`;
  const node = el('button', {
    className: 'ls-tab',
    attrs: {
      type: 'button',
      role: 'tab',
      'aria-selected': String(activeTab === id),
      'aria-controls': 'ls-panel',
      id: `ls-tab-${id}`,
    },
    children: [
      el('span', {
        className: 'ls-tab-kanji',
        text: meta.kanji,
        attrs: { 'aria-hidden': 'true' },
      }),
      el('span', { text: `${meta.label}${countText}` }),
    ],
  });
  node.addEventListener('click', () => {
    activeTab = id;
    void refresh();
  });
  return node;
}

function render(
  overview: Overview,
  pending: PendingJob | null,
  revisions: RevisionStore,
  staleProducer = false,
): void {
  applyTheme(overview.settings.theme);
  renderHeader(overview);
  clear(app);
  app.setAttribute('aria-busy', 'false');

  const heroSection = hero(overview);
  const status = statusPanel(overview);

  const tabs = el('div', {
    className: 'ls-tabs ls-reveal',
    attrs: { role: 'tablist', 'aria-label': 'Dashboard sections' },
    children: [
      tabButton('problems', overview.problems.length),
      tabButton('reviews', overview.schedule.overdue + overview.schedule.dueToday),
      tabButton('conflicts', pending?.conflicts.length ?? 0),
      tabButton('history'),
    ],
  });

  const tabChanged = lastRenderedTab !== null && lastRenderedTab !== activeTab;
  const panel = el('section', {
    className: `ls-card ls-stack ls-reveal${tabChanged ? ' ls-panel-enter' : ''}`,
    attrs: {
      role: 'tabpanel',
      id: 'ls-panel',
      'aria-labelledby': `ls-tab-${activeTab}`,
    },
  });

  const flashNote = flash;
  flash = null;
  if (flashNote !== null) {
    panel.append(
      el('div', { className: 'ls-flash', children: [note(flashNote.text, flashNote.tone)] }),
    );
  }

  if (activeTab === 'problems') {
    panel.append(filtersBar(overview), questBoard(overview));
  } else if (activeTab === 'reviews') {
    panel.append(reviewQueue(overview));
  } else if (activeTab === 'conflicts') {
    panel.append(conflictsPanel(pending));
  } else {
    panel.append(journalPanel(revisions, overview));
  }
  lastRenderedTab = activeTab;

  const orphanNote =
    overview.orphans.length > 0
      ? note(
          `${overview.orphans.length} problem(s) exist in only one of the manifest or the revision store. This is normal after a partial restore; the repository backup can reconcile them.`,
          'warn',
        )
      : null;

  const staleNote = staleProducer
    ? note(
        'This dashboard is newer than the running extension background, so rank, XP and streak were recomputed from your local review history. Reload LeetSensei in the extensions page to finish updating.',
        'warn',
      )
    : null;

  app.append(heroSection, status);
  if (orphanNote !== null) app.append(orphanNote);
  if (staleNote !== null) app.append(staleNote);
  app.append(tabs, panel);

  wireHeroMotion(heroSection);
  wireTilt([...panel.querySelectorAll<HTMLElement>('.ls-quest')]);

  // One entrance per session: switching tabs must not replay the reveal.
  if (hasRevealed) {
    app.dataset.entered = 'true';
  } else {
    hasRevealed = true;
    // Guarantees the hero is on screen the moment the dashboard opens.
    window.scrollTo(0, 0);
    window.requestAnimationFrame(() => {
      app.dataset.entered = 'true';
    });
  }
}

async function refresh(): Promise<void> {
  app.setAttribute('aria-busy', 'true');
  if (app.childElementCount === 0) app.append(loadingState());
  try {
    const response = await send<unknown>({ type: 'data/overview' });
    const guarded = readOverviewResponse(response, new Date());
    render(guarded.overview, guarded.pending, guarded.revisions, guarded.recoveredProgress);
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
