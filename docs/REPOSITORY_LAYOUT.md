# Proposed Source Tree

This is a plan. Source files will be introduced when the extension foundation is implemented.

```text
LeetSensei/
├── src/
│   ├── background/       # sync coordinator and service worker
│   ├── content/          # browser content entry points
│   ├── adapters/
│   │   └── leetcode/     # Accepted detection and source extraction
│   ├── core/
│   │   ├── normalize/    # canonical submission schema
│   │   ├── planner/      # tag mapping and file plan
│   │   ├── conflicts/    # remote/local conflict decisions
│   │   └── revision/     # review schedule
│   ├── github/           # authorization/API adapter
│   ├── storage/          # versioned state and migrations
│   ├── popup/
│   ├── dashboard/
│   └── options/
├── tests/
│   ├── unit/
│   ├── fixtures/
│   └── integration/
├── docs/
├── README.md
├── ROADMAP.md
├── CONTRIBUTING.md
└── LICENSE
```

The build framework, browser manifest and test tooling will be selected in Phase 1. Avoid creating empty placeholder folders without a real module or test.
