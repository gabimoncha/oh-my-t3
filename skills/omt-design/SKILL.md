---
name: omt-design
description: Design pass in T3 Code. Use when the user asks for designs, mockups, screens, UX, or a design pass, or when an omt-plan or omt-ulw run has a requested design pass before its UI units. A main thread on Claude Opus draws the profile's variant count in a new Paper file itself; any other model sends the drawing to one routed design child. Shows the screenshots by screen, lets the owner pick one variant per screen and steer until they approve, writes a design spec that UI units cite, and can build the screens in the same thread.
---

# Design

You get designs drawn, show their screenshots to the owner, and apply the owner's words until the owner approves. Then you write the design spec. When your model is Claude Opus, you draw the designs yourself. With any other model, one routed `design` child draws them. The T3 rules are in [delegation.md](../omt/references/delegation.md). T3 tools appear by base name, and your harness may prefix them, for example `mcp__t3-code__delegate_task`.

The owner is the design review. No `review`, `oracle`, `plan-review`, or other model task looks at the design files or the screenshots.

## Steps

### 0. Check your mode

Call `t3_thread_configure` with no arguments and read your `interactionMode` and `modelSelection` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). A design pass writes files, so in `plan` mode ask the user to switch this thread to default mode.

Keep the drawer for steps 2 to 4:

- When the `modelSelection` model is a Claude Opus model, such as `claude-opus-5-5`, you draw.
- With any other model, one `design` child draws.

