# Architecture Overview

This is the proposed architecture, not a claim that modules are implemented.

```text
LeetCode page
  -> LeetCode adapter
  -> Accepted-submission validator
  -> canonical normalizer + source hash
  -> local state / manifest
  -> tag/category and file-change planner
  -> conflict checker -> user decision if needed
  -> GitHub adapter -> selected repository + branch
  -> sync result + manifest update

Dashboard <-> Revision engine <-> Local storage
                    |
                    +------> GitHub backup
```

## Module boundaries

- **Adapter:** understands LeetCode page/submission behavior, not GitHub writes.
- **Normalizer:** validates input and creates a deterministic record without network writes.
- **Planner:** emits a deterministic list of intended file changes.
- **Conflict checker:** compares intended content against manifest and remote state.
- **GitHub adapter:** owns authorization and repository file/commit operations.
- **Revision engine:** schedules reviews without depending on page DOM.
- **UI:** displays status/settings/conflicts and cannot bypass the coordinator.

Keep modules behind interfaces so website markup or browser APIs can change without rewriting the full application.
