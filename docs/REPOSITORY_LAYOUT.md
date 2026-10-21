# Source Tree

**Status: implemented.** Every directory listed here contains real code or real tests; there
are no placeholder files.

```text
LeetSensei/
├── .github/workflows/ci.yml    # format, lint, typecheck, test, build
├── docs/                       # architecture, TDD, security, testing, troubleshooting
├── icons/                      # generated PNG icons (16/32/48/128)
├── scripts/
│   ├── build.mjs               # esbuild bundling + manifest for both browsers
│   └── generate-icons.mjs      # dependency-free PNG encoder
├── src/
│   ├── adapters/leetcode/
│   │   ├── detect.ts           # pure page-signal helpers (verdict text, slug, ids)
│   │   ├── graphql.ts          # the three queries + same-origin transport
│   │   ├── index.ts            # live observer wired to the DOM
│   │   └── parse.ts            # payload parsing + raw submission assembly
│   ├── background/
│   │   ├── coordinator.ts      # serialised sync/revision/restore orchestration
│   │   ├── index.ts            # service worker: message router, badge, alarms
│   │   └── overview.ts         # read-only views for the UI
│   ├── content/index.ts        # content script entry (leetcode.com/problems/*)
│   ├── core/
│   │   ├── conflicts.ts        # three-way conflict classification
│   │   ├── language.ts         # LeetCode language id -> file extension
│   │   ├── manifest.ts         # manifest schema, validation, migration, upsert
│   │   ├── model.ts            # canonical types
│   │   ├── normalize.ts        # the Accepted-only gate
│   │   ├── paths.ts            # path building + traversal safety + versioning
│   │   ├── pipeline.ts         # prepareSync / completeSync
│   │   ├── plan.ts             # two-phase planner, README/solution rendering
│   │   ├── readme.ts           # README template + merge of user sections
│   │   ├── resolve.ts          # replace / save-version / cancel
│   │   ├── revisions.ts        # revision schema, validation, applyReview
│   │   ├── schedule.ts         # interval ladder + due bucketing
│   │   ├── slug.ts             # 0217-contains-duplicate naming
│   │   └── tags.ts             # Hash Table -> Hash-Table
│   ├── github/
│   │   ├── auth.ts             # device flow, token verification
│   │   ├── client.ts           # REST client: retry, backoff, rate limits
│   │   ├── commit.ts           # grouped commit + verification
│   │   ├── sync.ts             # remote tree read + plan push
│   │   └── types.ts            # GithubClient interface (fake-able)
│   ├── manifest/build-manifest.ts  # shared by the build script and its tests
│   ├── options/                # options page (html/css/ts)
│   ├── popup/                  # popup (html/css/ts)
│   ├── dashboard/              # dashboard (html/css/ts)
│   ├── shared/                 # browser API shim, errors, hashing, logging, validation
│   ├── storage/                # storage area, settings, typed state repository
│   ├── ui/                     # DOM helpers, message client, shared theme
│   └── config.ts               # build-time defines (version, client id, browser)
├── tests/
│   ├── helpers.ts              # fixtures/factories
│   ├── fake-github.ts          # in-memory GitHub client
│   ├── setup.ts                # silences expected-failure logging
│   ├── unit/*.test.ts          # 15 files
│   └── integration/*.test.ts   # 4 files (GitHub client, auth, commit, coordinator)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
├── README.md
├── ROADMAP.md
├── CONTRIBUTING.md
├── CHANGELOG.md
└── LICENSE
```

## Naming conventions

- `core/*` is pure: no DOM, no network, no storage. That is what makes it unit testable.
- `github/*` and `adapters/*` own all I/O and are bound to interfaces (`GithubClient`,
  `LeetCodeRequestOptions`) so they can be faked.
- `*.test.ts` files mirror the module they cover, in the same order.
- Tests never touch the network. `tests/fake-github.ts` is the only remote substitute.

## What is deliberately absent

- No `fixtures/` directory of captured HTML: the only DOM dependency is a text predicate,
  so sanitised inline fixtures are clearer than large HTML dumps.
- No browser end-to-end test harness yet; see
  [TESTING.md](TESTING.md#what-is-not-covered) for the reasoning and the manual procedure.
- No framework, no CSS preprocessor, no runtime dependency.
