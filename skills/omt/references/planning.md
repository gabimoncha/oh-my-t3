# Planning

The standard for a plan file, in `omt-plan` and in a LIGHT `omt-ulw` plan. A plan is an execution spec: the main thread can build from it without a design decision.

- Read the code that the goal touches before you write a unit. Cite the files and functions that each unit changes.
- Create the file with `omt plan new <slug>` and fill every section. Keep the checkbox grammar: `- [ ] U1. <title>` at column zero.
- Write `Done when` items (D1, D2, ...) as checks that can fail: a command, a test, or an observable result. A unit that reads outside data, such as files or API responses, has a check on an input shaped like real data.
- Give every unit a role, a scope, a done condition, a verify command, and its dependencies. The role is `main` for a unit that the main thread builds, `ui` for UI, and `writing` for documentation only. Parallel units have disjoint scopes.
- Name each shared resource, such as a build folder, a simulator, or a dev-server port. Write each verify command that uses it as `omt lock run <resource> -- <command>` ([delegation.md](delegation.md#shared-builds)).
- Settle every design choice in the plan. A choice that only the owner can make goes to the owner with 2 to 4 options and your recommendation.
- `## Tests`: propose only the layers in `plan.testLayers`. Start with integration tests: real code through its production interface, with only external services faked. Add an e2e test only for a core user journey, and a unit test only for pure logic with real branching. Write each line as `- <layer> <unit>: <flow or case>. File: <path>. Reason: <the bug or regression that the test catches>.` A line in another layer needs its reason and the owner's approval. An empty section means no new tests.
- Write `## Summary` last, in at most 15 lines for the owner: what changes for them, the work, the main risk, the open decisions, and what is not in the plan. Use plain words, with no `path:line` citations.

Stop when every unit has all five fields and every done condition maps to a unit or a final check. Build no unit while you plan.
