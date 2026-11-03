# Config editor design

The implemented page follows [Config Final in Paper](https://app.paper.design/file/01M5CWMSCW0Z7GS4EXR3DXRB8D/p-V-0). This replaces the earlier Ledger, Stack, Inspector, and Revision 2 layouts. The API contract is in [the spec](../spec.md#51-omt-config). The settings and skill sources define the behavior when a design example differs.

## Layout

A compact header holds Show values for, Saved default, Edit file, the unsaved count, and Review changes. Show values for says "view only", because it changes no run. The left navigation contains Skills, Roles, Profiles, and Settings. Skills lists all 10 bundled skills: the four with a flow (Build, Code review, Plan, and Design) first, then Research, Grill, Swarm, Help, Setup, and Router (`omt`). The status bar reports the connection, config issues, and unsaved changes per file.

Every skill page starts with the name, the command, the description from the skill's front matter, and its child roles as links. A flow skill has two tabs: Flow and settings, and Instructions. A skill without a flow shows only the instructions. The instructions are the installed `SKILL.md`, rendered as read-only text, with a note that `omt update` replaces the file. Users can read the instructions, but cannot edit them, because an edit would conflict with the next update.

Skills opens on Build. Each flow has a column of stages with distinct markers for Main, Child, Owner, and conditional steps. Selecting a stage opens its controls beside the diagram. On a narrow window, the controls move below the flow and selection scrolls them into view. Values and loop conditions read the same pending changes as Settings.

Roles shows descriptions, a Used by line, and ordered model chips. Used by links each flow that has the role in a stage, and names the other skills that start it. A role opens in a focused page. The chain uses first-choice and fallback cards. Reorder arrows and drag preserve the configured card identity. Role permissions, runtime mode, and result fields are secondary details. Provider, Model, and Effort are dropdowns. With T3 capabilities, they list the T3 providers, their models, and the effort levels of the selected model, and Fast On is disabled for a model with no fast mode. Without capabilities, they list the detected harnesses and the models that the config names. Other model… switches the field to text for a model that the list does not hold. Each card names its status: Available in T3, Not in T3, Model not in T3, or Unverified. Raw options and an explicit driver remain available on each card.

Profiles answers three questions for each profile: when to use it (the description), what it changes (the values that it sets, with the parent value), and how to use it. The usage box names the T3 composer flag `--profile <name>` for one run, Make default for every run, and `omt plan profile <slug> <name>` for a running plan. The focused profile editor repeats the usage box. Its Values matrix shows only the values that the profile changes, and Show all values shows every key. New role and profile forms are separate pages.

Settings holds only the values that no other page edits. Harnesses comes first, with one checkbox per driver and the detection result beside it. Then limits and model options use four aligned columns: Key, Value, Description, and Source. A line names where the other values are: workflow switches on the Skills pages, models and permissions on Roles, and the saved default in the header. Narrow windows disclose descriptions through source help and adapt the columns.

A source badge opens a compact nonmodal panel. It contains the setting's help, saved layer history, current unsaved preview, exact destination, scope control, and Reset to inherited. There is no D/U/P/F strip, legend, or permanent source inspector.

## Visual system

| Role | Dark | Light |
| --- | --- | --- |
| Background | `#0A0A0A` | `#FFFFFF` |
| Panel | `#111111` | `#F6F6F6` |
| Primary text | `#FFFFFF` | `#0A0A0A` |
| Muted text | `#8A8A8A` | `#666666` |
| Border | `#191919` | `#E6E6E6` |
| Purple | `#AB7DF8` | `#8250DF` |
| Text on purple | `#0A0A0A` | `#FFFFFF` |
| Success | `#3FB950` | `#1A7F37` |
| Error | `#F85149` | `#D1242F` |
| Draft | `#9198A1` | `#59636E` |
| Warning | `#D29922` | `#D29922` |

These tokens come from the Paper palette. Selected value segments use purple at 16% opacity. Selected flow cards use purple at 10% opacity with a solid purple border. File and scope selections use solid purple. Warning and diff backgrounds use their state color at 10% opacity. All tints derive from the tokens.

The page follows the system color scheme. Body text uses the system sans font, as in Config Final. Keys, paths, models, and technical values use Overpass Mono with a system mono fallback. The page downloads no fonts or other external assets.

Primary headings are 22px. Body text and controls are 14px. Help and metadata are 13px. The header is at least 64px high. The navigation is 208px wide on a wide screen. The stage panel is 400px wide. Every page, focused editors too, keeps the navigation and uses the same 32px content inset, so the left edge does not move between pages. A focused editor has a bar with the back link, Docs, and Close, then a small kind label (Role or Profile), the name, and the description on its own line. Editor sections start at the title's edge, with no extra inner inset. Controls have 6px corners, and panels have 8px corners. Flow markers use a 24px lane. The settings in each stage card use the same key and value column widths, so they line up down the flow. Settings rows are at least 44px high. The controls have visible keyboard focus. Reduced-motion preferences suppress animation and smooth scrolling.

An absent optional config file is neutral. Warning icons identify validation issues or an overridden destination. Color alone does not identify actors, errors, or pending changes.

## Profile and edit semantics

Show values for reads values and writes nothing. Its loading state disables dependent edits. Failure keeps and names the last successful profile. Saved default stages a root profile key in the selected file. A command argument and a plan header can still take precedence over that default.

The page compares explain reports and pending values to find the values that differ from the saved default. Prototype changes 13 preset values against normal with the current defaults. The count comes from the data. Unchanged roles do not acquire change markers merely because the selected profile changes.

File and scope are separate. Workflow controls write only to the preview profile. Base roles, limits, and models can be overridden by profiles. A field identifies its exact destination in its stage panel or source help. Edits to normal can affect profiles that inherit its values.

Dropdowns, segments, and checkboxes stage changes immediately. Text and numeric inputs stage on Enter or change. Numeric validation keeps invalid text without staging it. A pending field names the file and path and offers Undo. Boolean overrides distinguish Inherit, On, and Off. Multi-field forms use Add changes. The page asks before leaving with dirty drafts or unsaved changes.

## Skill flows

Build shows exploration, owner decisions, LIGHT or HEAVY planning, a requested Design pass, unit builds, review and fixes, QA and fixes, and Git actions. A required oracle replaces the review child. Review off still permits that oracle. Every-round returns fixes to review up to maxReviewRounds. First-round runs no second review. BLOCK returns to planning or the owner. Open findings go to the owner.

QA follows review. It always runs checks and device flows. The build.qa setting controls the approved test list, not whether QA exists. Main fixes failed checks. QA reruns only the failed checks, at most twice.

Code review shows sizing, reviewer groups, merged findings, the conditional oracle, pull request checks, the report, and the owner decision. Auto sizing uses one, two, three, or four groups below 200, 1,000, 3,000, or otherwise changed lines. A numeric count replaces auto sizing. Small changes with both families use two reviewers and no oracle. Other small changes can use one oracle instead of a reviewer. Large changes can add an oracle after the groups. Reviewers report; Main fixes after the owner agrees.

Plan shows exploration, questions, the plan file, at most two review rounds, and owner approval. The two-families setting means one child from the other driver family. Design shows variants per screen, presentation, owner feedback until approval, and a design spec. It has no automatic model review stage.

## Model attempts

Cards show configured order. A cross-family role can preview attempt order for a selected main driver. The preview keeps configured rung numbers. Without capabilities, availability stays Unverified. A driver excluded by harnesses is marked separately.

The first eligible target runs; later eligible targets are fallbacks. Provider, model, or option refusals can advance. A driver-only provider refusal has one retry. Mode and capability denials stop. A skill that requires another family stops when only the same family remains.

Fast inheritance checks the rung, role, model, then off. Explicit Off stops inheritance. Raw options apply last. Changing a chain replaces the entire inherited array.

## Review and failure states

Review changes shows a JSONC diff and validation for one file. The write action names that file. Success removes only the written edits. The other file keeps its queue and hash base. New errors block the write; warnings do not.

A changed-file conflict offers Reload and review. This keeps pending edits, reads the newer file, and requires a new diff before the write. Discard asks before removing one file's changes. Dirty form input remains subject to the stale-draft check.

A missing file is unavailable as a destination. File help supplies its path and init command. A malformed file stays unavailable until fixed. Invalid profile inheritance shows the failure or the available base values. A failed preview retains the previous report. A skill whose instructions do not load shows the error in place of the text. A disconnected page keeps pending changes and becomes read-only.

## Maintainer mode

Maintainers edit the built-in defaults and the skill instructions in the same page, with `bun run defaults:edit` in an omt clone. It is a repository script and not a CLI command, because a user install has no clone to save to and `omt update` replaces the installed skills. The edits reach users through a pull request and a release: the defaults through the existing review in `omt doctor` and `omt update`, and the skills through the skills sync.

The defaults live in `src/config/defaults.jsonc` instead of TypeScript, so that the page can save them with the same comment-keeping edits as a user config. The page loads the file on an empty base, so the values shown are the values of the file, and Reset to inherited removes a key. A save that leaves the defaults incomplete is a new error, with the check that an accepted defaults snapshot passes.

The header names the defaults file and the label maintainer in place of the file picker. Each skill page shows the files of the skill side by side: the file list, the text, and the rendered result, so that a maintainer sees the effect of each change as they type. The list holds `SKILL.md` and the Markdown files under `references/`; the Router skill holds the shared references and the role instructions. A role page links to its instructions file. Save writes one file and checks that nobody changed it since the page loaded it.
