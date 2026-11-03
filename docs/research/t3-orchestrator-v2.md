# T3 Code orchestrator v2: what an agent inside a T3 thread can do

> Note, 2026-10-18: this report reads a T3 Code source snapshot from before T3 Code v0.1.0, which was released on 2026-10-15. Two facts changed in v0.1.0:
>
> - `delegate_task` accepts `isolation: "worktree"`. A child with that option runs in a separate checkout based on the parent's local commit ([tools.ts](https://github.com/pingdotgg/t3code/blob/v0.1.0/apps/server/src/mcp/toolkits/orchestrator/tools.ts#L66)).
> - Agents outside T3 can connect to T3's `/mcp` endpoint with OAuth ([outside-agents.md](https://github.com/pingdotgg/t3code/blob/v0.1.0/docs/user/outside-agents.md)). Thread-only tools such as `delegate_task` and `task_status` still need a T3 thread as the caller ([handlers.ts](https://github.com/pingdotgg/t3code/blob/v0.1.0/apps/server/src/mcp/toolkits/orchestrator/handlers.ts#L19)).
>
> Note, 2026-11-03: T3 PR #25423 ("merge 18 tools into action tools") merged the separate read tool into `t3_thread_configure`. With no arguments, it reads this thread's `modelSelection`, `runtimeMode`, and `interactionMode`. With `modelSelection`, it sets the model, so T3 marks the tool destructive (`apps/server/src/mcp/toolkits/thread/tools.ts:153`).
>
> Release data: [GitHub API, latest release](https://api.github.com/repos/pingdotgg/t3code/releases/latest). Provider setup: [install.md, Providers](https://github.com/pingdotgg/t3code/blob/v0.1.0/docs/user/install.md#providers).

Research date: 2026-10-06.
Source: clone of https://github.com/pingdotgg/t3code, HEAD `a172e1c4` ("feat: native /goal for Codex and Claude, with goal status in the UI").
All paths below are relative to the clone root.
A claim marked "(inferred)" is a conclusion from the code, not a direct read.

## 1. Summary

- The `/mcp` endpoint registers ten toolkits with about 80 tools. The orchestration core is 15 tools in `OrchestratorToolkit` and 17 tools in `ThreadToolkit` (`apps/server/src/mcp/McpHttpServer.ts:717-729`).
- `delegate_task` creates a T3 child thread that runs on any provider instance with a V2 adapter. The child gets only the task text. Parent history is not copied (`docs/orchestration-v2/orchestrator-mcp-server.md:17-20`).
- `role` adds one line and nothing else: `Act as the <role> sub-agent for this task.` followed by a blank line and the task. `general` and an omitted role add nothing (`apps/server/src/mcp/OrchestratorMcpService.ts:564-568`).
- The child thread copies the parent thread record, so it runs in the same project, branch, and worktree path as the parent. It is not isolated (`apps/server/src/orchestration-v2/SubagentProjection.ts:54-55`, inferred from the object spread).
- Runtime mode and interaction mode default to the parent values. A child can only narrow them. Escalation fails with a typed error (`apps/server/src/mcp/OrchestratorMcpService.ts:453-484`).
- `target.options` is checked against the model's option descriptors. An unknown id, a wrong type, a value outside a select list, or a duplicate id fails the whole call with `invalid_request` (`apps/server/src/mcp/OrchestratorMcpService.ts:249-281`, `:1090-1101`).
- An async child wakes the parent with a fixed text: `Delegated task <id> reached a terminal state. Use task_status with taskId <id> to read the result.` The result itself is not in the wake message (`apps/server/src/orchestration-v2/Orchestrator.ts:520-525`).
- The wake is steered into an active parent turn only if the session supports active steering that does not interrupt tools. Claude declares `activeSteeringInterruptsTools: true`, so a Claude parent always gets the wake as a queued turn (`apps/server/src/orchestration-v2/Orchestrator.ts:4625-4653`, `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts:202`).
- `mode: "wait"` blocks up to `timeoutMs` (default 10 minutes, maximum 60 minutes). A timeout does not cancel the child. It sets `waitTimedOut: true` and upgrades the task so its completion wakes the parent later (`apps/server/src/mcp/OrchestratorMcpService.ts:82-83`, `:1575-1630`).
- No limit on concurrent delegated tasks or nesting depth was found. Every thread, including a child, gets its own MCP credential with the `orchestration` capability, so a child can delegate again (`apps/server/src/orchestration-v2/ProviderSessionManager.ts:455-490`).
- Task prompt and message text are capped at 120,000 characters. `create_threads` takes 1 to 20 entries (`packages/contracts/src/orchestratorMcp.ts:40`, `:243-246`).
- Every mutation from a thread caller needs that thread's own active run. After the parent turn ends, writes fail with `parent_not_active`. Reads keep working (`apps/server/src/mcp/threadAccess.ts:94-117`).
- The MCP credential lives in server memory. It expires after 24 hours without a sign of life, and provider turns refresh it. A server restart drops all credentials, and new sessions get new ones (`apps/server/src/mcp/McpSessionRegistry.ts:82`, `:103`, inferred for restart).
- `schedule_task` gives a durable wake-up: interval (minimum 60 s) or fixed wall-clock time. By default each firing is queued into the calling thread (`packages/contracts/src/scheduledTask.ts:24`, `apps/server/src/scheduledTasks/ScheduledTaskService.ts:538-552`).
- Native `/goal` exists for Codex and Claude. No MCP tool sets or reads a goal. An agent can only send `/goal ...` as a queued message through `t3_thread_send` (inferred).

## 2. Findings per question

### Q1. Every MCP tool at `/mcp`

Registration: `apps/server/src/mcp/McpHttpServer.ts:710-729` mounts the transport at path `/mcp` with protocol `2025-06-18` and merges these toolkits: Preview, Orchestrator, Thread, Attachment, Project, Environment, PreviewControls, Worktree, PullRequests, Device.

Authentication: a bearer token is required. A missing or unknown token returns HTTP 401 with `invalid_mcp_credential` (`apps/server/src/mcp/McpHttpServer.ts:62-127`).

Caller types: a thread caller is a provider session T3 launched for one thread. A client caller is an outside agent signed in through MCP OAuth with a runtime-mode ceiling (`apps/server/src/mcp/McpInvocationContext.ts:22-51`). This report focuses on thread callers.

Capabilities on a thread credential: `orchestration`, `worktree`, `pull-requests`, plus `preview` and `device` when the user allows them (`apps/server/src/orchestration-v2/ProviderSessionManager.ts:455-460`).

Common guards (`apps/server/src/mcp/threadAccess.ts`):

- `readCaller` needs the `orchestration` capability (`:42-77`).
- `readMutationCaller` also needs the caller's thread to be unarchived, to have an active run, and to run on the credential's provider instance. Otherwise it fails with `parent_not_active` (`:94-117`).
- `readWritableThread` adds a check that the target's modes are not broader than the caller's (`:194-201`).
- `readFullAccessCaller` needs `full-access` runtime mode and `default` interaction mode (`:124-136`).

#### Orchestrator toolkit (`apps/server/src/mcp/toolkits/orchestrator/tools.ts`)

| Tool | Purpose | Key input | Key output | Notable rules |
| --- | --- | --- | --- | --- |
| `orchestrator_capabilities` | List providers, models, option descriptors, inherited settings, feature flags | none | `parentThreadId`, `inheritedProviderInstanceId`, `inheritedModel`, `runtimeMode`, `interactionMode`, `providers[]` (models with `options`, `canRunChildTask`, `constraints`), `features` (`maxBatchThreads: 20`) | Read-only. Same live catalog as the composer (`:46-57`, `OrchestratorMcpService.ts:1462-1503`) |
| `delegate_task` | Create a T3-owned child thread and run the task | `task`, `target{providerInstanceId, driverKind, model, options}`, `title`, `role`, `mode`, `timeoutMs`, `clientRequestId`, `runtimeMode`, `interactionMode` | `taskId`, `childThreadId`, `childRunId`, `status`, `workState`, `summary`, `waitTimedOut`, `latestTerminal*` | Thread caller only. Needs an active parent run. See Q2 (`:59-70`) |
| `task_status` | Read one delegated task of this thread | `taskId` | Same shape as `delegate_task` | Rejects a task of another parent. Reading a terminal result acknowledges its automatic delivery (`:72-84`) |
| `task_cancel` | Stop a delegated task and its descendants | `taskId`, `reason` (max 2,000), `clientRequestId` | `taskId`, `status` (`cancel_requested` or the terminal status) | Uses `thread.stop` on the child, then stops every task the child delegated, then disposes delivery (`:86-96`, `OrchestratorMcpService.ts:1633-1731`) |
| `schedule_task` | Create a recurring scheduled task | `prompt`, `schedule`, `title`, `enabled`, `projectId`, `bindToCurrentThread`, `clientRequestId` | `scheduledTaskId`, `schedule`, `nextRunAt`, `boundThreadId`, `lastRunStatus` | See Q5 (`:98-109`) |
| `list_scheduled_tasks` | List scheduled tasks | `projectId` | `tasks[]` | Defaults to the caller's project (`:111-123`) |
| `update_scheduled_task` | Change fields of a task | `scheduledTaskId`, optional `prompt`, `title`, `schedule`, `enabled`, `bindToCurrentThread` | task summary | Task modes must be within the caller's modes (`:125-135`, `OrchestratorMcpService.ts:1284-1311`) |
| `delete_scheduled_task` | Delete a task | `scheduledTaskId` | `deleted: true` | Same mode check (`:137-147`) |
| `create_threads` | Create 1 to 20 ordinary top-level threads that share the caller's checkout | `threads[]{prompt, title, target, runtimeMode, interactionMode}`, `clientRequestId` | `threads[]{threadId, runId, status, providerInstanceId, model}` | Project, branch, and worktree always inherit. Entries run one at a time (`concurrency: 1`). Needs an active run (`:149-160`, `OrchestratorMcpService.ts:1732-1918`) |
| `t3_thread_list` | List project threads, newest first | `projectId`, `statuses`, `titleContains`, `settled`, `includeSubagents`, `cursor`, `limit` (max 100, default 50) | `threads[]`, `nextCursor`, `total`, `currentThreadId` | Subagent threads are included unless `includeSubagents: false` (`:162-174`, `OrchestratorMcpService.ts:1885-1919`) |
| `t3_thread_read` | Read thread state and a paged timeline | `threadId`, `view`, `afterPosition`, `limit`, `runLimit`, `maxCharsPerItem`, `itemId`, `textOffset` | `thread` detail, `recentRuns`, `items[]`, `nextPosition`, `hasMore` | Can acknowledge a child result. See Q4 (`:176-188`) |
| `t3_thread_update` | Rename, regenerate title, link or unlink one PR | `threadId`, `action`, `title`, `pullRequest`, `clientRequestId` | command receipt, title, linked PR | No branch or workspace change (`:190-201`) |
| `t3_thread_send` | Send a message to any thread | `threadId`, `message`, `mode`, `clientRequestId` | `messageId`, `runId`, `status`, `delivery` | Target modes must be within the caller's. See Q4 (`:203-214`) |
| `t3_thread_wait` | Wait for a run to reach a terminal state | `threadId`, `runId`, `timeoutMs` | `runId`, `status`, `timedOut` | Default 10 min, max 60 min. Does not acknowledge a delegated result (`:216-228`) |
| `t3_thread_interrupt` | Interrupt an active run | `threadId`, `runId`, `reason`, `clientRequestId` | `status` (`interrupt_requested`, `no_active_run`, or terminal) | Target modes must be within the caller's (`:230-240`) |

#### Thread toolkit (`apps/server/src/mcp/toolkits/thread/tools.ts`)

All tools here default `threadId` to the calling thread. Writes use `readWritableThread`.

| Tool | Purpose | Key input | Key output | Notable rules |
| --- | --- | --- | --- | --- |
| `run_scheduled_task_now` | Fire a scheduled task now | `taskId` | `threadId`, `lastRunStatus`, `runCount`, `nextRunAt` | Full-access/default caller. Completion means dispatch, not a finished turn (`:253-268`, `handlers.ts:79-101`) |
| `t3_thread_search` | Bounded search of titles and content | search fields, `projectId` | `matches[]` | Filters global top matches to one project. No paging (`:239-251`) |
| `t3_thread_fork` | Fork a thread | `threadId`, `sourcePoint`, `title` | `sequence`, `targetThreadId` | Source point is `latest_stable`, `run`, or `checkpoint` (`:199-209`, `packages/contracts/src/orchestrationV2.ts:134-138`) |
| `t3_thread_merge_back` | Merge context from one thread back to a related one | `sourceThreadId`, `targetThreadId`, `sourcePoint` | `sequence`, `targetThreadId` | Both threads must be writable (`:210-220`, `handlers.ts:137-153`) |
| `t3_thread_transfers` | List context transfers | `threadId` | `transfers[]{id, sourceThreadId, targetThreadId, status}` | Read-only (`:221-237`) |
| `t3_thread_configure` | Read model selection and modes; set provider, model, options | `threadId`, `modelSelection` (both optional) | `modelSelection`, `runtimeMode`, `interactionMode`, or `sequence` | Reads with no `modelSelection`. Does not change permission modes (`:174-196`) |
| `t3_pending_request_list` | List pending user questions | `threadId` | `requestIds[]` | Approval requests are excluded (`:147-155`) |
| `t3_pending_request_read` | Read one question | `threadId`, `requestId` | `questions[]` | (`:156-164`) |
| `t3_pending_request_respond` | Answer a question | `threadId`, `requestId`, `answers` | `sequence` | Cannot approve permissions (`:165-172`) |
| `t3_thread_organize` | Pin, snooze, settle, archive, mark unread | `threadId`, `action`, `snoozedUntil` | `sequence` | `snooze` needs `snoozedUntil` (`:31-59`) |
| `t3_queue_list` | List queued messages | `threadId`, `cursor`, `limit` (1 to 100, default 20) | `items[]` (text cut at 1,000 chars), `nextCursor` | (`:77-92`, `handlers.ts:225-238`) |
| `t3_queue_read` | Read one queued message | `threadId`, `queuedRunId` | text up to 16,000 chars | (`:93-100`) |
| `t3_queue_edit` | Replace queued text | `queuedRunId`, `text` (max 100,000) | `sequence` | Keeps attachments (`:101-109`) |
| `t3_queue_cancel` | Cancel a queued run | `queuedRunId` | `sequence` | (`:110-114`) |
| `t3_queue_reorder` | Move a queued run | `queuedRunId`, `beforeRunId` or null | `sequence` | (`:115-119`) |
| `t3_queue_promote_to_steer` | Deliver a queued message as steering | `queuedRunId`, `targetRunId` | `sequence` | Provider rules apply (`:120-125`) |

#### Project toolkit (`apps/server/src/mcp/toolkits/project/tools.ts`)

| Tool | Purpose | Key input | Key output | Notable rules |
| --- | --- | --- | --- | --- |
| `t3_thread_launch` | Launch one top-level thread with an explicit workspace | `title`, `projectId`, `scratch`, `modelSelection`, `runtimeMode`, `interactionMode`, `workspaceStrategy`, `message` (max 120,000), `attachments` (max 8) | `threadId`, `projectId`, `modelSelection`, `runId`, `status` | Thread caller must be full-access/default. No retry key. See Q4 (`:102-148`, `handlers.ts:42-56`) |
| `t3_project_list` | List projects | `cursor`, `limit` (1 to 100) | `projects[]`, `nextCursor` | (`:43-57`) |
| `t3_project_read` | Read one project | `projectId` | project | (`:58-65`) |
| `t3_project_create` | Register a directory or create a new repo | project fields, optional `workspaceRoot` | project, `commitError` | Full-access caller (`:66-76`, `handlers.ts:36-38`) |
| `t3_project_update` | Update project settings | `projectId`, fields | project | Full-access caller (`:77-82`) |
| `t3_project_delete` | Delete a project | `projectId`, `force` | project | Does not delete the directory (`:83-88`) |
| `t3_project_clone` | Clone a repository | clone input | clone result | Clone only (`:89-101`) |

#### Worktree toolkit (`apps/server/src/mcp/toolkits/worktree/tools.ts`)

| Tool | Purpose | Key input | Key output | Notable rules |
| --- | --- | --- | --- | --- |
| `t3_worktree_handoff` | Move the calling thread into a new worktree | `branch`, `baseRef`, `startFromOrigin`, `path`, `runSetupScript`, `continuationPrompt` | `worktreePath`, `branch`, `baseRef`, `setupScript`, `continuation`, `note` | Ends the current turn. Fails when already in a worktree (`:25-38`, `packages/contracts/src/worktreeMcp.ts:13-50`) |
| `t3_worktree_status` | Report the thread's worktree binding | none | `attached`, `worktreePath`, `branch`, `projectWorkspaceRoot`, `defaultStartFromOrigin` | (`:40-56`) |
| `t3_worktree_list` | List branch refs and checkout paths | `threadId`, `query`, `cursor`, `limit`, `refKind` | ref list | Needs `worktree` capability. Detached worktrees are excluded (`:58-80`) |

#### Pull request toolkit (`apps/server/src/mcp/toolkits/pullRequests/tools.ts`)

| Tool | Purpose | Key input | Key output | Notable rules |
| --- | --- | --- | --- | --- |
| `link_pull_request` | Link a PR to a thread | `threadId`, `url` or `repository`+`number`, `host` | identity, `alreadyLinked` | Idempotent (`:246-257`) |
| `unlink_pull_request` | Remove a link | same | `wasLinked` | (`:259-271`) |
| `list_thread_pull_requests` | List linked PRs and stacks | `threadId` | `pullRequests[]`, `chains[]` | (`:273-288`) |
| `watch_pull_request` | Watch a PR and wake the thread on news | same target | `watching`, `wasWatching` | See Q7 (`:290-302`) |
| `unwatch_pull_request` | Stop watching | same target | `watching`, `wasWatching` | Link stays (`:304-316`) |

#### Attachment toolkit (`apps/server/src/mcp/toolkits/attachment/tools.ts`)

| Tool | Purpose | Key input | Key output | Notable rules |
| --- | --- | --- | --- | --- |
| `t3_attachment_prepare_upload` | Get a signed upload URL | `upload` | upload URL and id | POST the bytes to the MCP HTTP origin (`:33-39`) |
| `t3_attachment_discard` | Discard a pending upload | id | `{}` | (`:40-46`) |
| `t3_thread_send_attachments` | Send uploads to a thread | `threadId`, `message`, `attachments` (1 to 8) | `messageId`, `runId`, `status` | No retry key. Target modes must be within the caller's (`:47-67`) |

#### Environment toolkit (`apps/server/src/mcp/toolkits/environment/tools.ts`)

| Tool | Purpose | Key input | Key output | Notable rules |
| --- | --- | --- | --- | --- |
| `t3_environment_read` | Read server identity and some preferences | none | `environmentId`, `label`, `serverVersion`, `platform`, `preferences` | (`:40-53`) |
| `t3_environment_preferences_update` | Change some environment-wide preferences | `defaultThreadEnvMode`, `newWorktreesStartFromOrigin`, `enableProviderUpdateChecks`, `backgroundActivity`, `sourceControlWritingStyle` | preferences | Full-access/default caller (`:54-66`) |

#### Preview, preview controls, and device toolkits

| Tool | Purpose | Notable rules |
| --- | --- | --- |
| `preview_status`, `preview_open`, `preview_navigate`, `preview_resize`, `preview_set_appearance` | Open and control the shared browser tab | Needs `preview` capability and a thread caller (`apps/server/src/mcp/toolkits/preview/tools.ts:53-118`, `McpInvocationContext.ts:99-109`) |
| `preview_snapshot` | Page state, elements, PNG | Text capped near 20 KB (`preview/tools.ts:120-143`, `McpHttpServer.ts:143`) |
| `preview_click`, `preview_type`, `preview_press`, `preview_scroll`, `preview_wait_for` | Interact | (`preview/tools.ts:145-221`) |
| `preview_evaluate` | Run JavaScript | Result up to 64 KB (`preview/tools.ts:201-210`) |
| `preview_recording_start`, `preview_recording_stop` | Record a tab | Recording up to 50 MiB (`preview/tools.ts:223-242`) |
| `t3_preview_list`, `t3_preview_close` | List and close this thread's tabs | (`apps/server/src/mcp/toolkits/previewControls/tools.ts:18-40`) |
| `device_list`, `device_open`, `device_screenshot`, `device_close` | iOS Simulator and Android Emulator lifecycle | Driving the device goes through the `agent-device` CLI (`apps/server/src/mcp/toolkits/device/tools.ts:21-101`) |

Note: the doc says "eleven orchestration tools" (`docs/orchestration-v2/orchestrator-mcp-server.md:186`). The code has 15 in `OrchestratorToolkit` (`apps/server/src/mcp/toolkits/orchestrator/tools.ts:242-258`). The code is the source of truth.

### Q2. `delegate_task` in depth

#### Target resolution and `target.options` validation

Resolution order (`apps/server/src/mcp/OrchestratorMcpService.ts:998-1113`):

1. With `driverKind` and no `providerInstanceId`, T3 picks the parent's instance if it is of that driver and has no constraints. Otherwise it picks the first available instance of that driver (`:1009-1040`).
2. With no target, the instance is the parent's instance (`:1041`).
3. The instance must be registered, match `driverKind` when given, and have no constraints (`:1043-1065`). Constraints are: no V2 adapter, disabled, not installed, unavailable, status error, or unauthenticated (`:218-242`).
4. The model is the requested model, else the parent's model on the same instance, else `provider.models[0]` (`:1067-1078`).
5. A requested model must be in the provider's model list when that list is not empty. Otherwise `model_unavailable` (`:1079-1089`).
6. `options` is checked by `invalidOptionSelections` (`:1090-1101`).

`options` accepts an array `[{id, value}]` or a record `{id: value}`. A value that is not a string or boolean fails decoding (`packages/contracts/src/orchestratorMcp.ts:70-97`).

Rules in `invalidOptionSelections` (`apps/server/src/mcp/OrchestratorMcpService.ts:241-281`):

- A duplicate id always fails: `Option <id> was specified more than once.`
- If the model has no descriptors, other checks are skipped.
- An unknown id fails: `Unknown option <id>; supported options: <list>.`
- A boolean descriptor needs a boolean value.
- A select descriptor needs a value from its option ids: `Option <id> must be one of: <ids>.`

An invalid option fails the whole call with code `invalid_request` and message `Model <model> on provider <instance> rejected options: <problems>` (`:1096-1100`).

Option inheritance: the child inherits the parent's full `modelSelection`, including options, only when instance and model match and `options` is omitted. A different model without `options` gets no options (`:1103-1112`). The contract comment says the same (`packages/contracts/src/orchestratorMcp.ts:115-121`).

The descriptor ids for Claude (`effort`, `fastMode`, `contextWindow` and others) come from `orchestrator_capabilities` under `providers[].models[].options` (`apps/server/src/mcp/OrchestratorMcpService.ts:1477-1484`). This report did not list the exact Claude descriptor ids. They are live data.

#### `role`

The only role text is built in `taskPrompt` (`apps/server/src/mcp/OrchestratorMcpService.ts:564-568`):

```ts
return input.role === undefined || input.role === "general"
  ? input.task
  : `Act as the ${input.role} sub-agent for this task.\n\n${input.task}`;
```

Role instruction text per value:

| role | Text prepended to the task |
| --- | --- |
| `implementation` | `Act as the implementation sub-agent for this task.` |
| `research` | `Act as the research sub-agent for this task.` |
| `review` | `Act as the review sub-agent for this task.` |
| `design` | `Act as the design sub-agent for this task.` |
| `test` | `Act as the test sub-agent for this task.` |
| `general` | nothing |

No other role-specific text was found. Search: `rg -n "role" apps/server/src/mcp apps/server/src/orchestration-v2/Orchestrator.ts` and `rg -n "sub-agent for this task"` over the clone.

#### Mode ceilings and defaults

- Runtime mode rank: `approval-required` (0) < `auto-accept-edits` (1) < `auto` (2) < `full-access` (3) (`apps/server/src/mcp/OrchestratorMcpService.ts:436-447`).
- Interaction mode rank: `plan` (0) < `default` (1) (`:449-451`).
- Omitted or `inherit` resolves to the parent's mode (`:457`, `:472`).
- A broader child mode fails with `runtime_mode_escalation_denied` or `interaction_mode_escalation_denied` (`:458-466`, `:473-483`).
- The same ceiling applies to `create_threads` entries, `t3_thread_send`, `t3_thread_interrupt`, and edits of scheduled tasks (`:1754-1761`, `:2016-2017`, `:2085-2087`, `:1301-1302`).

#### What the child receives

1. A user message with `text: command.task`, which is the role line plus the task (`apps/server/src/orchestration-v2/Orchestrator.ts:6575-6587`). Dispatch mode is `start_immediately`.
2. The provider's normal system context and T3 runtime instructions, because the child is an ordinary V2 provider session (inferred).
3. The shared T3 orchestration instructions, since every session gets an MCP credential and the adapters add the instructions when MCP is present (see Q3) (inferred).
4. No parent history. The doc states "Parent conversation history is not copied into the child" (`docs/orchestration-v2/orchestrator-mcp-server.md:19-20`). A `subagent_spawn` context transfer is recorded as `consumed` with no handoff content (`apps/server/src/orchestration-v2/Orchestrator.ts:6597-6630`).

#### How the result returns to the parent

- The parent gets an `app_owned` subagent row, an execution node, and a `subagent` turn item when the task starts (`apps/server/src/orchestration-v2/Orchestrator.ts:6467-6573`).
- `delegate_task` sets `completionWake` to `"always"` for async and `"settled_only"` for wait (`apps/server/src/mcp/OrchestratorMcpService.ts:1551-1554`).
- When the child terminates, finalization records a `subagent_result` transfer and plans a delivery (`apps/server/src/orchestration-v2/Orchestrator.ts:8954-9140`).
- For `settled_only`, no wake is sent while the spawning parent run is still live. The blocking wait owns delivery (`:9001-9013`).
- Results that arrive while a delivery is queued join the same delivery message. One message can name several task ids (`:9019-9050`, `:9516-9548`).
- The wake message text comes from `delegatedCompletionWakeDetail` (`apps/server/src/orchestration-v2/Orchestrator.ts:520-525`):
  - One task: `Delegated task <id> reached a terminal state. Use task_status with taskId <id> to read the result.`
  - Several tasks: `Delegated tasks <id1>, <id2> reached terminal states. Use task_status with each taskId to read the results.`
- Steered or queued: the delivery is a server-created `queue_after_active` message. It becomes `steer_active` only when all task ids have `completionWake: "always"`, the parent has a running turn, and the live session has `supportsActiveSteering` true and `activeSteeringInterruptsTools` not true (`apps/server/src/orchestration-v2/Orchestrator.ts:4583-4655`). Otherwise it queues and starts a new parent run.
- Acknowledgment: `task_status`, an async `delegate_task` read, or a `t3_thread_read` of the child that includes the full terminal result marks the delivery `acknowledged` (`apps/server/src/mcp/OrchestratorMcpService.ts:1241-1272`, `:1965-1993`). `t3_thread_wait` does not acknowledge (`apps/server/src/mcp/toolkits/orchestrator/tools.ts:216-218`). The effect of acknowledgment on a pending wake was not traced in full (see Open questions).

#### `mode: "wait"` and `mode: "async"`

- Default is `async` (`packages/contracts/src/orchestratorMcp.ts:176-181`).
- `async` returns the current state at once (`apps/server/src/mcp/OrchestratorMcpService.ts:1572-1574`).
- `wait` polls every 50 ms until a terminal task status (`:84`, `:1276-1282`).
- `timeoutMs` default is 600,000 ms. The value is clamped to 1 to 3,600,000 ms (`:82-83`, `:1575-1578`).
- On timeout the call returns `waitTimedOut: true` and dispatches `delegated_task.wake-policy` with `completionWake: "always"` (`:1583-1630`). The child keeps running.
- If the child is already terminal and the parent run is live at upgrade time, the wake-policy handler plans a delivery at once (`apps/server/src/orchestration-v2/Orchestrator.ts:6694-6712`).
- A later `task_status` always returns `waitTimedOut: false` (`packages/contracts/src/orchestratorMcp.ts:208-211`).
- "Terminal" for `wait` means the task status is terminal. A child turn that finished while its own children still run reports `workState: "waiting_for_children"` and stays nonterminal (`apps/server/src/mcp/OrchestratorMcpService.ts:1173-1195`, `apps/server/src/orchestration-v2/SubagentProjection.ts:210-255`).

#### Limits

| Limit | Value | Evidence |
| --- | --- | --- |
| Task prompt | 120,000 chars, trimmed, non-empty | `packages/contracts/src/orchestratorMcp.ts:40-42` |
| Title | 512 chars. Child thread title is clipped to 72 chars | `orchestratorMcp.ts:43`, `apps/server/src/orchestration-v2/SubagentProjection.ts:28-40` |
| `clientRequestId` | 256 chars | `orchestratorMcp.ts:46-48` |
| Cancel reason | 2,000 chars | `orchestratorMcp.ts:222` |
| Concurrent delegated tasks | not found | searched `rg -n "MAX_\|maxConcurren\|limit" apps/server/src/orchestration-v2 apps/server/src/mcp` |
| Nesting depth | not found. Nesting works | children get credentials (`ProviderSessionManager.ts:455-490`). `waiting_for_children` and recursive stop exist (`ThreadManagementService.ts:734-756`) |
| Result `summary` size | no truncation found in `task_status` | `apps/server/src/orchestration-v2/SubagentProjection.ts:158-208`. Provider failure messages are capped at 4,096 chars (`apps/server/src/orchestration-v2/ProviderFailure.ts:19`) |
| `t3_thread_read` item text | default 20,000 chars per item, max 50,000, continue with `textOffset` | `apps/server/src/mcp/OrchestratorMcpService.ts:88`, `orchestratorMcp.ts:343` |

#### Workspace of the child

`makeSubagentChildThread` returns `{ ...input.parentThread, ... }` and overrides id, title, model, lineage, and timestamps. It does not override `projectId`, `branch`, or `worktreePath` (`apps/server/src/orchestration-v2/SubagentProjection.ts:42-83`). The child therefore uses the same checkout as the parent (inferred). Parallel implementation children edit the same files.

#### Where `summary` comes from

`subagentResultForRun` (`apps/server/src/orchestration-v2/SubagentProjection.ts:158-208`) picks, in order:

1. For a failed run, the message of the latest `error` turn item.
2. The latest non-empty assistant message of the result run.
3. The latest non-empty `assistant_message` turn item.
4. `Child task completed without an assistant result.` or `Child task ended with status <status>.`

The result run is the latest terminal, non-monitor, non-rolled-back run (`:210-255`). After publication, `summary` stays fixed. Later follow-up runs appear in `latestTerminal*` (`apps/server/src/mcp/OrchestratorMcpService.ts:1216-1240`).

#### Idempotency

- With `clientRequestId`, command id, child thread id, and message id are derived from it and from `requestNamespace` (`apps/server/src/mcp/OrchestratorMcpService.ts:487-562`).
- `requestNamespace` is the provider session id of the credential (`apps/server/src/mcp/McpSessionRegistry.ts:131-134`). A retry under a new credential creates new work (inferred).
- Without `clientRequestId`, each call creates new work (`apps/server/src/mcp/OrchestratorMcpService.ts:1115-1118`).

### Q3. Shared T3 orchestration instructions

Full text of `T3_CODE_ORCHESTRATION_INSTRUCTIONS` (`apps/server/src/provider/T3OrchestrationInstructions.ts:3-31`), with template escapes resolved:

```text
## T3 Code orchestration

The `t3-code` MCP server provides app-owned orchestration. Treat these concepts distinctly:

- A delegated task/subagent is child work owned by the current thread. Use `orchestrator_capabilities` to discover the current provider/model IDs from the same live catalog as the composer, including configured custom models. Do not treat a native tool's model list as the full list of available subagent models. Prefer native subagent tools for same-provider work only when they support the chosen model. Use `delegate_task` with that provider instance and model when native tools cannot, including for same-provider work. Also use `delegate_task` for cross-provider or explicitly T3-owned child tasks. Retain each returned `taskId`, and use `task_status` or `task_cancel` to manage it. The returned `childThreadId` is backing storage for the subagent, not the target for starting another delegated review round.
- `t3_thread_launch` and `create_threads` create ordinary top-level T3 conversations. Use them only when the user explicitly asks for separate/new/top-level threads or conversations. Never use them merely because the user said "subagent" or requested parallel delegated work.
- For every T3 delegated review round, call `delegate_task` again. Include the original brief, prior findings, responses, and unresolved objections in each new task prompt. Track each round by its own `taskId`. Use a distinct `clientRequestId` per round, stable across retries of that round. Do not use `t3_thread_send` on `childThreadId` to continue a delegated review.
- `schedule_task` creates persistent recurring work in the app scheduler. Pass `schedule` as a structured object, never as JSON text: `{"type":"interval","everyMs":3600000}` for an interval, or `{"type":"fixed_time","timeOfDay":"09:00","weekdays":[1,2,3,4,5]}` for a wall-clock schedule. By default runs return to the current thread; set `bindToCurrentThread=false` only when the user wants a fresh thread for every run. After scheduling, report the returned cadence and next run time.

### Choose the workspace before starting a new thread

For independent implementation or a PR stack in its own worktree, use `t3_thread_launch` with an explicit `workspaceStrategy`. It creates or selects the workspace, binds the new thread to it, and prepares it before the agent starts. Put the task in `message`, not `prompt`:

- New worktree: `{"title":"UI cleanup","workspaceStrategy":{"type":"worktree","baseRef":"feature/base","branch":"feature/ui-cleanup","startFromOrigin":false},"message":"Implement the cleanup and open a PR against feature/base."}`
- Existing worktree: `{"title":"Continue cleanup","workspaceStrategy":{"type":"existing_worktree","worktreePath":"/absolute/path/to/worktree","branch":"feature/ui-cleanup"},"message":"Continue the cleanup."}`
- Project's main checkout: `workspaceStrategy:{"type":"root"}`. Omitting workspaceStrategy also selects root; it does not inherit the caller's worktree.

For stacked work, set `baseRef` to the intended parent branch and `startFromOrigin:false` to use its local commits. Use `startFromOrigin:true` when you intend to fetch and start from origin. Uncommitted edits are not copied. Use `t3_worktree_list` to discover existing checkout paths. Project, model selection, and modes inherit unless supplied; launch requires a full-access/default caller.

`t3_thread_launch` is the single-thread launch tool. Use `create_threads` only for a batch of threads intentionally sharing the caller's checkout: it always inherits the caller's project, branch, and worktree and has no workspace override. Asking an agent to run `git worktree add` or `cd` in its prompt does not update T3's thread binding. Select the workspace in the launch call instead. `t3_worktree_handoff` moves the calling thread, not another thread, and cannot move a thread already attached to a worktree.

`t3_thread_launch` has no idempotency key. Retain its returned threadId and inspect it with `t3_thread_read` / `t3_thread_wait`; preparation can still be running after acceptance. If a launch fails or its response is lost, inspect `t3_thread_list` before retrying, since a thread may already exist.

Tool names may include a harness-normalized MCP prefix, such as `mcp__t3_code__delegate_task`; the semantics are the same. Some harnesses attach optional MCP servers lazily: if an initial tool-catalog scan does not show T3 tools, do not conclude that cross-provider delegation is unavailable. Make one bounded direct attempt using the known T3 tool name on the next tool step. In Codex code mode, for example, call `tools.mcp__t3_code__orchestrator_capabilities({})` before reporting that the capability is absent. Keep polling/wait loops bounded, do not duplicate active work, and use stable `clientRequestId` values when retrying tools that accept them.

ACP fallback: some ACP agents accept the injected MCP server but fail to expose its tools. When the T3 tools are absent and `T3_ACP_MCP_NODE` is present, call the same tools through the terminal: `ELECTRON_RUN_AS_NODE=1 "$T3_ACP_MCP_NODE" ${T3_ACP_MCP_ENTRYPOINT:+"$T3_ACP_MCP_ENTRYPOINT"} acp-mcp-call orchestrator_capabilities '{}'` (`T3_ACP_MCP_ENTRYPOINT` is unset when T3 runs as a standalone executable). Delegate with `acp-mcp-call delegate_task '{"task":"...","target":{"providerInstanceId":"...","model":"..."},"mode":"async","clientRequestId":"..."}'`. This is the supported T3 transport fallback, not an ordinary shell-based substitute for delegation.
```

The same file also defines `T3_CODE_BROWSER_TOOL_INSTRUCTIONS` (`:33-42`) and two ACP interaction-mode blocks (`:44-50`). The ACP plan-mode block reads: "Investigate with read-only actions and do not edit files or otherwise execute the implementation. Resolve discoverable facts before asking questions. When the requirements are decision complete, return a concrete implementation plan and do not start implementing it. Treat this mode as active until T3 Code supplies a different interaction-mode instruction." (`:48-50`).

How each driver receives the orchestration instructions:

| Driver | Channel | Condition and timing | Evidence |
| --- | --- | --- | --- |
| codex | Turn `additionalContext` entry `t3_code_orchestration` of kind `application` | Each turn start when `hasT3Mcp`. Resent when it changes | `apps/server/src/provider/CodexDeveloperInstructions.ts:205-225`, `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts:734-743`, `:1661-1671` |
| claudeAgent | Appended to the `claude_code` preset system prompt | Session options when `mcpServers` is set | `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts:909-915` |
| cursor | Wrapped in `<t3_code_orchestration_instructions>` before the first user prompt | Only run ordinal 1, when MCP exists | `apps/server/src/orchestration-v2/Adapters/CursorAdapterV2.ts:2129-2140`, `T3OrchestrationInstructions.ts:90-102` |
| opencode | Session system prompt | When the T3 MCP session exists and the connection is not external | `apps/server/src/orchestration-v2/Adapters/OpenCodeAdapterV2.ts:973-976` |
| opencode2 | Session instructions entry | When MCP is attached. Updated when the text changes | `apps/server/src/orchestration-v2/Adapters/OpenCode2AdapterV2.ts:3262-3274` |
| grok, acpRegistry, antigravity (ACP) | `<t3_code_instructions>` wrapper in the user prompt, with interaction-mode, browser, and orchestration blocks | First prompt, and again when interaction mode or MCP presence changes. Skipped when the prompt starts with `/` | `T3OrchestrationInstructions.ts:57-83`, `apps/server/src/orchestration-v2/Adapters/AcpAdapterV2.ts:6728-6745` |
| pi | Generated extension appends to the system prompt in `before_agent_start` | Every agent start when the extension loads | `apps/server/src/orchestration-v2/Adapters/piT3McpExtensionSource.ts:32`, `:322-326` |

Antigravity and Grok use the shared ACP adapter (inferred from `...AcpProviderCapabilitiesV2` at `AntigravityAdapterV2.ts:47` and `GrokAdapterV2.ts:81`).

### Q4. Thread tools

#### `t3_thread_launch`

- `workspaceStrategy` variants (`packages/contracts/src/orchestrationV2.ts:518-534`):
  - `{type: "root", branch?}`: the project checkout. Default when omitted.
  - `{type: "existing_worktree", worktreePath, branch?}`: bind an existing checkout.
  - `{type: "worktree", baseRef, branch?, startFromOrigin?}`: create a new worktree.
- `scratch: true` runs without a project, in a new folder. It cannot be combined with `projectId` or `workspaceStrategy` (`apps/server/src/mcp/toolkits/project/tools.ts:108-113`, `handlers.ts:69-77`).
- Project, model, and modes inherit from the caller. Workspace does not (`project/tools.ts:105`).
- A thread caller must be full-access/default (`handlers.ts:46-55`).
- Each call creates a new launch. There is no retry key. Thread id is derived from a random command id (`handlers.ts:59-61`).
- Uncommitted edits are not copied into a new worktree (`T3OrchestrationInstructions.ts:22`).
- Workspace preparation can still run after acceptance. A failed preparation leaves an error item with code `workspace_preparation_failed` (`packages/contracts/src/orchestrationV2.ts:538-539`).

#### `create_threads`

- 1 to 20 entries (`packages/contracts/src/orchestratorMcp.ts:242-246`).
- Each entry resolves provider, model, options, and modes like `delegate_task` (`apps/server/src/mcp/OrchestratorMcpService.ts:1749-1761`).
- Threads copy the caller's `projectId`, `branch`, and `worktreePath` (`:1790-1792`).
- Entries with a prompt start at once. Entries without one stay idle (`:1801-1830`).
- The parent timeline gets a `thread_created` record (`:1834-1855`).
- The threads have no subagent lineage, so they never wake the parent (inferred).

#### `t3_thread_send`

Modes (`apps/server/src/orchestration-v2/ThreadManagementService.ts:554-575`):

- `auto` (default): steer the latest steerable run if there is one, else start immediately.
- `queue`: `queue_after_active`, a separate later run.
- `steer`: needs a steerable run, else `thread_not_sendable`.
- `restart`: needs a steerable run. It interrupts and restarts.

The result `delivery` is `started`, `queued`, `steered`, or `restarted` (`:619-629`). The target can be any thread in the environment, not only the project (`apps/server/src/mcp/toolkits/orchestrator/tools.ts:203-205`). The doc says "calling project" (`docs/orchestration-v2/orchestrator-mcp-server.md:370`). Sending to another thread needs the caller's live run (`apps/server/src/mcp/OrchestratorMcpService.ts:935-942`, `:2015`). Messages are recorded with `createdBy: "agent"`, `creationSource: "mcp"`, and `senderThreadId` (`:2027-2041`).

#### `t3_thread_wait`

- Without `runId`, it pins the latest run at call time. An idle thread returns at once (`apps/server/src/orchestration-v2/ThreadManagementService.ts:634-650`).
- It polls every 250 ms by default (`:662`).
- Timeout default 10 minutes, max 60 minutes. A timeout reports status and does not cancel (`apps/server/src/mcp/OrchestratorMcpService.ts:2061-2080`).

#### `t3_thread_read`

- `view: "messages"` (default) returns user messages, assistant messages, and proposed plans. `view: "activity"` returns all summarized items (`apps/server/src/mcp/toolkits/orchestrator/tools.ts:176-178`).
- Incremental reads: pass `afterPosition = nextPosition` from the last call. `limit` max 100, default 50 (`packages/contracts/src/orchestratorMcp.ts:335-344`, `apps/server/src/mcp/OrchestratorMcpService.ts:86`, `:1925-1927`).
- Long text: item text is cut at `maxCharsPerItem` (default 20,000, max 50,000). Read the rest with `itemId` and `textOffset = nextTextOffset` (`apps/server/src/mcp/OrchestratorMcpService.ts:739-775`).
- `recentRuns` default 10, max 50 (`:87`, `orchestratorMcp.ts:342`).
- Any thread in the environment is readable (`apps/server/src/mcp/toolkits/orchestrator/tools.ts:178`).
- Reading the full terminal result of a direct child acknowledges its delivery (`apps/server/src/mcp/OrchestratorMcpService.ts:1965-1993`).
- Thread detail includes `branch`, `worktreePath`, `pendingRequestCount`, `parentThreadId`, `relationshipToParent`, `linkedPullRequest`, and `settled` (`packages/contracts/src/orchestratorMcp.ts:347-374`). It has no `goal` field.

#### `t3_thread_search`

Uses the app's bounded search, then filters to one project. It may return fewer than `limit`. No paging (`apps/server/src/mcp/toolkits/thread/tools.ts:239-251`, `handlers.ts:102-117`).

#### `t3_thread_fork` and `t3_thread_merge_back`

- Fork dispatches `thread.fork` from `latest_stable`, a `run`, or a `checkpoint`. The new thread id is `<commandId>:fork`. The fork inherits configuration. Acceptance does not mean a turn finished (`apps/server/src/mcp/toolkits/thread/handlers.ts:118-136`).
- Merge-back dispatches `thread.merge_back` from a source thread into a related target thread. Lineage and transfer rules apply (`handlers.ts:137-153`).
- The transfer strategy is `native_fork`, `portable_context`, `delta_context`, `fork_delta_context`, or `checkpoint_context` (`packages/contracts/src/orchestrationV2.ts:141-162`). Drivers without native fork use portable context (`docs/orchestration-v2/orchestrator-mcp-server.md:111-115`).

#### `t3_thread_organize`

Actions: `pin`, `unpin`, `snooze` (needs `snoozedUntil`), `unsnooze`, `settle`, `unsettle`, `archive`, `unarchive`, `mark_unread`. It does not schedule anything (`apps/server/src/mcp/toolkits/thread/tools.ts:31-59`, `handlers.ts:278-305`).

#### `t3_thread_configure`

With no `modelSelection`, it reads `modelSelection`, `runtimeMode`, and `interactionMode`. With `modelSelection`, it sets the model with the app's selection command. It cannot change modes (`apps/server/src/mcp/toolkits/thread/tools.ts:174-196`, `handlers.ts:168-196`). No MCP tool changes a thread's runtime or interaction mode (inferred from the tool list).

#### Queue tools and pending request tools

See the Thread toolkit table in Q1. Queue edits are rejected when the run is no longer queued (`apps/server/src/mcp/toolkits/thread/tools.ts:101-109`). Pending request tools cover user questions only. They cannot answer approval requests (`:147-172`).

### Q5. Scheduled tasks

Schedule shapes (`packages/contracts/src/scheduledTask.ts:24-88`):

- `{type: "interval", everyMs}`. Writes need `everyMs >= 60000`. Older rows below the minimum are run at 60 s (`apps/server/src/scheduledTasks/Schedule.ts:16-22`).
- `{type: "fixed_time", timeOfDay: "HH:MM", weekdays?: [0..6]}`. `0` is Sunday. Omitted or empty weekdays means daily. The time is local wall-clock time.
- A JSON string form is accepted for OpenCode compatibility (`packages/contracts/src/orchestratorMcp.ts:50-68`).

Thread binding (`apps/server/src/mcp/OrchestratorMcpService.ts:1315-1375`):

- `bindToCurrentThread` defaults to true when the caller is a thread in the target project.
- A bound task stores `threadId` and workspace strategy `root`.
- An unbound task stores workspace strategy `{type: "worktree", baseRef: "main", startFromOrigin: true}` (`:196-202`). The base ref is hard-coded to `main`.
- Model selection, runtime mode, and interaction mode come from the calling thread at creation (`:1338-1355`). `update_scheduled_task` cannot change them (`:1423-1435`).

What runs at each firing (`apps/server/src/scheduledTasks/ScheduledTaskService.ts:507-552`):

- Bound: `sendToThread` with `mode: "queue"` and the stored prompt. Comment: "Scheduled prompts must not interrupt tools in the bound thread."
- Unbound: `threadLaunch.launch` with the stored title, model, modes, and workspace strategy.
- The prompt is read from the fresh row at fire time.

Timing and missed runs:

- The scheduler ticks every 5 seconds (`apps/server/src/scheduling/Scheduler.ts:60`).
- A task whose `last_run_status` is `running` is not picked again (`ScheduledTaskService.ts:177`). "Running" covers dispatch and bookkeeping, not the provider turn (`apps/server/src/mcp/toolkits/thread/tools.ts:256`).
- An overdue interval task runs once to catch up (`Schedule.ts:80-85`).
- A fixed-time run more than 10 minutes late is skipped and moved to its next slot (`Schedule.ts:73-93`).
- Rows stuck in `running` after a crash are recovered at start (`ScheduledTaskService.ts:647-696`).
- The next run is computed from the completion time (`ScheduledTaskService.ts:567`).

MCP tools: `schedule_task`, `list_scheduled_tasks`, `update_scheduled_task`, `delete_scheduled_task` (orchestrator toolkit), and `run_scheduled_task_now` (thread toolkit, full-access/default caller).

### Q6. Goals (commit `a172e1c4`)

- Representation: `OrchestrationV2ProviderGoal` has `objective`, `status`, and provider-specific usage fields. Status is `active`, `paused`, `blocked`, `usage_limited`, `budget_limited`, or `complete`. Codex reports `tokensUsed`, `tokenBudget`, `timeUsedSeconds`. Claude reports `checks` and `lastCheck` (`git show a172e1c4 -- packages/contracts/src/orchestrationV2.ts`, now at `packages/contracts/src/orchestrationV2.ts:842-868`).
- The goal lives on the provider thread (`OrchestrationV2ProviderThread.goal`). The thread shell exposes the goal of the active provider thread (`apps/server/src/orchestration-v2/ProjectionStore.ts:1465`).
- Set and clear: the user sends `/goal <objective>`. `/goal` alone shows the goal. `/goal clear` removes it. Codex also has `/goal pause` and `/goal resume` (`docs/user/composer.md`, section "Goals").
- A `/goal` command can never steer a running turn. Steering it fails with "Goal commands must run as a separate turn. Queue it or wait for the active turn to finish." (`apps/server/src/orchestration-v2/Orchestrator.ts:375-380`, `:3681-3688`).
- Codex: the adapter keeps one run open across the several native turns of a goal (`docs/internals/providers.md`, goal paragraph).
- Claude: the SDK emits no goal events. The adapter parses synthetic transcript text (`Goal set: `, `Goal active: ...`, `Goal cleared: `, `No goal set`) and `Stop hook feedback:` messages. It marks the goal `complete` when a checked turn ends normally with no background work (`git show a172e1c4 -- apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`).
- UI: titles "Pursuing goal", "Goal paused", "Goal blocked", "Goal hit a usage limit", "Goal reached its token budget", "Goal complete", and "Goal set" for an active goal on an idle thread. Usage shows tokens, time, or checks (`packages/client-runtime/src/state/threadExecution.ts`, function `presentProviderGoal`).
- MCP: no tool reads or sets a goal. `rg -n -i goal apps/server/src/mcp packages/contracts/src/orchestratorMcp.ts` returns nothing. An agent can send `/goal ...` to a thread with `t3_thread_send` in `queue` mode, or in `auto` mode on an idle thread (inferred). A `delegate_task` with no role whose task starts with `/goal` would start the child with a goal command (inferred, not tested). A role prefix would stop the slash command from being recognized (inferred).

### Q7. Pull request and worktree tools

Pull requests:

- `link_pull_request` links a PR by URL or `repository`+`number`. T3 tracks it, shows status, and settles the thread when it merges (`apps/server/src/mcp/toolkits/pullRequests/tools.ts:246-257`).
- `unlink_pull_request` removes the link (`:259-271`).
- `list_thread_pull_requests` returns linked PRs with host state and stack chains, bottom first (`:214-244`, `:273-288`).
- `watch_pull_request` links if needed, then checks once a minute. It wakes the thread when a check fails, required checks pass, someone else comments or reviews, or the branch conflicts. Only comments after the call wake the thread. The watch ends when the PR merges or closes, the thread settles, T3 cannot read it for 15 passes (15 minutes), the user stops the thread, or the agent unwatches (`:290-302`, `apps/server/src/orchestration-v2/PullRequestWatchReactor.ts:32-33`, `:275`).
- `unwatch_pull_request` stops the watch and keeps the link (`:304-316`).
- Cross-thread changes fail when the target has broader permissions or the caller has no active run (`:99-106`).

Worktrees:

- `t3_worktree_status` reports the binding of the calling thread (`apps/server/src/mcp/toolkits/worktree/tools.ts:40-56`).
- `t3_worktree_handoff` creates a branch and worktree, re-points the calling thread, and runs the setup script by default. The live provider session detaches and the turn ends. `continuationPrompt` is queued as the next turn. It fails with `already_in_worktree` when the thread already has a worktree. The worktree is not deleted with the thread (`:25-38`, `packages/contracts/src/worktreeMcp.ts:13-128`).
- `t3_worktree_list` lists refs with checkout paths for the thread's workspace (`apps/server/src/mcp/toolkits/worktree/handlers.ts:13-36`).

### Q8. Provider capability matrix

Sources: capability constants in `apps/server/src/orchestration-v2/Adapters/*AdapterV2.ts` and `docs/orchestration-v2/provider-capability-system.md`. "App fallback" means the orchestrator degrades by policy (`docs/orchestration-v2/provider-capability-system.md:216-246`).

| Capability | codex | claudeAgent | cursor | grok | opencode | opencode2 | antigravity | pi | acpRegistry |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Active steering | yes | yes, but interrupts tools | no (interrupt-restart) | no (interrupt-restart) | yes | yes | no (interrupt-restart) (inferred from ACP base) | yes | no (interrupt-restart) |
| Delegated wake steered into active turn | yes | no, queued | no, queued | no, queued | yes | yes | no, queued | yes | no, queued |
| Native fork | yes | yes | no | no | yes | yes | if agent advertises `session/fork` (inferred) | yes | if agent advertises `session/fork` |
| Fork from a turn | yes | yes | no | no | yes | not read | no | yes | no |
| Provider conversation rollback | yes | yes | no | yes (ACP base) | yes | yes | no (`docs/internals/providers.md`) | yes | yes (ACP base) |
| Native plan mode | collaboration mode `plan` | permission mode `plan` | agent mode `plan` | prompt instruction block | agent `plan` | agent `plan`, edit denied | prompt instruction block (inferred) | not found | prompt instruction block |
| Native subagents | yes, thread ids exposed | yes, no thread ids | yes, no thread ids | yes, thread ids | yes, thread ids | yes, thread ids | yes | yes, no thread ids | no |
| MCP injection | `-c mcp_servers.t3-code` and env token | SDK `mcpServers` http | SDK `mcpServers` | ACP `mcpServers` | `client.mcp.add` remote | session MCP | ACP `mcpServers` | T3 extension bridge | ACP, stdio bridge fallback |
| Structured questions | yes | yes | no | yes | yes | not read | yes | yes | yes |
| Runtime policy enforcement | native | native | native | client-boundary (ACP base) | native | native | client-boundary (inferred) | client-boundary | client-boundary |

Evidence per column:

- codex: `CodexAdapterV2.ts:239-334`. Plan mode `:745-749`. MCP: `docs/orchestration-v2/orchestrator-mcp-server.md:59-71`.
- claudeAgent: `ClaudeAdapterV2.ts:179-274`, `activeSteeringInterruptsTools` at `:202`. Plan mode `:1500-1505`. MCP: `orchestrator-mcp-server.md:73-96`.
- cursor: `CursorAdapterV2.ts:84-180`. Plan mode `:316`, `:2212`.
- grok: `GrokAdapterV2.ts:81` onward spreads `AcpProviderCapabilitiesV2` and sets `canForkThread: false`, `supportsSubagents: true`, `exposesSubagentThreadIds: true`, `supportsMcpTools: true`.
- opencode: `OpenCodeAdapterV2.ts:122` onward. Plan agent `:3270`.
- opencode2: `OpenCode2AdapterV2.ts:100-195`. Plan rules `:484`, `:771`. Its constant says `supportsMcpTools: false`, but the adapter still attaches T3 MCP and instructions (`:3262-3274`).
- antigravity: `AntigravityAdapterV2.ts:47` onward spreads the ACP base and sets `supportsMcpTools: true`, `supportsSubagents: true`.
- pi: `PiAdapterV2.ts:119` onward. MCP: `orchestrator-mcp-server.md:146-171`.
- ACP base and acpRegistry: `AcpAdapterV2.ts:540-620`. Runtime overrides by advertised features at `:640-673`. Registry flavor at `AcpRegistryAdapterV2.ts:190-192`.
- Wake steering rule: `Orchestrator.ts:4625-4653`.

All drivers above have a V2 adapter, so all can run delegated children when enabled, installed, and authenticated (`docs/orchestration-v2/orchestrator-mcp-server.md:173-182`).

### Q9. Failure modes

`OrchestratorMcpFailure` codes (`packages/contracts/src/orchestratorMcp.ts:591-614`). The toolkits return them as tool results, not exceptions (`failureMode: "return"`).

| Code | Conditions that produce it | Evidence |
| --- | --- | --- |
| `capability_denied` | Credential lacks `orchestration` or `worktree`. Thread caller not full-access/default for launch, project changes, preferences, `run_scheduled_task_now` | `threadAccess.ts:44-49`, `:124-136`, `OrchestratorMcpService.ts:801-809`, `worktree/handlers.ts:16-20`, `project/handlers.ts:49-55` |
| `parent_not_active` | Caller thread archived, has no active run, or the active run is on another provider instance. `delegate_task` and `create_threads` also need a run root node | `threadAccess.ts:94-106`, `OrchestratorMcpService.ts:954-965`, `:1508-1519`, `:1737-1746` |
| `provider_unavailable` | No adapter for the driver, instance not registered, or any provider constraint | `OrchestratorMcpService.ts:1016-1065` |
| `model_unavailable` | Model not advertised, or no model to inherit | `:1070-1089` |
| `runtime_mode_escalation_denied` | Requested or target runtime mode broader than the caller's | `:453-466` |
| `interaction_mode_escalation_denied` | `default` requested from a `plan` caller, or the same for a target | `:468-484` |
| `task_not_found` | Task id not owned by this parent, or scheduled task id unknown | `OrchestratorMcpService.ts:1136-1142`, `:1305-1308` |
| `task_not_cancellable` | Nonterminal task with no interruptible child run and no live children. `thread.stop` or descendant stop failed | `OrchestratorMcpService.ts:1676-1697`, `:1705-1717` |
| `thread_not_found` | Caller or target thread missing or deleted | `threadAccess.ts:65-70`, `:171-190`, `OrchestratorMcpService.ts:914-916` |
| `run_not_found` | `runId` not in the thread | `OrchestratorMcpService.ts:173-174`, `ThreadManagementService.ts:640-645` |
| `thread_not_sendable` | Target archived, or `steer`/`restart` with no steerable run | `OrchestratorMcpService.ts:175-177` |
| `thread_not_interruptible` | Interrupt on a thread that cannot be interrupted | `:178-179` |
| `invalid_request` | Bad options, driver mismatch, missing project, bad binding, unknown queued message or question, snooze without time | `:1050-1054`, `:1096-1100`, `:1326-1335`, `thread/handlers.ts:72-75`, `:285-290` |
| `orchestration_error` | Projection read or dispatch failure, missing task event, any unmapped error | `OrchestratorMcpService.ts:167-185`, `:1556-1572`, `threadAccess.ts:18-22` |
| `thread_credential_required` | A client caller (not a thread) calls a tool that acts as the caller | `McpInvocationContext.ts:111-123` |
| `target_required` | A client caller omits `projectId` or `threadId` | `threadAccess.ts:139-162` |

Other typed errors:

- `WorktreeMcpFailure`: `capability_denied`, `thread_not_found`, `project_not_found`, `already_in_worktree`, `handoff_in_progress`, `invalid_request`, `operation_failed`, `thread_credential_required` (`packages/contracts/src/worktreeMcp.ts:113-128`).
- Pull request tools return tagged errors such as `PullRequestThreadAboveLimitsError` and `PullRequestNotOpenError` (`apps/server/src/mcp/toolkits/pullRequests/tools.ts:63-176`).
- Device tools return `DeviceToolError`. Preview tools can return `PreviewAutomationUnavailableError`.
- An HTTP 401 `invalid_mcp_credential` means the token is unknown or expired. The agent then loses the whole toolkit for the session (`McpHttpServer.ts:62-127`).

### Q10. Other limits on fan-out and long-running orchestration

- Batch: `create_threads` max 20 entries, run sequentially (`orchestratorMcp.ts:243-245`, `OrchestratorMcpService.ts:1914`). `t3_thread_launch` is one thread per call.
- Credential lifetime: there is no maximum lifetime in code. A credential expires 24 hours after its last sign of life. MCP calls and every provider turn refresh it (`McpSessionRegistry.ts:68-82`, `:168-198`). The doc mentions "a maximum lifetime" (`orchestrator-mcp-server.md:48-50`). The code does not have one.
- Revocation: on provider session release, on thread re-issue, and on `revokeAll` (`McpSessionRegistry.ts:200-218`, `ProviderSessionManager.ts:495-520`).
- Reuse: a still-valid credential is reused across re-attach, for example after a worktree handoff (`ProviderSessionManager.ts:447-480`).
- Parent turn ends while children run: async children keep running. Each terminal result queues a wake run on the parent (`Orchestrator.ts:8954-9140`). The parent cannot call mutating tools between turns, but it is not running then anyway. A `wait`-mode child whose parent turn ends gets a wake as well, because `settled_only` offers delivery when the spawning run is not live (`Orchestrator.ts:9001-9013`).
- User Stop on the parent: `thread.stop` stops delegated tasks recursively and ends PR watches (commit `f32c23cf`, `apps/server/src/orchestration-v2/EffectWorker.ts:462-470`, `ThreadManagementService.ts:734-756`).
- Server restart:
  - Credentials are in memory, so they are gone (inferred from `SynchronizedRef` state at `McpSessionRegistry.ts:103`).
  - Finalization replays persisted events, so results of children that finished are still delivered (`orchestrator-mcp-server.md:423-426`).
  - A running root turn is continued with the prompt "Continue where you left off." when the project setting `continueThreadsAfterServerUpdate` is on (`apps/server/src/orchestration-v2/RestartContinuation.ts:22`, `:90-106`).
  - Delegated children are not treated as provider background work. Their own threads are reconciled and continued (`apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.ts:99-107`).
  - A task cut by restart reports `workState: "working"` until its continuation settles (`apps/server/src/mcp/OrchestratorMcpService.ts:1170-1178`, test `apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts:909`).
  - Provider-native background work cancelled by a restart is reported in the next turn as "Note: the T3 server restarted, and this background work was cancelled before it finished. It will not report back:" with up to 10 entries (`apps/server/src/orchestration-v2/RestartBackgroundNote.ts:84-97`).
- Polling cost: `wait` polls the projection every 50 ms (`OrchestratorMcpService.ts:84`). `t3_thread_wait` polls every 250 ms (`ThreadManagementService.ts:662`).

## 3. Implications for oh-my-t3code

This section is design advice. It is separate from the facts above.

### What the layer can rely on

- Cross-provider delegation with model and option selection, checked before dispatch.
- Durable task state across server restarts, read through `task_status`.
- An automatic wake on completion of async children, also after the parent turn ends.
- Batched wake messages when several children finish close together.
- A mode ceiling that keeps children at or below the parent's permissions.
- Idempotent retries through `clientRequestId` within one provider session.
- Scheduled wake-ups into the same thread, with catch-up for intervals.
- PR watches that wake the thread without polling.
- Recursive cancel through `task_cancel` and user Stop.

### What the layer must work around

- Shared checkout. Delegated children edit the same files as the parent. For parallel implementation, use `t3_thread_launch` with a `worktree` strategy instead, or give each child a disjoint file set. `t3_thread_launch` needs a full-access/default parent and has no retry key.
- Thin roles. `role` adds one sentence. The layer must write its own role prompts (persona, scope, output format, stop rules) into `task`. Use `role: "general"` or omit it when the layer supplies the full prompt, so the prefix does not conflict.
- No parent context. Every task prompt must be self-contained: goal, file paths, constraints, and the expected output format.
- Wake without content. The wake message carries only task ids. The parent must call `task_status` per id. Design the parent loop as "on wake, read every listed task, then decide".
- Claude parents do not get mid-turn steering of results. A Claude orchestrator should end its turn after it dispatches async work, as the tool description advises (`apps/server/src/mcp/toolkits/orchestrator/tools.ts:61`).
- No fan-out cap. The layer must set its own concurrency budget and nesting limit, for example a depth field in each task prompt.
- No summary cap. A child can return a very long final message. Ask children for a bounded, structured final message.
- Idempotency is per provider session. After a credential rotation, a retry with the same `clientRequestId` creates a duplicate. Check `t3_thread_list` with `includeSubagents` before a retry after a lost response.
- Mutations need a live parent run. The layer cannot act from outside a turn. Scheduled tasks and wakes are the only way to resume.
- Unbound scheduled tasks use base ref `main` with `startFromOrigin: true`. Repositories with another default branch need bound tasks or a launch from the scheduled turn.
- Goals have no MCP surface. A goal can only be set by a queued `/goal` message.

### Design recommendations

1. Put an explicit envelope in every `task`: role prompt, objective, inputs, constraints, a depth counter, and a required result schema at the end of the final message.
2. Default to `mode: "async"` and end the turn. Use `wait` only for short, blocking sub-steps, with a short `timeoutMs`.
3. Keep a task ledger in the parent: `taskId`, `clientRequestId`, round number, status. Use one new `delegate_task` per review round, as the shared instructions require.
4. Read `orchestrator_capabilities` once per orchestration to pick models and validate `target.options` locally before the call.
5. Use `t3_thread_launch` with worktrees for independent implementation tracks, and link every PR with `link_pull_request`. Use `watch_pull_request` instead of polling.
6. Use `schedule_task` bound to the orchestrator thread as a heartbeat for long runs, and delete it when the work is done.
7. Treat `parent_not_active`, `provider_unavailable`, and `model_unavailable` as recoverable. Fall back to another model or provider listed in the capabilities.
8. Use `t3_thread_read` with `view: "activity"` and `afterPosition` to inspect a stuck child without acknowledging it. Use `t3_thread_wait` when only status is needed.

Note, 2026-10-28: the workflow fold rejects recommendations 2 and 6 for omt. The main thread waits for children inside its turn, with `mode: "wait"` or with `t3_thread_wait`, and no flow uses a heartbeat. See [the workflow fold design](../design/workflow-fold.md).

## 4. Open questions

- Does acknowledgment of a terminal result through `task_status` cancel a wake message that is already queued but not yet started? The acknowledge command handler at `apps/server/src/orchestration-v2/Orchestrator.ts:1860-2030` was not traced in full.
- Which option descriptor ids does each Claude, Codex, and Cursor model advertise today? These are live data from `orchestrator_capabilities`.
- Do provider-native subagents count toward `waiting_for_children` for an app-owned task, through `pendingBackgroundTasks`? `SubagentProjection.ts:240-242` suggests yes. Not verified.
- Is there any rate limit or back-pressure on `delegated_task.request` dispatch under heavy fan-out? None was found in `Orchestrator.ts` or `EffectWorker.ts`.
- Does a delegated task that starts with `/goal` work end to end for Claude and Codex children? This is inferred, not tested.
- Pi plan mode: no plan-mode handling was found in `PiAdapterV2.ts`. Searches: `rg -n "plan" apps/server/src/orchestration-v2/Adapters/PiAdapterV2.ts`.
- `opencode2` declares `supportsMcpTools: false` but attaches the T3 MCP server. The effect of that flag on orchestration was not traced.
- The doc says "eleven orchestration tools" and "a maximum lifetime" for credentials. The code differs. This report follows the code.
