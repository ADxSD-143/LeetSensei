# Contributing

Thanks for considering a contribution. LeetSensei is a working, tested MVP; the most
valuable contributions right now are bug reports from real browser sessions and small,
well-tested fixes.

## Before starting

1. Read [README.md](README.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
   [docs/SECURITY.md](docs/SECURITY.md).
2. Search existing issues and pull requests first.
3. Discuss a substantial change (new dependency, new permission, new network destination,
   architectural change) in an issue before implementing it.

## Development setup

```bash
git clone https://github.com/ADxSD-143/LeetSensei.git
cd LeetSensei
npm ci --include=dev      # --include=dev matters when NODE_ENV=production is set
npm run verify            # format check + lint + typecheck + tests + build
```

Other useful commands:

```bash
npm run format            # prettier --write
npm run lint              # eslint
npm run typecheck         # tsc --noEmit
npm test                  # vitest run
npm run test:watch
npm run build -- --watch  # rebuild on change
```

Load `dist/chrome` or `dist/firefox` in your browser to try a change. See
[docs/INSTALLATION.md](docs/INSTALLATION.md).

## Non-negotiable rules

These protect users, and a pull request that breaks one will not be merged:

1. **Only Accepted submissions may be uploaded.** The gate is in `src/core/normalize.ts`;
   do not add another path around it.
2. **Never overwrite or delete a user's file silently.** Every planned write goes through
   `core/conflicts.ts`. Deletion is not implemented on purpose.
3. **Never rewrite branch history.** `force` must never be sent on a ref update.
4. **No telemetry, analytics, or new network destinations** without an explicit project
   decision recorded in [docs/SECURITY.md](docs/SECURITY.md).
5. **No secrets in the bundle, the logs, the tests or the repository.** The OAuth device flow
   exists precisely because a public extension cannot hold a client secret.
6. **Never claim a result that was not verified.** An unconfirmed write is reported as
   unconfirmed.
7. **No false success messages, and no fabricated data in fixtures.** Fixtures must be
   sanitised, shaped like the real payload, and clearly synthetic.

## Code expectations

- **Strict TypeScript.** No `any`, no non-null assertions, no unchecked index access. The
  project enables `noUncheckedIndexedAccess` and `verbatimModuleSyntax`; `npm run typecheck`
  is the gate.
- **No new runtime dependencies.** The extension ships zero. Dev dependencies are fine when
  they earn their place, but explain why in the pull request.
- **Keep `core/` pure.** No DOM, no network, no storage in `src/core/*`. That purity is what
  makes the logic testable; I/O belongs in `src/github/*` and `src/adapters/*`.
- **Respect the module boundaries** in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In
  particular, only `background/coordinator.ts` mutates state, and the UI only talks to the
  background through `src/shared/messages.ts`.
- **Render with `textContent`.** Never build HTML from page or API data.
- **Comments explain _why_, not _what_.** The existing code is commented in that style.
- Formatting and linting are automated: run `npm run format` before committing.

## Tests

Every behaviour change needs a test, and every bug fix needs a regression test that fails
before the fix.

- Unit tests live in `tests/unit/*.test.ts` and mirror the module they cover.
- Integration tests live in `tests/integration/*.test.ts` and use
  `tests/fake-github.ts`. **Never point a test at a real repository, and never require
  network access.** CI has no credentials and must not need any.
- `tests/fake-github.ts` is expected to model GitHub's real constraints: content-addressed
  blobs, fast-forward-only ref updates, immutable trees. If you need a new failure mode, add
  a knob to the fake rather than weakening a test.

State what you ran in the pull request, and what the result was. If you could not run
something (for example a real browser), say so.

## Adding a LeetCode language

One line in the `LANGUAGE_TABLE` in `src/core/language.ts`, plus a case in
`tests/unit/language.test.ts` if the alias behaviour is interesting. Use the exact language
id LeetCode reports.

## Reporting a LeetCode page change

If detection stops working, include:

- the popup's status message (it names the failure),
- the problem URL,
- your browser and version,
- whether the submission was Accepted.

The API-based extraction is validated by live queries; only the verdict trigger depends on
page markup, so a page change usually means one predicate in
`src/adapters/leetcode/detect.ts`.

## Pull requests

Include: what changed and why, how it was tested, the commands you ran, and links to relevant
issues. Add screenshots for UI changes. Call out any compatibility, permission, migration or
security implication explicitly.

## Security issues

Do not open a public issue. Follow [docs/SECURITY.md](docs/SECURITY.md#reporting-a-vulnerability).
