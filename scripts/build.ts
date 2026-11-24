// Builds the omt CLI in two forms:
// - <outdir>/cli.js: one JavaScript file for Node 22+ and Bun, which runs with skills/ in the package root.
// - <outdir>/bin/omt: a binary that embeds skills/ and needs neither Node nor Bun. With --target, each
//   target goes to <outdir>/bin/<target>/omt. A cross-compile downloads the Bun runtime of the target.
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const USAGE = "Usage: bun scripts/build.ts [--bundle] [--binary] [--target <bun-target>]... [--outdir <dir>]";
const ROOT = resolve(import.meta.dir, "..");

function parse() {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      options: {
        bundle: { type: "boolean" },
        binary: { type: "boolean" },
        target: { type: "string", multiple: true },
        outdir: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }).values;
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    process.exit(2);
  }
}

const values = parse();

if (values.help === true) {
  console.log(USAGE);
  process.exit(0);
}

const outdir = resolve(values.outdir ?? join(ROOT, "dist"));
const both = values.bundle !== true && values.binary !== true;

// Runs `bun build` from the repository root, so the embedded skills sit at <embedded root>/skills.
async function bunBuild(args: string[]): Promise<void> {
  const proc = Bun.spawn([process.execPath, "build", ...args], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`bun build ${args.join(" ")} exited with code ${code}`);
}

// bun build keeps the source shebang, #!/usr/bin/env bun. The bundle must run on a machine with only
// Node, so its first line becomes the one shebang, #!/usr/bin/env node.
async function buildBundle(): Promise<string> {
  const file = join(outdir, "cli.js");
  await bunBuild(["--target=node", "--define", 'OMT_BUILD="bundle"', "src/cli.ts", "--outfile", file]);
  const text = await readFile(file, "utf8");
  const body = text.startsWith("#!") ? text.slice(text.indexOf("\n") + 1) : text;
  await writeFile(file, `#!/usr/bin/env node\n${body}`);
  await chmod(file, 0o755);
  return file;
}

async function buildBinary(target?: string): Promise<string> {
  const file = target === undefined ? join(outdir, "bin", "omt") : join(outdir, "bin", target, "omt");
  const targetArgs = target === undefined ? [] : [`--target=${target}`];
  await bunBuild(["--compile", "--minify", "--asset", "./skills", "--asset", "./workflows", "--define", 'OMT_BUILD="binary"', ...targetArgs, "src/cli.ts", "--outfile", file]);
  return file;
}

const written: string[] = [];
if (both || values.bundle === true) written.push(await buildBundle());
if (both || values.binary === true) {
  const targets = values.target ?? [];
  if (targets.length === 0) written.push(await buildBinary());
  for (const target of targets) written.push(await buildBinary(target));
}
for (const file of written) console.log(`wrote ${relative(process.cwd(), file) || file}`);
