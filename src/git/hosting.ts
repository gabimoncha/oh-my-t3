import type { RemoteRepo } from "./branch.ts";
import { firstLine, ok, runTool } from "./exec.ts";
import type { ToolContext } from "./exec.ts";
import { sameName } from "./policy.ts";

export const PR_LIST_LIMIT = 100;

export interface OpenPr {
  number: number;
  url: string;
  author: string;
  baseRefName: string;
}

export type HostResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export function repoArg(remote: RemoteRepo): string {
  return `${remote.host}/${remote.owner}/${remote.repo}`;
}

export function ghLogin(ctx: ToolContext, host: string): HostResult<string> {
  const result = runTool(ctx, "gh", ["api", "--hostname", host, "user", "-q", ".login"]);
  const login = result.stdout.trim();
  if (!ok(result) || login === "") return { ok: false, reason: `cannot read the gh login for ${host}: ${firstLine(result)}` };
  return { ok: true, value: login };
}

interface RawPr {
  number?: number;
  url?: string;
  author?: { login?: string } | null;
  headRefName?: string;
  headRepositoryOwner?: { login?: string } | null;
  baseRefName?: string;
}

// The open PRs from `branch` of the origin repo. A PR from a fork with the same branch name is not one of them.
export function openPrs(ctx: ToolContext, remote: RemoteRepo, branch: string): HostResult<OpenPr[]> {
  const result = runTool(ctx, "gh", [
    "pr", "list", "--repo", repoArg(remote), "--head", branch, "--state", "open",
    "--json", "author,headRefName,headRepositoryOwner,number,url,baseRefName", "--limit", String(PR_LIST_LIMIT),
  ]);
  if (!ok(result)) return { ok: false, reason: `cannot list the open PRs of ${branch}: ${firstLine(result)}` };
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    return { ok: false, reason: `cannot read the open PRs of ${branch}: gh printed no JSON` };
  }
  if (!Array.isArray(raw)) return { ok: false, reason: `cannot read the open PRs of ${branch}: gh printed no list` };
  if (raw.length >= PR_LIST_LIMIT) return { ok: false, reason: `${branch} has ${PR_LIST_LIMIT} or more open PRs; omt cannot check them all` };
  const prs = (raw as RawPr[])
    .filter((pr) => pr.headRefName === branch && (pr.headRepositoryOwner?.login === undefined || sameName(pr.headRepositoryOwner.login, remote.owner)))
    .map((pr) => ({ number: pr.number ?? 0, url: pr.url ?? "", author: pr.author?.login ?? "", baseRefName: pr.baseRefName ?? "" }));
  return { ok: true, value: prs };
}

// The author to pass as `--pr-author`: an author that is not the user, else the user.
export function prAuthorOf(prs: OpenPr[], user: string | undefined): string | undefined {
  if (prs.length === 0) return undefined;
  return prs.find((pr) => user === undefined || !sameName(pr.author, user))?.author ?? user;
}
