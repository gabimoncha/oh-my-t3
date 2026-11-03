import type { ResolvedProfile } from "../profile/resolve.ts";
import type { GitPolicy, LoadedConfig } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { parseRemote } from "./branch.ts";
import type { BranchState, RemoteRepo } from "./branch.ts";

export const ACTIONS = ["commit", "push", "pr", "merge"] as const;
export type Action = (typeof ACTIONS)[number];
export type Decision = "auto" | "ask" | "off";
export type PolicyKey = Exclude<keyof GitPolicy, "owners" | "maxPrFiles">;

// What decided the result. `--yes` can turn a `config`, `owner`, or `policy` decision into a go,
// but not a `state` decision, because the action cannot run in that state.
export type DecisionKind = "config" | "owner" | "policy" | "state";

export type LoadedProfile = LoadedConfig & { profile: ResolvedProfile };

export interface GitDecision {
  decision: Decision;
  kind: DecisionKind;
  key: PolicyKey | null;
  value: string | null;
  reason: string;
}

export interface PolicyInput {
  action: Action;
  state: BranchState;
  loaded: LoadedProfile | OmtError;
  user: string | undefined;
  host: string; // the host of the login
  prAuthor: string | undefined;
}

function keyFor(action: Action, branch: string | undefined, defaultBranch: string | undefined): PolicyKey | null {
  if (action === "merge") return "merge";
  if (action === "pr") return "pullRequests";
  if (branch === undefined || defaultBranch === undefined) return null;
  if (branch === defaultBranch) return "defaultBranch";
  return action === "commit" ? "branchCommits" : "pullRequests";
}

export function maxPrFilesOf(loaded: LoadedProfile | OmtError): number | null {
  return loaded instanceof OmtError ? null : loaded.profile.workflow.git?.maxPrFiles ?? null;
}

export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// The decision of spec section 5.15, in the order that the spec lists.
export function decide(input: PolicyInput): GitDecision {
  const { action, state, loaded, user, host: loginHost, prAuthor } = input;
  const remote = state.origin === undefined ? undefined : parseRemote(state.origin);
  const pushRemotes = state.pushUrls.map(parseRemote);
  const ask = (kind: DecisionKind, reason: string, key: PolicyKey | null = null, value: string | null = null): GitDecision =>
    ({ decision: "ask", kind, key, value, reason });

  if (loaded instanceof OmtError) return ask("config", `config error: ${loaded.message}; fix the config first`);
  const { profile, issues } = loaded;
  const configError = [...issues, ...profile.issues].find((issue) => issue.severity === "error");
  const key = keyFor(action, state.branch, state.defaultBranch);
  const value = key === null ? null : profile.workflow.git?.[key] ?? null;
  const owners = profile.workflow.git?.owners ?? [];
  const isMine = (repo: RemoteRepo) => user !== undefined && (sameName(repo.owner, user) || owners.some((owner) => sameName(owner, repo.owner)));
  const foreignPush = pushRemotes.find((push) => push !== undefined && (!sameName(push.host, loginHost) || !isMine(push)));
  const otherRepoPush = remote === undefined
    ? undefined
    : pushRemotes.find((push) => push !== undefined && (!sameName(push.host, remote.host) || !sameName(push.owner, remote.owner) || !sameName(push.repo, remote.repo)));
  const on = state.branch === undefined ? "" : ` on branch ${state.branch}`;

  if (configError !== undefined) {
    const where = configError.path === "" ? configError.source : `${configError.source} ${configError.path}`;
    return ask("config", `config error in ${where}: ${configError.message}; fix the config first`, key, value);
  }
  if (state.origin === undefined && (action === "push" || action === "pr")) return ask("state", "no origin remote", key, value);
  if (state.origin !== undefined && remote === undefined) {
    return ask("owner", "omt cannot read the owner from the origin remote URL", key, value);
  }
  if (remote !== undefined && (pushRemotes.length === 0 || pushRemotes.includes(undefined))) {
    return ask("owner", "origin has an unreadable push URL; omt cannot read its owner", key, value);
  }
  if (remote !== undefined && user === undefined) return ask("owner", "pass --user <login> to check ownership", key, value);
  if (remote !== undefined && !sameName(remote.host, loginHost)) {
    return ask("owner", `the login is for ${loginHost}, the repo is on ${remote.host}`, key, value);
  }
  if (remote !== undefined && !isMine(remote)) {
    return ask("owner", `${remote.owner}/${remote.repo} is not your repo; add the owner to workflow.git.owners to allow it`, key, value);
  }
  if (foreignPush !== undefined) {
    return ask("owner", `a push URL of origin goes to owner ${foreignPush.owner} on ${foreignPush.host}, which is not yours`, key, value);
  }
  if (otherRepoPush !== undefined) {
    return ask("owner", `a push URL of origin goes to another repo, ${otherRepoPush.owner}/${otherRepoPush.repo} on ${otherRepoPush.host}`, key, value);
  }
  if (prAuthor !== undefined && (user === undefined || !sameName(prAuthor, user))) {
    return ask("owner", `the PR is by ${prAuthor}`, key, value);
  }
  if (key !== null && value === null) return ask("policy", `workflow.git.${key} is not set in profile "${profile.name}"`, key, value);
  if (action === "merge") {
    return { decision: value as Decision, kind: "policy", key, value, reason: `workflow.git.merge is "${String(value)}" in profile "${profile.name}"` };
  }
  if (!state.repo) return ask("state", "the current folder is not in a git repository", key, value);
  if (state.branch === undefined) return ask("state", "HEAD is detached", key, value);
  if (state.defaultBranch === undefined) return ask("state", "no default branch found", key, value);
  if (action === "pr" && state.branch === state.defaultBranch) {
    return ask("state", `${state.branch} is the default branch, and a PR cannot go from the default branch to itself`, key, value);
  }
  return {
    decision: value as Decision,
    kind: "policy",
    key,
    value,
    reason: `workflow.git.${String(key)} is "${String(value)}" in profile "${profile.name}"${on}`,
  };
}
