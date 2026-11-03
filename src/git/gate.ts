import { loadEffectiveConfigReporting } from "../commands/shared.ts";
import type { CliContext } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { parseRemote, readBranchState } from "./branch.ts";
import type { BranchState, RemoteRepo } from "./branch.ts";
import { ghLogin, openPrs, prAuthorOf } from "./hosting.ts";
import type { OpenPr } from "./hosting.ts";
import { decide } from "./policy.ts";
import type { Action, DecisionKind, GitDecision, LoadedProfile } from "./policy.ts";

// An OmtError from config load or profile resolution means "ask", not a failed check.
export async function loadConfigOrError(ctx: CliContext, profile: string | undefined, plan: string | undefined): Promise<LoadedProfile | OmtError> {
  try {
    return await loadEffectiveConfigReporting(ctx, { profile, plan });
  } catch (error) {
    if (!(error instanceof OmtError)) throw error;
    ctx.stderr(`omt: ${error.message}\n`);
    return error;
  }
}

export interface GateInput {
  profile: string | undefined;
  plan: string | undefined;
  yes: boolean;
  actions: Action[];
  // The kind of a gh failure: `owner` when the command can go on without gh, `state` when it needs gh.
  hostFailure: DecisionKind;
}

export interface Gate {
  stop: string | undefined; // the line to print when the command must not act
  loaded: LoadedProfile | OmtError;
  state: BranchState;
  remote: RemoteRepo | undefined;
  user: string | undefined;
  prs: OpenPr[];
}

function blocks(decision: GitDecision, yes: boolean): boolean {
  if (decision.decision === "auto") return false;
  return !yes || decision.kind === "state";
}

function line(decision: GitDecision): string {
  return `${decision.decision}: ${decision.reason}\n`;
}

// Reads the login and the branch's open PRs with gh, then runs the `omt git check` decision for each
// action. `--yes` turns an ask or an off into a go, except in a state where the action cannot run.
export async function gate(ctx: CliContext, input: GateInput): Promise<Gate> {
  const loaded = await loadConfigOrError(ctx, input.profile, input.plan);
  const state = readBranchState(ctx);
  const remote = state.origin === undefined ? undefined : parseRemote(state.origin);
  const result: Gate = { stop: undefined, loaded, state, remote, user: undefined, prs: [] };
  if (remote !== undefined) {
    const hostAsk = (reason: string): GitDecision => ({ decision: "ask", kind: input.hostFailure, key: null, value: null, reason });
    const login = ghLogin(ctx, remote.host);
    if (!login.ok) {
      if (blocks(hostAsk(login.reason), input.yes)) return { ...result, stop: line(hostAsk(login.reason)) };
    } else {
      result.user = login.value;
    }
    if (state.branch !== undefined) {
      const prs = openPrs(ctx, remote, state.branch);
      if (!prs.ok) {
        if (blocks(hostAsk(prs.reason), input.yes)) return { ...result, stop: line(hostAsk(prs.reason)) };
      } else {
        result.prs = prs.value;
      }
    }
  }
  const prAuthor = prAuthorOf(result.prs, result.user);
  for (const action of input.actions) {
    const decision = decide({ action, state, loaded, user: result.user, host: remote?.host ?? "github.com", prAuthor });
    if (blocks(decision, input.yes)) return { ...result, stop: line(decision) };
  }
  return result;
}
