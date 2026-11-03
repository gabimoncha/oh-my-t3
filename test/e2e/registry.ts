import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { onTestFinished } from "bun:test";
import { childEnv, GIT, gitEnv, PACKAGE_ROOT, tempDir } from "../helpers.ts";

const execute = promisify(execFile);

export function tools() {
  const find = (name: string): string => {
    const path = Bun.which(name);
    assert.ok(path, `Required tool is missing: ${name}`);
    return realpathSync(path);
  };
  const paths = { node: find("node"), npm: find("npm"), pnpm: find("pnpm"), npx: find("npx"), bun: process.execPath };
  const dirs = [...new Set([dirname(paths.node), dirname(paths.npm), dirname(paths.pnpm), "/usr/bin", "/bin"])];
  for (const dir of dirs) assert.ok(!existsSync(join(dir, "bun")), `Node-only PATH contains bun: ${dir}`);
  return { ...paths, nodePath: dirs.join(delimiter), bunPath: [dirname(paths.bun), ...dirs].join(delimiter) };
}

export function isolatedEnv(root: string): NodeJS.ProcessEnv {
  const env = childEnv(root);
  for (const name of Object.keys(env)) {
    if (/^(OMT_|XDG_|CLAUDE_|T3CODE_)/.test(name)) delete env[name];
  }
  Object.assign(env, {
    OMT_CONFIG_DIR: join(root, "omt"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    T3CODE_HOME: join(root, "t3"),
    npm_config_cache: join(root, "home", ".npm"),
    npm_config_userconfig: join(root, "npmrc"),
    NPM_CONFIG_USERCONFIG: join(root, "npmrc"),
    BUN_INSTALL_CACHE_DIR: join(root, "bun-cache"),
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  });
  mkdirSync(env.HOME!, { recursive: true });
  return env;
}

export async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const result = await execute(command, args, { cwd, env, encoding: "utf8", timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });
    return result.stdout + result.stderr;
  } catch (error) {
    const result = error as Error & { stdout?: string; stderr?: string };
    assert.fail(`${command} ${args.join(" ")}\n${result.message}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
}

type PackageManifest = { name: string; version: string; bin: Record<string, string> };

// Builds the release of the checkout at `source` into `<root>/<outdir>`, packs all npm packages, and
// returns their manifests with the tarball bytes.
async function packRelease(source: string, root: string, outdir: string, tool: ReturnType<typeof tools>, env: NodeJS.ProcessEnv) {
  const release = join(root, outdir);
  await run(tool.bun, [join(source, "scripts", "release.ts"), "--target", `${process.platform}-${process.arch}`, "--outdir", release], source, env);
  const packed: { manifest: PackageManifest; bytes: Buffer }[] = [];
  for (const name of ["oh-my-t3code", "omt3", "oh-my-t3"]) {
    const dir = join(release, "npm", name);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageManifest;
    assert.ok(existsSync(join(dir, "dist", "cli.js")), `Missing bundle for ${name}`);
    assert.equal(manifest.name, name);
    assert.equal(manifest.bin[name], "dist/cli.js");
    await run(tool.npm, ["pack", "--ignore-scripts", "--pack-destination", root], dir, env);
    packed.push({ manifest, bytes: readFileSync(join(root, `${name}-${manifest.version}.tgz`)) });
  }
  return packed;
}

// Build B: a copy of the files that git tracks, plus the files that it would track (the checkout's uncommitted
// work), committed in a new repository. Its version is A's patch plus 1, and skills/omt-help/SKILL.md has one more
// line, so an update from A to B changes one skill.
function nextCheckout(root: string, home: string): { dir: string; version: string } {
  const dir = join(root, "next-src");
  const listed = execFileSync(GIT, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: PACKAGE_ROOT, encoding: "utf8" });
  for (const file of listed.split("\0").filter((line) => line !== "")) {
    const from = join(PACKAGE_ROOT, file);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(from, join(dir, file));
  }
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  const [major, minor, patch] = pkg.version.split(".").map(Number);
  const version = `${major}.${minor}.${patch! + 1}`;
  writeFileSync(pkgPath, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
  appendFileSync(join(dir, "skills", "omt-help", "SKILL.md"), `\nThis line exists only in the e2e update build ${version}.\n`);
  const git = (args: string[]) => execFileSync(GIT, args, { cwd: dir, env: gitEnv(home), encoding: "utf8" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", `build ${version}`]);
  return { dir, version };
}

// Serves the release of the checkout (A) from a loopback registry. With `next`, it also serves build B and its
// dist-tags name B as latest. `requests` records the path of each request.
export async function releaseRegistry(prefix: string, tool: ReturnType<typeof tools>, options: { next?: boolean } = {}) {
  const parent = join(PACKAGE_ROOT, "dist", "test-e2e");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  // Stop package managers from walking up to the checkout's private package.
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "omt-release-test", private: true }));
  const home = tempDir("omt-registry-home-");
  const env = isolatedEnv(home);
  env.PATH = tool.bunPath;
  const packed = await packRelease(PACKAGE_ROOT, root, "release", tool, env);
  const version = packed[0]!.manifest.version;
  let nextVersion: string | undefined;
  if (options.next === true) {
    const next = nextCheckout(root, home);
    packed.push(...(await packRelease(next.dir, root, "release-next", tool, env)));
    nextVersion = next.version;
  }
  const latest = nextVersion ?? version;
  const tarballs = new Map<string, Buffer>();
  const packages = new Map<string, PackageManifest[]>();
  for (const { manifest, bytes } of packed) {
    tarballs.set(`/${manifest.name}-${manifest.version}.tgz`, bytes);
    packages.set(manifest.name, [...(packages.get(manifest.name) ?? []), manifest]);
  }
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url.pathname);
      const tarball = tarballs.get(url.pathname);
      if (request.method !== "GET") return new Response("Not found", { status: 404 });
      if (tarball) return new Response(new Uint8Array(tarball), { headers: { "content-type": "application/octet-stream" } });
      const tags = /^\/-\/package\/([^/]+)\/dist-tags$/.exec(url.pathname)?.[1];
      if (tags !== undefined) return packages.has(tags) ? Response.json({ latest }) : new Response("Not found", { status: 404 });
      const manifests = packages.get(decodeURIComponent(url.pathname.slice(1)));
      if (!manifests) return new Response("Not found", { status: 404 });
      const versions: Record<string, unknown> = {};
      for (const manifest of manifests) {
        const path = `/${manifest.name}-${manifest.version}.tgz`;
        const bytes = tarballs.get(path)!;
        versions[manifest.version] = {
          ...manifest,
          dist: {
            tarball: `${url.origin}${path}`,
            shasum: createHash("sha1").update(bytes).digest("hex"),
            integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
          },
        };
      }
      return Response.json({ name: manifests[0]!.name, "dist-tags": { latest }, versions });
    },
  });
  onTestFinished(() => server.stop(true));
  const registry = server.url.origin;
  return {
    root,
    version,
    nextVersion,
    registry,
    requests,
    env: (name: string, path: string): NodeJS.ProcessEnv => ({
      ...isolatedEnv(join(home, name)),
      PATH: path,
      npm_config_registry: registry,
      NPM_CONFIG_REGISTRY: registry,
      BUN_CONFIG_REGISTRY: registry,
    }),
  };
}
