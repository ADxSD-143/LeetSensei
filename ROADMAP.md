# LeetSensei Roadmap

LeetSensei is in the specification/scaffold stage. There is no working extension yet.

## Phase 0 — Specification and repository setup

- [x] Public GitHub repository created
- [x] MIT license selected
- [ ] Finish architecture, security, installation and contribution docs

## Phase 1 — Extension foundation

- [ ] Select TypeScript/build tooling and browser manifest strategy
- [ ] Build popup, dashboard, options page and background/service worker
- [ ] Add linting, formatting and automated tests
- [ ] Establish a shared Chrome/Brave/Firefox codebase

## Phase 2 — LeetCode adapter (highest technical risk)

- [ ] Validate reliable Accepted detection against current LeetCode behavior
- [ ] Extract source code, problem ID, title, difficulty, official tags and language
- [ ] Add sanitized fixtures and adapter tests
- [ ] Show a clear error when source extraction is unsupported

## Phase 3 — Solution organization

- [ ] Normalize submissions into a canonical record
- [ ] Map official tags to stable folder names
- [ ] Generate per-problem README and source files
- [ ] Add each problem to every applicable topic category
- [ ] Maintain a manifest of managed files

## Phase 4 — GitHub sync

- [ ] Choose a secure authorization flow suitable for a public extension
- [ ] Let the user select an existing repository and branch
- [ ] Detect conflicts and never silently overwrite user edits
- [ ] Group related file changes into a single commit where feasible
- [ ] Make retries idempotent and reconcile uncertain outcomes

## Phase 5 — Revision tracker

- [ ] Dashboard for due/upcoming revisions
- [ ] Configurable starting intervals: 1, 3, 7, 14 and 30 days
- [ ] Self-assessment (Easy, Hard, Again) adjusts intervals
- [ ] Local primary storage and GitHub backup after changes
- [ ] Restore and validate backup after reinstall/device migration

## Phase 6 — Cross-browser QA and release

- [ ] Unit and browser integration tests
- [ ] Exercise offline, retry, duplicate event, conflicts and partial-write cases
- [ ] Complete privacy and permissions review
- [ ] Document browser-specific installation and release process
- [ ] Submit packages to browser stores where supported

## MVP acceptance criteria

1. Only Accepted submissions are eligible for sync.
2. Retrying the same submission does not duplicate managed files.
3. All applicable official tag categories are represented.
4. Existing or manually edited remote files are never silently overwritten.
5. Sync errors are visible and retryable.
6. Revision state can be restored from repository backup.
7. No telemetry or analytics is sent.
8. Tests cover normalization, conflict handling, retries and revision logic.

## Out of scope for MVP

- AI-generated explanations
- Automatic LeetCode resubmission
- Hosted accounts
- Usage analytics
