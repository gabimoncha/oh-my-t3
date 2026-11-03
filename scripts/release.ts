// Writes the release artifacts under <outdir>:
// - npm/<package>/: identical npm packages under each supported name.
// - github/oh-my-t3code-v<version>-<platform>.tar.gz: one archive per platform, with omt at the root.
// - github/SHA256SUMS: one checksum line per archive.
// It builds into <outdir>/build, so each outdir has its own build. It publishes nothing: the release workflow (.github/workflows/release.yml) or the owner publishes.
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse as parsePath, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PACKAGE_NAMES } from "../src/brand.ts";
import { isWithin } from "../src/paths.ts";

const USAGE = "Usage: bun scripts/release.ts [--target <platform>]... [--outdir <dir>]";
const ROOT = resolve(import.meta.dir, "..");
const PLATFORMS: Record<string, string> = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-arm64": "bun-linux-arm64",
  "linux-x64": "bun-linux-x64",
  "linux-arm64-musl": "bun-linux-arm64-musl",
  "linux-x64-musl": "bun-linux-x64-musl",
};
// The icon and the README banner. The README points at the banner, so it renders from the package too.
const ASSETS = ["icon.svg", "banner.png"];
// The script deletes build/, npm/, and github/ only in an outdir that holds this marker.
const MARKER = ".omt-release";

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

function parse() {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      options: {
        target: { type: "string", multiple: true },
        outdir: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }).values;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

const values = parse();

if (values.help === true) {
  console.log(`${USAGE}\nPlatforms: ${Object.keys(PLATFORMS).join(", ")}`);
  process.exit(0);
}

const platforms = values.target ?? Object.keys(PLATFORMS);
for (const platform of platforms) {
  if (!Object.hasOwn(PLATFORMS, platform)) fail(`Unknown platform: ${platform}. Platforms: ${Object.keys(PLATFORMS).join(", ")}`);
}

// Resolves symlinks in the part of the path that exists, so a link cannot hide the home or repo directory.
function real(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(real(parent), relative(parent, path));
}

function git(args: string[]): string[] {
  const proc = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "inherit" });
  if (proc.exitCode !== 0) refuse(`git ${args.join(" ")} exited with code ${proc.exitCode}`);
  return proc.stdout.toString().split("\0").filter((line) => line !== "");
}

const outdir = real(resolve(values.outdir ?? join(ROOT, "dist", "release")));
const repo = real(ROOT);
if (outdir === parsePath(outdir).root || outdir === real(homedir()) || isWithin(outdir, repo)) {
  refuse(`Refusing outdir ${outdir}: it is the filesystem root, the home directory, or the repository or one of its parents.`);
}
// The binary embeds skills/ as it is on disk, so release output inside it would ship as skill content.
if (isWithin(real(join(ROOT, "skills")), outdir)) {
  refuse(`Refusing outdir ${outdir}: it is the skills/ directory or inside it.`);
}
if (existsSync(outdir) && !existsSync(join(outdir, MARKER)) && (await readdir(outdir)).length > 0) {
  refuse(`Refusing outdir ${outdir}: it is not empty and has no ${MARKER} marker, so this script did not create it. Choose a new or empty directory.`);
}

// The binary embeds skills/ as it is on disk, so a file that git does not track would ship in it.
const stray = git(["ls-files", "-z", "--others", "--", "skills"]);
if (stray.length > 0) {
  refuse(`Refusing to release: skills/ has files that git does not track. Remove them first:\n${stray.map((file) => `  ${file}`).join("\n")}`);
}
const skillFiles = git(["ls-files", "-z", "--", "skills"]);
const buildDir = join(outdir, "build");
const githubDir = join(outdir, "github");
const root = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
  version: string;
  description: string;
  license: string;
  repository: string;
  homepage: string;
};
const version = root.version;

async function run(cmd: string[], cwd: string, env?: Record<string, string>): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited with code ${code}`);
}

await mkdir(outdir, { recursive: true });
await writeFile(join(outdir, MARKER), "This directory is written by scripts/release.ts.\n");
for (const dir of [buildDir, join(outdir, "npm"), githubDir]) await rm(dir, { recursive: true, force: true });

const buildArgs = platforms.flatMap((platform) => ["--target", PLATFORMS[platform] as string]);
await run([process.execPath, join(ROOT, "scripts", "build.ts"), "--outdir", buildDir, ...buildArgs], ROOT);

for (const name of PACKAGE_NAMES) {
  const dir = join(outdir, "npm", name);
  const manifest = {
    name,
    version,
    description: root.description,
    type: "module",
    license: root.license,
    repository: root.repository,
    homepage: root.homepage,
    bin: { omt: "dist/cli.js", omt3: "dist/cli.js", "oh-my-t3code": "dist/cli.js", "oh-my-t3": "dist/cli.js" },
    files: ["dist", "skills", "assets", "README.md", "LICENSE"],
    engines: { node: ">=22" },
  };
  await mkdir(join(dir, "dist"), { recursive: true });
  await writeFile(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(join(buildDir, "cli.js"), join(dir, "dist", "cli.js"));
  await chmod(join(dir, "dist", "cli.js"), 0o755);
  for (const file of skillFiles) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await cp(join(ROOT, file), join(dir, file));
  }
  await mkdir(join(dir, "assets"), { recursive: true });
  for (const file of ASSETS) await cp(join(ROOT, "assets", file), join(dir, "assets", file));
  await cp(join(ROOT, "README.md"), join(dir, "README.md"));
  await cp(join(ROOT, "LICENSE"), join(dir, "LICENSE"));
  console.log(`wrote ${relative(process.cwd(), dir)}`);
}

await mkdir(githubDir, { recursive: true });
const sums: string[] = [];
for (const platform of platforms) {
  const archive = `oh-my-t3code-v${version}-${platform}.tar.gz`;
  // A staging directory holds only omt, so the archive has omt at its root and nothing else.
  const stage = await mkdtemp(join(buildDir, "stage-"));
  await cp(join(buildDir, "bin", PLATFORMS[platform] as string, "omt"), join(stage, "omt"));
  await chmod(join(stage, "omt"), 0o755);
  // COPYFILE_DISABLE stops macOS tar from adding ._ metadata files.
  await run(["tar", "-czf", join(githubDir, archive), "-C", stage, "omt"], ROOT, { COPYFILE_DISABLE: "1" });
  await rm(stage, { recursive: true, force: true });
  const hash = createHash("sha256").update(await readFile(join(githubDir, archive))).digest("hex");
  sums.push(`${hash}  ${archive}\n`);
  console.log(`wrote ${relative(process.cwd(), join(githubDir, archive))}`);
}
await writeFile(join(githubDir, "SHA256SUMS"), sums.join(""));
console.log(`wrote ${relative(process.cwd(), join(githubDir, "SHA256SUMS"))}`);

const rel = (path: string) => relative(process.cwd(), path) || ".";
const quote = (text: string) => (/^[\w./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);
console.log(`\nPublish v${version} with these commands, in this order:`);
for (const name of PACKAGE_NAMES) console.log(`  (cd ${quote(rel(join(outdir, "npm", name)))} && bun publish --access public)`);
console.log(`  gh release create v${version} ${quote(rel(githubDir))}/*`);
