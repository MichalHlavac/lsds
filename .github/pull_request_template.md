## Summary

<!-- What does this PR do and why? -->

## Changes

- 

## Testing

<!-- How was this tested? Commands run, test results, manual steps. -->

- [ ] Unit tests pass (`pnpm test`)
- [ ] Type check passes (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] License check passes (`node scripts/check-licenses.mjs`)

## Screenshots / Output

<!-- If applicable, paste relevant terminal output or screenshots. -->

## Breaking Changes

- [ ] This PR introduces breaking changes

<!-- If checked, describe what breaks and the migration path. -->

## Schema Migrations (L1-L2)

- [ ] This PR does NOT modify `apps/api/migrations/` — skip this section
- [ ] This PR modifies `apps/api/migrations/` — CTO authorization required before merge

<!-- If migration files changed: @MichalHlavac must comment "merge-authorized: <PR-number>"
     AFTER the most recent push. Any new commits (rebase, fixup) invalidate prior authorization.
     The migration-auth CI check will fail until a post-push token is present.
     See apps/api/migrations/README.md for the full process. -->
