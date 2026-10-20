# Security and Privacy

## Data principles

- No telemetry, analytics or behavioral tracking.
- Keep activity local except data needed for explicit sync and backup to the user's selected GitHub repository.
- Never request a LeetCode password.
- Never embed a personal access token, private key or confidential OAuth client secret in the public extension bundle.
- Request the minimum permissions required and explain what is uploaded before enabling sync.

## GitHub authorization

Choose a supported authorization flow designed for a public browser extension. Confidential client secrets must not be shipped in extension code. If an authorization exchange service is unavoidable, limit it to that exchange; it must not receive solution submissions or revision activity and must not run analytics.

Do not log tokens or write them to URLs, repository files or crash reports. Provide disconnect and local credential-clear controls.

## Repository writes

- Write only to the repository and branch selected by the user.
- Never silently overwrite existing or manually edited files.
- Make retries idempotent and reconcile remote state when the outcome is uncertain.
- Track only LeetSensei-managed paths in the manifest.
- Never automatically delete files when tags are removed.

## Vulnerability reports

Do not publish exploitable details or secrets in a public issue. Contact the maintainer privately through a channel listed on the maintainer's GitHub profile.

## Known risks

LeetCode may change its page structure; source extraction might not work for every language or flow. GitHub authorization, browser permissions and store-policy compatibility require review before release.
