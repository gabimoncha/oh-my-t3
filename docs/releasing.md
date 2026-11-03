# Release oh-my-t3

This page is for the owner. A release has the primary npm package `oh-my-t3`, the aliases `oh-my-t3code` and `omt3`, and one GitHub release with the binary archives. When you push a `v<version>` tag, the workflow `.github/workflows/release.yml` builds the release, publishes all three npm packages, and creates the GitHub release. [Spec section 17](spec.md#17-packaging-and-release) describes the release script and the workflows.

Before the first automated release, do the steps in [Set up once](#set-up-once).

## Publish a release

Do these steps in order, in the repository root. Start on `main` with a clean working tree: `git status --short` prints nothing. Each step must pass before you start the next step. Replace `<version>` with the new version, such as `0.2.0`.

1. Set the new version in the `version` field of `package.json`.
2. Run the type check and all tests:

   ```sh
   mise exec -- bun run verify
   ```

3. Commit the version change and push it:

   ```sh
   git commit -m "release v<version>" package.json
   git push origin main
   ```

4. Tag that commit and push the tag. The release must come from the commit that you tested:

   ```sh
   git tag v<version>
   git push origin v<version>
   ```

5. Wait for the release workflow. To follow it, run `gh run watch` and select the `Release` run. The workflow does these jobs:
   - `verify` runs the CI workflow `.github/workflows/ci.yml` on the tagged commit.
   - `build` checks that the tag is `v` plus the `version` of `package.json`. Then it runs `bun scripts/release.ts`, checks the 6 archives against `SHA256SUMS`, and uploads `dist/release` as the artifact `release`.
   - `npm` publishes `oh-my-t3`, `oh-my-t3code`, and `omt3` with `npm publish --access public --tag latest`. It uses npm trusted publishing, so no npm token is stored in GitHub.
   - `github` creates the GitHub release `v<version>` with the 6 archives and `SHA256SUMS`, and with notes that GitHub generates.
6. Check each channel on a clean machine, or in a fresh user account. Each command must print the new version:

   ```sh
   mise use -g github:gabimoncha/oh-my-t3@<version>
   omt --version
   npx omt3 --version
   bunx omt3 --version
   npx oh-my-t3 --version
   ```

   Keep `@<version>` in the mise command. Recent mise versions hide a release for its first 24 hours, through the setting `minimum_release_age`. Without the pin, mise installs the previous release in that time, or fails when no older release exists. Check the one-shot package as `npx omt3`, not `npx omt`. `npx omt` downloads a different npm package named `omt`. `npx omt3` needs Node. `bunx omt3` also works with only Bun.

## Set up once

On npmjs.com:

1. For each of `oh-my-t3`, `oh-my-t3code`, and `omt3`, open the package, then **Settings** > **Trusted publishing**. Add a trusted publisher of type **GitHub Actions** with these values:
   - Organization or user: `gabimoncha`
   - Repository: `oh-my-t3`
   - Workflow filename: `release.yml`
   - Environment: `npm`
   - Allowed actions: check **Allow `npm publish`**. Leave **Allow `npm dist-tag`** unchecked.

   As an alternative, run this command once for each package. It needs npm 11.15 or later and your 2FA:

   ```sh
   npm trust github oh-my-t3code --file release.yml --repo gabimoncha/oh-my-t3 --env npm --allow-publish
   npm trust github omt3 --file release.yml --repo gabimoncha/oh-my-t3 --env npm --allow-publish
   npm trust github oh-my-t3 --file release.yml --repo gabimoncha/oh-my-t3 --env npm --allow-publish
   ```

   A new trusted publisher configuration expires when no publish uses it within two days. Add it shortly before you push the tag of the first automated release. Read [trusted publishers](https://docs.npmjs.com/trusted-publishers/) for the details.

2. After the first automated release succeeds, open **Settings** > **Publishing access** for each package. Select "Require two-factor authentication and disallow tokens". This setting blocks token publishes. It does not block the trusted publisher of the workflow.

On your machine:

1. Use the pinned npm 11.21.1 release, which includes the October bundled dependency security fixes and supports `npm trust`. Run `mise install`, then check the version with `mise exec -- npm --version`.
2. Log in to npm with `npm login`.
3. Log in to GitHub with `gh auth login`, with write access to `gabimoncha/oh-my-t3`.
4. Install the repository tools as a contributor does: run `mise install` and `bun install` in the clone.

On GitHub:

1. Add a tag ruleset for `v*` in **Settings** > **Rules** > **Rulesets**, so that only you can create release tags. A pushed `v*` tag publishes to npm with no other check.
2. The `npm` job creates the environment `npm` on its first run. To let only release tags use it, open **Settings** > **Environments** > `npm`, and add a deployment tag rule for `v*`.

If another person gets the right to push release tags, add an approval before npm publishes. One way: in **Settings** > **Environments** > `npm`, add yourself as a required reviewer. The `npm` job then waits for your approval. The other way: change `npm publish` to `npm stage publish` in `release.yml`, and approve each version on npmjs.com.

## If a release job fails

To see the failed job and its log, run `gh run list --workflow release.yml` and then `gh run view <run-id> --log-failed`. If the cause is outside the repository, such as a missing trusted publisher, fix it and re-run only the failed jobs:

```sh
gh run rerun <run-id> --failed
```

A re-run uses the same commit. If the fix needs a code change, release a new version. A re-run does not repeat the work that is done:

- The `npm` job asks `npm view <pkg>@<version> version` for each package. If npm shows the version, the job skips that package. If npm answers `E404`, the job publishes the package. Any other answer fails the package. The job tries all three packages before it fails.
- The `github` job skips a published release that has all 7 assets. If the release is a draft or has missing assets, the job fails and prints the recovery commands:

  ```sh
  gh release upload "v<version>" <files> --clobber
  gh release edit "v<version>" --draft=false
  ```

  Or delete the draft release and re-run the job.

If the `build` job fails because the tag does not match `package.json`, delete the tag with `git push origin :refs/tags/v<version>` and `git tag -d v<version>`. Then tag the correct commit again. A tag ruleset can block the deletion.

## Publish by hand

Use these steps when the workflow cannot publish, or when it stops partway. Do steps 1 to 4 of [Publish a release](#publish-a-release) first.

1. Check which channels are done already. A workflow run that stops partway can leave a published package or a GitHub release. Run these commands for each of `oh-my-t3code`, `omt3`, and `oh-my-t3`:

   ```sh
   npm view <pkg>@<version> version
   ```

   `npm view` prints the version when the package is published, and fails with `E404` when it is not. Then check the GitHub release:

   ```sh
   gh release view v<version>
   ```

   The command prints `release not found` when the release does not exist. If the release is a draft or lacks some of its 7 assets, use the recovery commands of [If a release job fails](#if-a-release-job-fails) in step 6, with `dist/release/github/*` as `<files>`.

2. Write the release files from the tagged commit:

   ```sh
   mise exec -- bun scripts/release.ts
   ```

   The script writes `dist/release/`: the npm packages in `npm/oh-my-t3code/`, `npm/omt3/`, and `npm/oh-my-t3/`, and one archive per platform with `SHA256SUMS` in `github/`. It publishes nothing. At the end, it prints the publish commands. It refuses an unsafe output directory, and it refuses a `skills/` directory that holds untracked or ignored files, such as `.DS_Store`. Remove those files and run the script again.

3. Publish the primary package. Skip this step if `oh-my-t3@<version>` is published. npm asks for your 2FA code:

   ```sh
   (cd dist/release/npm/oh-my-t3 && npm publish --access public)
   ```

4. Publish the one-shot package. It is the same build under the name `omt3`. Skip this step if `omt3@<version>` is published:

   ```sh
   (cd dist/release/npm/omt3 && npm publish --access public)
   ```

   Use `npm publish`, not the `bun publish` command that the release script prints. `bun publish` uses a token. After you select "disallow tokens" in [Set up once](#set-up-once), a token publish fails. Before that setting, `bun publish --access public` also works.

5. Publish the legacy `oh-my-t3code` alias. Skip this step if `oh-my-t3code@<version>` is published:

   ```sh
   (cd dist/release/npm/oh-my-t3code && npm publish --access public)
   ```

6. Create the GitHub release from the tag, with the archives and `SHA256SUMS`. Skip this step if the release `v<version>` exists:

   ```sh
   gh release create v<version> --verify-tag dist/release/github/*
   ```

   `--verify-tag` stops the command when the tag is not on GitHub. Without it, `gh` creates the tag from the last commit of the default branch, which can differ from the commit that you released. The release script prints this command without `--verify-tag`. Use the command of this step.

7. Do step 6 of [Publish a release](#publish-a-release).

## The 0.5.0 package alias

oh-my-t3 version `0.5.0` was published under the new npm name on 2026-10-30. The existing `oh-my-t3code@0.5.0` and `omt3@0.5.0` packages remain available. npm never accepts a second publish of the same package version. Repository and artwork changes reach npm with the next release.

The GitHub repository is now `gabimoncha/oh-my-t3`. Trusted publishers for all three npm packages must name this repository, `release.yml`, and the `npm` environment. A publisher still configured for the old repository name cannot publish from the renamed workflow. Use the commands in [Set up once](#set-up-once) to configure the new repository.

## What happened in the first release

Version 0.1.0 was published by hand on 2026-10-20. These facts explain what you can see on npm:

- npm first showed the version `0.0.0-stage` at 21:15 UTC, and then `0.1.0` at 21:16 to 21:17 UTC. The `0.0.0-stage` placeholder appears only when a package does not exist yet. It is not a release. Read [staged publishing](https://docs.npmjs.com/staged-publishing/).
- To see the current versions and tags, run `npm view <pkg> versions dist-tags --prefer-online` or `curl https://registry.npmjs.org/<pkg>`. `--prefer-online` makes npm ask the registry instead of its local cache.
- A second publish failed with "You cannot publish over the previously published versions: 0.1.0." This error means that the first publish worked. npm never accepts the same version again, also after you unpublish it.
- `npm stage list` and `npm stage approve` need npm 11.15 or later. The owner's npm was 11.11. npm 12 needs Node `^22.22.2 || ^24.15.0 || >=26`.

## If mise installs the binary under another name

Version 0.1.0 installs as `omt` with no rename.

The archive holds one file, `omt`, and mise keeps the name of the file in the archive. If `mise use github:gabimoncha/oh-my-t3` installs the binary under another name than `omt`, use the `rename_exe` option of the mise [GitHub backend](https://mise.jdx.dev/dev-tools/backends/github.html) to name it `omt`. Then record the fix in the release binary section of [the install guide](install.md#release-binary), so that users run the same command.
