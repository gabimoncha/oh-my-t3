# Landing page contributor guide

`site/` is the landing page at https://oh-my-t3.pages.dev. It is a separate Bun package: a TanStack Start app that prerenders one static page to `dist/client`. Its contract is `docs/spec.md` section 17.2. When the page and the spec disagree, fix one of them in the same change.

## Copy and design

Final copy belongs to the website source. Paper defines layout, typography, color, and spacing. Its description slots state the content's purpose and length; write final words from the task and source rather than copying those slot instructions. A copy-only change needs no Paper update. Keep brand names, commands, and functional identifiers real in Paper. Read `docs/design/paper-drift.md` when you change the Paper design or embedded banner previews.

Read the release version from the root `package.json` through `src/site.ts`. Do not hardcode a version in page text.

## Commands

Run each command in `site/` through `mise exec --`. The root `bun run verify` does not cover the site.

| Command | Use |
| --- | --- |
| `bun install` | Install the site dependencies. |
| `bun run dev` | Serve the page with hot reload at http://localhost:3000. |
| `bun run typecheck` | Type-check `src/`, `e2e/`, and the configs. |
| `bun run build` | Prerender the page to `dist/client`. |
| `bun run e2e` | Run the end-to-end tests against `dist/client`. Build first. The first run needs `bunx playwright install chromium webkit`. |

Before you report done, run `typecheck`, `build`, and `e2e`, and look at the changed section in a browser at 1440 px and 390 px wide.

## Deploy

`.github/workflows/site.yml` deploys. A pull request that changes `site/` runs the checks. A push to `main` runs the checks and then deploys to Cloudflare Pages. Run `bun run deploy` yourself only when the owner asks for it.

## Files

| Path | Holds |
| --- | --- |
| `src/routes/index.tsx` | The page: one function per section, in page order. |
| `src/components/HeroRuns.tsx` | The hero pictures: the ulw run, then the swarm run. |
| `src/components/SkillTour.tsx` | The skill list, its pointer, and the picture of each skill. |
| `src/components/InstallSteps.tsx` | The two install steps with tabs. |
| `src/components/metro.tsx` | The renderer for the animated metro pictures (`Draw`, `Metro`). |
| `src/components/scenes.ts` | One scene for each skill. The hero uses the `omt-ulw` and `omt-swarm` scenes. |
| `src/styles.css` | All styles. The design tokens are in `:root`. |
| `e2e/site.e2e.ts` | The end-to-end tests. `e2e/serve.ts` serves `dist/client` the way Cloudflare Pages does. |

## Animation

- A scene is a list of items, each with a start time in ms. Build it with `Draw`: each call takes its start time and returns its end time. Lines draw at one speed, from their path length.
- CSS runs the timing from `--at` and `--dur`. A host element has the class `anim`. `useInView` sets `data-play` when the host first comes into view and `data-paused` while it is out of view.
- A rotation (hero, skill tour) moves on when its `.m-clock` element ends its `clock` animation. Give the clock the scene's `end` plus a hold.
- Skill scenes share one grid: a 480 x 256 canvas, lanes at y 64, 128, and 192. The ulw and swarm scenes put Build at x 200 and Review on the rail at x 300, so the two hero pictures line up.
- With reduced motion, each picture shows its last frame and nothing rotates. Without JavaScript, the last frame shows too. The e2e tests check reduced motion.
- In the end-to-end tests, use `finishAnimations` to end the animations at once, so a test does not wait in real time.

## Style

- Take colors only from the tokens in `:root`. Text has three roles: `--ink` for headings and key text, `--text-2` for body copy (class `muted`), and `--text-3` for labels and meta (class `meta`). `--text-off` is for disabled text. Measure a new text color with APCA against `--ground`: body copy needs Lc 75.
- Space sections with the tokens: `--gap-section` between sections (`.section`), `--gap-block` between the parts of one section (`.section-tight`), and `--gap-heading` under a section heading.
- The layout has one breakpoint, at 1100 px.
- Keep page text short. The owner removed text on each review: one line for each step, one note under each install step.
