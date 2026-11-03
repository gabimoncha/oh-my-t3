# Names and compatibility

The public name is **oh-my-t3**. The descriptor is "CLI, skills, and hooks for T3 Code". The repository is `gabimoncha/oh-my-t3`. `src/brand.ts` defines the CLI's primary package, package aliases, and repository identity.

New install examples use these commands:

```sh
npm i -g oh-my-t3
omt --version
npx oh-my-t3 --version
```

The `omt` command stays the same. `oh-my-t3code` and `omt3` remain npm package aliases. Keep their releases at the same version. The npm name `omt` belongs to another author.

The website uses the Cloudflare Pages project `oh-my-t3`, at `https://oh-my-t3.pages.dev`. The previous project, `oh-my-t3code`, redirects to the new site with HTTP 301 and preserves paths for links in published packages.

## Compatibility identities

These strings identify existing installations. They retain their original values:

- The user config directory is `~/.config/oh-my-t3code`, or `oh-my-t3code` under `XDG_CONFIG_HOME`. `OMT_CONFIG_DIR` still overrides it.
- Project state stays in `.omt/`. The `OMT_*` environment variables stay the same.
- Managed skill markers and manifests retain the package identity `oh-my-t3code`. Hook signatures, shim signatures, and git exclude delimiters retain their existing text.
- One-shot project shims continue to pin `omt3@<version>`. Public one-shot examples use `npx oh-my-t3`.
- Release archives keep the prefix `oh-my-t3code-v`. Their executable is `omt`.
- mise detection accepts both the old and new repository install directories. New commands use `github:gabimoncha/oh-my-t3`.
- Updates keep the installed npm package name. Version discovery uses the primary `oh-my-t3` package.

## Prevent drift

Update public copy, command examples, package metadata, and the specification together. Keep historical research and accepted design records accurate to their date. Do not replace compatibility identities with the public brand.

The website source owns final marketing copy. Paper owns layout, typography, color, and spacing. Description fields in Paper use labeled slots with a purpose and an approximate length. Brand names, commands, and functional identifiers stay real. A wording change in the site needs no matching Paper edit. Slot instructions are design notes, not product copy. The site reads its displayed release version from the root `package.json`.

When you update the exported banner, replace its embedded image in both Paper README mockups too. Renaming surrounding text does not update image pixels. Palette previews of color-vision deficiencies are simulations; their shifted colors do not change the production palette.

`test/branding.test.ts` checks public repository links, primary install examples, package aliases, and the naming contract. The site tests check the rendered brand, links, and install commands. Run `mise exec -- bun run verify` at the root, then the site checks from `site/AGENTS.md`.

The Paper file and artwork export process are recorded in [the brand design note](design/brand-rename.md).
The description slots and corrected embedded previews are recorded in [the Paper copy policy](design/paper-drift.md).
