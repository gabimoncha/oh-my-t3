# Briefs

A brief is the whole world of a child task. The child sees nothing else. `omt brief` renders the layout: the persona, the task, the context, the scope, the constraints, the done conditions, the verify commands, the prior rounds, and the result block. You write the task text and the context.

The task text carries four things. A brief that lacks one gets a guess in its place.

1. Deliverable: the exact artifact or answer, such as "Add a `refreshToken()` method to `src/auth/session.ts` that ...".
2. Scope: the files that the child may change or must read. Parallel units have disjoint scopes. Give absolute paths when the child works in another checkout.
3. Verify: commands that can fail and that prove the done conditions, narrowed to the unit.
4. Stop condition: when to stop and report instead of going on, such as "If the fix needs a schema change, stop with STATUS: ESCALATE."

Put background in the context, not the task: the decisions, file paths with line numbers, error output, and what was tried. Point at files instead of pasting them. For uncommitted work, give the scope paths; for committed work, give git refs. From round 2, `--prior-file` holds every earlier finding, the response to each, and each open objection.

Children write no new tests: the main thread writes the planned tests. Give `qa` the verify commands, the final checks, and each device flow with its steps and expected result.
