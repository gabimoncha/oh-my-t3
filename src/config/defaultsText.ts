import { readFileSync } from "node:fs";

// A Bun macro: src/config/defaults.ts imports it `with { type: "macro" }`, so Bun reads defaults.jsonc when it
// transpiles or bundles defaults.ts and inlines the text. The bundle and the binary then read no file.
export function defaultsText(): string {
  return readFileSync(new URL("./defaults.jsonc", import.meta.url), "utf8");
}
