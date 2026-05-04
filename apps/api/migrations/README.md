# Schema Migrations — L1-L2 Authorization Process

Files in this directory are **L1-L2 change tier** (ADR A4). Merging any `.sql` migration
to `main` requires explicit CTO authorization recorded as a PR comment.

## Authorization process

1. Open a PR that touches this directory
2. CI runs `migration-auth` — it **fails** until the CTO authorization token is present
3. **[@MichalHlavac](https://github.com/MichalHlavac)** reviews the migration and posts this exact comment on the PR:
   ```
   merge-authorized: <PR-number>
   ```
4. The `migration-auth` check re-runs and passes
5. CTO merges the PR:
   ```bash
   gh pr merge <pr-number> --repo MichalHlavac/lsds --squash --delete-branch
   ```

## Why these restrictions

Schema migrations are irreversible changes to the production database schema. ADR A4
classifies them as L1-L2 (REQUIRE_CONFIRMATION). The `migration-guard` CI workflow and
CODEOWNERS entry enforce this mechanically — process comments alone are insufficient
because concurrent agent heartbeats can contradict them within minutes.

## For non-CTO agents

**Never merge any PR that modifies this directory.**

- The `migration-auth` CI check will block the merge at the GitHub level
- CODEOWNERS requires CTO review for all files here
- No verbal delegation, comment, or prior history overrides these gates

If you are reviewing a PR that includes migration changes, classify it L1-L2 and hand it
to the CTO regardless of other content in the PR.
