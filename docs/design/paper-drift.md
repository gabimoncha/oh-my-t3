# Paper drift fix: Marketing page

Paper file: oh-my-t3, page Marketing.
Link: https://app.paper.design/file/01M5CWMSCW0Z7GS4EXR3DXRB8D/p-O-0

This change applies the owner's Scrawl feedback (capture `scrawl-1793446722505-387-7`, marks #1 to #12). It corrects the approved design. It keeps the layout, palette, type, and monogram.

## Source-of-truth policy

- Paper defines the layout, the type, and the color. It does not hold final copy.
- The website code holds the final website wording: `site/src/routes/index.tsx` and `site/src/components/SkillTour.tsx`.
- Descriptions in Paper are copy slots. A slot is text in square brackets, such as `[Skill description: one short sentence]`. It gives the place, the length, and the kind of text. Never ship slot text as product copy.
- Brand names, headlines, section headings, real commands, file paths, and skill identifiers stay real in Paper.
- README previews point to `README.md` for final introduction text and use slots for their repository description.
- Paper does not sync with the source. Because Paper holds no final copy, copy changes in code do not make Paper drift.
- The diagrams are layout and motion references. They are not a workflow manual.
- The note artboard "Note · copy slots (not product copy)" is on the canvas, outside the production artboards, and states this policy.

## Slot categories

Each slot layer is named `copy:<section>.<item>`. The desktop and mobile artboards use the same names.

| Section | Layer names |
| --- | --- |
| Hero | `copy:hero.description`, `copy:hero.diagram-note` |
| Install | `copy:install.{npx,bunx,npm,mise}.note`, `copy:install.project.note-1..3` |
| Names | `copy:names.{oh-my-t3,omt,aliases}` |
| How it works | `copy:workflow.goal.note`, `copy:workflow.{plan,build,review,test}.description` |
| States | `copy:states.caption` |
| Two parts | `copy:parts.{skills,cli,note}` |
| Evidence | `copy:evidence.intro`, `copy:evidence.note`, `copy:evidence.run-1`, `copy:evidence.run-2`, `copy:evidence.file.{plans,ledger,config}` |
| Skills | `copy:skills.<skill>.description`, `copy:skills.swarm-caption` |
| Who it is for | `copy:audience.use.item-1`, `copy:audience.avoid.item-1..3` |
| Requirements | `copy:requirements.{t3-version,providers,runtime,release-status}` |
| README mockups | `copy:readme.version-badge`, `copy:readme.description`, `copy:readme.repository-description` |
| Credits | `copy:credits.description` |

## Changes

1. Palette, color-vision group (#1). The heading is now "Color-vision simulations". The caption says that the blue and gray rails are simulations only, and that the shipped review rail is always Purple #AB7DF8. Each sample label now says "simulation, not a production color", except the normal-vision label, which says "shipped colors". The four raster samples did not change.
2. README light and README dark mockups (#2, #3). The banner image is now `assets/banner.png` (oh-my-t3, `npm i -g oh-my-t3`). The old image showed oh-my-t3code and `npx omt3`. The frame and the 830x415 size did not change. The introduction and repository description are labeled slots; the introduction points to `README.md` for its final wording. The npm badge `v0.1.1` is now the slot `v{version}`.
3. Site desktop and site mobile (#4 to #12). The descriptions in the hero, install, names, how it works, states, two parts, evidence, skills, audience, and requirements sections are now copy slots. The headline, headings, commands, and paths stay real. Credits descriptions also use slots; the source names and links stay real.
4. Skills. The skill list is now omt-ulw, omt-plan, omt-design, omt-code-review, omt-research (agent-started) and omt-swarm, omt (by name). The omt-show and omt-loop rows are hidden, not deleted (layers named "removed: … (hidden)"). omt-review is now omt-code-review. The headings have no skill counts: "The agent can start these itself" and "You start these by name".
5. Workflow names. The steps are now Give a goal, Plan, Build, Review, Test and report. The hero diagram labels Delegate and Verify are now Build and Test. The diagram geometry did not change.
6. Versions. "This is version 0.1." and "T3 Code v0.1.0 or later." are now slots with `{version}` and `{minimum version}`.

Not changed: the `Banner · 1280x640` artboard (the source of the exported public banner), the `Site · motion` notes, and all repository files outside this note.

## Screenshots

All under `docs/design/paper-drift/`:

- `palette-cvd-before.jpg`, `palette-cvd-after.jpg`
- `readme-light-before.jpg`, `readme-light-after.jpg`
- `readme-dark-before.jpg`, `readme-dark-after.jpg`
- `site-desktop-before.jpg`, `site-desktop-after.jpg`
- `site-mobile-before.jpg`, `site-mobile-after.jpg`
- `copy-slot-note.jpg`

## Verification

The updated README previews embed the current banner image. Their description slots and the desktop/mobile credits were checked with Paper screenshots. The note artboard sits to the left of the desktop frame, outside the product layout. The production banner files retain their finished copy.

The site reads the root package version, and its workflow also runs when that manifest changes. Root verification passes 834 tests. Site typecheck, build, and all 18 e2e checks pass.
