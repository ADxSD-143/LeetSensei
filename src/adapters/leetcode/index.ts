import type { RawSubmission } from '../../core/model';
import { toLeetSenseiError } from '../../shared/errors';
import { createLogger } from '../../shared/logger';
import {
  RESULT_NODE_SELECTORS,
  extractTitleSlug,
  isSubmitControl,
  pickResultVerdict,
  type TextCarrier,
} from './detect';
import {
  fetchQuestion,
  fetchSubmissionDetails,
  fetchSubmissionList,
  readCsrfToken,
  type LeetCodeRequestOptions,
} from './graphql';
import { assembleRawSubmission, pickUnprocessedSubmission, type LeetCodeQuestion } from './parse';

/**
 * Live LeetCode adapter (content script side).
 *
 * Detection strategy, in order of reliability:
 *  1. A submit control is clicked, or a verdict node appears.
 *  2. LeetCode's own `submissionList` query is polled for the current problem.
 *  3. The newest unprocessed entry must report "Accepted" - otherwise nothing
 *     leaves the browser.
 *  4. `submissionDetails` supplies the source code and language.
 *  5. `question` supplies the authoritative id, title, difficulty and tags.
 *
 * Only step 1 depends on page markup; steps 2-5 use LeetCode's stable API, so a
 * class-name change cannot silently break extraction.
 */

const logger = createLogger('leetcode');

const DEFAULT_SCAN_DELAY_MS = 500;
const POLL_INTERVAL_MS = 1500;
const POLL_DURATION_MS = 45_000;
const URL_CHECK_INTERVAL_MS = 1000;
const MAX_REMEMBERED_SUBMISSIONS = 300;

export interface AcceptedSubmissionEvent {
  raw: RawSubmission;
  titleSlug: string;
  submissionId: string;
}

/** The subset of `Document` the adapter needs, so it can be faked in tests. */
export interface PageRoot extends ParentNode {
  addEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
}

export interface AdapterOptions {
  isEnabled: () => boolean;
  onAccepted: (event: AcceptedSubmissionEvent) => void;
  onDiagnostic?: (message: string) => void;
  request?: LeetCodeRequestOptions;
  scanDelayMs?: number;
  /** Test seams; default to the real page globals. */
  root?: PageRoot;
  observeTarget?: Node;
  location?: { pathname: string };
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
}

export interface AdapterHandle {
  stop(): void;
  /** Runs one detection pass immediately. Exposed for diagnostics and tests. */
  scan(): Promise<void>;
}

export function collectResultNodes(root: ParentNode): TextCarrier[] {
  const nodes: TextCarrier[] = [];
  for (const selector of RESULT_NODE_SELECTORS) {
    let matches: Element[];
    try {
      matches = [...root.querySelectorAll(selector)];
    } catch {
      continue;
    }
    for (const element of matches) nodes.push({ textContent: element.textContent });
  }
  return nodes;
}

