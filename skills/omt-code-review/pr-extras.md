# PR review extras

Run each extra whose switch is not `off`, at the PR step it names, in the PR checkout when it runs code. Save files under `omt paths --evidence`, and put each result in the PR step 5 report.

## CI (`review.ci`)

At PR step 1, read `gh pr checks <n> --json name,state,bucket,link,workflow`, and save the last 400 lines of `gh run view --job <job-id> --log-failed` per failing check as `ci-<slug>-<check>.log`. With `review.ci: fix`, fix each failure after PR step 4, run its local command again, and send the round's CI fixes to one fix review, up to `maxReviewRounds`.

Never wait with `--watch`: when checks are pending at PR step 5, call `watch_pull_request` last, and `unwatch_pull_request` when the review ends.

## Coverage and CRAP (`review.crap: report`)

Before PR step 3, run the coverage command once as `omt lock run coverage -- <command>`, with lcov output to `coverage-<slug>.lcov`. Each reviewer computes `CRAP = complexity² × (1 − coverage)³ + complexity` per added or changed function, with McCabe complexity, and coverage 0 without a coverage file. Report each function above 30 as P2, with its three values.

## Changed-flow QA (`review.verify: changed-flows`)

At PR step 3, when the PR changes a screen, a CLI command, or an API route, dispatch one `qa` child with the changed flows, the build and run commands, and the changed paths. It changes no files and names the test file that covers each flow, or `none`. Each `NOT VERIFIED` flow becomes a P1 finding.

## Test offers (`review.tests: offer`)

At PR step 6, offer one e2e test per verified flow that no test covers, with its file path. After the owner's yes, write the tests yourself in the main thread, and dispatch one `qa` child with `mode: "wait"` to run them. Send the tests through one fix review before the commit.

## Guardrails (`review.guardrails: propose`)

After PR step 4 and the CI fixes, dispatch one read-only `guardrail` child with `mode: "wait"`, the merged findings, the CI failures, the rule-file list, and `.omt/guardrails.md`. Per finding, it proposes a `check`, a `rule-fix`, or a `new-rule`, or gives a reason for none. Append each new proposal to `.omt/guardrails.md` as `- [ ] G<k> <date> PR #<n> <class>: <proposal>. Where: <file>. Proof: <command or none>.`
