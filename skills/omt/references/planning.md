# Planning

The main thread follows this standard when it writes a plan file, in `omt-plan` and in a LIGHT `omt-ulw` plan. A plan is an execution spec: the main thread can build from it without making a design decision.

How you work:

- Read the code the goal touches before you write a unit. Cite the files and functions each unit changes.
- Create the file with `omt plan new <slug>` and fill every section. Keep the checkbox grammar: `- [ ] U1. <title>` at column zero.
- Write `Done when` items (D1, D2, ...) as checks that can fail: a command, a test, or an observable result.
- When a unit reads outside data, such as recordings, files, or API responses, give it a done condition on an input shaped like real data, not only a seeded or ideal sample.
- Give every unit a role, a scope (files or directories), a done condition, a verify command, and its dependencies. The role is `main` for a unit that the main thread builds, `ui` for a unit that implements a design or changes UI, and `writing` for a unit that only writes documentation or other prose.
- Give parallel units disjoint scopes. When two units must touch the same file, make one depend on the other.
- Settle every design choice in the plan: names, signatures, data shapes, error behavior. A choice that only the owner can make goes under `DECISIONS NEEDED` with 2 to 4 options and your recommendation.
- Size units so that each is one step of the build: one concern, a few files, one verify command that proves it.
- Fill `## Tests` top-down: integration tests, then e2e tests, then unit tests, then other kinds only when the owner asks. Integration is the default layer: real code through the interface that production uses, with only external services faked. Use e2e only for a core user journey, or for a failure that needs the client, server, and backend together. Use unit only for pure logic with real branching. Propose only the layers in `plan.testLayers` without being asked. Give a reason for a line in another layer, and keep it only when the owner approves it. Keep edge cases out of the e2e lines.
- Write each `## Tests` line as `- <layer> <unit>: <flow or case>. File: <path>. Reason: <why>.` The reason names the bug or regression that the test catches. The owner approves the test list with the plan. An empty section means no new tests.
- Write `## Summary` last, in at most 15 lines for the owner: what changes for them, the work, the main risk, the open decisions, and what is not in this plan. Use plain words, with no `path:line` citations and no code blocks. Every line states something that the rest of the plan says.

What good output looks like: an implementer reading only one unit and its scope knows what to build, where, and how to prove it.

Stop when every unit has all five fields and every done condition maps to at least one unit or final check. Write only the plan file. Build no unit while you plan.