export function startLeetCodeAdapter(options: AdapterOptions): AdapterHandle {
  const root = options.root ?? document;
  const scope = options.location ?? window.location;
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  const setIntervalImpl = options.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;
  const scanDelayMs = options.scanDelayMs ?? DEFAULT_SCAN_DELAY_MS;

  const requestOptions: LeetCodeRequestOptions = { ...options.request };
  const processed = new Set<string>();
  let inFlight = false;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollDeadline = 0;
  let lastPathname = scope.pathname;
  let stopped = false;

  const diagnostic = (message: string): void => {
    logger.info(message);
    options.onDiagnostic?.(message);
  };

  const remember = (submissionId: string): void => {
    processed.add(submissionId);
    if (processed.size > MAX_REMEMBERED_SUBMISSIONS) {
      const oldest = processed.values().next();
      if (!oldest.done) processed.delete(oldest.value);
    }
  };

  const scheduleScan = (delay = scanDelayMs): void => {
    if (stopped) return;
    if (scanTimer !== null) clearTimeoutImpl(scanTimer);
    scanTimer = setTimeoutImpl(() => {
      scanTimer = null;
      void scan();
    }, delay);
  };

  const stopPolling = (): void => {
    if (pollTimer !== null) {
      clearIntervalImpl(pollTimer);
      pollTimer = null;
    }
    pollDeadline = 0;
  };

  /** Polls after a submit until a verdict appears or the window elapses. */
  const startPolling = (): void => {
    if (stopped || pollTimer !== null) return;
    pollDeadline = Date.now() + POLL_DURATION_MS;
    pollTimer = setIntervalImpl(() => {
      if (Date.now() > pollDeadline) {
        stopPolling();
        return;
      }
      void scan();
    }, POLL_INTERVAL_MS);
  };

  const safeFetchQuestion = async (titleSlug: string): Promise<LeetCodeQuestion | null> => {
    try {
      return await fetchQuestion(titleSlug, requestOptions);
    } catch (error) {
      diagnostic(
        `Problem details could not be read (${toLeetSenseiError(error).message}). The submission will be reported as incomplete metadata.`,
      );
      return null;
    }
  };

  const runScan = async (): Promise<void> => {
    const verdict = pickResultVerdict(collectResultNodes(root));
    if (verdict !== 'accepted') {
      // Nothing to do: this is either judging, a rejection, or no verdict yet.
      if (verdict === 'rejected') stopPolling();
      return;
    }

    const titleSlug = extractTitleSlug(scope.pathname);
    if (titleSlug === null) {
      diagnostic('A result was visible but the problem could not be identified from the URL.');
      return;
    }

    requestOptions.csrfToken = readCsrfToken(root);

    const entries = await fetchSubmissionList(titleSlug, 10, requestOptions);
    const candidate = pickUnprocessedSubmission(entries, processed);
    if (candidate === null) return;

    // The verdict panel can lag behind the list; never trust the panel alone.
    if (candidate.status.trim() !== 'Accepted') {
      remember(candidate.id);
      return;
    }

    const details = await fetchSubmissionDetails(candidate.id, requestOptions);
    if ((details.status ?? '').trim() !== 'Accepted') {
      remember(candidate.id);
      diagnostic(
        `Submission ${candidate.id} reported "${details.status ?? 'unknown'}", so it was not synced.`,
      );
      return;
    }

    const question = await safeFetchQuestion(titleSlug);
    const raw = assembleRawSubmission({
      submissionId: candidate.id,
      details,
      question,
      titleSlugFromUrl: titleSlug,
      url: `https://leetcode.com/problems/${titleSlug}/`,
    });

    remember(candidate.id);
    stopPolling();
    options.onAccepted({ raw, titleSlug, submissionId: candidate.id });
  };

  const scan = async (): Promise<void> => {
    if (stopped || inFlight) return;
    if (!options.isEnabled()) return;
    inFlight = true;
    try {
      await runScan();
    } catch (error) {
      const known = toLeetSenseiError(error, 'extraction_failed');
      diagnostic(`Submission extraction failed: ${known.message}`);
    } finally {
      inFlight = false;
    }
  };

  const handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest('button, [role="button"], a');
    if (control === null) return;
    if (!isSubmitControl(control.textContent)) return;
    startPolling();
    scheduleScan(POLL_INTERVAL_MS);
  };

  const checkUrl = (): void => {
    if (scope.pathname === lastPathname) return;
    lastPathname = scope.pathname;
    stopPolling();
    scheduleScan();
  };

  const observer = new MutationObserver(() => scheduleScan());
  const observeTarget = options.observeTarget ?? document.body;
  if (observeTarget) {
    observer.observe(observeTarget, { childList: true, subtree: true, characterData: true });
  }
  root.addEventListener('click', handleClick, true);
  const urlTimer = setIntervalImpl(checkUrl, URL_CHECK_INTERVAL_MS);

  diagnostic('LeetSensei is watching this problem page for Accepted submissions.');
  scheduleScan(0);

  return {
    scan,
    stop(): void {
      stopped = true;
      observer.disconnect();
      root.removeEventListener('click', handleClick, true);
      clearIntervalImpl(urlTimer);
      if (scanTimer !== null) clearTimeoutImpl(scanTimer);
      stopPolling();
    },
  };
}
