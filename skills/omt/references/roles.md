# Roles

A role names a kind of work. The config maps each role to a chain of targets (provider, model, effort), and `omt brief` picks the first that can run. Plans name roles, never models.

| Role | Access | Result | Choose it for |
| --- | --- | --- | --- |
| `explore` | read-only | research | One narrow question about this repository, answered with `path:line` citations. |
| `research` | read-only | research | A question that needs docs, the web, or other repositories. |
| `plan-review` | read-only | review | Checking a plan for gaps before any unit runs. Cross-family. |
| `execute` | edit | work | One large planned unit with a disjoint scope, built as an independent track. |
| `review` | edit | review | One review round of a diff. Fixes local findings when it may edit, and reports the rest. Cross-family. |
| `oracle` | edit | review | The final gate over the whole change, from the other family. Cross-family. |
| `qa` | edit | test | Running the given checks and device flows. Edits nothing and writes no tests. |
| `guardrail` | read-only | guardrail | Turning review findings into checks and rule fixes. Edits nothing. |
| `writing` | edit | work | One docs unit as an independent track. |
| `design` | edit | work | Design variants and the design spec ([omt-design](../../omt-design/SKILL.md)). |
| `ui` | edit | work | One UI unit, from its design spec or the task requirements. |

Read-only roles run in `plan` interaction mode, and edit roles in `default`. Every default role inherits your runtime mode. The persona of each role is `roles/<role>.md`, and the result block of each kind is `results/<kind>.md`.

## Commands

- `omt roles` prints every role with its target, access, and mode.
- `omt route <role> --json` prints the payload fields and the fallbacks of one role.
- `omt brief <role> ... --json` resolves the role and renders the brief in one step ([delegation.md](delegation.md#dispatching-a-child)).
- `--capabilities <file>` checks the targets against a saved `orchestrator_capabilities` result.

## Cross-family roles

`plan-review`, `review`, and `oracle` review from the family other than the worker's. The family of a target is its driver, such as `claudeAgent` or `codex`. `--against <provider|driver>` names the worker, and `--against auto` reads it from the ledger of `--plan`. The CLI then tries the other family's targets first. With `--strict`, it exits 1 instead of falling back to the worker's family.

## Main thread or child

A role whose first target has your own model is work that you can do yourself. `omt-design` and `omt-ulw` use this for `design` and `ui`: when `omt route <role> --json` shows your model as `delegateTask.target.model`, you draw or build yourself; otherwise one routed child does it.

## Custom roles

A config can add or override a role, set `fast` for a model, a role, or a target, and give a role its own persona file `$(omt paths --omt)/roles/<role>.md`. `omt-setup` makes these changes with the owner.
