# oh-my-t3code contributor guide

If your user asks you to evaluate, install, or use omt, follow [docs/agents/quickstart.md](docs/agents/quickstart.md) and stop reading here. The rest of this file is for agents that change omt.

`omt` is a TypeScript CLI plus a set of skills for T3 Code. In a clone, Bun runs the TypeScript sources directly. Users install the npm bundle or the release binary, never a clone.

## Setup

Clone the repository, then run `mise install` (it installs the Bun version that `mise.toml` pins) and `bun install`. Then run `bun run verify` to check the setup.

## Contract

`docs/spec.md` is the contract for the code, the skills, and the tests. Read the section for your module before you change it. When the code and the spec disagree, fix one of them in the same change. `docs/design.md` explains why each part exists.

To change the landing page in `site/`, read [site/AGENTS.md](site/AGENTS.md) first. The site is a separate package with its own commands and tests.

## Commands

Run each command through `mise exec --` (or in a shell where mise is active), so that the Bun version that `mise.toml` pins runs.

| Command | Use |
| --- | --- |
| `bun install` | Install the dev dependencies. |
| `bun run verify` | Type-check and run all tests. Run it before you report done. |
| `bun test` | Run the tests (files `test/**/*.test.ts`). |
| `bun run typecheck` | Run `scripts/tsrs.sh -p tsconfig.json`. It runs the native binary of `tsrs`, the Rust port of the TypeScript 7 compiler. |
| `bun run schema` | Write `schema/omt.schema.json` from `src/config/schema.ts`. |
| `bun run defaults:edit` | Edit the built-in defaults (`src/config/defaults.jsonc`) and the skill files (`skills/`) in the config editor. It saves to this clone. Run `bun run verify` after you save. |
| `bun src/cli.ts <command>` | Run the CLI from source. |

## TypeScript rules

- Use ESM and erasable syntax only: no `enum`, no `namespace`, no parameter properties, no decorators.
- Use `import type` for type-only imports. End relative imports with `.ts`.
- `tsconfig.json` sets `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, and `erasableSyntaxOnly`, and `tsrs` enforces them.
- Format with 2-space indentation, double quotes, semicolons, and trailing commas in multi-line literals.
- Write a comment only for a reason that the code cannot show.
- Import shared types from `src/types.ts`. Throw `OmtError` from `src/util/errors.ts` for expected failures. Use exit code 2 for usage errors.
- Write files atomically with the helpers in `src/util/fs.ts`.

## Dependencies

- Runtime dependencies: none.
- `src/` uses only `node:` built-in modules, because the npm bundle runs on Node. Scripts in `scripts/` and tests may use Bun APIs.
- The dev dependencies are `@types/bun` and `tsrs`. `tsrs` is pinned to an exact version, because each release is a development build. It has native builds for macOS arm64 and Linux only.
- Build scripts may download Bun cross-compile runtimes. The CLI sends no telemetry. It contacts the npm registry only when you run `omt update`, or once a day in `omt install` and `omt doctor` after you set `update` in the user config. `omt update` runs the package manager or mise command of the channel that installed omt.

## Tests

- Put tests in `test/<module>.test.ts`. `bun test` runs them. Use `bun:test` and `node:assert/strict`.
- Tests never read or write the real home directory. Use the temp-directory helper and `fakeContext()` from `test/helpers.ts`, and pass `env` and `homedir` explicitly.
- A test that runs the CLI as a child process sets `HOME`, `TMPDIR`, and the `OMT_*`, `XDG_*`, `CLAUDE_*`, and `T3CODE_*` variables to temp paths.
