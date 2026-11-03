// Starts the config editor in maintainer mode: it saves the built-in defaults in src/config/defaults.jsonc and the
// skill files in skills/ of this clone. Commit the changes; users get them in the next release.
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readCapabilities } from "../src/commands/shared.ts";
import { startConfigEditor } from "../src/config/editor/server.ts";
import { createContext } from "../src/main.ts";

const USAGE = "Usage: bun run defaults:edit [--no-open] [--capabilities <file>]";
const ROOT = join(import.meta.dir, "..");

let values: { "no-open"?: boolean; capabilities?: string; help?: boolean };
try {
  ({ values } = parseArgs({
    options: { "no-open": { type: "boolean" }, capabilities: { type: "string" }, help: { type: "boolean", short: "h" } },
  }));
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n${USAGE}\n`);
  process.exit(2);
}
if (values.help === true) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const ctx = createContext({ packageRoot: ROOT });
const caps = await readCapabilities(ctx, values.capabilities);
const editor = await startConfigEditor(ctx, {
  open: values["no-open"] !== true,
  ...(caps === undefined ? {} : { capabilities: caps }),
  maintainer: { defaultsPath: join(ROOT, "src", "config", "defaults.jsonc"), skillsRoot: join(ROOT, "skills") },
});
const stop = () => void editor.close();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.stdout.write(`omt defaults editor: ${editor.url}\n`);
process.stdout.write("It saves src/config/defaults.jsonc and skills/ in this clone. Press Ctrl-C to stop.\n");
await editor.closed;
process.stdout.write("editor stopped\n");