Then run the [branch check](../omt/references/delegation.md#branch-check).

Done when: you run in `default` mode and you know the drawer, or the user has the question.

### 1. Frame

Write down the goal, the users, the platform, the screens and flows, the constraints, and the existing brand (colors, type, logo, an app that already ships). Read the code and assets that already set the look. Ask the owner only what you cannot find, in one batch, with 2 to 4 options and your recommendation for each question.

Pick a slug that matches `^[a-z0-9][a-z0-9-]{0,63}$`. The design files go under `docs/design/<slug>/`, and the spec is `docs/design/<slug>.md`. The ledger plan is the plan slug when `omt-plan` or `omt-ulw` called this skill, and `design-<slug>` otherwise. Each design pass of a child is one unit `DS<k>`.

When the ledger plan has a plan file, run `omt profile show --plan <ledger plan> --json`. When the ledger plan has no plan file, use `omt profile show <name> --json` for an explicit profile name. When neither a plan file nor a profile name exists, run `omt profile show --json`. Keep the returned `profile` as `<name>` for later commands.

With a selected profile and no plan file for the `--plan` id:

- Pass `--profile <name>` to every `omt brief`, `omt roles`, and `omt route` command.
- Before each dispatch, run `omt ledger stats --plan <ledger plan>` and `omt profile show <name> --json`.
- Dispatch only when the ledger's `active` is below the profile's `limits.maxParallel`.
- Use this check in place of `can dispatch`.

Done when: the frame and the slug are written in your reply.

### 2. Draw the variants

Read the effective profile again with the step 1 command before each design pass. Read `workflow.design.variants` as `design.variants`. Draw `design.variants` distinct variants of each screen. When the owner asked for another count, use that count. Make a screenshot of every variant. The persona in [roles/design.md](../omt/references/roles/design.md) is the standard for both drawers. Follow [Design](../omt/references/roles.md#main-thread-or-child) to load Anthropic's `frontend-design` skill when available. Put its installed path in a child's brief so the child loads it too.

When you draw:

1. When Paper is available, load its guide and make a new Paper file named after the project. Do not reuse an open file. Without Paper, make self-contained HTML mockups or platform-native previews, by [roles/design.md](../omt/references/roles/design.md).
2. Draw one frame or mockup per variant of each screen, each with its empty, loading, and error states.
3. Export a PNG of each frame to `docs/design/<slug>/`, with a name that says the screen, the variant, and the state.
4. With Paper, call `finish_working_on_nodes` when you are done.

When a `design` child draws:

1. Before each dispatch, run `omt ledger stats --plan <ledger plan>`. When a plan file exists, dispatch only while it reports `can dispatch: yes`. Otherwise, use the step 1 dispatch check.
2. Build the brief with `omt brief design --task-file - --title "design DS<k>: <slug> variants" --scope docs/design/<slug>/ --plan <ledger plan> --unit DS<k> --round 1 --attempt 1 --json`. The task carries the frame from step 1 and the variant count. The task asks the designer to make a new Paper file named after the project when Paper is available, or to use the mockup fallback otherwise.
3. Call `delegate_task` with `mode: "wait"`. Record the dispatch with `--task-id`, `--provider`, and `--model` ([results.md](../omt/references/delegation.md#dispatching-a-child)), and wait for it in this turn ([delegation.md](../omt/references/delegation.md#waiting)). Then read the result, record it, and settle the child.

When T3 refuses a target, try the configured `design` fallbacks by [Fall back to the next rung](../omt/references/delegation.md#failure-codes). When every configured target fails, or the role is unavailable, stop and tell the owner which targets failed and why.

Done when: every variant of each screen has a screenshot under `docs/design/<slug>/`, or the owner knows why the design child cannot run.

### 3. Owner checkpoint

Check that each screenshot path exists. For a child, take the paths from `CHANGES` in its result.

Show the owner every screenshot as an image with its absolute path, for example `![Home, variant A](/abs/path/docs/design/<slug>/home-a.png)`. Group the screenshots by screen, with one line on each variant. Then ask in one batch: which variant for each screen, and what to change. The owner may mix variants across screens. End the turn and wait for the answers.

Done when: the owner has the screenshots and the question.

### 4. Steer

Apply the owner's words verbatim to the chosen variants in the same Paper file or mockup files:

- When you draw, change the frames yourself and export the screenshots again.
- When a child draws, dispatch a new `design` task for the next round `<n+1>` of the same unit, with the owner's words verbatim in the task text and every earlier round in `--prior-file`. The task names the Paper file or mockup files from the first result. Only one `design` child runs at a time.

Then go back to step 3. Repeat until the owner approves one variant for each screen.

Done when: the owner approved one variant for each screen.

### 5. Write the spec

Write `docs/design/<slug>.md` yourself, also when a child drew. Read exact values from the Paper file or mockup source, not from the screenshots. Use the spec sections in [roles/design.md](../omt/references/roles/design.md): screens, flows, components, tokens, states, the Paper file and frame names or the mockup paths, and the screenshot paths. Name the approved variant of each screen, and quote the owner's last words.

Check that each screenshot path in the spec exists. Give the owner the spec path.

Done when: `docs/design/<slug>.md` exists, its screenshot paths exist, and the owner has the path.

### 6. Hand off

Before you report, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)).

Every unit that builds or changes this UI cites `docs/design/<slug>.md` in its task and scope, and uses the `ui` role. The `qa` task of such a unit gets no `docs/design/` paths and no visual-match conditions. QA checks behavior only. The owner compares the result with the design.

When `omt-plan` or `omt-ulw` called this skill, return to it with the spec path. Otherwise give the owner the spec path and the screenshot folder, and offer to build the screens in this thread.

Done when: the caller, or the owner, has the spec path.

### 7. Build in the same thread

Run this step only when the owner asks to build the screens in this thread.

When no plan file exists for the slug, run `omt plan new <slug> --light` and fill it by the LIGHT rules of [omt-ulw](../omt-ulw/SKILL.md) step 5: one `ui` unit per screen, each citing `docs/design/<slug>.md`. Then follow [omt-ulw](../omt-ulw/SKILL.md) steps 7 to 12: build, one review child, the fix diff, one QA child that checks behavior only, failed-check fixes, and the report.

Done when: the omt-ulw step 12 report is with the owner.
