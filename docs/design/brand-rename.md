# Brand rename: oh-my-t3

The GitHub repository moved to `gabimoncha/oh-my-t3`, and the public name is now oh-my-t3. This note records the edits to the approved marketing design and to the exported assets. Layout, palette, and type did not change.

For the current description slots and copy ownership rules, read [the Paper copy policy](paper-drift.md). The rename screenshots below record the earlier pass.

## Paper file

- File: `oh-my-t3` (renamed from `omt3`), folder `oh-my-t3`, page `Marketing`.
- Link: https://app.paper.design/file/01M5CWMSCW0Z7GS4EXR3DXRB8D/p-O-0
- Boards edited: `Site · desktop 1440`, `Site · mobile 390`, `Site · motion`, `Icon · sizes`, `Icon · tabs`, `Banner · 1280x640`, `Banner · README light`, `Banner · README dark`.

## Changes

| Where | Before | After |
| --- | --- | --- |
| Nav and footer wordmark | `omt3`, `oh-my-t3code` | `oh-my-t3` |
| Hero command plate (desktop, mobile) | `npx omt3` | `npx oh-my-t3`, the same command as `site/src/routes/index.tsx` (the plate stays 272 px wide) |
| Closing plate, install row, motion copy states | `npx omt3` | `npx oh-my-t3` |
| Install rows | `bunx omt3`, `npm i -g oh-my-t3code`, `mise use -g github:gabimoncha/oh-my-t3code` | `bunx oh-my-t3`, `npm i -g oh-my-t3`, `mise use -g github:gabimoncha/oh-my-t3` |
| Names list | `oh-my-t3code`; `omt3`: "The same npm package under a short name" | `oh-my-t3`; `omt3`: "Older npm names (omt3, oh-my-t3code), kept as aliases." |
| Footer links | `oh-my-t3code on npm`, `omt3 on npm` | `oh-my-t3 on npm`, `Aliases on npm` |
| Hero, README banner, and credits paragraphs | "oh-my-t3code adds…", "oh-my-t3code uses…" | "oh-my-t3 adds…", "oh-my-t3 uses…" |
| Icon boards | `oh-my-t3code`, `github.com/gabimoncha/oh-my-t3code` | `oh-my-t3`, `github.com/gabimoncha/oh-my-t3` |
| Social banner | name `oh-my-t3code`, plate `npx omt3` | `oh-my-t3 · CLI, skills, and hooks for T3 Code`, plate `npm i -g oh-my-t3` |
| Screen reader note (motion) | "Copy npx omt3" | "Copy npx oh-my-t3" |

The initial brand pass kept https://oh-my-t3code.pages.dev. The site now moves to https://oh-my-t3.pages.dev in a separate Pages project. The `omt` command and the `.omt/` paths did not change. The compact mark keeps its `OMT3` glyphs by decision: `OMT3` abbreviates oh-my-t3, and the approved mark stays the same.

## Command choices

- Hero plates (desktop, mobile), closing plate, motion copy states: `npx oh-my-t3`.
- Install rows: `npx oh-my-t3`, `bunx oh-my-t3`, `npm i -g oh-my-t3`, `mise use -g github:gabimoncha/oh-my-t3`.
- Social banner plate (`Banner · 1280x640`, exported to `assets/banner.png` and `site/public/og.png`): `npm i -g oh-my-t3`.

## Exported files

- `assets/banner.png` and `site/public/og.png`: 1x PNG export of the `Banner · 1280x640` board, 1280 x 640.
- `assets/icon.svg`, `site/public/icon.svg`, `site/public/icon-16.svg`, `site/public/icon-32.svg`: only `<title>` and `aria-label` changed from `omt3` to `oh-my-t3`. The vector paths are the same.
- `site/public/icon-512.png`, `apple-touch-icon.png`, `favicon.ico`: not changed, because the pixels did not change.

To export again, open the `Marketing` page, select `Banner · 1280x640`, export PNG at 1x, and copy the file to both paths above. The Paper board is the editable source.

## Screenshots

- `docs/design/brand-rename/desktop-before.png`, `docs/design/brand-rename/desktop-after.png`
- `docs/design/brand-rename/mobile-before.png`, `docs/design/brand-rename/mobile-after.png`
- `docs/design/brand-rename/banner-before.png`, `docs/design/brand-rename/banner-after.png`
