"use strict";

// The omt config editor page. It talks only to the API under its own base path and builds every element with
// createElement and textContent, so that no config text is ever parsed as HTML.

const BASE = location.pathname.replace(/[^/]*$/, "");
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const LAYERS = ["defaults", "user", "project", "profile"];
const FILES = ["user", "project"];
const ROOT_ONLY = new Set(["profile", "harnesses", "profiles"]);
const PING_MS = 5000;
const KEY_DOCS = {
  "limits.maxParallel": "Most child tasks that run at the same time (1 to 32).",
  "limits.maxDepth": "Most levels of child tasks below the main thread (0 to 3). At the most, a child does the work itself.",
  "limits.maxReviewRounds": "Most review rounds for one build before the main thread stops and asks you (1 to 10).",
  "workflow.plan.review": "Who reviews a plan. two-families: one reviewer from the other model family. one: one reviewer from any family. owner: you review it.",
  "workflow.plan.testLayers": "The test layers that a plan proposes without an owner request: integration, e2e, unit.",
  "workflow.design.variants": "How many variants of each screen the design step draws (1 to 5).",
  "workflow.design.tool": "paper: draw in Paper when its tools load, else HTML mockups. html: HTML mockups only.",
  "workflow.build.review": "every-round: review fixes again. first-round: review once. off: skip review unless an oracle is required.",
  "workflow.build.qa": "planned: write the approved tests. off: leave the test list empty. QA still runs checks and device flows.",
  "workflow.build.failureProofs": "Whether the main thread proves that each new test can fail.",
  "workflow.build.oracle": "When an oracle tries to break the finished change. heavy: only on a HEAVY task. always. off.",
  "workflow.review.reviewers": "How many reviewers a code review uses (1 to 4). auto sizes them by the size of the diff.",
  "workflow.review.families": "Whether the reviewers come from one model family or from both.",
  "workflow.review.oracle": "Whether an oracle pass runs after the reviewers.",
  "workflow.review.fixLoop": "offer: a review offers to fix its findings. off: it only reports them.",
  "workflow.review.ci": "What a review does with CI. off: ignore it. check: read it. fix: repair failing checks.",
  "workflow.review.verify": "changed-flows: run the flows that the change touches. off: skip.",
  "workflow.review.tests": "offer: offer to add missing tests. off: do not.",
  "workflow.review.guardrails": "propose: suggest checks and rules that would have caught each finding. off: do not.",
  "workflow.review.crap": "report: report the CRAP score (complexity against coverage) of changed code. off: do not.",
  "workflow.git.branchCommits": "auto: skills commit to a work branch without asking. ask: they ask first.",
  "workflow.git.pullRequests": "auto: skills open a PR without asking. ask: they ask first. off: they never open one.",
  "workflow.git.defaultBranch": "auto: skills may push to the default branch without asking. ask: they ask first.",
  "workflow.git.merge": "auto: skills may merge a PR without asking. ask: they ask first.",
  "workflow.git.owners": "GitHub owners whose repos count as yours. Repos of any other owner always ask first.",
  "workflow.git.maxPrFiles": "Most changed files in one PR. Over it, skills split the branch into stacked PRs. 0 means no limit.",
  harnesses: "The T3 drivers that omt may use, such as codex. A rung on another driver fails. With no key, every driver may run.",
  profile: "The profile that omt uses when a command does not name one.",
};

const ROLE_FIELD_DOCS = {
  description: "What the role is for.",
  access: "edit: the task may change files. read-only: the task runs in plan mode and can only read.",
  result: "The kind of report that the task returns, such as work, review, or research.",
  t3Role: "The role that T3 gives to the child task.",
  interactionMode: "The T3 interaction mode of the task. inherit uses the mode of the parent thread.",
  runtimeMode: "How T3 asks for permissions during the task. inherit uses the mode of the parent thread.",
  crossFamily: "With --against, try the rungs of the other model family first.",
  fast: "Ask for fast mode on models that support it.",
  chain: "The models to try, in order. The first rung that T3 accepts runs.",
};

function docFor(path) {
  const key = dotted(path);
  if (KEY_DOCS[key]) return KEY_DOCS[key];
  if (path[0] === "roles" && path[2]) return ROLE_FIELD_DOCS[path[2]] || "";
  if (path[0] === "models") return "Fast mode for this model, in every role that does not set fast itself.";
  return "";
}

function summaryFor(path) {
  const summaries = {
    "limits.maxParallel": "Child tasks that can run at once.",
    "limits.maxDepth": "Child task levels below the main thread.",
    "limits.maxReviewRounds": "Review rounds before the owner decides.",
    "workflow.plan.review": "Who reviews the plan.",
    "workflow.plan.testLayers": "Test layers named in the plan.",
    "workflow.design.variants": "Design variants per screen.",
    "workflow.design.tool": "Paper or HTML mockups.",
    "workflow.build.review": "When to review the build and its fixes.",
    "workflow.build.qa": "Off leaves the test list empty. QA still runs checks.",
    "workflow.build.failureProofs": "Prove new tests fail without the change.",
    "workflow.build.oracle": "When oracle replaces the review child.",
    "workflow.review.reviewers": "Reviewer groups. Auto uses the size of the diff.",
    "workflow.review.families": "Driver families used for code review.",
    "workflow.review.oracle": "Use an oracle pass for code review.",
    "workflow.review.fixLoop": "Offer to fix findings after the report.",
    "workflow.review.ci": "Read or repair pull request checks.",
    "workflow.review.verify": "Check the flows that the change affects.",
    "workflow.review.tests": "Offer to add missing tests.",
    "workflow.review.guardrails": "Propose checks that catch these findings.",
    "workflow.review.crap": "Report code complexity against test coverage.",
    "workflow.git.branchCommits": "Commit to work branches automatically or ask first.",
    "workflow.git.pullRequests": "Open pull requests automatically, ask, or skip.",
    "workflow.git.defaultBranch": "Push to the default branch automatically or ask.",
    "workflow.git.merge": "Merge automatically or ask first.",
    "workflow.git.owners": "Owners whose repositories count as yours.",
    "workflow.git.maxPrFiles": "File limit per pull request. Zero means no limit.",
    harnesses: "Enabled drivers. Unset means every driver.",
    profile: "Default when no command or plan selects a profile.",
  };
  return summaries[dotted(path)] || docFor(path);
}

const app = {
  state: null,
  explain: null,
  profile: "",
  profileError: null,
  editIn: "user",
  queues: { user: new Map(), project: new Map() },
  bases: { user: null, project: null },
  writing: null,
  route: { screen: "effective", key: null, name: null, pick: null },
  back: "#/",
  filter: "",
  open: new Set(["setting:workflow.build", "setting:limits"]),
  stopped: false,
  conflict: null,
  blocked: null,
  fileError: {},
  review: null,
  toast: null,
  error: null,
  explainCache: new Map(),
  gen: 0,
  seq: { state: 0, explain: 0 },
  drafts: {},
  fileDrafts: {},
  issuesOpen: false,
  activeRow: null,
  live: [],
  keyPaths: new Map(),
  skill: "build",
  stages: { build: "review", "code-review": "size", plan: "review", design: "draw" },
  skillTexts: new Map(),
  skillFiles: new Map(), // maintainer mode: command -> null while loading, { files } or { error }
  skillBuffers: new Map(), // maintainer mode: "<command>/<path>" -> unsaved text
  skillSaving: null,
  profileAll: false,
  scope: "auto",
  changedOnly: false,
  previewPending: null,
  previewError: null,
  savedExplain: null,
  history: null,
  inlineErrors: {},
  against: "",
};

// ---------- small helpers ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let value;
  if (props) {
    for (const [key, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (key === "class") el.className = v;
      else if (key === "text") el.textContent = v;
      else if (key === "value") value = v;
      else if (key.startsWith("on") && typeof v === "function") el.addEventListener(key.slice(2), v);
      else if (key === "checked" || key === "disabled" || key === "hidden" || key === "selected") el[key] = true;
      else el.setAttribute(key, v === true ? "" : String(v));
    }
  }
  append(el, kids);
  if (value !== undefined) el.value = value;
  return el;
}

function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(typeof kid === "string" || typeof kid === "number" ? String(kid) : kid);
  }
}

const pk = (path) => JSON.stringify(path);
const dotted = (path) => path.join(".");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function fmt(value) {
  if (value === undefined) return "not set";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((item) => item && typeof item === "object" && "model" in item)) {
      return `[${value.map((rung) => [rung.model, rung.effort].filter(Boolean).join(" ")).join(", ")}]`;
    }
    return `[${value.map(fmt).join(", ")}]`;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function joinAnd(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Maintainer mode (`bun run defaults:edit`) edits the built-in defaults file, which the server sends as the user file.
function maintainer() {
  return app.state?.mode === "defaults";
}

const DEFAULTS_FILE = "src/config/defaults.jsonc";

function fileWords(kind) {
  return maintainer() && kind === "user" ? DEFAULTS_FILE : `the ${kind} file`;
}

function kindName(kind) {
  return maintainer() && kind === "user" ? "built-in" : kind;
}

function shortLabel(source) {
  if (source.kind === "defaults") return "defaults";
  if (source.kind === "profile") return shortLabel(source.declaredIn);
  return kindName(source.kind);
}

function sourceLabel(source) {
  if (!source) return "";
  if (source.kind === "defaults") return "defaults";
  if (source.kind === "profile") return `profile ${source.profile} (${shortLabel(source.declaredIn)})`;
  return kindName(source.kind);
}

function layerName(source) {
  return source.kind === "profile" ? `profile ${source.profile}` : kindName(source.kind);
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

// Stable row ids for a list editor. The editor updates them with each change it makes, and a store whose length no
// longer matches its list (the owner reset the list) starts over.
let lastRowId = 0;

function newRowId() {
  lastRowId += 1;
  return lastRowId;
}

function rowIds(store, length) {
  if (!store.ids || store.ids.length !== length) store.ids = Array.from({ length }, newRowId);
  return store.ids;
}

// ---------- API ----------

async function api(path, body) {
  const init = body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  let response;
  try {
    response = await fetch(BASE + path, init);
  } catch {
    const error = new Error("the editor does not answer");
    error.code = "network";
    error.status = 0;
    throw error;
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data && data.message ? data.message : `HTTP ${response.status}`);
    error.status = response.status;
    error.code = data && data.code ? data.code : "http";
    error.hint = data ? data.hint : undefined;
    error.newErrors = data ? data.newErrors : undefined;
    throw error;
  }
  return data;
}

function showError(error) {
  if (error.code === "network") {
    stop();
    return;
  }
  app.error = { message: error.message, hint: error.hint };
  render();
}

// ---------- data ----------

function file(kind) {
  return app.state.files.find((entry) => entry.kind === kind);
}

function parseError(kind) {
  const issue = file(kind).issues.find((item) => item.severity === "error" && item.path === "");
  if (issue) return issue.message;
  const err = app.fileError[kind];
  return err && err.code === "jsonc_parse" ? err.message : null;
}

function absent(kind) {
  return !file(kind).present || (app.fileError[kind] && app.fileError[kind].code === "config_not_found");
}

function usable(kind) {
  return !absent(kind) && !parseError(kind);
}

// While a write to a file runs, its edits are off, so that no edit can be made against the state the write replaces.
function writeLocked(kind) {
  return app.writing === kind;
}

function canEdit() {
  return !app.stopped && !app.previewPending && usable(app.editIn) && !writeLocked(app.editIn);
}

function index() {
  app.rootMap = new Map(app.explain.root.map((entry) => [pk(entry.path), entry]));
  app.effMap = new Map(app.explain.effective.map((entry) => [pk(entry.path), entry]));
  refreshDrafts();
}

function selectedProfileName() {
  return app.profile || app.explain.profile.name;
}

function rootValue(path) {
  const entry = app.rootMap.get(pk(path));
  return entry ? entry.value : undefined;
}

// The value that one file itself sets at a leaf path.
function fileValue(kind, path) {
  const entry = app.rootMap.get(pk(path));
  if (!entry) return undefined;
  if (entry.source.kind === kind) return entry.value;
  const over = entry.overridden.find((item) => item.source.kind === kind);
  return over ? over.value : undefined;
}

function fileSets(kind, path) {
  const key = pk(path);
  const prefix = key.slice(0, -1) + ",";
  for (const entry of app.explain.root) {
    const own = pk(entry.path);
    if (own !== key && !own.startsWith(prefix)) continue;
    if (entry.source.kind === kind || entry.overridden.some((item) => item.source.kind === kind)) return true;
  }
  return false;
}

function queued(kind, path) {
  return app.queues[kind].get(pk(path));
}

// A queue keeps the hash of the file text that its first edit was made on, so that a reload for the other file
// cannot move its base past a change that the user never saw. Each edit names the hash of the text that its draft or
// control was built on, and queues only onto that text: onto the queue's base, or onto the file when the queue is
// empty. Else the page shows the changed-on-disk state.
function draftFits(kind, from) {
  const base = queueCount(kind) ? app.bases[kind] : file(kind).hash;
  if (from === base) return true;
  app.conflict = { file: kind, message: `${fileWords(kind)} changed after this edit started`, confirming: false };
  return false;
}

function enqueue(kind, path, edit, from = file(kind).hash) {
  if (writeLocked(kind) || !draftFits(kind, from)) return false;
  const queue = app.queues[kind];
  if (queue.size === 0) app.bases[kind] = file(kind).hash;
  queue.delete(pk(path));
  queue.set(pk(path), { path, ...edit });
  if (app.blocked && app.blocked.file === kind) app.blocked = null;
  if (app.review && app.review.previews[kind]) delete app.review.previews[kind];
  return true;
}

// A draft is editor input that is not queued yet, for the edit-in file. It records the file hash that it was built
// on, and only user input to one of its controls makes it dirty. Each new state builds every clean draft again from
// that state. A dirty draft keeps its input. When its file's hash changed, its notice keeps it out of the queue until
// the user keeps it on the new text or discards it, so that the page never moves an edit onto text that the user did
// not see.
// reset() clears the input that the editor builds from the state.
function fresh(draft, reset = draft.reset) {
  draft.reset = reset;
  reset(draft);
  draft.hash = file(app.editIn).hash;
  draft.dirty = false;
  return draft;
}

function touch(draft) {
  draft.dirty = true;
}

function stale(draft) {
  return draft.dirty && draft.hash !== file(app.editIn).hash;
}

function refreshDrafts() {
  for (const draft of Object.values(app.drafts)) if (draft && draft.reset && !draft.dirty) fresh(draft);
}

// app.drafts holds the drafts of the edit-in file. The drafts of the other file wait in app.fileDrafts, so that a
// switch of the edit-in file drops no input, and they come back when the page edits in that file again.
function switchEditIn(kind) {
  if (kind === app.editIn) return;
  app.fileDrafts[app.editIn] = app.drafts;
  app.drafts = app.fileDrafts[kind] || {};
  delete app.fileDrafts[kind];
  app.editIn = kind;
}

// An editor holds its draft in one slot. When the user opens another item in that editor, a dirty draft stays under
// the name of its item, and the editor takes it back when the user returns to that item.
function keepDraft(slot, id) {
  const draft = app.drafts[slot];
  if (draft && draft.dirty) app.drafts[`${slot}@${id}`] = draft;
  app.drafts[slot] = null;
}

function takeDraft(slot, id) {
  const draft = app.drafts[`${slot}@${id}`] || null;
  delete app.drafts[`${slot}@${id}`];
  app.drafts[slot] = draft;
  return draft;
}

// A text field that queues its edit on change keeps the typed text in a draft of its own until then.
function typedDraft(name) {
  return app.drafts[name] || (app.drafts[name] = fresh({}, (d) => { d.raw = null; }));
}

function typedText(name, value) {
  const draft = app.drafts[name];
  return draft && draft.raw !== null ? draft.raw : value;
}

// commit(raw, hash) queues the text on the file text with that hash and returns true when it did: the hash of the
// draft, or else seen, the hash of the text that the field was rendered on. The draft goes before that render, and
// comes back when the text does not queue.
function typedField(input, name, seen, commit) {
  input.addEventListener("input", () => {
    const draft = typedDraft(name);
    touch(draft);
    draft.raw = input.value;
  });
  let sent = null;
  const run = () => {
    const draft = app.drafts[name];
    if (draft && stale(draft)) {
      render();
      return;
    }
    if (input.value === sent) return;
    sent = input.value;
    delete app.drafts[name];
    if (!commit(input.value, draft && draft.dirty ? draft.hash : seen) && draft && draft.dirty) {
      app.drafts[name] = draft;
      render();
    }
  };
  input.addEventListener("change", run);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") run(); });
}

function staleNotice(name) {
  const draft = app.drafts[name];
  if (!draft || !stale(draft)) return null;
  const disabled = !canEdit();
  const keep = () => { draft.hash = file(app.editIn).hash; };
  return h("div", { class: "stale" },
    h("p", { text: "Based on older text. The file changed after you started this edit." }),
    h("div", { class: "btnrow" },
      h("button", { type: "button", class: "btn", text: "Keep my edit", disabled, "data-fk": `stale:${name}:keep`, onclick: () => { keep(); render(); } }),
      h("button", { type: "button", class: "btn", text: "Discard", disabled, "data-fk": `stale:${name}:discard`, onclick: () => { fresh(draft); render(); } })));
}

function unqueue(kind, path) {
  if (writeLocked(kind)) return;
  app.queues[kind].delete(pk(path));
  if (app.queues[kind].size === 0) app.bases[kind] = null;
  if (app.blocked && app.blocked.file === kind) app.blocked = null;
}

function clearQueue(kind) {
  app.queues[kind].clear();
  app.bases[kind] = null;
}

function queueCount(kind) {
  return app.queues[kind].size;
}

function totalQueued() {
  return queueCount("user") + queueCount("project");
}

function canSet(layer, path) {
  if (layer === "profile") return !ROOT_ONLY.has(path[0]);
  if (layer === "defaults") return path[0] !== "defaults";
  return path[0] !== "workflow";
}

// Which layer sets a path and which layers it overrides. Root entries give the file layers, effective entries the profile.
function stackOf(path) {
  const key = pk(path);
  const root = app.rootMap.get(key);
  const eff = app.effMap.get(key);
  const rows = {};
  const put = (source, value, state) => {
    if (!rows[source.kind]) rows[source.kind] = { source, value, state };
  };
  let main = root || eff;
  const otherProfiles = [];
  if (eff && eff.source.kind === "profile") {
    main = eff;
    put(eff.source, eff.value, "win");
    for (const item of eff.overridden) if (item.source.kind === "profile") otherProfiles.push(item.source.profile);
    if (root) {
      put(root.source, root.value, "over");
      for (const item of root.overridden) put(item.source, item.value, "over");
    } else {
      for (const item of eff.overridden) put(item.source, item.value, "over");
    }
  } else if (main) {
    put(main.source, main.value, "win");
    for (const item of main.overridden) put(item.source, item.value, "over");
  }
  return {
    path,
    rows,
    winner: main ? main.source.kind : null,
    value: main ? main.value : undefined,
    source: main ? main.source : undefined,
    otherProfiles,
  };
}

function harnessStack() {
  const stack = stackOf(["harnesses"]);
  if (stack.winner) return stack;
  return {
    path: ["harnesses"],
    rows: { defaults: { source: { kind: "defaults" }, value: undefined, state: "win" } },
    winner: "defaults",
    value: undefined,
    source: { kind: "defaults" },
    otherProfiles: [],
    noKey: true,
  };
}

// The higher layers that set the edited path, highest first.
function overridesOf(kind, path) {
  const out = [];
  if (path[0] === "profiles" && path.length > 2) {
    const entry = app.rootMap.get(pk(path));
    if (kind === "user" && entry && entry.source.kind === "project") out.push({ who: "project", value: entry.value });
    return out;
  }
  const eff = app.effMap.get(pk(path));
  if (eff && eff.source.kind === "profile") out.push({ who: `profile ${eff.source.profile}`, value: eff.value });
  const entry = app.rootMap.get(pk(path));
  if (kind === "user" && entry && entry.source.kind === "project") out.push({ who: "project", value: entry.value });
  return out;
}

function allIssues() {
  const seen = new Set();
  const out = [];
  for (const issue of [...app.state.issues, ...app.state.files.flatMap((entry) => entry.issues)]) {
    const key = pk([issue.source, issue.path, issue.message]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

function issueSource(source) {
  const match = app.state.files.find((entry) => entry.path === source);
  return match ? match.kind : source;
}

function blockedFor(path) {
  if (!app.blocked) return [];
  const key = dotted(path);
  return app.blocked.errors.filter((issue) => {
    const where = issue.path.replace(/\[\d+\].*$/, "");
    return where === key || where.startsWith(key + ".") || (key.startsWith(where + ".") && where.split(".").length > 2);
  });
}

function roleNames() {
  const names = [];
  for (const entry of [...app.explain.root, ...app.explain.effective]) {
    if (entry.path[0] === "roles" && !names.includes(entry.path[1])) names.push(entry.path[1]);
  }
  return names;
}

function knownKinds() {
  const kinds = new Set();
  for (const entry of [...app.explain.root, ...app.explain.effective]) {
    if (entry.path[0] === "roles" && entry.path[2] === "chain" && Array.isArray(entry.value)) {
      for (const rung of entry.value) {
        if (rung && typeof rung === "object") kinds.add(rung.driver || rung.provider);
      }
    }
  }
  const list = rootValue(["harnesses"]);
  if (Array.isArray(list)) for (const kind of list) kinds.add(kind);
  for (const kind of FILES) {
    const edit = queued(kind, ["harnesses"]);
    if (edit && Array.isArray(edit.value)) for (const item of edit.value) kinds.add(item);
  }
  kinds.delete(undefined);
  return [...kinds].sort();
}

// ---------- state loading ----------

// Each state bumps the generation. A response that a request of an older generation gets is dropped, so that the
// values, the hashes, and the explain report on screen always come from one state.
function setState(state) {
  app.gen += 1;
  app.state = state;
  app.explainCache.clear();
  if (!app.profile) app.profile = state.selectedProfile;
  app.savedExplain = state.explain;
  app.explain = state.explain;
  app.previewPending = null;
  app.previewError = null;
  app.profileError = null;
  if (state.explain.effective.length === 0) {
    const issue = state.issues.find((item) => item.severity === "error");
    app.profileError = issue ? issue.message : "the profile does not resolve";
  }
  const editIn = usable(app.editIn) ? app.editIn : usable("user") ? "user" : usable("project") ? "project" : app.editIn;
  switchEditIn(editIn);
  index();
  const desired = app.profile;
  app.profile = state.explain.profile.name;
  if (desired !== app.profile && state.profiles.includes(desired)) void pickProfile(desired);
}

async function loadState() {
  const token = ++app.seq.state;
  const gen = app.gen;
  const current = () => token === app.seq.state && gen === app.gen;
  try {
    const state = await api("api/state");
    if (!current()) return;
    setState(state);
  } catch (error) {
    if (current()) showError(error);
    return;
  }
  render();
}

async function pickProfile(name) {
  const token = ++app.seq.explain;
  const gen = app.gen;
  const current = () => token === app.seq.explain && gen === app.gen;
  app.previewPending = name;
  app.previewError = null;
  render();
  try {
    const report = await api(`api/explain?profile=${encodeURIComponent(name)}`);
    if (!current()) return;
    app.profile = name;
    app.explain = report;
    app.profileError = null;
    app.explainCache.set(name, report);
    app.scope = "auto";
    index();
  } catch (error) {
    if (!current()) return;
    app.previewError = { name, message: error.message };
  } finally {
    if (current()) {
      app.previewPending = null;
      render();
    }
  }
}

async function explainFor(name) {
  if (name === app.explain.profile.name && !app.profileError) return app.explain;
  if (app.explainCache.has(name)) return app.explainCache.get(name);
  app.explainCache.set(name, null);
  const gen = app.gen;
  let report;
  try {
    report = await api(`api/explain?profile=${encodeURIComponent(name)}`);
  } catch (error) {
    report = { error: error.message };
  }
  if (gen !== app.gen || app.explainCache.get(name) !== null) return app.explainCache.get(name);
  app.explainCache.set(name, report);
  render();
  return app.explainCache.get(name);
}

// ---------- ping and close ----------

let pingTimer;

function stop() {
  if (app.stopped) return;
  app.stopped = true;
  clearInterval(pingTimer);
  render();
}

async function ping() {
  if (app.stopped) return;
  try {
    const response = await fetch(BASE + "api/ping", { method: "POST" });
    if (!response.ok) stop();
  } catch {
    stop();
  }
}

// ---------- routing ----------

function parseHash() {
  const hash = location.hash.replace(/^#/, "");
  const at = hash.indexOf("?");
  const route = at === -1 ? hash : hash.slice(0, at);
  const params = new URLSearchParams(at === -1 ? "" : hash.slice(at + 1));
  const parts = route.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (parts[0] === "role" && parts[1]) return { screen: "role", name: parts[1], key: null, pick: null };
  if (parts[0] === "profile" && parts[1]) return { screen: "profile", name: parts[1], key: null, pick: null };
  if (parts[0] === "root") return { screen: "root", name: null, key: null, pick: null };
  if (parts[0] === "settings") return { screen: "settings" };
  if (parts[0] === "roles") return { screen: "roles" };
  if (parts[0] === "profiles") return { screen: "profiles" };
  const name = Object.hasOwn(SKILLS, parts[1] || "") ? parts[1] : "build";
  return { screen: "skills", name, tab: !SKILLS[name].flow || parts[2] === "instructions" ? "instructions" : "flow", file: params.get("file") };
}

function remember() {
  if (!["role", "profile", "root"].includes(app.route.screen)) app.back = location.hash || "#/";
}

function closeModal() {
  go(app.back || "#/");
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

// ---------- rendering ----------

let pointerDown = false;
let renderPending = false;

function render() {
  if (pointerDown) {
    renderPending = true;
    return;
  }
  renderPending = false;
  // data-fid names a control by the row id of its list item, so focus follows a rung or an option that moved.
  const data = document.activeElement && document.activeElement.dataset;
  const focused = data && (data.fid ? ["fid", data.fid] : data.fk ? ["fk", data.fk] : undefined);
  const active = document.activeElement;
  const selection = active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT") && typeof active.selectionStart === "number"
    ? [active.selectionStart, active.selectionEnd] : null;
  const scrolls = {};
  for (const el of document.querySelectorAll("[data-scroll]")) scrolls[el.dataset.scroll] = [el.scrollTop, el.scrollLeft];
  app.live = [];
  renderCmdbar();
  renderContent();
  renderReview();
  renderBanners();
  renderStatus();
  runLive();
  if (app.focusModal) {
    app.focusModal = false;
    const first = document.querySelector(".modal .side-row.sel") || document.querySelector(".modal .modal-close");
    if (first) first.focus({ preventScroll: true });
  }
  for (const el of document.querySelectorAll("[data-scroll]")) {
    const saved = scrolls[el.dataset.scroll];
    if (saved) [el.scrollTop, el.scrollLeft] = saved;
  }
  if (focused) {
    const target = document.querySelector(`[data-${focused[0]}="${CSS.escape(focused[1])}"]`);
    if (target && document.activeElement !== target) {
      target.focus({ preventScroll: true });
      if (selection && typeof target.setSelectionRange === "function" && target.value !== undefined) {
        try {
          target.setSelectionRange(...selection);
        } catch {
          // a field type without a text selection
        }
      }
    }
  }

}

function runLive() {
  for (const fn of app.live) fn();
}

function seg(options, current, onPick, props = {}) {
  const group = h("div", { class: `seg${props.small ? " small" : ""}`, role: "radiogroup", "aria-label": props.label });
  const buttons = options.map((option) => {
    const value = typeof option === "string" ? option : option.value;
    const label = typeof option === "string" ? option : option.label;
    const selected = value === current;
    return h("button", {
      type: "button",
      class: `seg-item${selected ? " on" : ""}`,
      role: "radio",
      "aria-checked": selected ? "true" : "false",
      tabindex: selected || (current === undefined && option === options[0]) ? "0" : "-1",
      disabled: props.disabled || (typeof option === "object" && option.disabled),
      "aria-disabled": typeof option === "object" && option.disabled ? "true" : undefined,
      title: typeof option === "object" ? option.title : undefined,
      "data-fk": props.fk ? `${props.fk}:${value}` : undefined,
      onclick: () => onPick(value),
      text: label,
    }, typeof option === "object" && option.detail ? h("code", { class: "seg-detail", text: option.detail }) : null);
  });
  group.addEventListener("keydown", (event) => radioKeys(event, buttons));
  append(group, buttons);
  return group;
}

function radioKeys(event, items) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(event.key in keys)) return;
  event.preventDefault();
  const enabled = items.filter((item) => !item.disabled);
  const at = enabled.indexOf(document.activeElement);
  const next = enabled[(at + keys[event.key] + enabled.length) % enabled.length];
  if (next) {
    next.focus();
    next.click();
  }
}

// A select or a checkbox reports its pick on input. Change runs the pick only when no input event came first.
function onPick(el, read, pick) {
  let last = read();
  const run = () => {
    const value = read();
    if (value === last) return;
    last = value;
    pick(value);
  };
  el.addEventListener("input", run);
  el.addEventListener("change", run);
  return el;
}

function checkbox(checked, props, pick) {
  const el = h("input", { type: "checkbox", checked, ...props });
  return onPick(el, () => el.checked, pick);
}

function select(options, current, pick, props = {}) {
  const el = h("select", {
    class: props.class,
    "aria-label": props.label,
    disabled: props.disabled,
    "data-fk": props.fk,
    "data-fid": props.fid,
  }, options.map((option) => {
    const value = typeof option === "string" ? option : option.value;
    const label = typeof option === "string" ? option : option.label;
    return h("option", { value, text: label });
  }));
  el.value = current;
  onPick(el, () => el.value, pick);
  return h("span", { class: `select${props.dashed ? " dashed" : ""}${props.wide ? " wide" : ""}${props.error ? " error" : ""}` }, el,
    h("span", { class: "caret", "aria-hidden": "true", text: "▼" }));
}

function copyButton(command) {
  return h("button", {
    type: "button",
    class: "link copy",
    "aria-label": `Copy ${command}`,
    text: "copy",
    onclick: (event) => {
      const button = event.currentTarget;
      const done = () => {
        button.textContent = "copied";
        setTimeout(() => { button.textContent = "copy"; }, 1500);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(command).then(done, () => {});
    },
  });
}

function cmdLine(command, extra) {
  return h("div", { class: "cmdline" }, h("span", { class: "prompt", text: "$" }), h("code", { text: command }), copyButton(command),
    extra ? h("span", { class: "muted", text: extra }) : null);
}

// ---------- command bar ----------

function renderCmdbar() {
  renderHeader();
}

// ---------- content ----------

function renderContent() {
  if (!app.state) return;
  const content = document.getElementById("content");
  content.replaceChildren(workspace());
  content.classList.toggle("dim", Boolean(app.review));
  content.inert = Boolean(app.review);
  document.getElementById("cmdbar").inert = Boolean(app.review);
}

function roleDesc(name) {
  const entry = [...app.explain.effective, ...app.explain.root].find((item) =>
    item.path[0] === "roles" && item.path[1] === name && item.path[2] === "description");
  return entry ? String(entry.value) : "";
}

function blockedCard() {
  if (!app.blocked) return null;
  const errors = app.blocked.errors;
  return h("div", { class: "blocked" },
    h("div", { class: "meta-caps err", text: `WRITE BLOCKED · ${errors.length} NEW ERROR${errors.length === 1 ? "" : "S"}` }),
    errors.map((issue) => h("p", { text: `${issue.path}: ${issue.message}` })),
    h("p", { class: "prose muted", text: "Fix the value, then open the review again. Nothing was written." }));
}

function valueKind(path) {
  const vocab = app.state.vocab;
  const last = path.at(-1);
  const rel = path[0] === "profiles" && path.length > 2 ? path.slice(2) : path;
  if (rel[0] === "limits") return { type: "number", range: vocab.limitRanges[last] };
  if (rel[0] === "workflow") {
    const rule = (vocab.workflow[rel[1]] || {})[rel[2]];
    if (rule && rule.values) return { type: "enum", values: rule.values };
    if (rule && rule.items) return { type: "items", items: rule.items };
    if (rule) return { type: "number", range: [rule.minimum, rule.maximum], auto: rule.auto };
  }
  if (rel[0] === "roles" && rel[2] === "chain") return { type: "chain" };
  if (rel[0] === "roles" && ["access", "result", "t3Role", "interactionMode", "runtimeMode"].includes(last)) return { type: "enum", values: vocab[last] };
  if (["fast", "crossFamily", "plan"].includes(last)) return { type: "bool" };
  if (path[0] === "profile") return { type: "enum", values: app.state.profiles };
  if (last === "extends") return { type: "enum", values: app.state.profiles.filter((item) => item !== path[1]) };
  if (path[0] === "harnesses") return { type: "list" };
  if (last === "description" || last === "model") return { type: "text" };
  return { type: "json" };
}

function parseValue(kind, raw) {
  if (kind.type === "number") {
    if (kind.auto && raw.trim() === "auto") return { value: "auto" };
    if (!/^-?\d+$/.test(raw.trim())) return { error: "enter an integer" };
    const number = Number(raw);
    const [min, max] = kind.range;
    if (number < min || number > max) return { value: number, error: `must be an integer from ${min} to ${max}` };
    return { value: number };
  }
  if (kind.type === "bool") return { value: raw === "true" };
  if (kind.type === "list") return { value: raw.split(/[\s,]+/).filter(Boolean) };
  if (kind.type === "json") {
    try {
      return { value: JSON.parse(raw) };
    } catch {
      return { error: "enter a JSON value" };
    }
  }
  return { value: raw };
}

function rawOf(kind, value) {
  if (value === undefined) return "";
  if (kind.type === "list") return Array.isArray(value) ? value.join(", ") : "";
  if (kind.type === "json") return JSON.stringify(value);
  if (kind.type === "items") return value;
  return String(value);
}

function newRoleForm() {
  const vocab = app.state.vocab;
  const draft = app.drafts.newRole
    || (app.drafts.newRole = fresh({}, (d) => Object.assign(d, { name: "", description: "", access: "read-only", rung: "", error: "" })));
  const disabled = !canEdit();
  const errorEl = h("p", { class: "err small", text: draft.error });
  const field = (label, key, placeholder, sans) => {
    const input = h("input", { type: "text", class: `text${sans ? " sans" : ""}`, value: draft[key], placeholder, disabled, "data-fk": `nr:${key}`, "aria-label": label });
    input.addEventListener("input", () => { touch(draft); draft[key] = input.value; });
    return h("label", { class: "ffield" }, h("span", { class: "flabel", text: label }), input);
  };
  const pickAccess = (value) => { if (value !== draft.access) { touch(draft); draft.access = value; render(); } };
  return h("div", { class: "newform" },
    h("div", { class: "newtitle" }, "+ NEW ROLE · in ", h("span", { class: "lc", text: app.editIn })),
    field("name", "name", "security"),
    field("description", "description", "What the role does", true),
    h("div", { class: "ffield" }, h("span", { class: "flabel", text: "access" }),
      seg(["read-only", "edit"], draft.access, pickAccess, { label: "access", disabled, fk: "nr:access", small: true })),
    field("first rung", "rung", "provider · model · effort"),
    errorEl,
    staleNotice("newRole"),
    h("div", { class: "btnrow" },
      h("button", {
        type: "button", class: "btn primary", text: "Add changes", disabled: disabled || stale(draft), "data-fk": "nr:queue",
        onclick: () => {
          if (stale(draft)) return;
          const parts = draft.rung.split(/[·\s]+/).filter(Boolean);
          const names = roleNames();
          if (!new RegExp(vocab.roleNamePattern).test(draft.name)) draft.error = `name must match ${vocab.roleNamePattern}`;
          else if (names.includes(draft.name)) draft.error = `role ${draft.name} exists`;
          else if (!draft.description.trim()) draft.error = "description is required";
          else if (parts.length < 2) draft.error = "first rung needs a provider and a model";
          else if (parts[2] && !vocab.effort.includes(parts[2])) draft.error = `effort must be one of ${vocab.effort.join(", ")}`;
          else {
            const rung = { provider: parts[0], model: parts[1] };
            if (parts[2]) rung.effort = parts[2];
            if (!enqueue(app.editIn, ["roles", draft.name], { value: { description: draft.description.trim(), access: draft.access, chain: [rung] } }, draft.hash)) {
              render();
              return;
            }
            app.drafts.newRole = null;
            render();
            return;
          }
          render();
        },
      }),
      h("button", { type: "button", class: "btn", text: "Cancel", "data-fk": "nr:cancel", onclick: () => { app.drafts.newRole = null; render(); } })));
}

// The role editor keeps one draft for each path in the file: a dirty draft of the path that the user leaves stays under
// "<id>#<base>".
function startRole(id, name, kind, profileName, base) {
  return fresh({ id, name, file: kind, profile: profileName, base }, (d) => Object.assign(d, { fields: {}, chain: null, rows: {} }));
}

function roleEditor(name) {
  const vocab = app.state.vocab;
  const kind = app.editIn;
  const profileName = selectedProfileName();
  const id = `${kind}|${profileName}|${name}`;
  let draft = app.drafts.role;
  if (!draft || draft.id !== id) {
    if (draft) keepDraft("role", draft.id);
    draft = takeDraft("role", id) || takeDraft("role", `${id}#root`) || (app.drafts.role = startRole(id, name, kind, profileName, "root"));
  }
  const baseNow = () => (draft.base === "root" ? ["roles", name] : ["profiles", profileName, "roles", name]);
  const base = baseNow();
  const disabled = !canEdit();
  const current = (field) => {
    if (Object.hasOwn(draft.fields, field)) return draft.fields[field];
    const edit = queued(kind, [...baseNow(), field]);
    if (edit && !edit.remove) return edit.value;
    return stackOf(["roles", name, field]).value;
  };
  const boolFields = ["crossFamily", "fast"];
  const ownBool = (field) => {
    if (queued(kind, [...baseNow(), field])?.remove) return "__inherit";
    const value = ownLeaf(kind, [...baseNow(), field]).value;
    return value === undefined ? "__inherit" : value;
  };
  const baseline = (field) => {
    if (boolFields.includes(field)) return ownBool(field);
    const edit = queued(kind, [...baseNow(), field]);
    return edit && !edit.remove ? edit.value : stackOf(["roles", name, field]).value;
  };
  const setField = (field, value, rerender = true) => {
    const was = boolFields.includes(field) && !Object.hasOwn(draft.fields, field) ? ownBool(field) : current(field);
    if (same(value, was)) return;
    touch(draft);
    draft.fields[field] = value;
    if (rerender) render();
    else runLive();
  };
  const sources = [];
  for (const field of vocab.roleKeys) {
    const stack = stackOf(["roles", name, field]);
    if (stack.source) {
      const label = sourceLabel(stack.source);
      if (!sources.includes(label)) sources.push(label);
    }
  }
  const fieldRow = (label, fields, control) => {
    const field = fields[0];
    const stack = stackOf(["roles", name, field]);
    const edit = queued(kind, [...baseNow(), field]);
    const over = edit ? overridesOf(kind, [...base, field]) : [];
    const errors = blockedFor([...base, field]);
    return h("div", { class: `frow${over.length ? " warnrow" : ""}${errors.length ? " errrow" : ""}` },
      h("span", { class: "flab", text: label }),
      h("div", { class: "fctl" }, control,
        over.length ? h("span", { class: "warn-text small", text: `Unsaved · ${over[0].who} overrides this value` }) : null,
        errors.length ? h("span", { class: "err small", text: errors[0].message }) : null),
      h("span", { class: `fsrc${stack.winner === "profile" ? " accent" : ""}` },
        ` ${stack.source ? sourceLabel(stack.source) : "not set"}`));
  };
  const desc = h("input", { type: "text", class: "text sans full", value: current("description") || "", disabled, "data-fk": "role:description", "aria-label": "description", maxlength: String(vocab.descriptionMax) });
  desc.addEventListener("input", () => setField("description", desc.value, false));
  const boolBox = (field) => {
    const own = Object.hasOwn(draft.fields, field) ? draft.fields[field] : ownBool(field);
    return seg([{ value: "__inherit", label: "Inherit" }, { value: "true", label: "On" }, { value: "false", label: "Off" }],
      own === "__inherit" ? "__inherit" : String(own), (value) => setField(field, value === "__inherit" ? value : value === "true"), { label: field, disabled, fk: `role:${field}` });
  };
  const chainNow = () => draft.chain || clone(current("chain")) || [];
  const chainOut = () => resolveOptions(chainNow(), draft.rows);
  const queueBtn = h("button", { type: "button", class: "btn primary", "data-fk": "role:queue" });
  const chainEdited = () => draft.chain && !same(chainOut(), baseline("chain"));
  const editedFields = () => Object.keys(draft.fields).filter((field) => !same(draft.fields[field], baseline(field)));
  const pendingCount = () => editedFields().length + (chainEdited() ? 1 : 0);
  const seen = file(kind).hash;
  const refresh = () => {
    const count = pendingCount();
    queueBtn.textContent = count ? `Add ${plural(count, "change")}` : "Add changes";
    queueBtn.disabled = disabled || stale(draft) || count === 0 || chainNow().length === 0 || !chainOut() || optionFormHasText(draft.rows);
  };
  app.live.push(refresh);
  queueBtn.addEventListener("click", () => {
    if (app.drafts.role !== draft || !canEdit() || stale(draft) || pendingCount() === 0 || chainNow().length === 0 || optionFormHasText(draft.rows)) return;
    const chain = chainOut();
    if (!chain || !draftFits(kind, draft.hash)) {
      render();
      return;
    }
    const target = baseNow();
    for (const field of editedFields()) enqueue(kind, [...target, field], draft.fields[field] === "__inherit" ? { remove: true } : { value: draft.fields[field] }, draft.hash);
    if (chainEdited()) enqueue(kind, [...target, "chain"], { value: chain }, draft.hash);
    app.drafts.role = null;
    render();
  });
  const rootPath = ["roles", name];
  const profilePath = ["profiles", profileName, "roles", name];
  return h("div", { class: "editor" },
    h("header", { class: "ed-head" },
      h("div", { class: "ed-title" }, h("h2", { class: "h2", text: name }), h("span", { class: "ed-src", text: roleDesc(name) })),
      h("div", { class: "ed-sub" }, h("span", { class: "muted" }, `Edits go to ${fileWords(app.editIn)} at `, h("code", { text: dotted(base) })),
        seg([{ value: "root", label: "Base settings" }, { value: "profile", label: `Profile: ${profileName}` }], draft.base,
          (value) => {
            if (value === draft.base) return;
            keepDraft("role", `${id}#${draft.base}`);
            if (!takeDraft("role", `${id}#${value}`)) app.drafts.role = startRole(id, name, kind, profileName, value);
            render();
          }, { label: "Path in this file", disabled, fk: "role:base", small: true }))),
    staleNotice("role"),
    h("details", { class: "role-advanced" }, h("summary", { text: "Role details and permissions" }), h("div", { class: "fields" },
      fieldRow("description", ["description"], desc),
      fieldRow("access", ["access"], seg(vocab.access.slice().reverse(), current("access"), (value) => setField("access", value), { label: "access", disabled, fk: "role:access", small: true })),
      fieldRow("result · t3Role", ["result", "t3Role"], h("div", { class: "pair" },
        select(vocab.result, current("result"), (value) => setField("result", value), { label: "result", disabled, fk: "role:result" }),
        select(vocab.t3Role, current("t3Role"), (value) => setField("t3Role", value), { label: "t3Role", disabled, fk: "role:t3Role" }))),
      fieldRow("interactionMode", ["interactionMode"], seg(vocab.interactionMode, current("interactionMode"), (value) => setField("interactionMode", value), { label: "interactionMode", disabled, fk: "role:im", small: true })),
      fieldRow("runtimeMode", ["runtimeMode"], select(vocab.runtimeMode, current("runtimeMode"), (value) => setField("runtimeMode", value), { label: "runtimeMode", disabled, fk: "role:rm" })),
      fieldRow("crossFamily", ["crossFamily"], boolBox("crossFamily")),
      fieldRow("fast", ["fast"], boolBox("fast")))),
    chainEditor(chainNow, (chain, typing) => { touch(draft); draft.chain = chain; if (typing) runLive(); else render(); }, disabled, blockedFor([...base, "chain"]), draft.rows,
      () => { touch(draft); draft.chain = chainNow(); }),
    h("footer", { class: "ed-foot" },
      draft.base === "root" ? h("button", {
        type: "button", class: "btn danger", text: "Remove role", disabled, "data-fk": "role:remove",
        onclick: () => { if (enqueue(kind, rootPath, { value: null }, seen)) app.drafts.role = null; render(); },
      }) : null,
      draft.base === "root" ? h("span", { class: "muted small", text: `writes ${dotted(rootPath)}: null` }) : null,
      h("span", { class: "spacer" }),
      h("button", {
        type: "button", class: "btn", text: "Reset to inherited", disabled: disabled || !fileSets(kind, base), "data-fk": "role:reset",
        title: fileSets(kind, base) ? `removes ${dotted(base)} from ${fileWords(kind)}` : `${fileWords(kind)} does not set ${dotted(base)}`,
        onclick: () => { if (enqueue(kind, baseNow(), { remove: true }, seen)) app.drafts.role = null; render(); },
      }),
      queueBtn));
}

// The option lines of one rung with their typed keys. A typed key stays in store.raw until the chain takes it: an
// empty key removes its option, and a key that repeats another key of the rung, or that a plain object cannot hold
// as its own key, has a problem and stops the queue.
function optionLines(options, store) {
  const entries = Object.entries(options || {});
  const ids = rowIds(store, entries.length);
  const raw = store.raw || new Map();
  const lines = entries.map(([key, value], at) => {
    const typed = raw.has(`${ids[at]}:key`);
    return { id: ids[at], key: typed ? raw.get(`${ids[at]}:key`).trim() : key, value, typed, problem: null };
  });
  for (const line of lines) line.problem = optionKeyProblem(line.key, lines.filter((other) => other !== line).map((other) => other.key));
  return lines;
}

// A new-option form with text holds an option that the chain does not have yet, so Queue waits until the user adds
// it with Enter or clears the form.
function optionFormHasText(store) {
  return [...(store.opts || new Map()).values()].some((opts) => opts.adding && (opts.adding.key !== "" || opts.adding.value !== ""));
}

function optionKeyProblem(key, others) {
  if (key === "__proto__") return "this key is not allowed";
  if (key !== "" && others.includes(key)) return "another option of this rung has this key";
  return null;
}

// The chain with every typed option key in it, or null when a typed key has a problem. A Queue sends this chain, so
// that it sends what the editor shows.
function resolveOptions(chain, store) {
  const ids = rowIds(store, chain.length);
  let blocked = false;
  const next = chain.map((rung, at) => {
    const opts = store.opts && store.opts.get(ids[at]);
    if (!opts || !rung.options) return rung;
    const lines = optionLines(rung.options, opts);
    if (!lines.some((line) => line.typed)) return rung;
    if (lines.some((line) => line.problem)) blocked = true;
    const options = {};
    for (const line of lines) if (line.key !== "") options[line.key] = line.value;
    const out = { ...rung, options };
    if (Object.keys(options).length === 0) delete out.options;
    return out;
  });
  return blocked ? null : next;
}

// One line per option. A value keeps its type: a string stays a string, also "true", and a boolean stays a boolean.
// Each action reads the options through getOptions and finds its line by row id, because a click can run before the
// render of an earlier change that removed or reordered a line. store belongs to one rung id, so the new-option form
// stays with its rung when the rung moves and goes away when the rung is removed.
function optionsEditor(getOptions, index, disabled, onChange, store, rungId, onInput) {
  const entries = Object.entries(getOptions() || {});
  const label = `rung ${index + 1}`;
  const fk = `rung:${index}:opt`;
  const fid = `rung#${rungId}:opt`;
  const now = () => Object.entries(getOptions() || {});
  const ids = () => rowIds(store, now().length);
  const commit = (next, nextIds, typing) => {
    const out = {};
    const idOf = new Map();
    next.forEach(([key, value], at) => {
      if (key === "" || Object.hasOwn(out, key)) return;
      out[key] = value;
      idOf.set(key, nextIds[at]);
    });
    store.ids = Object.keys(out).map((key) => idOf.get(key));
    onChange(Object.keys(out).length ? out : undefined, typing);
  };
  const replace = (id, change, typing) => {
    const current = now();
    const rowIdsNow = ids();
    const at = rowIdsNow.indexOf(id);
    if (at === -1) return;
    commit(current.map((entry, other) => (other === at ? change(entry) : entry)), rowIdsNow, typing);
  };
  // The typed text of a line stays by its row id until change, so that a render or a move of the rung keeps it. A
  // key with a problem stays typed also after change.
  store.raw ||= new Map();
  const typed = (input, name, apply) => {
    input.addEventListener("input", () => {
      store.raw.set(name, input.value);
      if (apply(input.value, true)) return;
      onInput();
      runLive();
    });
    input.addEventListener("change", () => {
      store.raw.delete(name);
      if (apply(input.value, false)) return;
      store.raw.set(name, input.value);
      onInput();
      render();
    });
  };
  const problemOf = (id, key) => optionKeyProblem(key, optionLines(getOptions(), store).filter((line) => line.id !== id).map((line) => line.key));
  const remove = (id) => {
    const current = now();
    const rowIdsNow = ids();
    const at = rowIdsNow.indexOf(id);
    if (at === -1) return;
    commit(current.filter((_, other) => other !== at), rowIdsNow.filter((_, other) => other !== at));
  };
  const types = [{ value: "text", label: "text" }, { value: "true", label: "true" }, { value: "false", label: "false" }];
  const renderIds = [...ids()];
  const lines = entries.map(([key, value], at) => {
    const id = renderIds[at];
    const shown = (name, text) => (store.raw.has(name) ? store.raw.get(name) : text);
    const keyInput = h("input", { type: "text", class: "cell-input okey", value: shown(`${id}:key`, key), disabled, "aria-label": `option key ${at + 1} of ${label}`, "data-fk": `${fk}:${at}:key`, "data-fid": `${fid}:${id}:key` });
    typed(keyInput, `${id}:key`, (raw, typing) => {
      const next = raw.trim();
      if ((typing && next === "") || problemOf(id, next) || now().some(([other], line) => other === next && ids()[line] !== id)) return false;
      replace(id, ([, old]) => [next, old], typing);
      return true;
    });
    const problem = h("span", { class: "err small", "data-fk": `${fk}:${at}:problem` });
    const showProblem = () => {
      const line = optionLines(getOptions(), store).find((item) => item.id === id);
      problem.textContent = line && line.problem ? line.problem : "";
    };
    showProblem();
    app.live.push(showProblem);
    const type = select(types, typeof value === "boolean" ? String(value) : "text", (picked) => {
      store.raw.delete(`${id}:value`);
      replace(id, ([name, old]) => [name, picked === "text" ? String(old) : picked === "true"]);
    },
    { label: `type of option ${key} of ${label}`, disabled, fk: `${fk}:${at}:type`, fid: `${fid}:${id}:type`, class: "cell-select" });
    let valueInput = null;
    if (typeof value === "string") {
      valueInput = h("input", { type: "text", class: "cell-input oval", value: shown(`${id}:value`, value), disabled, "aria-label": `value of option ${key} of ${label}`, "data-fk": `${fk}:${at}:value`, "data-fid": `${fid}:${id}:value` });
      typed(valueInput, `${id}:value`, (raw, typing) => {
        replace(id, ([name]) => [name, raw], typing);
        return true;
      });
    }
    return h("div", { class: "opt-line" }, keyInput, h("span", { class: "faint", text: "=" }), type, valueInput,
      h("button", { type: "button", class: "icon", text: "✕", disabled, "aria-label": `Remove option ${key} of ${label}`, "data-fk": `${fk}:${at}:rm`, "data-fid": `${fid}:${id}:rm`, onclick: () => remove(id) }),
      problem);
  });
  const pending = store.adding || null;
  let add;
  if (pending) {
    const keyInput = h("input", { type: "text", class: "cell-input okey", value: pending.key, placeholder: "key", disabled, "aria-label": `new option key of ${label}`, "data-fk": `${fk}:new:key`, "data-fid": `${fid}:new:key` });
    const valueInput = h("input", { type: "text", class: "cell-input oval", value: pending.value, placeholder: "value", disabled, "aria-label": `new option value of ${label}`, "data-fk": `${fk}:new:value`, "data-fid": `${fid}:new:value` });
    keyInput.addEventListener("input", () => { pending.key = keyInput.value; onInput(); runLive(); });
    valueInput.addEventListener("input", () => { pending.value = valueInput.value; onInput(); runLive(); });
    const hint = h("span", { class: "warn-text small", "data-fk": `${fk}:new:hint` });
    const showHint = () => { hint.textContent = pending.key !== "" || pending.value !== "" ? "Press Enter to add the option, or clear it." : ""; };
    showHint();
    app.live.push(showHint);
    const keys = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (store.adding === pending) store.adding = null;
        render();
      } else if (event.key === "Enter" && pending.key.trim() && store.adding === pending) {
        // The typed keys of the existing lines resolve with the insertion, so that it keeps every option on screen.
        const current = optionLines(getOptions(), store);
        const blocked = current.find((line) => line.problem);
        pending.problem = blocked ? blocked.problem : optionKeyProblem(pending.key.trim(), current.map((line) => line.key));
        if (pending.problem) {
          render();
          return;
        }
        store.adding = null;
        for (const line of current) store.raw.delete(`${line.id}:key`);
        commit([...current.map((line) => [line.key, line.value]), [pending.key.trim(), pending.value]], [...current.map((line) => line.id), newRowId()]);
      }
    };
    keyInput.addEventListener("keydown", keys);
    valueInput.addEventListener("keydown", keys);
    add = h("div", { class: "opt-line" }, keyInput, h("span", { class: "faint", text: "=" }), valueInput,
      h("span", { class: "muted small", text: "⏎" }),
      hint,
      pending.problem ? h("span", { class: "err small", "data-fk": `${fk}:new:problem`, text: pending.problem }) : null);
  } else {
    add = h("button", {
      type: "button", class: "link", text: "+ key=value", disabled, "data-fk": `${fk}:add`, "data-fid": `${fid}:add`,
      onclick: () => {
        store.adding = { key: "", value: "" };
        render();
        const input = document.querySelector(`[data-fid="${fid}:new:key"]`);
        if (input) input.focus();
      },
    });
  }
  return h("div", { class: "opts" }, lines, add);
}

// getChain returns the current draft chain. Each action reads it when it runs, not when the control was rendered,
// and finds its rung by row id, because render waits while a pointer is down, so a click can follow a change event
// that removed or moved a rung before the next render. store keeps the row ids; its owner resets it with the chain.
// onChange gets typing = true for a keystroke: the owner saves the chain and does not render, so that the field keeps
// its caret. store.raw keeps the typed text of each field by row id until change. onInput runs on typing that changes
// no value, as in a new-option form. The owner then keeps the chain on screen as its draft chain, so that the form
// keeps its rung when a new state changes the chain.
// The catalog provider and model of a rung, and a short status for the rung card.
function catalogFit(rung) {
  const catalog = app.state.catalog || { source: "local", providers: [] };
  const key = rung.provider || rung.driver;
  const provider = catalog.providers.find((item) => item.id === key) || (rung.provider ? undefined : catalog.providers.find((item) => item.driver === key));
  const model = provider ? provider.models.find((item) => item.id === rung.model) : undefined;
  if (!key) return { provider, model, status: "Choose a provider" };
  if (!provider) return { provider, model, problem: true, status: catalog.source === "t3" ? "Not in T3" : "Not detected", title: `No ${catalog.source === "t3" ? "T3 provider" : "detected harness"} named ${key}` };
  if (!provider.available) return { provider, model, problem: true, status: catalog.source === "t3" ? "T3 cannot run it" : "Not detected", title: provider.reason };
  if (catalog.source !== "t3") return { provider, model, status: "Unverified", title: provider.reason };
  if (rung.model && !model) return { provider, model, problem: true, status: "Model not in T3", title: `${provider.label} does not list ${rung.model}` };
  return { provider, model, status: "Available in T3", title: provider.reason };
}

function withCurrent(values, current) {
  return current && !values.includes(current) ? [...values, current] : values;
}

function providerPicker(rung, index, id, disabled, patch) {
  const providers = (app.state.catalog || { providers: [] }).providers;
  const current = rung.provider || rung.driver || "";
  const options = [{ value: "", label: "Choose a provider" }, ...providers.map((item) => ({ value: item.id, label: `${item.label}${item.available ? "" : " (not available)"}` }))];
  if (current && !providers.some((item) => item.id === current)) options.push({ value: current, label: `${current} (not detected)` });
  return select(options, current, (value) => {
    const provider = providers.find((item) => item.id === value);
    const keep = provider && provider.models.some((model) => model.id === rung.model);
    patch({ provider: value || undefined, driver: provider ? provider.driver : rung.driver, model: keep ? rung.model : provider && provider.models.length ? provider.models[0].id : rung.model });
  }, { label: `provider of rung ${index + 1}`, disabled, fid: `rung#${id}:provider`, wide: true });
}

function modelPicker(rung, fit, index, id, disabled, patch, custom) {
  const models = fit.provider ? fit.provider.models : [];
  const options = [{ value: "", label: "Choose a model" }, ...models.map((model) => ({ value: model.id, label: model.label || model.id }))];
  if (rung.model && !models.some((model) => model.id === rung.model)) options.push({ value: rung.model, label: `${rung.model} (not listed)` });
  options.push({ value: "__other", label: "Other model…" });
  return select(options, rung.model || "", (value) => {
    if (value === "__other") return custom();
    const model = models.find((item) => item.id === value);
    const effort = model && rung.effort && model.efforts.length && !model.efforts.includes(rung.effort) ? undefined : rung.effort;
    patch({ model: value || undefined, effort });
  }, { label: `model of rung ${index + 1}`, disabled, fid: `rung#${id}:model`, wide: true });
}

function chainEditor(getChain, onChange, disabled, errors, store, onInput) {
  const vocab = app.state.vocab;
  const chain = getChain();
  const ids = () => rowIds(store, getChain().length);
  const indexOf = (id) => ids().indexOf(id);
  store.opts ||= new Map();
  store.raw ||= new Map();
  const update = (id, patch, typing) => {
    const index = indexOf(id);
    const next = clone(getChain());
    if (index === -1 || !next[index]) return;
    next[index] = { ...next[index], ...(typeof patch === "function" ? patch(next[index]) : patch) };
    for (const [key, value] of Object.entries(next[index])) if (value === undefined || value === "") delete next[index][key];
    onChange(next, typing);
  };
  const reorder = (from, to) => {
    const next = clone(getChain());
    const nextIds = [...ids()];
    if (from === -1 || to < 0 || to >= next.length || from === to) return false;
    next.splice(to, 0, ...next.splice(from, 1));
    nextIds.splice(to, 0, ...nextIds.splice(from, 1));
    store.ids = nextIds;
    onChange(next);
    return true;
  };
  const move = (id, delta) => {
    const index = indexOf(id);
    const to = index + delta;
    if (index === -1 || !reorder(index, to)) return;
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-fid="rung#${id}:provider"]`);
      if (target) target.focus();
    });
  };
  const renderIds = [...ids()];
  const listId = `chain-suggestions-${renderIds[0] || "new"}`;
  const models = new Set();
  for (const entry of app.explain.effective) {
    if (entry.path[0] === "roles" && entry.path[2] === "chain" && Array.isArray(entry.value)) {
      for (const rung of entry.value) models.add(rung.model);
    }
  }
  const rows = chain.map((rung, index) => {
    const id = renderIds[index];
    const text = (key, value, label) => {
      const name = `${id}:${key}`;
      const input = h("input", { type: "text", class: "cell-input", value: store.raw.has(name) ? store.raw.get(name) : value || "", disabled,
        "aria-label": `${label} of rung ${index + 1}`, "data-fk": `rung:${index}:${key}`, "data-fid": `rung#${id}:${key}`, list: key === "provider" || key === "model" ? `${listId}-${key}` : undefined });
      input.addEventListener("input", () => {
        store.raw.set(name, input.value);
        update(id, { [key]: input.value.trim() || undefined }, true);
      });
      input.addEventListener("change", () => {
        store.raw.delete(name);
        update(id, { [key]: input.value.trim() || undefined });
      });
      return input;
    };
    if (!store.opts.has(id)) store.opts.set(id, {});
    const opts = optionsEditor(() => {
      const at = indexOf(id);
      return at === -1 ? undefined : (getChain()[at] || {}).options;
    }, index, disabled, (options, typing) => update(id, { options }, typing), store.opts.get(id), id, onInput);
    const driver = rung.driver || (["codex", "claudeAgent", "cursor", "opencode", "pi", "grok"].includes(rung.provider) ? rung.provider : undefined);
    const enabled = displayedLeaf(["harnesses"]).value;
    const excluded = driver && Array.isArray(enabled) && !enabled.includes(driver);
    const fit = catalogFit(rung);
    const row = h("article", { class: `rung-card${excluded ? " excluded" : ""}`, draggable: disabled ? undefined : "true", "data-index": String(index) },
      h("header", { class: "rung-heading" }, h("span", { class: "handle", "aria-hidden": "true", text: "⋮⋮" }),
        h("code", { class: "accent", text: `#${index + 1}` }), h("strong", { text: index ? "Fallback" : "First choice" }),
        h("span", { class: "spacer" }), h("small", { class: excluded || fit.problem ? "warning-text" : "muted", title: fit.title, text: excluded ? "Disabled by harnesses" : fit.status }),
        h("button", { type: "button", class: "icon", text: "↑", "aria-label": `Move rung ${index + 1} up`, disabled: disabled || index === 0, "data-fid": `rung#${id}:up`, onclick: () => move(id, -1) }),
        h("button", { type: "button", class: "icon", text: "↓", "aria-label": `Move rung ${index + 1} down`, disabled: disabled || index === chain.length - 1, "data-fid": `rung#${id}:down`, onclick: () => move(id, 1) }),
        h("button", { type: "button", class: "icon", text: "×", "aria-label": `Remove rung ${index + 1}`, disabled: disabled || chain.length <= vocab.chainMin, "data-fid": `rung#${id}:rm`,
          onclick: () => {
            const at = indexOf(id);
            if (at === -1 || getChain().length <= vocab.chainMin) return;
            store.ids = ids().filter((_, other) => other !== at);
            store.opts.delete(id);
            onChange(getChain().filter((_, other) => other !== at));
          } })),
      h("div", { class: "rung-fields" },
        h("label", null, h("span", { class: "muted", text: "Provider" }), providerPicker(rung, index, id, disabled, (patch) => update(id, patch))),
        h("label", null, h("span", { class: "muted", text: "Model" }), store.custom?.has(`${id}:model`) || (rung.model && !fit.provider) ? text("model", rung.model, "model")
          : modelPicker(rung, fit, index, id, disabled, (patch) => update(id, patch), () => { (store.custom ||= new Set()).add(`${id}:model`); render(); })),
        h("label", null, h("span", { class: "muted", text: "Effort" }), select(["", ...(fit.model && fit.model.efforts.length ? withCurrent(fit.model.efforts, rung.effort) : vocab.effort)].map((value) => ({ value, label: value || "Inherit" })), rung.effort || "",
          (value) => update(id, { effort: value || undefined }), { label: `effort of rung ${index + 1}`, disabled, fid: `rung#${id}:effort` }))),
      h("div", { class: "rung-fast" }, h("span", { class: "muted", text: "Fast" }),
        seg([{ value: "inherit", label: "Inherit" }, { value: "on", label: "On", disabled: fit.model?.fast === false && rung.fast !== true }, { value: "off", label: "Off" }], rung.fast === undefined ? "inherit" : rung.fast ? "on" : "off",
          (value) => update(id, { fast: value === "inherit" ? undefined : value === "on" }), { label: `fast of rung ${index + 1}`, disabled, fk: `rung#${id}:fast` }),
        fit.model?.fast === false ? h("small", { class: "muted", text: "This model has no fast mode." }) : null),
      h("details", { class: "rung-options" }, h("summary", { text: "Driver and raw options" }),
        h("label", null, "Driver ", text("driver", rung.driver, "driver")), opts));
    row.addEventListener("keydown", (event) => {
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        move(id, event.key === "ArrowUp" ? -1 : 1);
      }
    });
    row.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", String(id)));
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = indexOf(Number(event.dataTransfer.getData("text/plain")));
      reorder(from, indexOf(id));
    });
    return row;
  });
  const roleName = app.route.screen === "role" ? app.route.name : null;
  const crossFamily = roleName && ((app.drafts.role?.fields.crossFamily === "__inherit" ? undefined : app.drafts.role?.fields.crossFamily) ?? displayedLeaf(["roles", roleName, "crossFamily"]).value);
  const attempts = chain.map((rung, index) => ({ rung, index }));
  if (crossFamily && app.against) attempts.sort((a, b) => Number((a.rung.driver || a.rung.provider) === app.against) - Number((b.rung.driver || b.rung.provider) === app.against));
  return h("section", { class: "chain" },
    h("datalist", { id: `${listId}-provider` }, knownKinds().map((value) => h("option", { value }))),
    h("datalist", { id: `${listId}-model` }, [...models].filter(Boolean).map((value) => h("option", { value }))),
    h("div", { class: "chain-head" }, h("h3", { text: "Model chain" }), h("span", { class: "muted", text: "Configured order. Drag or use the arrows to reorder." })),
    h("p", { class: "muted", text: "Changing the chain replaces the whole inherited list." }),
    errors.length ? h("p", { class: "err", text: errors.map((issue) => `${issue.path}: ${issue.message}`).join(" · ") }) : null,
    h("div", { class: "chain-layout" }, h("div", { class: "rung-list" }, rows,
      h("button", { type: "button", class: "link", text: "+ Add fallback", disabled: disabled || chain.length >= vocab.chainMax, "data-fk": "rung:add",
        onclick: () => {
          if (getChain().length >= vocab.chainMax) return;
          store.ids = [...ids(), newRowId()];
          onChange([...getChain(), { provider: "", model: "" }]);
        } })),
      h("aside", { class: "attempt-panel" }, h("h3", { text: "Attempt order" }),
        crossFamily ? h("label", { class: "attempt-driver" }, "Main driver ", select([{ value: "", label: "Select to preview" }, ...knownKinds()], app.against,
          (value) => { app.against = value; render(); }, { label: "Main driver for order preview", fk: "attempt-driver" })) : null,
        h("p", { class: "muted", text: crossFamily && app.against ? "Other driver families go first. Rung numbers keep their configured positions." : "First eligible target runs. Later eligible targets are fallbacks." }),
        attempts.map(({ rung, index }) => h("div", { class: "attempt-row" }, h("code", { text: `#${index + 1}` }), h("code", { text: rung.model || "Choose a model" }))),
        h("p", { class: "muted", text: app.state.catalog?.source === "t3" ? "The lists come from the providers that T3 reported when the editor started." : "Availability is unverified until T3 checks the targets. Start the editor from omt-setup to list the T3 models." }),
        h("h3", { text: "When an attempt fails" }),
        h("p", { text: "Try the next rung if the provider, model, or options are refused." }),
        h("p", { text: "A driver-only provider refusal gets one retry. A mode or capability denial stops the chain." }),
        h("p", { class: "warning-text", text: "A skill that requires another family stops if only the same family remains." }),
        h("h3", { text: "Fast mode" }), h("p", { text: "Rung, then role, then model, then off. Explicit Off stops inheritance. Raw options apply last." }))));
}

// ----- s4 profile editor -----

function newProfileForm() {
  const draft = app.drafts.newProfile
    || (app.drafts.newProfile = fresh({}, (d) => Object.assign(d, { name: "", description: "", extends: "normal", error: "" })));
  const disabled = !canEdit();
  const field = (label, key, placeholder) => {
    const input = h("input", { type: "text", class: `text${key === "description" ? " sans" : ""}`, value: draft[key], placeholder, disabled, "data-fk": `np:${key}`, "aria-label": label });
    input.addEventListener("input", () => { touch(draft); draft[key] = input.value; });
    return h("label", { class: "ffield" }, h("span", { class: "flabel", text: label }), input);
  };
  return h("div", { class: "newform" },
    h("div", { class: "newtitle" }, "+ NEW PROFILE · in ", h("span", { class: "lc", text: app.editIn })),
    field("name", "name", "demo-day"),
    field("description (required)", "description", "What the profile is for"),
    h("div", { class: "ffield" }, h("span", { class: "flabel", text: "extends" }),
      select(app.state.profiles, draft.extends, (value) => { touch(draft); draft.extends = value; }, { label: "extends", disabled, fk: "np:extends", wide: true })),
    h("p", { class: "err small", text: draft.error }),
    staleNotice("newProfile"),
    h("div", { class: "btnrow" },
      h("button", {
        type: "button", class: "btn primary", text: "Add changes", disabled: disabled || stale(draft), "data-fk": "np:queue",
        onclick: () => {
          if (stale(draft)) return;
          if (!/^[a-z][a-z0-9-]{0,31}$/.test(draft.name)) draft.error = "name must be lower case letters, digits, and dashes";
          else if (app.state.profiles.includes(draft.name)) draft.error = `profile ${draft.name} exists`;
          else if (!draft.description.trim()) draft.error = "description is required";
          else {
            if (!enqueue(app.editIn, ["profiles", draft.name], { value: { description: draft.description.trim(), extends: draft.extends } }, draft.hash)) {
              render();
              return;
            }
            app.drafts.newProfile = null;
            render();
            return;
          }
          render();
        },
      }),
      h("button", { type: "button", class: "btn", text: "Cancel", "data-fk": "np:cancel", onclick: () => { app.drafts.newProfile = null; render(); } })));
}

function ancestorsOf(name) {
  const chain = [];
  const seen = new Set([name]);
  let current = rootValue(["profiles", name, "extends"]);
  while (typeof current === "string" && !seen.has(current) && chain.length < app.state.vocab.profileChainMax) {
    chain.unshift(current);
    seen.add(current);
    current = rootValue(["profiles", current, "extends"]);
  }
  if (name !== "normal" && chain[0] !== "normal" && app.state.profiles.includes("normal")) chain.unshift("normal");
  return chain;
}

function profileEditor(name) {
  const vocab = app.state.vocab;
  const kind = app.editIn;
  const presets = vocab.presetProfiles;
  const disabled = !canEdit();
  const id = `${kind}|${name}`;
  let draft = app.drafts.profile;
  if (!draft || draft.id !== id) {
    if (draft) for (const slot of ["profile", "chainPanel", "pAdd"]) keepDraft(slot, draft.id);
    draft = takeDraft("profile", id) || (app.drafts.profile = fresh({ id, name, file: kind, extraRows: [] }, (d) => { d.fields = {}; }));
    takeDraft("chainPanel", id);
    takeDraft("pAdd", id);
  }
  const panel = app.drafts.chainPanel;
  const seen = file(kind).hash;
  const own = ["profiles", name];
  const ownValue = (rel) => {
    const edit = queued(kind, [...own, ...rel]);
    if (edit) return edit.remove ? undefined : edit.value;
    return rootValue([...own, ...rel]);
  };
  const ancestors = ancestorsOf(name);
  const declared = app.explain.root.find((entry) => entry.path[0] === "profiles" && entry.path[1] === name && entry.source.kind !== "defaults")
    || app.explain.root.find((entry) => entry.path[0] === "profiles" && entry.path[1] === name);
  const effective = name === app.explain.profile.name && !app.profileError ? app.explain : app.explainCache.get(name);
  if (effective === undefined) void explainFor(name);
  const effMap = effective && effective.effective ? new Map(effective.effective.map((entry) => [pk(entry.path), entry])) : null;

  const queueBtn = h("button", { type: "button", class: "btn primary", "data-fk": "prof:queue" });
  const edited = () => Object.keys(draft.fields).filter((field) => (draft.fields[field] || "") !== (ownValue([field]) || ""));
  const refresh = () => {
    const count = edited().length;
    queueBtn.textContent = count ? `Add ${plural(count, "change")}` : "Add changes";
    queueBtn.disabled = disabled || stale(draft) || count === 0;
  };
  app.live.push(refresh);
  queueBtn.addEventListener("click", () => {
    if (stale(draft) || !draftFits(kind, draft.hash)) {
      render();
      return;
    }
    for (const field of edited()) {
      const value = draft.fields[field];
      enqueue(kind, [...own, field], value === undefined ? { remove: true } : { value }, draft.hash);
    }
    fresh(draft);
    render();
  });
  const desc = h("input", { type: "text", class: "text sans full", disabled, "data-fk": "prof:description", "aria-label": "description",
    value: Object.hasOwn(draft.fields, "description") ? draft.fields.description : ownValue(["description"]) || "" });
  desc.addEventListener("input", () => {
    touch(draft);
    draft.fields.description = desc.value;
    runLive();
  });
  const extOptions = [{ value: "", label: "(none)" }, ...app.state.profiles.filter((item) => item !== name).map((item) => ({ value: item, label: item }))];
  const extValue = Object.hasOwn(draft.fields, "extends") ? draft.fields.extends || "" : ownValue(["extends"]) || "";

  // rows
  const groups = [];
  for (const group of Object.keys(vocab.workflow)) {
    groups.push({ id: `workflow.${group}`, rows: Object.keys(vocab.workflow[group]).map((key) => ["workflow", group, key]) });
  }
  const other = [];
  for (const key of vocab.limitKeys) other.push(["limits", key]);
  const extra = new Map();
  for (const profile of [...ancestors, name]) {
    for (const entry of app.explain.root) {
      if (entry.path[0] !== "profiles" || entry.path[1] !== profile) continue;
      const rel = entry.path.slice(2);
      if (rel[0] === "roles" || rel[0] === "models") extra.set(pk(rel), rel);
    }
    for (const [, edit] of app.queues[kind]) {
      if (edit.path[0] === "profiles" && edit.path[1] === profile && (edit.path[2] === "roles" || edit.path[2] === "models") && edit.path.length > 3) {
        const rel = edit.path.slice(2);
        extra.set(pk(rel), rel);
      }
    }
  }
  for (const rel of draft.extraRows) extra.set(pk(rel), rel);
  for (const [slot, kept] of Object.entries(app.drafts)) {
    if (kept && (slot === "chainPanel" || slot === `chainPanel@${id}` || slot.startsWith(`chainPanel@${id}|`))) extra.set(kept.rel, JSON.parse(kept.rel));
  }
  other.push(...extra.values());
  groups.push({ id: "limits · roles · models", rows: other, always: true });

  const closeChain = () => {
    app.drafts.chainPanel = null;
    render();
  };
  const chainCell = (rel, value, errors) => {
    const path = [...own, ...rel];
    const open = Boolean(panel) && panel.rel === pk(rel);
    return [
      h("span", { class: `mbox${value === undefined ? " dashed" : ""}${errors.length ? " error" : ""}`, title: value === undefined ? undefined : fmt(value), text: value === undefined ? "inherit" : fmt(value) }),
      h("button", {
        type: "button", class: "link", text: open ? "close" : "edit", disabled, "aria-expanded": open ? "true" : "false",
        "aria-label": `${open ? "Close" : "Edit"} ${dotted(path)}`, "data-fk": `mchain:${pk(rel)}`,
        onclick: () => {
          if (open) return closeChain();
          if (panel) keepDraft("chainPanel", `${id}|${panel.rel}`);
          if (!takeDraft("chainPanel", `${id}|${pk(rel)}`)) app.drafts.chainPanel = fresh({ rel: pk(rel) }, (d) => Object.assign(d, { chain: null, rows: {} }));
          render();
        },
      }),
      value === undefined ? null : h("button", {
        type: "button", class: "link plain muted", text: "inherit", disabled, "aria-label": `Inherit ${dotted(path)}`, "data-fk": `mchain:${pk(rel)}:inherit`,
        onclick: () => {
          if (fileSets(kind, path)) enqueue(kind, path, { remove: true }, seen);
          else unqueue(kind, path);
          closeChain();
        },
      }),
      errors.length ? h("span", { class: "err small", text: errors[0].message }) : null,
    ];
  };
  const chainRow = (rel, value, effEntry, errors) => {
    const path = [...own, ...rel];
    const start = value !== undefined ? value : effEntry ? effEntry.value : rootValue(rel);
    const chainNow = () => panel.chain || clone(start) || [];
    const chainOut = () => resolveOptions(chainNow(), panel.rows);
    const ready = (chain) => chain !== null && chain.length >= vocab.chainMin && !same(chain, value) && !optionFormHasText(panel.rows);
    const queueChain = h("button", {
      type: "button", class: "btn primary", text: "Add chain changes", "data-fk": `mchain:${pk(rel)}:queue`,
      onclick: () => {
        const chain = chainOut();
        if (!chain) render();
        if (app.drafts.chainPanel !== panel || !canEdit() || stale(panel) || !ready(chain)) return;
        if (enqueue(kind, path, { value: clone(chain) }, panel.hash)) closeChain();
        else render();
      },
    });
    app.live.push(() => { queueChain.disabled = disabled || stale(panel) || !ready(chainOut()); });
    return h("div", { class: "mchain", role: "group", "aria-label": dotted(path) },
      h("div", { class: "meta-caps mchain-title", text: dotted(path) }),
      chainEditor(chainNow, (next, typing) => { touch(panel); panel.chain = next; if (typing) runLive(); else render(); }, disabled, errors, panel.rows,
        () => { touch(panel); panel.chain = chainNow(); }),
      staleNotice("chainPanel"),
      h("div", { class: "btnrow mchain-btns" },
        queueChain,
        h("button", { type: "button", class: "btn", text: "Cancel", "data-fk": `mchain:${pk(rel)}:cancel`, onclick: closeChain })));
  };
  const columns = [...ancestors, name];
  const cellValue = (profile, rel) => (profile === name ? ownValue(rel) : rootValue(["profiles", profile, ...rel]));
  const rowsEl = [];
  let panelEl = null;
  const changedOnly = name !== "normal" && !app.profileAll;
  const changed = (rel) => columns.some((profile) => profile !== "normal" && cellValue(profile, rel) !== undefined) || Boolean(queued(kind, [...own, ...rel]))
    || (Boolean(panel) && panel.rel === pk(rel));
  for (const group of groups) {
    const setsAny = group.rows.some(changed);
    const open = changedOnly ? setsAny || app.open.has(`m:${group.id}`) : group.always || setsAny || app.open.has(`m:${group.id}`);
    rowsEl.push(h("div", { class: "mrow mgroup", role: "row" }, h("span", { class: "mg-name", role: "cell", text: group.id }),
      open ? null : h("button", {
        type: "button", class: "link plain muted", "data-fk": `mg:${group.id}`,
        text: `${plural(group.rows.length, "key")}, all from normal · show`,
        onclick: () => { app.open.add(`m:${group.id}`); render(); },
      })));
    if (!open) continue;
    for (const rel of group.rows) {
      if (changedOnly && setsAny && !app.open.has(`m:${group.id}`) && !changed(rel)) continue;
      const values = columns.map((profile) => cellValue(profile, rel));
      const winner = values.map((value) => value !== undefined).lastIndexOf(true);
      const cells = ancestors.map((profile, index) => {
        const value = values[index];
        const cls = value === undefined ? "faint" : index === winner ? "winning" : "struck";
        return h("span", { class: `mcell anc ${cls}`, role: "cell", text: value === undefined ? "·" : fmt(value) });
      });
      const effEntry = effMap ? effMap.get(pk(rel)) : undefined;
      const rootVal = rel[0] === "workflow" ? undefined : rootValue(rel);
      const effText = effective === null || effective === undefined ? "…" : effEntry ? fmt(effEntry.value) : effective.error ? "—" : "·";
      const errors = blockedFor([...own, ...rel]);
      const isChain = rel[0] === "roles" && rel[2] === "chain";
      rowsEl.push(h("div", { class: `mrow${errors.length ? " errrow" : ""}`, role: "row" },
        h("span", { class: "mcell key", role: "cell", title: dotted(rel), text: rel[0] === "workflow" ? rel.slice(2).join(".") : dotted(rel) }),
        cells,
        h("span", { class: `mcell mine${queued(kind, [...own, ...rel]) ? " edited" : ""}`, role: "cell" },
          isChain ? chainCell(rel, values[values.length - 1], errors) : matrixControl(name, rel, values[values.length - 1], disabled, errors)),
        h("span", { class: "mcell eff", role: "cell" }, effText,
          effEntry && rootVal !== undefined && !same(rootVal, effEntry.value) ? h("span", { class: "muted", text: ` · root ${fmt(rootVal)}` }) : null)));
      if (isChain && panel && panel.rel === pk(rel)) panelEl = chainRow(rel, values[values.length - 1], effEntry, errors);
    }
  }
  const adding = app.drafts.pAdd;
  const addInput = adding ? h("input", {
    type: "text", class: "text", "data-fk": "prof:add", "aria-label": adding.type === "role" ? "role.field" : "model id",
    placeholder: adding.type === "role" ? "role.field, e.g. execute.fast" : "model id, e.g. gpt-6.1-sol", value: adding.value,
  }) : null;
  if (addInput) {
    addInput.addEventListener("input", () => { touch(adding); adding.value = addInput.value; });
    addInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const raw = addInput.value.trim();
      if (adding.type === "role") {
        const [role, field] = raw.split(".");
        if (role && field && vocab.roleKeys.includes(field)) draft.extraRows.push(["roles", role, field]);
      } else if (raw) {
        draft.extraRows.push(["models", raw, "fast"]);
      }
      app.drafts.pAdd = null;
      render();
    });
  }
  const openAdd = (type) => { app.drafts.pAdd = fresh({ type }, (d) => { d.value = ""; }); render(); };
  const isPreset = presets.includes(name);
  return h("div", { class: "editor" },
    h("header", { class: "ed-head row" },
      h("span", { class: "muted" }, `Edits go to ${fileWords(kind)} at `, h("code", { text: `profiles.${name}` })),
      h("span", { class: "spacer" }),
      declared ? h("span", { class: "muted", text: `Declared in ${shortLabel(declared.source)}` }) : null),
    staleNotice("profile"),
    h("div", { class: "desc-row" },
      h("label", { class: "ffield grow" }, h("span", { class: "flabel", text: "description" }), desc),
      h("div", { class: "ffield ext" }, h("span", { class: "flabel", text: "extends" }),
        select(extOptions, extValue, (value) => {
          touch(draft);
          draft.fields.extends = value || undefined;
          render();
        }, { label: "extends", disabled, fk: "prof:extends", wide: true }))),
    h("section", { class: "usage-wrap" }, h("div", { class: "section-head" }, h("h3", { text: "Use this profile" })), profileUsage(name)),
    h("section", { class: "matrix-wrap" },
      h("div", { class: "section-head" }, h("h3", { text: "Values" }),
        h("span", { class: "muted", text: name === "normal" ? "Edit in the normal column. Other profiles start from these values." : `Edit in the ${name} column. A value that ${name} does not set comes from ${ancestors[ancestors.length - 1] || "normal"}.` }),
        name === "normal" ? null : h("button", { type: "button", class: "link", "data-fk": "prof:all", text: app.profileAll ? "Show only changed values" : "Show all values",
          onclick: () => { app.profileAll = !app.profileAll; render(); } })),
      h("div", { class: "matrix-scroll", "data-scroll": "matrix" },
        h("div", { class: "matrix", role: "table", "aria-label": "Inheritance matrix" },
          h("div", { class: "mrow mhead", role: "row" }, h("span", { class: "mcell key", role: "columnheader", text: "key" }),
            ancestors.map((profile) => h("span", { class: "mcell anc", role: "columnheader", text: profile })),
            h("span", { class: "mcell mine accent", role: "columnheader", text: `${name} ✎` }),
            h("span", { class: "mcell eff", role: "columnheader", text: "result" })),
          rowsEl)),
      panelEl),
    h("div", { class: "links" },
      h("button", { type: "button", class: "link", text: "+ limit", "data-fk": "prof:+limit", disabled, onclick: () => {
        app.open.add("m:limits · roles · models");
        render();
        const input = document.querySelector(".mcell.mine input[data-limit]");
        if (input) input.focus();
      } }),
      h("button", { type: "button", class: "link", text: "+ role override", "data-fk": "prof:+role", disabled, onclick: () => openAdd("role") }),
      h("button", { type: "button", class: "link", text: "+ model", "data-fk": "prof:+model", disabled, onclick: () => openAdd("model") }),
      addInput),
    staleNotice("pAdd"),
    h("footer", { class: "ed-foot" },
      isPreset ? null : h("button", {
        type: "button", class: "btn danger", text: "Remove profile", disabled, "data-fk": "prof:remove",
        onclick: () => { enqueue(kind, own, { value: null }, seen); render(); },
      }),
      h("span", { class: "muted small", text: isPreset ? "Preset profiles cannot be removed." : `Remove writes profiles.${name}: null.` }),
      h("span", { class: "spacer" }),
      queueBtn));
}

function matrixControl(name, rel, value, disabled, errors) {
  const kind = app.editIn;
  const path = ["profiles", name, ...rel];
  const type = valueKind(path);
  const seen = file(kind).hash;
  const set = (raw, from = seen) => {
    let done = true;
    if (raw === "__inherit" || raw === "") {
      if (fileSets(kind, path) || queued(kind, path)) {
        if (fileSets(kind, path)) done = enqueue(kind, path, { remove: true }, from);
        else unqueue(kind, path);
      }
    } else {
      const parsed = parseValue(type, raw);
      done = parsed.value !== undefined && enqueue(kind, path, { value: parsed.value }, from);
    }
    render();
    return done;
  };
  const dashed = value === undefined;
  const errorText = errors.length ? h("span", { class: "err small", text: errors[0].message }) : null;
  if (type.type === "enum" || type.type === "bool") {
    const values = type.type === "bool" ? ["true", "false"] : type.values;
    return [select([{ value: "__inherit", label: "inherit" }, ...values.map((item) => ({ value: item, label: item }))],
      value === undefined ? "__inherit" : String(value), set, { label: dotted(path), disabled, fk: `m:${pk(rel)}`, dashed, error: errors.length > 0, class: "cell-select" }), errorText];
  }
  if (type.type === "items") {
    const list = Array.isArray(value) ? value : [];
    return [h("span", { class: `mitems${dashed ? " dashed" : ""}${errors.length ? " error" : ""}`, role: "group", "aria-label": dotted(path) },
      dashed ? h("span", { class: "muted", text: "inherit" }) : null,
      type.items.map((item) => h("label", { class: "check" }, checkbox(list.includes(item), { disabled, "data-fk": `m:${pk(rel)}:${item}` }, (checked) => {
        const edit = queued(kind, path);
        const now = edit ? (edit.remove ? undefined : edit.value) : rootValue(path);
        const current = Array.isArray(now) ? now : [];
        const next = checked ? type.items.filter((other) => other === item || current.includes(other)) : current.filter((other) => other !== item);
        enqueue(kind, path, { value: next }, seen);
        render();
      }), item))),
    dashed ? null : h("button", { type: "button", class: "link plain muted", text: "inherit", disabled, "aria-label": `Inherit ${dotted(path)}`, "data-fk": `m:${pk(rel)}:inherit`, onclick: () => set("__inherit") }),
    errorText];
  }
  const placeholder = type.type === "number" ? `${type.range[0]}–${type.range[1]}${type.auto ? " or auto" : ""}` : "inherit";
  const cell = `cell:${kind}|${pk(path)}`;
  const input = h("input", {
    type: "text", class: `cell-input full${dashed ? " dashed" : ""}${errors.length ? " error" : ""}`, disabled, placeholder,
    "aria-label": dotted(path), "data-fk": `m:${pk(rel)}`, "data-limit": rel[0] === "limits" ? "1" : undefined,
    value: typedText(cell, value === undefined ? "" : type.type === "json" ? JSON.stringify(value) : String(value)),
  });
  typedField(input, cell, seen, (raw, from) => set(raw.trim(), from));
  return [input, staleNotice(cell), errorText];
}

// ----- s5 root settings -----

function rootScreen() {
  const kind = app.editIn;
  const vocab = app.state.vocab;
  const disabled = !canEdit();
  const f = file(kind);
  const seen = f.hash;
  const own = (path) => {
    const edit = queued(kind, path);
    if (edit) return { set: !edit.remove, value: edit.remove ? undefined : edit.value, edited: true, edit };
    const value = fileValue(kind, path);
    return { set: value !== undefined, value, edited: false };
  };
  const effOf = (path) => stackOf(path);
  const row = (key, path, control, hint, props = {}) => {
    const mine = own(path);
    const errors = blockedFor(path);
    const localError = props.error;
    return h("div", { class: `jrow lvl-${props.level || 0}${mine.edited ? " edited" : ""}${errors.length || localError ? " errrow" : ""}` },
      h("span", { class: `jkey${mine.set ? "" : " muted"}`, text: key ? `"${key}":` : "" }),
      h("span", { class: "jctl" }, control),
      h("span", { class: "jhint" }, errors.length ? h("span", { class: "err", text: errors[0].message }) : localError ? h("span", { class: "err", text: localError }) : hint),
      props.right ? h("span", { class: "jright muted", text: props.right }) : null);
  };

  // profile
  const profileOwn = own(["profile"]);
  const profileEntry = app.rootMap.get(pk(["profile"]));
  const profileCtl = select([{ value: "__inherit", label: "inherit" }, ...app.state.profiles.map((item) => ({ value: item, label: `"${item}"` }))],
    profileOwn.set ? profileOwn.value : "__inherit", (value) => {
      if (value === "__inherit") {
        if (fileValue(kind, ["profile"]) !== undefined) enqueue(kind, ["profile"], { remove: true }, seen);
        else unqueue(kind, ["profile"]);
      } else if (value === fileValue(kind, ["profile"])) unqueue(kind, ["profile"]);
      else enqueue(kind, ["profile"], { value }, seen);
      render();
    }, { label: "profile", disabled, fk: "root:profile", dashed: !profileOwn.set });
  const profileHint = profileEntry ? `${profileEntry.source.kind} sets "${profileEntry.value}"` : "";

  // limits
  const limitRows = vocab.limitKeys.map((key) => {
    const path = ["limits", key];
    const mine = own(path);
    const [min, max] = vocab.limitRanges[key];
    const stack = effOf(path);
    const cell = `cell:${kind}|${pk(path)}`;
    const input = h("input", {
      type: "text", inputmode: "numeric", class: `num small${mine.set ? "" : " dashed"}`, disabled, "aria-label": `limits.${key}`,
      placeholder: mine.set ? "" : fmt(rootValue(path)),
      value: typedText(cell, mine.value === undefined ? "" : String(mine.value)), "data-fk": `root:limit:${key}`,
    });
    typedField(input, cell, seen, (text, from) => {
      const raw = text.trim();
      const number = /^-?\d+$/.test(raw) ? Number(raw) : undefined;
      let done = raw === "" || number !== undefined;
      if (raw === "" && fileValue(kind, path) !== undefined) done = enqueue(kind, path, { remove: true }, from);
      else if (number !== undefined && number !== fileValue(kind, path)) done = enqueue(kind, path, { value: number }, from);
      else if (done) unqueue(kind, path);
      render();
      return done;
    });
    const over = overridesOf(kind, path);
    const parts = [`${min}–${max}`];
    if (!mine.set) parts.push(`inherited${stack.rows.defaults && !over.length && stack.winner === "defaults" ? " from defaults" : ""}`);
    else {
      const lower = LAYERS.slice(0, LAYERS.indexOf(kind)).reverse().find((layer) => stack.rows[layer] && layer !== "defaults");
      if (!over.length && lower) parts.push(`wins over ${lower} ${fmt(stack.rows[lower].value)}`);
    }
    const hint = h("span", null, h("span", { class: "muted", text: parts.join(" · ") }),
      over.map((item) => h("span", { class: "warn-text", text: ` · ▲ ${item.who} overrides this value (sets ${fmt(item.value)})` })));
    const value = mine.value;
    const localError = typeof value === "number" && (value < min || value > max) ? `must be an integer from ${min} to ${max}` : undefined;
    return row(key, path, [input, staleNotice(cell)], hint, { level: 1, error: localError });
  });

  // harnesses
  const harnessOwn = own(["harnesses"]);
  const harnessEff = harnessStack();
  const kinds = knownKinds();
  const listNow = () => {
    const mine = own(["harnesses"]);
    return mine.set ? mine.value : harnessEff.noKey ? null : harnessEff.value;
  };
  const list = listNow();
  const setList = (next, from = seen) => {
    if (same(next, fileValue(kind, ["harnesses"]))) unqueue(kind, ["harnesses"]);
    else if (!enqueue(kind, ["harnesses"], { value: next }, from)) return false;
    render();
    return true;
  };
  const chips = kinds.map((driver) => {
    const on = list ? list.includes(driver) : true;
    return h("button", {
      type: "button", class: `hchip${on ? " on" : ""}${harnessOwn.set ? "" : " dashed"}`, disabled, "aria-pressed": on ? "true" : "false",
      "data-fk": `root:h:${driver}`,
      onclick: () => {
        const current = listNow();
        const base = current ? [...current] : knownKinds();
        setList(base.includes(driver) ? base.filter((item) => item !== driver) : [...base, driver]);
      },
    }, h("span", { class: "sq", "aria-hidden": "true" }), `"${driver}"`);
  });
  const hAdd = app.drafts.hAdd;
  const hInput = hAdd ? h("input", { type: "text", class: "text small", value: hAdd.value, placeholder: "driver kind", "aria-label": "new driver kind", "data-fk": "root:h:add" }) : null;
  if (hInput) {
    hInput.addEventListener("input", () => { touch(hAdd); hAdd.value = hInput.value; });
    hInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { app.drafts.hAdd = undefined; render(); }
      if (event.key !== "Enter" || stale(hAdd)) return;
      if (!new RegExp(vocab.providerPattern).test(hInput.value)) {
        hAdd.error = `a driver kind matches ${vocab.providerPattern}`;
        render();
        return;
      }
      const current = listNow();
      const base = current ? [...current] : knownKinds();
      if (!base.includes(hInput.value)) base.push(hInput.value);
      app.drafts.hAdd = undefined;
      if (!setList(base, hAdd.hash)) {
        app.drafts.hAdd = hAdd;
        render();
      }
    });
  }
  const effList = list || kinds;
  const orphaned = roleNames().filter((role) => {
    const chain = stackOf(["roles", role, "chain"]).value;
    return Array.isArray(chain) && chain.length > 0 && !chain.some((rung) => effList.includes(rung.driver || rung.provider));
  });
  const missing = kinds.filter((item) => !effList.includes(item));
  const harnessCtl = h("span", { class: "hlist" }, h("span", { class: "faint", text: "[" }), chips,
    h("button", { type: "button", class: "link", text: "+ kind", disabled, "data-fk": "root:h:+", onclick: () => { app.drafts.hAdd = fresh({}, (d) => Object.assign(d, { value: "", error: "" })); render(); } }),
    hInput, h("span", { class: "faint", text: "]" }), h("span", { class: "muted", text: " or " }),
    h("button", {
      type: "button", class: "link plain", text: "remove key (every driver)", disabled: disabled || !fileSets(kind, ["harnesses"]), "data-fk": "root:h:rm",
      onclick: () => { enqueue(kind, ["harnesses"], { remove: true }, seen); render(); },
    }));
  const harnessNote = [
    staleNotice("hAdd"),
    hAdd && hAdd.error ? h("div", { class: "err small", text: hAdd.error }) : null,
    orphaned.length ? h("div", { class: "warn-sentence", text: `Without ${joinAnd(missing)}, ${joinAnd(orphaned)} ${orphaned.length === 1 ? "becomes" : "become"} unavailable.` }) : null,
    !harnessOwn.set && harnessEff.noKey ? h("div", { class: "muted small", text: "No key: every driver kind runs." }) : null,
  ];

  // models
  const modelIds = [];
  for (const entry of app.explain.root) if (entry.path[0] === "models" && !modelIds.includes(entry.path[1])) modelIds.push(entry.path[1]);
  for (const [, edit] of app.queues[kind]) if (edit.path[0] === "models" && edit.path[1] && !modelIds.includes(edit.path[1])) modelIds.push(edit.path[1]);
  const modelCtl = (id) => {
    const path = ["models", id, "fast"];
    const mine = own(path);
    const inherited = rootValue(path);
    return h("span", { class: "inline" }, h("span", { class: "faint", text: `{ "${id}": { "fast": ` }),
      select([{ value: "true", label: "true" }, { value: "false", label: "false" }, { value: "__inherit", label: `inherit (${inherited === undefined ? "not set" : fmt(inherited)})` }],
        mine.set ? String(mine.value) : "__inherit", (value) => {
          if (value === "__inherit") {
            if (fileValue(kind, path) !== undefined) enqueue(kind, path, { remove: true }, seen);
            else unqueue(kind, path);
          } else {
            const next = value === "true";
            if (next === fileValue(kind, path)) unqueue(kind, path);
            else enqueue(kind, path, { value: next }, seen);
          }
          render();
        }, { label: `models.${id}.fast`, disabled, fk: `root:model:${id}`, dashed: !mine.set }),
      h("span", { class: "faint", text: " } }" }));
  };
  const mAdd = app.drafts.mAdd;
  const modelRows = modelIds.map((id, index) => row(index === 0 ? "models" : "", ["models", id, "fast"], modelCtl(id), null));
  const mInput = mAdd ? h("input", { type: "text", class: "text small", value: mAdd.value, placeholder: "model id", "aria-label": "new model id", "data-fk": "root:m:add" }) : null;
  const mNote = staleNotice("mAdd");
  if (mInput) {
    mInput.addEventListener("input", () => { touch(mAdd); mAdd.value = mInput.value; });
    mInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { app.drafts.mAdd = undefined; render(); }
      if (event.key !== "Enter" || !mInput.value.trim() || stale(mAdd)) return;
      if (enqueue(kind, ["models", mInput.value.trim(), "fast"], { value: true }, mAdd.hash)) app.drafts.mAdd = undefined;
      render();
    });
  }

  const content = h("div", { class: "jform", "data-scroll": "jform" },
    h("header", { class: "root-head" }, h("span", { class: "muted" }, `Edits go to ${fileWords(kind)} at `, h("code", { text: f.path }))),
    !usable(kind) ? h("p", { class: "warn-text", text: `Edit in ${kind} is off: ${absent(kind) ? "the file does not exist" : "the file does not parse"}.` }) : null,
    h("div", { class: "jpunct", text: "{" }),
    row("profile", ["profile"], profileCtl, h("span", { class: "muted", text: profileHint })),
    h("div", { class: "jrow" }, h("span", { class: `jkey${fileSets(kind, ["limits"]) ? "" : " muted"}`, text: '"limits": {' })),
    limitRows,
    h("div", { class: "jpunct in1", text: "}," }),
    row("harnesses", ["harnesses"], harnessCtl, null),
    h("div", { class: "jnote" }, harnessNote),
    modelRows.length ? modelRows : null,
    h("div", { class: "jrow" }, h("span", { class: "jkey" }), h("span", { class: "jctl" },
      h("button", { type: "button", class: "link", text: "+ model", disabled, "data-fk": "root:m:+", onclick: () => { app.drafts.mAdd = fresh({}, (d) => { d.value = ""; }); render(); } }), mInput)),
    mNote ? h("div", { class: "jnote" }, mNote) : null,
    h("div", { class: "jpunct", text: "}" }),
    h("p", { class: "prose muted foot", text: `Solid box: ${fileWords(kind)} sets this key. Dashed box: not set here, the value is inherited. Profiles cannot set defaults or harnesses.` }));
  return h("section", { class: "screen-root" }, h("div", { class: "root-main" }, blockedCard(), content), previewPanel());
}

function previewPanel() {
  return h("aside", { class: "preview", "data-scroll": "preview" },
    h("div", { class: "meta-caps", text: "DEFAULTS" }),
    h("p", { class: "prose", text: "Run omt doctor or omt update to review and accept current defaults. Your overrides stay in these config files." }));
}

// ---------- s6 review ----------

function sentEdit(edit) {
  return edit.remove ? { path: [...edit.path], remove: true } : { path: [...edit.path], value: clone(edit.value) };
}

// The request is a deep copy, so that a later edit of the queue cannot change what a preview showed.
function requestFor(kind) {
  return {
    file: kind,
    base: app.bases[kind] || file(kind).hash || "",
    edits: [...app.queues[kind].values()].map(sentEdit),
  };
}

function bodyOf(request) {
  return JSON.stringify(request);
}

function handleEditError(kind, error) {
  if (error.code === "config_changed") app.conflict = { file: kind, message: error.message, confirming: false };
  else if (error.code === "config_invalid") app.blocked = { file: kind, errors: error.newErrors || [] };
  else if (error.code === "config_not_found" || error.code === "jsonc_parse") app.fileError[kind] = { code: error.code, message: error.message };
  else if (error.code === "network") stop();
  else app.error = { message: error.message, hint: error.hint };
}

function openReview() {
  if (app.stopped || totalQueued() === 0) return;
  const tab = queueCount(app.editIn) ? app.editIn : FILES.find((kind) => queueCount(kind));
  app.review = { tab, previews: {} };
  app.issuesOpen = false;
  render();
  requestAnimationFrame(() => {
    const first = document.querySelector("#review-host .rtab");
    if (first) first.focus();
  });
}

// Review shows a file that has queued edits, and closes when no file has any.
function settleReview() {
  if (!app.review || queueCount(app.review.tab)) return;
  const next = FILES.find((kind) => queueCount(kind));
  if (next) app.review.tab = next;
  else app.review = null;
}

function closeReview() {
  app.review = null;
  render();
  const button = document.querySelector("#cmdbar .review-btn");
  if (button) button.focus();
}

// Each preview belongs to one review session and one request. A response for an older session or request is dropped,
// and Write sends the request of the preview on screen.
function startPreview(kind) {
  const session = app.review;
  const request = requestFor(kind);
  const slot = { status: "loading", request, body: bodyOf(request), gen: app.gen };
  session.previews[kind] = slot;
  const current = () => app.review === session && session.previews[kind] === slot && slot.gen === app.gen;
  api("api/preview", request).then((result) => {
    if (!current()) return;
    slot.status = "ok";
    slot.result = result;
    if (result.newErrors.length > 0) app.blocked = { file: kind, errors: result.newErrors };
    else if (app.blocked && app.blocked.file === kind) app.blocked = null;
    render();
  }, (error) => {
    if (!current()) return;
    handleEditError(kind, error);
    slot.status = "error";
    slot.message = error.message;
    slot.code = error.code;
    render();
  });
  return slot;
}

// After a write, only the sent edits leave the queue. An edit that changed while the write ran stays queued.
function dropSent(kind, edits) {
  const queue = app.queues[kind];
  for (const edit of edits) {
    const key = pk(edit.path);
    const entry = queue.get(key);
    if (entry && same(sentEdit(entry), edit)) queue.delete(key);
  }
}

async function writeFile(kind) {
  const session = app.review;
  const preview = session && session.previews[kind];
  if (app.writing || !preview || preview.status !== "ok" || preview.gen !== app.gen || bodyOf(requestFor(kind)) !== preview.body) return;
  const request = preview.request;
  app.writing = kind;
  render();
  try {
    const result = await api("api/write", request);
    dropSent(kind, request.edits);
    if (app.blocked && app.blocked.file === kind) app.blocked = null;
    if (app.conflict && app.conflict.file === kind) app.conflict = null;
    delete app.fileError[kind];
    setState(result.state);
    app.bases[kind] = queueCount(kind) ? file(kind).hash : null;
    app.toast = { text: `✓ wrote ${plural(request.edits.length, "edit")} to ${maintainer() ? DEFAULTS_FILE : kind}` };
    setTimeout(() => { app.toast = null; render(); }, 4000);
    if (app.review) {
      delete app.review.previews[kind];
      settleReview();
    }
  } catch (error) {
    handleEditError(kind, error);
    if (error.code === "config_invalid" && preview.result && session.previews[kind] === preview) {
      preview.result.newErrors = error.newErrors || [];
    }
  } finally {
    app.writing = null;
  }
  render();
}

function diffHunks(diff, edits) {
  let oldLine = 0;
  let newLine = 0;
  const lines = diff.map((item) => {
    if (item.op === " ") {
      oldLine++;
      newLine++;
      return { ...item, num: oldLine };
    }
    if (item.op === "-") {
      oldLine++;
      return { ...item, num: oldLine };
    }
    newLine++;
    return { ...item, num: newLine };
  });
  const blocks = [];
  lines.forEach((line, index) => {
    if (line.op === " ") return;
    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length - 1, index + 3);
    const last = blocks.at(-1);
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else blocks.push({ start, end });
  });
  return blocks.map((block) => {
    const slice = lines.slice(block.start, block.end + 1);
    const changed = slice.filter((line) => line.op !== " ");
    const edit = edits.find((item) => changed.some((line) => line.line.includes(`"${item.path.at(-1)}"`)));
    return { label: edit ? dotted(edit.path) : `lines ${slice[0].num}–${slice.at(-1).num}`, lines: slice };
  });
}

function renderReview() {
  const host = document.getElementById("review-host");
  settleReview();
  if (!app.review || !app.state) {
    host.replaceChildren();
    return;
  }
  const kind = app.review.tab;
  const edits = [...app.queues[kind].values()];
  let preview = app.review.previews[kind];
  if (edits.length && (!preview || preview.gen !== app.gen || preview.body !== bodyOf(requestFor(kind)))) preview = startPreview(kind);
  const tabs = FILES.filter((item) => queueCount(item)).map((item) => h("button", {
    type: "button", class: `rtab${item === kind ? " on" : ""}`, role: "tab", "aria-selected": item === kind ? "true" : "false",
    "data-fk": `rtab:${item}`, text: `${maintainer() ? DEFAULTS_FILE : item} · ${queueCount(item)}`,
    onclick: () => { app.review.tab = item; render(); },
  }));
  const editBlocks = edits.map((edit) => {
    const old = edit.path[0] === "profiles" && edit.path.length === 2 ? (fileSets(kind, edit.path) ? "set" : undefined) : fileValue(kind, edit.path);
    const wasSet = old !== undefined || fileSets(kind, edit.path);
    const removing = edit.remove || edit.value === null;
    const mark = removing ? "-" : wasSet ? "~" : "+";
    const to = edit.remove ? "not set" : fmt(edit.value);
    const over = overridesOf(kind, edit.path);
    return h("div", { class: "redit" },
      h("div", { class: "redit-path" }, h("span", { class: `mark m${mark === "-" ? "rm" : mark === "+" ? "add" : "chg"}`, text: mark }), ` ${dotted(edit.path)}`),
      h("div", { class: "redit-chg", text: `${wasSet ? (old === undefined ? "set" : fmt(old)) : "not set"} → ${to}` }),
      h("button", { type: "button", class: "link", text: "Undo", disabled: app.stopped || Boolean(app.writing), onclick: () => { unqueue(kind, edit.path); render(); } }),
      over.length && !removing ? h("div", { class: "warn-text small", text: `▲ ${over[0].who} overrides this value (sets ${fmt(over[0].value)})` }) : null);
  });
  const result = preview && preview.status === "ok" ? preview.result : null;
  const newErrors = result ? result.newErrors : app.blocked && app.blocked.file === kind ? app.blocked.errors : [];
  const warnings = result ? result.issues.filter((issue) => issue.severity === "warning" && issueSource(issue.source) === kind) : [];
  const known = new Set(allIssues().map((issue) => pk([issue.source, issue.path, issue.message])));
  const newWarnings = warnings.filter((issue) => !known.has(pk([issue.source, issue.path, issue.message])));
  const check = h("div", { class: "rcheck", "aria-live": "polite" }, h("div", { class: "meta-caps", text: "CHECK" }),
    !result ? h("p", { class: "muted", text: preview && preview.status === "error" ? `✕ ${preview.message}` : "checking…" })
      : newErrors.length === 0 ? h("p", { class: "ok", text: "✓ No new errors" })
        : [h("p", { class: "err", text: `✕ ${plural(newErrors.length, "new error")}` }), newErrors.map((issue) => h("p", { class: "err small", text: `${issue.path}: ${issue.message}` }))],
    warnings.length ? h("p", { class: "warn", text: `▲ ${plural(warnings.length, "warning")} already in ${kindName(kind)} · does not block` }) : null,
    newWarnings.map((issue) => h("p", { class: "warn-text small", text: `▲ ${issue.path || "(file)"}: ${issue.message}` })),
    result ? h("p", { class: "text-2", text: "✓ comments outside the edited values kept" }) : null);
  let diffEl;
  if (!result) diffEl = h("p", { class: "muted pad", text: preview && preview.status === "error" ? "No diff: the preview failed." : "checking…" });
  else {
    const hunks = diffHunks(result.diff, edits);
    diffEl = hunks.length === 0 ? h("p", { class: "muted pad", text: "The edits do not change the file text." }) : hunks.map((hunk) => h("div", { class: "hunk" },
      h("div", { class: "dline head" }, h("span", { class: "dnum" }), h("span", { class: "dop faint", text: "@@" }), h("span", { class: "dtext muted", text: hunk.label })),
      hunk.lines.map((line) => h("div", { class: `dline${line.op === "+" ? " add" : line.op === "-" ? " rm" : ""}` },
        h("span", { class: "dnum", text: String(line.num) }), h("span", { class: "dop", text: line.op === "-" ? "−" : line.op === "+" ? "+" : "" }),
        h("span", { class: "dtext", text: line.line })))));
  }
  const conflict = app.conflict && app.conflict.file === kind ? conflictBanner() : null;
  const writeBtn = h("button", {
    type: "button", class: "btn accent", "data-fk": "review:write",
    text: maintainer() ? app.writing === kind ? "Writing defaults…" : "Write defaults" : app.writing === kind ? `Writing ${kind} file…` : `Write ${kind} file`,
    disabled: app.stopped || !result || newErrors.length > 0 || Boolean(conflict) || Boolean(app.writing),
    onclick: () => writeFile(kind),
  });
  const panel = h("div", { class: "review", role: "dialog", "aria-modal": "true", "aria-label": "Review changes" },
    h("div", { class: "rtabs", role: "tablist" }, h("span", { class: "rtitle", text: "Review changes" }), tabs, h("span", { class: "spacer" }), h("span", { class: "muted small", text: "esc to close" })),
    h("div", { class: "rbody" },
      h("div", { class: "redits", "data-scroll": "redits" }, h("div", { class: "meta-caps" }, "EDITS → ", h("span", { class: "lc", text: file(kind).path })), editBlocks, check),
      h("div", { class: "rdiff", "data-scroll": "rdiff" }, diffEl)),
    conflict,
    h("div", { class: "rfoot" }, h("span", { class: "muted small", text: 'The write stops with "changed on disk" if another tool edited the file after the page read it.' }),
      h("span", { class: "spacer" }),
      h("button", { type: "button", class: "btn", text: "Back", "data-fk": "review:back", onclick: closeReview }),
      writeBtn));
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusables = [...panel.querySelectorAll("button:not([disabled]), [tabindex='0']")];
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  host.replaceChildren(panel);
}

async function reloadForReview(kind) {
  const token = ++app.seq.state;
  try {
    const state = await api("api/state");
    if (token !== app.seq.state) return;
    setState(state);
    app.bases[kind] = queueCount(kind) ? file(kind).hash : null;
    app.conflict = null;
    app.blocked = null;
    if (app.review) delete app.review.previews[kind];
    openReview();
  } catch (error) {
    showError(error);
  }
  render();
}

function conflictBanner() {
  const conflict = app.conflict;
  const count = queueCount(conflict.file);
  return h("div", { class: "conflict" },
    h("div", { class: "conflict-main" }, h("strong", { class: "err", text: "File changed on disk" }),
      h("span", { text: conflict.message }), h("span", { class: "spacer" }),
      h("button", { type: "button", class: "btn primary", text: "Reload and review", "data-fk": "conflict:reload",
        disabled: Boolean(app.writing), onclick: () => { void reloadForReview(conflict.file); } }),
      h("button", { type: "button", class: "btn", text: "Discard changes…", disabled: Boolean(app.writing),
        onclick: () => { conflict.confirming = !conflict.confirming; render(); } })),
    h("p", { class: "prose", text: "Reload keeps unsaved changes. Review the new diff before writing." }),
    conflict.confirming ? h("div", { class: "conflict-confirm" },
      h("p", { text: `Discard ${plural(count, "change")} for ${conflict.file}? The other file keeps its changes.` }),
      h("div", { class: "btnrow" },
        h("button", { type: "button", class: "btn", text: "Keep editing", onclick: () => { conflict.confirming = false; render(); } }),
        h("button", { type: "button", class: "btn err-fill", text: "Discard and reload", disabled: Boolean(app.writing), onclick: async () => {
          clearQueue(conflict.file);
          app.conflict = null;
          app.blocked = null;
          if (app.review) delete app.review.previews[conflict.file];
          settleReview();
          await loadState();
        } }))) : null);
}

// ---------- banners and status bar ----------

function renderBanners() {
  const host = document.getElementById("banners");
  const out = [];
  if (app.stopped && app.state) {
    out.push(h("div", { class: "stopped-card" },
      h("p", { class: "err", text: "● disconnected · the editor stopped" }),
      h("p", { class: "prose", text: "The page is read-only now. Unsaved changes stay in this tab. Start the editor again:" }),
      cmdLine("omt config edit --web")));
  }
  if (app.conflict && !app.review) out.push(conflictBanner());
  host.replaceChildren(...out);
}

function renderStatus() {
  const bar = document.getElementById("statusbar");
  if (!app.state) {
    bar.replaceChildren();
    append(bar, [
      h("span", { class: `dot ${app.stopped ? "err" : "ok"}`, role: "img", "aria-label": app.stopped ? "Editor stopped" : "Editor connected" }),
      h("span", { class: app.stopped ? "err" : "conn", text: app.stopped ? "disconnected · the editor stopped" : "connected · 127.0.0.1" }),
      app.error ? h("span", { class: "err", text: `✕ ${app.error.message}${app.error.hint ? ` · ${app.error.hint}` : ""}` }) : null]);
    return;
  }
  const issues = allIssues();
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  let summary = null;
  if (app.toast) summary = h("span", { class: "ok", text: app.toast.text });
  else if (app.error) summary = h("span", { class: "err" }, `✕ ${app.error.message}`, app.error.hint ? h("span", { class: "muted", text: ` · ${app.error.hint}` }) : null);
  else if (errors.length || warnings.length) {
    const first = errors[0] || warnings[0];
    summary = h("button", {
      type: "button", class: "issues-btn", "aria-expanded": app.issuesOpen ? "true" : "false", "data-fk": "status:issues",
      onclick: () => { app.issuesOpen = !app.issuesOpen; render(); },
    }, errors.length ? h("span", { class: "err", text: `✕ ${plural(errors.length, "error")}` }) : h("span", { class: "warn", text: `▲ ${plural(warnings.length, "warning")}` }),
    h("span", { class: "muted", text: ` ${first.path || "(file)"} (${issueSource(first.source)}): ${first.message}` }));
  }
  const counts = maintainer() ? `${queueCount("user")} unsaved in ${DEFAULTS_FILE}` : app.stopped
    ? FILES.filter((kind) => queueCount(kind)).map((kind) => `${kind}: ${queueCount(kind)} unsaved`).join(" · ") || "no unsaved changes"
    : `user: ${queueCount("user")} unsaved · project: ${queueCount("project")}`;
  bar.replaceChildren();
  append(bar, [
    h("span", { class: `dot ${app.stopped ? "err" : "ok"}`, role: "img", "aria-label": app.stopped ? "Editor stopped" : "Editor connected" }),
    h("span", { class: app.stopped ? "err" : "conn", text: app.stopped ? "disconnected · the editor stopped" : "connected · 127.0.0.1" }),
    summary,
    h("span", { class: "spacer" }),
    h("span", { class: "counts", text: counts }),
    h("button", {
      type: "button", class: "btn accent review-btn", "data-fk": "status:review", text: "Review changes ⏎",
      "aria-keyshortcuts": IS_MAC ? "Meta+Enter" : "Control+Enter",
      disabled: app.stopped || totalQueued() === 0,
      onclick: openReview,
    })]);
  const pop = document.getElementById("issues-pop");
  pop.hidden = !app.issuesOpen;
  if (app.issuesOpen) {
    pop.replaceChildren(h("div", { class: "meta-caps", text: "ISSUES" }), ...issues.map((issue) => h("p", { class: issue.severity === "error" ? "err" : "warn-text" },
      `${issue.severity === "error" ? "✕" : "▲"} ${issue.path || "(file)"} (${issueSource(issue.source)}): `, h("span", { class: "text", text: issue.message }))));
  }
}

function atPath(value, path) {
  for (const part of path) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

function ownLeaf(kind, path, pending = true) {
  const entry = app.rootMap.get(pk(path));
  const own = entry && [entry, ...entry.overridden].find((item) => item.source.kind === kind);
  let value = own?.value;
  let touched = false;
  if (pending && kind !== "defaults") {
    for (const edit of app.queues[kind].values()) {
      if (edit.path.length > path.length || !edit.path.every((part, i) => path[i] === part)) continue;
      if (edit.remove) { value = undefined; touched = true; }
      else if (edit.value === null) { value = null; touched = true; }
      else {
        const next = atPath(edit.value, path.slice(edit.path.length));
        if (next !== undefined) { value = next; touched = true; }
      }
    }
  }
  return { value, touched };
}

function layeredLeaf(path, pending = true) {
  let result = { value: undefined, source: undefined, pending: false };
  for (const kind of ["defaults", ...FILES]) {
    const own = ownLeaf(kind, path, pending);
    if (own.value !== undefined) result = { value: own.value === null ? undefined : own.value, source: { kind }, pending: own.touched };
  }
  return result;
}

function previewChain(name, pending = true) {
  const names = [];
  const seen = new Set();
  let next = name;
  while (next && !seen.has(next) && names.length < app.state.vocab.profileChainMax) {
    names.unshift(next);
    seen.add(next);
    const parent = layeredLeaf(["profiles", next, "extends"], pending).value;
    next = typeof parent === "string" ? parent : next === "normal" ? null : "normal";
  }
  return names;
}

function displayedLeaf(path, pending = true) {
  let result = layeredLeaf(path, pending);
  if (["roles", "limits", "models", "workflow"].includes(path[0]) && !app.profileError) {
    for (const name of previewChain(app.profile, pending)) {
      const own = layeredLeaf(["profiles", name, ...path], pending);
      if (own.source) result = { ...own, source: { kind: "profile", profile: name, declaredIn: own.source } };
    }
  }
  return result;
}

function previewDifferences() {
  const saved = app.savedExplain;
  if (!saved || saved.profile.name !== app.state.selectedProfile) return new Map();
  const baseline = new Map(saved.effective.map((entry) => [pk(entry.path), entry.value]));
  const paths = new Map([...saved.effective, ...app.explain.effective].map((entry) => [pk(entry.path), entry.path]));
  const diff = new Map();
  for (const [key, path] of paths) {
    const value = displayedLeaf(path).value;
    if (!same(value, baseline.get(key))) diff.set(key, { before: baseline.get(key), value });
  }
  return diff;
}

function editTarget(path) {
  const source = displayedLeaf(path).source;
  const profile = path[0] === "workflow" || (["roles", "limits", "models"].includes(path[0]) &&
    (app.scope === "profile" || (app.scope === "auto" && source?.kind === "profile")));
  return profile ? ["profiles", app.profile, ...path] : path;
}

function stageValue(path, value, remove = false, from = file(app.editIn).hash) {
  if (!canEdit()) return false;
  const target = editTarget(path);
  const current = ownLeaf(app.editIn, target, false).value;
  if (remove && current === undefined || !remove && (same(value, current) || current === undefined && valueKind(target).type !== "bool" && same(value, displayedLeaf(path, false).value))) unqueue(app.editIn, target);
  else if (!enqueue(app.editIn, target, remove ? { remove: true } : { value }, from)) return false;
  delete app.inlineErrors[pk(target)];
  return true;
}

function renderHeader() {
  if (!app.state) return;
  const disabled = !canEdit();
  const saved = app.state.selectedProfile;
  const pending = queued(app.editIn, ["profile"]);
  const savedEntry = app.rootMap.get(pk(["profile"]));
  const profileControl = select(app.state.profiles, app.previewPending || app.profile,
    (name) => { void pickProfile(name); }, { label: "Show values for profile", disabled: app.stopped, fk: "preview-profile" });
  const defaultChoices = app.state.profiles.includes(saved) ? app.state.profiles : [...app.state.profiles, { value: saved, label: `${saved} (invalid)` }];
  const defaultControl = select(defaultChoices, pending && !pending.remove ? pending.value : saved, (name) => {
    stageValue(["profile"], name);
    render();
  }, { label: "Saved default", disabled, fk: "saved-default" });
  document.getElementById("cmdbar").replaceChildren(
    h("a", { class: "brand", href: "#/skills/build", title: `omt ${app.state.version}` }, h("strong", { text: "omt" }), maintainer() ? " defaults" : " config"),
    h("label", { class: `header-control${app.previewPending ? " preview-loading" : app.profile !== saved ? " preview-other" : ""}`, title: "Shows the values of this profile on every page. It does not change what runs." }, h("span", { text: "Show values for" }), profileControl,
      h("small", { class: "muted", text: app.previewPending ? "loading…" : "view only" })),
    h("label", { class: "header-control header-default" }, h("span", { text: "Saved default" }), defaultControl,
      h("small", { class: pending && app.editIn === "user" && savedEntry?.source.kind === "project" ? "warning-text" : pending ? "accent" : "muted", text: pending ? app.editIn === "user" && savedEntry?.source.kind === "project" ? "project overrides this" : "unsaved" : sourceLabel(savedEntry?.source) || "defaults" })),
    maintainer() ? h("div", { class: "header-control file-picker maintainer-file", title: "Maintainer mode saves the built-in defaults and the skill files of this clone. Commit them; users get them in the next release." },
      h("span", { text: "Edit file" }), h("code", { text: DEFAULTS_FILE }), h("small", { class: "accent", text: "maintainer" }),
      h("button", { class: "help-button", type: "button", text: "i", "aria-label": "Maintainer mode help", onclick: () => { app.history = app.history === "files" ? null : "files"; render(); } })) : h("div", { class: "header-control file-picker" }, h("span", { text: "Edit file" }),
      seg(["project", "user"].map((kind) => ({ value: kind, label: `${kind === "project" ? "Project" : "User"}${absent(kind) ? " · absent" : ""}`,
        detail: kind === "project" && usable(kind) ? ".omt3/config.jsonc" : undefined,
        disabled: !usable(kind), title: absent(kind) ? `Optional file. Create it with ${kind === "user" ? "omt config init" : "omt init"}.\n${file(kind).path}` : file(kind).path })), app.editIn,
      (kind) => { switchEditIn(kind); refreshDrafts(); render(); }, { label: "Edit file", disabled: app.stopped, fk: "editin" }),
      h("button", { class: "help-button", type: "button", text: "i", "aria-label": "Config file help", onclick: () => { app.history = app.history === "files" ? null : "files"; render(); } })),
    h("span", { class: "header-count", text: totalQueued() ? `${totalQueued()} unsaved` : "No unsaved changes", "aria-live": "polite" }),
    h("button", { type: "button", class: `btn review-btn${totalQueued() ? " accent" : ""}`, text: "Review changes", disabled: app.stopped || !totalQueued(), onclick: openReview }));
}

function navigation() {
  const screen = app.route.screen;
  const navLink = (text, href, selected, count) => h("a", { href, class: `nav-item${selected ? " selected" : ""}`, "aria-current": selected ? "page" : undefined }, text,
    count === undefined ? null : h("small", { class: "muted", text: String(count) }));
  return h("nav", { class: "workspace-nav", "aria-label": "Configuration" },
    navLink("Skills", "#/skills/build", screen === "skills"),
    h("div", { class: "skill-nav" }, Object.entries(SKILLS).map(([key, skill]) => navLink(skill.label, `#/skills/${key}`, screen === "skills" && app.route.name === key))),
    navLink("Roles", "#/roles", ["roles", "role"].includes(screen), roleNames().length),
    navLink("Profiles", "#/profiles", ["profiles", "profile"].includes(screen), app.state.profiles.length),
    navLink("Settings", "#/settings", ["settings", "root"].includes(screen)));
}

function workspace() {
  const screen = app.route.screen;
  let body;
  if (screen === "skills") body = skillScreen(app.route.name, app.route.tab);
  else if (screen === "settings") body = settingsScreen();
  else if (screen === "roles" || screen === "profiles") body = directoryScreen(screen);
  else if (screen === "role") body = focusedEditor("Role editor", app.route.name === "+new" ? newRoleForm() : roleEditor(app.route.name));
  else if (screen === "profile") body = focusedEditor("Profile editor", app.route.name === "+new" ? newProfileForm() : profileEditor(app.route.name));
  else body = focusedEditor("Base settings", rootScreen());
  return h("div", { class: "workspace" }, navigation(), h("div", { class: "workspace-main", "data-scroll": "workspace" },
    previewNotice(), blockedCard(), body), app.history ? historyPopover() : null);
}

function previewNotice() {
  if (app.previewPending) return h("div", { class: "notice info", role: "status", text: `Loading ${app.previewPending}. Showing ${app.profile} until it loads. Edits are paused.` });
  if (app.previewError) return h("div", { class: "notice warning", role: "alert" },
    `Could not load ${app.previewError.name}. Still showing ${app.profile}. `,
    h("span", { text: app.previewError.message }),
    h("button", { type: "button", class: "link", text: "Try again", onclick: () => { void pickProfile(app.previewError.name); } }));
  if (app.profileError) return h("div", { class: "notice warning", role: "alert", text: `${app.profileError}. Only base settings are available.` });
  return null;
}

function backLabel() {
  const parts = (app.back || "#/").replace(/^#\/?/, "").split(/[/?]/);
  if (parts[0] === "roles") return "Roles";
  if (parts[0] === "profiles") return "Profiles";
  if (parts[0] === "settings") return "Settings";
  const skill = SKILLS[parts[1]] || SKILLS.build;
  return skill.label;
}

function focusedEditor(title, body) {
  const role = app.route.screen === "role" && app.route.name !== "+new";
  const profile = app.route.screen === "profile" && app.route.name !== "+new";
  return h("section", { class: `focused-editor${role ? " role-editor" : ""}${profile ? " profile-editor" : ""}` },
    h("header", { class: "editor-title" },
      h("div", { class: "editor-title-bar" },
        h("a", { class: "back-link", href: app.back || "#/", text: `← ${backLabel()}` }),
        h("span", { class: "spacer" }),
        role ? roleInstructionsLink(app.route.name) : null,
        role ? docsLink("docs/configuration.md#change-a-role") : app.route.screen === "profile" ? docsLink("docs/configuration.md#write-a-custom-profile") : null,
        h("button", { type: "button", class: "link plain", text: "Close ×", onclick: closeModal })),
      h("div", { class: "editor-title-main" },
        role || profile ? h("small", { class: "muted", text: role ? "Role" : "Profile" }) : null,
        h("h1", { class: role || profile ? "mono" : "", text: role || profile ? app.route.name : title })),
      role ? h("p", { class: "muted role-description", text: roleDesc(app.route.name) }) : null), body);
}

function directoryScreen(kind) {
  if (kind === "profiles") return profilesScreen();
  const names = roleNames();
  return h("section", { class: "directory" },
    h("header", { class: "page-title" }, h("h1", { text: "Roles" }),
      docsLink("docs/configuration.md#default-roles"), h("span", { class: "spacer" }),
      h("a", { class: "btn", href: "#/role/+new", text: "+ Add role" })),
    h("p", { class: "muted", text: "Models and permissions for each child task." }),
    names.map((name) => h("article", { class: "directory-row" },
      h("div", null, h("a", { class: "directory-name", href: `#/role/${encodeURIComponent(name)}`, text: name }),
        h("p", { class: "muted", text: roleDesc(name) }), roleUses(name)),
      h("div", { class: "chain-chips" }, (displayedLeaf(["roles", name, "chain"]).value || []).map((rung, i) => h("span", { class: "model-chip" },
        h("small", { class: "muted", text: i ? "Fallback" : "First choice" }), h("code", { text: `${rung.model}${rung.effort ? ` · ${rung.effort}` : ""}` })))))));
}

// The values that a profile sets itself, each with the value of its parent profile when the parent sets it.
function profileChanges(name) {
  const parent = rootValue(["profiles", name, "extends"]) || (name === "normal" ? null : "normal");
  return app.explain.root.filter((entry) => entry.path[0] === "profiles" && entry.path[1] === name && !["description", "extends"].includes(entry.path[2]) && entry.value !== undefined)
    .map((entry) => {
      const rel = entry.path.slice(2);
      const before = parent ? (rootValue(["profiles", parent, ...rel]) ?? (rel[0] === "workflow" ? undefined : rootValue(rel))) : undefined;
      return { rel, value: entry.value, before };
    });
}

function profileUsage(name) {
  const isDefault = (queued(app.editIn, ["profile"])?.value ?? app.state.selectedProfile) === name;
  return h("div", { class: "profile-usage" },
    h("div", { class: "usage-row" }, h("span", { class: "usage-label", text: "One run" }),
      h("code", { text: `ulw --profile ${name} <task>` }), copyButton(`ulw --profile ${name} `),
      h("span", { class: "muted", text: "Type it in the T3 composer. Plan, Design, and Code review take the same flag." })),
    h("div", { class: "usage-row" }, h("span", { class: "usage-label", text: "Every run" }),
      isDefault ? h("span", { class: "default-badge", text: "Saved default" }) : h("button", { type: "button", class: "btn small", text: "Make default", disabled: !canEdit(),
        onclick: () => { stageValue(["profile"], name); render(); } }),
      h("span", { class: "muted", text: "A run without --profile uses the saved default." })),
    h("div", { class: "usage-row" }, h("span", { class: "usage-label", text: "Running plan" }),
      h("code", { text: `omt plan profile <slug> ${name}` }),
      h("span", { class: "muted", text: "Changes the profile for the rest of the plan." })));
}

function profileChangeList(name, limit) {
  const changes = profileChanges(name);
  if (name === "normal") return h("p", { class: "muted", text: "The base profile. It sets every workflow value, and other profiles change only some of them." });
  if (!changes.length) return h("p", { class: "muted", text: `Same values as ${rootValue(["profiles", name, "extends"]) || "normal"}.` });
  const shown = limit ? changes.slice(0, limit) : changes;
  return h("div", { class: "profile-changes" },
    h("p", { class: "muted", text: `Changes ${plural(changes.length, "value")} from ${rootValue(["profiles", name, "extends"]) || "normal"}:` }),
    h("ul", null, shown.map((change) => h("li", null, h("code", { text: change.rel[0] === "workflow" ? change.rel.slice(1).join(".") : dotted(change.rel) }), " ",
      change.before === undefined ? null : [h("span", { class: "muted", text: fmt(change.before) }), " → "], h("strong", { text: fmt(change.value) })))),
    limit && changes.length > limit ? h("a", { href: `#/profile/${encodeURIComponent(name)}`, class: "link", text: `${changes.length - limit} more` }) : null);
}

function profilesScreen() {
  return h("section", { class: "directory profiles-page" },
    h("header", { class: "page-title" }, h("h1", { text: "Profiles" }),
      docsLink("docs/configuration.md#choose-a-profile"), h("span", { class: "spacer" }),
      h("a", { class: "btn", href: "#/profile/+new", text: "+ Add profile" })),
    h("p", { class: "profiles-intro" }, "A profile is a set of workflow switches: how many reviews, which checks, how many design variants. Every run uses one profile. A run uses the saved default unless you name another one with ",
      h("code", { text: "--profile" }), "."),
    app.state.profiles.map((name) => h("article", { class: "profile-card" },
      h("header", { class: "profile-card-head" },
        h("a", { class: "directory-name", href: `#/profile/${encodeURIComponent(name)}`, text: name }),
        app.state.vocab.presetProfiles.includes(name) ? h("small", { class: "muted", text: "Preset" }) : h("small", { class: "muted", text: "Custom" }),
        h("span", { class: "spacer" }),
        h("a", { class: "btn small", href: `#/profile/${encodeURIComponent(name)}`, text: "Edit" })),
      h("p", { class: "profile-when", text: rootValue(["profiles", name, "description"]) || "" }),
      profileChangeList(name, 6),
      profileUsage(name))));
}

function fileScopeControl() {
  return h("div", { class: "scope-control" }, h("span", { class: "muted", text: `Edits go to ${fileWords(app.editIn)}` }),
    select([{ value: "auto", label: "Use value's scope" }, { value: "base", label: "Base settings" }, { value: "profile", label: `Profile: ${app.profile}` }], app.scope,
      (value) => { app.scope = value; render(); }, { label: "Edit scope", disabled: !canEdit(), fk: "edit-scope" }));
}

function sourceBadge(path) {
  const leaf = displayedLeaf(path);
  const label = leaf.source ? sourceLabel(leaf.source) : "not set";
  const profile = leaf.source?.kind === "profile" ? leaf.source.profile : null;
  const badge = profile ? profile === "normal" ? shortLabel(leaf.source.declaredIn) : profile : label;
  return h("button", { type: "button", class: `source-badge${profile && profile !== "normal" ? " profile-source" : ""}${leaf.pending ? " pending-source" : ""}`, text: badge,
    title: "Show source history and edit destination", "aria-label": `Source of ${dotted(path)}: ${label}`, "aria-expanded": same(app.history, path) ? "true" : "false",
    onclick: () => { app.history = same(app.history, path) ? null : path; render(); } });
}

function historyPopover() {
  const close = h("button", { type: "button", class: "icon popover-close", text: "×", "aria-label": "Close source details", onclick: () => { app.history = null; render(); } });
  if (app.history === "files" && maintainer()) return h("aside", { class: "source-popover", role: "dialog", "aria-label": "Maintainer mode" }, close,
    h("h2", { text: "Maintainer mode" }),
    h("p", null, "Edits save ", h("code", { text: DEFAULTS_FILE }), " and the skill files in ", h("code", { text: "skills/" }), " of this clone. User and project configs are not read."),
    h("p", { class: "muted", text: "Commit the changes and release. Users review the new defaults with omt doctor or omt update before they apply." }));
  if (app.history === "files") return h("aside", { class: "source-popover", role: "dialog", "aria-label": "Config files" }, close,
    h("h2", { text: "Config files" }), h("p", { text: "Defaults work without a user file." }),
    FILES.map((kind) => h("section", { class: "file-help" }, h("strong", { text: `${kind} · ${absent(kind) ? "optional, absent" : parseError(kind) ? "cannot parse" : "present"}` }),
      h("code", { text: file(kind).path }), absent(kind) ? cmdLine(kind === "user" ? "omt config init" : "omt init") : null)),
    h("p", { class: "muted", text: "A command's profile takes precedence over a plan header, then the project default, the user default, and normal." }));
  const path = app.history;
  const stack = stackOf(path);
  const target = editTarget(path);
  const edit = queued(app.editIn, target);
  const over = overridesOf(app.editIn, target);
  return h("aside", { class: "source-popover", role: "dialog", "aria-label": `Source of ${dotted(path)}` }, close,
    h("h2", { text: "Source history" }), h("code", { text: dotted(path) }), h("p", { text: docFor(path) }),
    edit ? h("p", { class: "accent", text: `Preview with unsaved changes: ${fmt(displayedLeaf(path).value)}` }) : null,
    LAYERS.filter((layer) => !maintainer() || layer === "user" || layer === "profile").map((layer) => {
      const item = stack.rows[layer];
      return h("div", { class: `history-row${item?.state === "win" ? " winner" : ""}` },
        h("span", { text: item ? sourceLabel(item.source) : layer === "profile" ? `profile ${app.profile}` : kindName(layer) }),
        h("code", { text: item ? fmt(item.value) : layer !== "defaults" && layer !== "profile" && absent(layer) ? "absent" : "not set" }),
        item?.state === "win" ? h("small", { text: "sets this value" }) : null);
    }), fileScopeControl(), h("code", { class: "target-path", text: `${kindName(app.editIn)}: ${dotted(target)}` }),
    over.length ? h("p", { class: "warning-text", text: `⚠ ${over[0].who} overrides this edit. This preview stays ${fmt(stack.value)}.` }) : null,
    target[0] === "profiles" && target[1] === "normal" ? h("p", { class: "muted", text: "Other profiles inherit unset keys from normal." }) : null,
    h("div", { class: "btnrow" }, h("button", { type: "button", class: "btn", text: "Reset to inherited", disabled: !canEdit() || !fileSets(app.editIn, target) || edit?.remove,
      onclick: () => { stageValue(path, undefined, true); render(); } }),
      edit ? h("button", { type: "button", class: "link", text: "Undo", disabled: !canEdit(), onclick: () => { unqueue(app.editIn, target); render(); } }) : null));
}

function inlineControl(path, compact = false) {
  const leaf = displayedLeaf(path);
  const target = editTarget(path);
  const type = valueKind(target);
  const edit = queued(app.editIn, target);
  const current = leaf.value;
  const disabled = !canEdit();
  const fk = `inline:${app.editIn}:${pk(target)}`;
  const seen = file(app.editIn).hash;
  const title = `Save to ${app.editIn}: ${dotted(target)}`;
  const stage = (value, remove = false) => { stageValue(path, value, remove, seen); render(); };
  let control;
  if (type.type === "number" && type.auto) {
    const options = ["auto", ...Array.from({ length: type.range[1] - type.range[0] + 1 }, (_, i) => String(type.range[0] + i))];
    const pick = (value) => stage(value === "auto" ? value : Number(value));
    control = compact ? select(options, String(current), pick, { label: dotted(path), disabled, fk })
      : seg(options, String(current), pick, { label: dotted(path), disabled, fk });
  } else if (type.type === "enum") {
    control = !compact && type.values.length <= 3
      ? seg(type.values, current, stage, { label: dotted(path), disabled, fk })
      : select(type.values, current, stage, { label: dotted(path), disabled, fk });
  } else if (type.type === "bool") {
    const own = ownLeaf(app.editIn, target).value;
    control = seg([{ value: "inherit", label: "Inherit" }, { value: "true", label: "On" }, { value: "false", label: "Off" }],
      own === undefined ? "inherit" : String(own), (value) => stage(value === "true", value === "inherit"), { label: dotted(path), disabled, fk });
  } else if (type.type === "items") {
    control = h("div", { class: "checks" }, type.items.map((item) => h("label", { class: "check" },
      checkbox((current || []).includes(item), { disabled, "data-fk": `${fk}:${item}` }, (on) => stage(on ? [...current || [], item] : (current || []).filter((value) => value !== item))), item)));
  } else if (type.type === "chain") {
    control = h("a", { class: "btn chain-link", href: `#/role/${encodeURIComponent(path[1])}`, text: `${(current || []).length} models · Edit fallback order` });
  } else {
    const cell = `inline-draft:${app.editIn}:${pk(target)}`;
    const input = h("input", { type: type.type === "number" && !type.auto ? "number" : "text", class: type.type === "number" ? "num" : "text",
      value: typedText(cell, rawOf(type, current)), disabled, "data-fk": fk, "aria-label": dotted(path), title,
      min: type.range?.[0], max: type.range?.[1], step: type.type === "number" ? "1" : undefined });
    typedField(input, cell, seen, (raw, from) => {
      const parsed = parseValue(type, raw);
      if (type.type === "list" && !raw.trim()) { const done = stageValue(path, undefined, true, from); render(); return done; }
      if (parsed.error) {
        app.inlineErrors[pk(target)] = parsed.error;
        render();
        return false;
      }
      const done = stageValue(path, parsed.value, false, from);
      render();
      return done;
    });
    control = input;
  }
  const over = overridesOf(app.editIn, target);
  return h("div", { class: `inline-value${edit ? " is-unsaved" : ""}`, title }, control,
    over.length ? h("span", { class: "override-hint", title: `${over[0].who} sets ${fmt(over[0].value)}. ${title}`, text: "⚠ overridden" }) : null,
    edit ? h("div", { class: "pending-note" }, h("span", { text: edit.remove ? "Reset unsaved" : `Unsaved in ${app.editIn}` }),
      h("button", { type: "button", class: "link", text: "Undo", disabled, onclick: () => { unqueue(app.editIn, target); render(); } }),
      h("code", { text: dotted(target) })) : null,
    app.inlineErrors[pk(target)] ? h("span", { class: "err", role: "alert", text: app.inlineErrors[pk(target)] }) : null);
}

// The drivers that omt may use, with what the editor detected for each one. Unset means every driver.
function harnessesPanel() {
  const catalog = app.state.catalog || { source: "local", providers: [] };
  const drivers = [...new Set(catalog.providers.map((item) => item.driver))];
  const leaf = displayedLeaf(["harnesses"]);
  const current = Array.isArray(leaf.value) ? leaf.value : null;
  for (const driver of current || []) if (!drivers.includes(driver)) drivers.push(driver);
  const disabled = !canEdit();
  const edit = queued(app.editIn, ["harnesses"]);
  const pick = (driver, on) => {
    const base = current || drivers;
    const next = drivers.filter((item) => (item === driver ? on : base.includes(item)));
    if (!next.length) return;
    stageHarnesses(next);
    render();
  };
  // Removing the key falls back to the layers below the edited file, so remove it only when they give the same drivers.
  const stageHarnesses = (wanted) => {
    let below;
    for (const kind of ["defaults", ...FILES]) {
      if (kind === app.editIn) break;
      const own = ownLeaf(kind, ["harnesses"]).value;
      if (own !== undefined) below = own === null ? undefined : own;
    }
    const fallback = Array.isArray(below) ? below : drivers;
    const sameSet = wanted.every((item) => fallback.includes(item)) && fallback.every((item) => wanted.includes(item));
    if (sameSet) stageValue(["harnesses"], undefined, true);
    else stageValue(["harnesses"], wanted);
  };
  const recommended = catalog.providers.filter((item) => item.available).map((item) => item.driver);
  return h("section", { class: "harnesses-panel" },
    h("div", { class: "section-head" }, h("h2", { text: "Harnesses" }), sourceBadge(["harnesses"])),
    h("p", { class: "muted", text: "The drivers that child tasks may run on. omt skips the model chain rungs of a driver that is off. All on is the same as no harnesses key." }),
    h("div", { class: "harness-list" }, drivers.map((driver) => {
      const provider = catalog.providers.find((item) => item.driver === driver);
      const on = current ? current.includes(driver) : true;
      return h("label", { class: "harness-row" },
        checkbox(on, { disabled: disabled || (on && (current || drivers).length <= 1), "data-fk": `harness:${driver}` }, (value) => pick(driver, value)),
        h("strong", { text: provider ? provider.label : driver }), h("code", { class: "muted", text: driver }),
        h("span", { class: provider && provider.available ? "muted" : "warning-text", text: provider ? `${provider.available ? "Detected" : "Not detected"}: ${provider.reason}` : "Not detected" }));
    })),
    edit ? h("div", { class: "pending-note" }, h("span", { text: `Unsaved in ${app.editIn}` }),
      h("button", { type: "button", class: "link", text: "Undo", disabled, onclick: () => { unqueue(app.editIn, editTarget(["harnesses"])); render(); } })) : null,
    !same([...recommended].sort(), [...(current || drivers)].sort()) && recommended.length ? h("p", { class: "warning-text" }, `The detected drivers are ${recommended.join(", ")}. `,
      h("button", { type: "button", class: "link", text: "Use the detected drivers", disabled, onclick: () => {
        stageHarnesses(recommended);
        render();
      } })) : null);
}

function settingsScreen() {
  const diff = previewDifferences();
  const entries = app.explain.effective.length ? app.explain.effective : app.explain.root.filter((entry) => entry.path[0] !== "profiles");
  const paths = new Map(entries.map((entry) => [pk(entry.path), entry.path]));
  paths.delete(pk(["harnesses"]));
  const groups = new Map();
  for (const [key, path] of paths) {
    // Skills edit the workflow keys, Roles edit the roles, the header edits the saved default, harnessesPanel edits harnesses.
    if (["profiles", "workflow", "roles", "profile"].includes(path[0])) continue;
    const group = path[0] === "workflow" ? `workflow.${path[1]}` : path[0] === "models" || ROOT_ONLY.has(path[0]) ? "base" : path[0];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(path);
  }
  const descriptions = { "workflow.build": "Review, tests, and proof rules for Build.", "workflow.review": "Reviewers, oracle, and pull request checks.",
    "workflow.plan": "Plan reviewer and test layers.", "workflow.design": "Design variants per screen and the design tool.", "workflow.git": "Commits, pull requests, and merge.",
    limits: "Caps on child tasks, depth, and review rounds.", roles: "Models and permissions for child tasks.", base: "Options for one model in every role that uses it." };
  return h("section", { class: "settings-page" },
    h("header", { class: "settings-toolbar" }, h("h1", { text: "Settings" })),
    h("div", { class: "settings-destination" }, fileScopeControl(), h("a", { class: "link", href: "#/root", text: "More base settings" })),
    app.profile !== app.state.selectedProfile ? h("div", { class: "preview-comparison" }, `Previewing ${app.profile}. The saved default stays ${app.state.selectedProfile}.`,
      h("button", { type: "button", class: "link", text: "Use as default", disabled: !canEdit(), onclick: () => { stageValue(["profile"], app.profile); render(); } })) : null,
    harnessesPanel(),
    h("p", { class: "settings-elsewhere muted" }, "Workflow switches are on the ", h("a", { href: "#/skills/build", text: "Skills" }), " pages, models and permissions on ",
      h("a", { href: "#/roles", text: "Roles" }), ", and the saved default profile in the header."),
    h("div", { class: "settings-columns" }, h("span", { text: "Key" }), h("span", { text: "Value" }), h("span", { text: "Description" }), h("span", { text: "Source" })),
    groups.size ? [...groups].sort(([a], [b]) => ["limits", "base"].indexOf(a) - ["limits", "base"].indexOf(b)).map(([group, paths]) => {
      const open = true;
      return h("section", { class: "settings-group" },
        h("div", { class: "settings-row group-row" },
          h("h2", { class: "group-title" }, group === "base" ? "models" : group, h("span", { class: "group-count", text: String(paths.length) })), h("span"),
          h("span", { class: "muted", text: descriptions[group] || "" }), h("span", { class: "muted", text: "Base or profile" })),
        open ? paths.map((path) => h("div", { class: `settings-row${diff.has(pk(path)) ? " changed-row" : ""}` },
          h("code", { class: "setting-key", text: path[0] === "workflow" ? path.slice(2).join(".") : path[0] === "limits" ? path[1] : dotted(path), title: dotted(path) }),
          h("div", null, inlineControl(path, true), diff.has(pk(path)) ? h("del", { class: "previous-value", text: fmt(diff.get(pk(path)).before), title: "Saved default value" }) : null),
          h("span", { class: "setting-description", text: summaryFor(path) }), sourceBadge(path))) : null);
    }) : null);
}

const DOCS = "https://github.com/gabimoncha/oh-my-t3/blob/main/";
// Every bundled skill. A flow skill has a workflow group, so its page also shows the flow. Keep in sync with
// skills/*/SKILL.md and stageModel.
const SKILLS = {
  build: { label: "Build", command: "omt-ulw", flow: true },
  "code-review": { label: "Code review", command: "omt-code-review", flow: true },
  plan: { label: "Plan", command: "omt-plan", flow: true },
  design: { label: "Design", command: "omt-design", flow: true },
  research: { label: "Research", command: "omt-research", roles: ["explore", "research"] },
  grill: { label: "Grill", command: "omt-grill", roles: ["explore", "grill"] },
  swarm: { label: "Swarm", command: "omt-swarm", roles: ["review", "qa"] },
  help: { label: "Help", command: "omt-help", roles: [] },
  setup: { label: "Setup", command: "omt-setup", roles: [] },
  omt: { label: "Router", command: "omt", roles: [] },
};

function skillDocs(skill) {
  return `skills/${skill.command}/SKILL.md`;
}

function skillRoles(key) {
  const skill = SKILLS[key];
  if (!skill.flow) return skill.roles;
  return [...new Set(stageModel(key).flatMap((stage) => stage.roles))];
}

function roleUses(role) {
  const items = Object.entries(SKILLS).filter(([key]) => skillRoles(key).includes(role))
    .map(([key, skill]) => h("a", { href: `#/skills/${key}`, text: skill.label }));
  if (!items.length) return h("p", { class: "role-uses muted", text: "Used by: no built-in skill. Name it in a plan unit or a custom flow." });
  return h("p", { class: "role-uses muted" }, "Used by: ", items.flatMap((item, i) => i ? [", ", item] : [item]));
}

async function loadSkill(command) {
  if (app.skillTexts.has(command)) return;
  app.skillTexts.set(command, null);
  try {
    const result = await api(`api/skill?name=${encodeURIComponent(command)}`);
    app.skillTexts.set(command, { text: result.text });
  } catch (error) {
    app.skillTexts.set(command, { error: error.message });
  }
  render();
}

// ---------- markdown (read-only skill text) ----------

function splitFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { meta, body: text.slice(match[0].length) };
}

// A relative link in a skill points into the skill folder on GitHub; an anchor or an absolute URL stays as it is.
function skillHref(command, href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return /^https?:/i.test(href) ? href : null;
  if (href.startsWith("#")) return null;
  const parts = [];
  for (const part of `skills/${command}/${href}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return DOCS + parts.join("/");
}

function inlineMarkdown(text, command) {
  const out = [];
  const pattern = /(`+)([\s\S]*?)\1|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*([^*\s][^*]*)\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    if (match[1]) out.push(h("code", { text: match[2] }));
    else if (match[3] !== undefined) out.push(h("strong", null, inlineMarkdown(match[3], command)));
    else if (match[4] !== undefined) {
      const href = skillHref(command, match[5]);
      out.push(href ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, inlineMarkdown(match[4], command)) : h("span", null, inlineMarkdown(match[4], command)));
    } else out.push(h("em", { text: match[6] }));
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function renderMarkdown(text, command) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  const isBreak = (line) => /^\s*$/.test(line) || /^(#{1,6})\s/.test(line) || /^```/.test(line) || /^\s*([-*]|\d+\.)\s/.test(line) || /^\s*\|/.test(line) || /^>/.test(line);
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(h(`h${Math.min(6, heading[1].length + 1)}`, null, inlineMarkdown(heading[2], command)));
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(h("pre", null, h("code", { text: code.join("\n") })));
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const head = tableCells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(tableCells(lines[i++]));
      blocks.push(h("div", { class: "md-table" }, h("table", null,
        h("thead", null, h("tr", null, head.map((cell) => h("th", null, inlineMarkdown(cell, command))))),
        h("tbody", null, rows.map((row) => h("tr", null, row.map((cell) => h("td", null, inlineMarkdown(cell, command)))))))));
      continue;
    }
    if (/^>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(h("blockquote", null, inlineMarkdown(quote.join(" "), command)));
      continue;
    }
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]);
      const items = [];
      while (i < lines.length) {
        const next = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (next) {
          items.push({ depth: next[1].length >= 2 ? 1 : 0, text: next[3] });
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ` ${lines[i].trim()}`;
          i++;
        } else break;
      }
      const list = h(ordered ? "ol" : "ul");
      let sub = null;
      for (const entry of items) {
        if (entry.depth && list.lastChild) {
          if (!sub || sub.parentNode !== list.lastChild) { sub = h("ul"); list.lastChild.append(sub); }
          sub.append(h("li", null, inlineMarkdown(entry.text, command)));
        } else list.append(h("li", null, inlineMarkdown(entry.text, command)));
      }
      blocks.push(list);
      continue;
    }
    const para = [];
    while (i < lines.length && (para.length === 0 || !isBreak(lines[i]))) para.push(lines[i++].trim());
    blocks.push(h("p", null, inlineMarkdown(para.join(" "), command)));
  }
  return blocks;
}

function skillInstructions(key) {
  const skill = SKILLS[key];
  const loaded = app.skillTexts.get(skill.command);
  if (loaded === undefined) void loadSkill(skill.command);
  if (!loaded) return h("p", { class: "muted skill-doc-status", text: "Loading the instructions…" });
  if (loaded.error) return h("p", { class: "err skill-doc-status", text: `Could not load the instructions: ${loaded.error}` });
  return h("article", { class: "skill-doc" }, renderMarkdown(splitFrontmatter(loaded.text).body, skill.command));
}

function skillTabs(key, tab) {
  const tabLink = (id, label) => h("a", { class: `tab${tab === id ? " selected" : ""}`, href: `#/skills/${key}${id === "flow" ? "" : `/${id}`}`, "aria-current": tab === id ? "page" : undefined, text: label });
  return h("nav", { class: "skill-tabs", "aria-label": "Skill views" }, tabLink("flow", "Flow and settings"), tabLink("instructions", "Instructions"));
}

function skillHeader(key, tab) {
  const skill = SKILLS[key];
  const loaded = app.skillTexts.get(skill.command);
  if (loaded === undefined) void loadSkill(skill.command);
  const description = loaded && loaded.text ? splitFrontmatter(loaded.text).meta.description : "";
  const roles = skillRoles(key).filter((role) => roleNames().includes(role));
  return h("header", { class: "skill-head" },
    h("div", { class: "page-title" }, h("h1", { text: skill.label }), h("code", { class: "muted", text: skill.command }),
      h("span", { class: "spacer" }), docsLink(skillDocs(skill), "View on GitHub")),
    description ? h("p", { class: "skill-summary", text: description }) : null,
    h("p", { class: "skill-roles muted" }, roles.length ? ["Child roles: ", roles.flatMap((role, i) => [i ? ", " : "", h("a", { href: `#/role/${role}`, text: role })])] : "No child roles. The main thread does all the work."),
    skill.flow ? skillTabs(key, tab) : null);
}

function instructionsNote(skill) {
  return h("p", { class: "skill-doc-note muted" }, "Read-only. This is ", h("code", { text: skillDocs(skill) }), ` from omt ${app.state.version}. `,
    h("code", { text: "omt update" }), " replaces it with the new version.");
}

function skillPage(key, tab) {
  const skill = SKILLS[key];
  if (maintainer()) return h("section", { class: "skill-page skill-page-edit" }, skillHeader(key, tab), maintainerNote(skill), skillEditor(key, app.route.file));
  return h("section", { class: "skill-page" }, skillHeader(key, tab), instructionsNote(skill), skillInstructions(key));
}

// ---------- skill files (maintainer mode) ----------

function maintainerNote(skill) {
  return h("p", { class: "skill-doc-note muted" }, "Maintainer mode. Save writes ", h("code", { text: `skills/${skill.command}/` }),
    " in this clone. Commit the change; users get it with the next release and ", h("code", { text: "omt update" }), ".");
}

async function loadSkillFiles(command) {
  app.skillFiles.set(command, null);
  try {
    const result = await api(`api/skill-files?name=${encodeURIComponent(command)}`);
    app.skillFiles.set(command, { files: result.files });
  } catch (error) {
    app.skillFiles.set(command, { error: error.message });
  }
  render();
}

function skillBufferId(command, path) {
  return `${command}/${path}`;
}

function skillFileDirty(command, entry) {
  const id = skillBufferId(command, entry.path);
  return app.skillBuffers.has(id) && app.skillBuffers.get(id) !== entry.text;
}

function dirtySkillFiles() {
  return [...app.skillFiles.entries()].flatMap(([command, loaded]) => (loaded?.files || []).filter((entry) => skillFileDirty(command, entry)));
}

// The preview of one skill file. Relative links resolve from the file's own folder.
function skillFileView(text, command, path) {
  const folder = path.includes("/") ? `${command}/${path.slice(0, path.lastIndexOf("/"))}` : command;
  if (path !== "SKILL.md") return renderMarkdown(text, folder);
  const { meta, body } = splitFrontmatter(text);
  return [
    meta.description ? h("p", { class: "skill-doc-meta" }, h("strong", { text: "description " }), meta.description) : null,
    ...renderMarkdown(body, folder),
  ].filter(Boolean);
}

async function saveSkillFile(command, entry) {
  const id = skillBufferId(command, entry.path);
  if (!skillFileDirty(command, entry) || app.skillSaving || app.stopped) return;
  app.skillSaving = id;
  render();
  try {
    const saved = await api("api/skill-file", { name: command, path: entry.path, base: entry.hash, text: app.skillBuffers.get(id) });
    const loaded = app.skillFiles.get(command);
    if (loaded?.files) loaded.files = loaded.files.map((item) => (item.path === saved.path ? saved : item));
    app.skillBuffers.delete(id);
    if (saved.path === "SKILL.md") app.skillTexts.set(command, { text: saved.text });
    app.error = null;
    app.toast = { text: `✓ saved skills/${id}` };
    setTimeout(() => { app.toast = null; render(); }, 4000);
  } catch (error) {
    showError(error);
  } finally {
    app.skillSaving = null;
    render();
  }
}

function skillEditor(key, filePath) {
  const command = SKILLS[key].command;
  const loaded = app.skillFiles.get(command);
  if (loaded === undefined) void loadSkillFiles(command);
  if (!loaded) return h("p", { class: "muted skill-doc-status", text: "Loading the skill files…" });
  if (loaded.error) return h("p", { class: "err skill-doc-status", text: `Could not load the skill files: ${loaded.error}` });
  const current = loaded.files.find((entry) => entry.path === filePath) || loaded.files[0];
  const id = skillBufferId(command, current.path);
  const text = app.skillBuffers.has(id) ? app.skillBuffers.get(id) : current.text;
  const saving = app.skillSaving === id;
  const preview = h("article", { class: "skill-doc skill-editor-preview", "data-scroll": "skill-preview" }, skillFileView(text, command, current.path));
  const status = h("small", { "aria-live": "polite" });
  const revert = h("button", { type: "button", class: "btn small", text: "Revert", onclick: () => { app.skillBuffers.delete(id); render(); } });
  const save = h("button", { type: "button", class: "btn small", text: saving ? "Saving…" : "Save", "aria-keyshortcuts": IS_MAC ? "Meta+S" : "Control+S",
    onclick: () => { void saveSkillFile(command, current); } });
  const listItems = new Map();
  const sync = (value) => {
    const dirty = value !== current.text;
    status.className = dirty ? "accent" : "muted";
    status.textContent = dirty ? "unsaved" : "saved";
    save.disabled = !dirty || saving || app.stopped || Boolean(app.skillSaving);
    save.classList.toggle("accent", dirty);
    revert.disabled = !dirty || saving;
    listItems.get(current.path)?.classList.toggle("dirty", dirty);
  };
  const area = h("textarea", {
    class: "skill-editor-text", spellcheck: "false", "data-fk": `skilltext:${id}`, "data-scroll": "skill-text",
    "aria-label": `Text of skills/${id}`, value: text, disabled: saving || app.stopped,
    oninput: (event) => {
      const value = event.target.value;
      if (value === current.text) app.skillBuffers.delete(id);
      else app.skillBuffers.set(id, value);
      preview.replaceChildren(...skillFileView(value, command, current.path));
      sync(value);
    },
    onkeydown: (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveSkillFile(command, current);
      }
    },
  });
  const files = h("nav", { class: "skill-files", "aria-label": `Files of ${command}` }, loaded.files.map((entry) => {
    const link = h("a", {
      href: `#/skills/${key}/instructions?file=${encodeURIComponent(entry.path)}`,
      class: `skill-file${entry.path === current.path ? " selected" : ""}${skillFileDirty(command, entry) ? " dirty" : ""}`,
      "aria-current": entry.path === current.path ? "page" : undefined, text: entry.path,
    });
    listItems.set(entry.path, link);
    return link;
  }));
  sync(text);
  return h("div", { class: "skill-editor" }, files,
    h("div", { class: "skill-editor-pane" },
      h("div", { class: "skill-editor-bar" }, h("code", { text: `skills/${id}` }), h("span", { class: "spacer" }), status, revert, save), area),
    h("div", { class: "skill-editor-pane" },
      h("div", { class: "skill-editor-bar" }, h("span", { class: "muted", text: "Preview" })), preview));
}

// The instructions file that each built-in role's child reads. A custom role reads the generic file.
const ROLE_FILES = new Set(["design", "execute", "explore", "grill", "guardrail", "oracle", "plan-review", "qa", "research", "review", "ui", "writing"]);

function roleInstructionsLink(name) {
  const path = `references/roles/${ROLE_FILES.has(name) ? name : "_generic"}.md`;
  const label = ROLE_FILES.has(name) ? "Role instructions" : "Generic role instructions";
  if (maintainer()) return h("a", { class: "docs-link", href: `#/skills/omt/instructions?file=${encodeURIComponent(path)}`, text: `Edit ${label.toLowerCase()}` });
  return docsLink(`skills/omt/${path}`, label);
}

function docsLink(path, label = "Docs") {
  return h("a", { class: "docs-link", href: DOCS + path, target: "_blank", rel: "noopener noreferrer", text: `${label} ↗` });
}

function stageModel(skill) {
  const v = (key) => displayedLeaf(key.split(".")).value;
  const work = (key) => `workflow.${key}`;
  const stage = (id, title, actor, description, keys = [], notes = [], roles = []) => ({ id, title, actor, description, keys, notes, roles });
  const rounds = v("limits.maxReviewRounds");
  if (skill === "build") {
    const review = v(work("build.review"));
    const oracle = v(work("build.oracle"));
    const skip = review === "off" && oracle === "off";
    return [
      stage("explore", "Explore", "main", "Main reads the repo. Explore children answer narrow questions.", ["limits.maxParallel", "limits.maxDepth"], [], ["explore", "research"]),
      stage("questions", "Settle owner questions", "owner", "Owner answers questions the code cannot settle."),
      stage("plan", "Plan", "main", "LIGHT uses an inline plan. HEAVY needs plan review and owner approval.", [work("plan.review"), work("plan.testLayers")], ["Plan review stops after 2 rounds."], ["plan-review"]),
      stage("design", "Design pass when requested", "conditional", "Runs Design before the affected UI units.", [work("design.variants")], ["Owner approves the design."], ["design", "ui"]),
      stage("build", "Build units", "main", "Main builds units and runs their checks.", [work("build.qa"), work("build.failureProofs")],
        [v(work("build.qa")) === "off" ? "Test list is empty. QA still runs checks." : "Main writes the approved tests.", v(work("build.failureProofs")) === "on" ? "Prove each new test fails without the change." : "Failure proofs are off."], ["execute", "ui", "writing"]),
      stage("review", skip ? "Review skipped" : "Review", "child", skip ? "Review and oracle are off." : oracle === "heavy" ? "On HEAVY, oracle replaces this child. Main fixes findings." : oracle === "always" ? "Oracle replaces review on every task, even when review is off." : "The other driver family reviews. Main fixes findings.",
        [work("build.review"), work("build.oracle"), "limits.maxReviewRounds"],
        [review === "every-round" && !skip ? `↺ Fixes → review again, ≤ ${rounds} rounds.` : review === "first-round" ? "Review runs once. Fixes are not reviewed again." : skip ? "Continue to QA." : "Only the required oracle runs.",
          "BLOCK → back to plan or owner. Open findings → owner."], ["review", "oracle"]),
      stage("qa", "QA", "child", "After review, QA runs checks and device flows. Main fixes failures.", [], ["↺ Rerun failed checks at most twice.", "Open failures go to the owner."], ["qa"]),
      stage("ship", "Ship", "main", "Commit, open a pull request, and merge under the Git rules.", Object.keys(app.state.vocab.workflow.git).map((key) => work(`git.${key}`))),
    ];
  }
  if (skill === "code-review") {
    const count = v(work("review.reviewers"));
    const both = v(work("review.families")) === "both";
    const oracle = v(work("review.oracle")) === "on";
    return [
      stage("target", "Target", "main", "Uncommitted changes, a branch, a commit, or a pull request."),
      stage("size", "Size and group", "main", count === "auto" ? "Auto sizes reviewer groups by changed lines." : `${count} reviewer groups replace auto sizing.`, [work("review.reviewers"), work("review.families")], ["<200 lines: 1 · <1,000: 2 · <3,000: 3 · otherwise: 4"]),
      stage("reviewers", "Reviewers", "child", "One child per group. Reviewers report findings and do not fix files.", [work("review.families")],
        [both ? "Small + both families: 2 reviewers, no oracle." : oracle ? "Small: one oracle replaces the reviewer." : "Small: one reviewer."], ["review"]),
      stage("merge", "Merge findings", "main", "Main removes duplicates and ranks findings by severity."),
      stage("oracle", oracle ? "Oracle" : "Oracle off", "conditional", oracle ? "Large changes get one pass after the reviewer groups." : "Continue with the merged findings.", [work("review.oracle")], ["Small + both families has no oracle pass."], ["oracle"]),
      stage("pr", "Pull request checks", "conditional", "These steps run only for a pull request target.", ["ci", "verify", "tests", "guardrails", "crap"].map((key) => work(`review.${key}`)), ["Guardrails propose checks for the findings."], ["guardrail"]),
      stage("report", "Report", "main", "Findings by severity, with file and line references."),
      stage("fix", "Owner decides", "owner", v(work("review.fixLoop")) === "offer" ? "Offer to fix findings. Main fixes only after the owner agrees." : "Report findings without a fix offer.", [work("review.fixLoop"), "limits.maxReviewRounds"],
        v(work("review.fixLoop")) === "offer" ? [`↺ Owner agrees: Main fixes, then a fresh review. At most ${rounds} rounds.`, "Owner declines: finish."] : ["Finish after the report."], ["review", "qa"]),
    ];
  }
  if (skill === "plan") return [
    stage("explore", "Explore", "main", "Main and explore children read the code.", [], [], ["explore"]),
    stage("ask", "Ask owner decisions", "owner", "Ask only what the code cannot answer."),
    stage("write", "Write plan", "main", "Each unit has a scope, a done condition, and a verify command.", [work("plan.testLayers")]),
    stage("review", "Plan review", v(work("plan.review")) === "owner" ? "owner" : "child", v(work("plan.review")) === "two-families" ? "One child from the other driver family reviews." : v(work("plan.review")) === "one" ? "One child from any family reviews." : "Owner reviews without a child.", [work("plan.review")], ["↺ Fix and review again, at most 2 rounds. Round 2 checks the frozen blockers."], ["plan-review"]),
    stage("approve", "Owner approves", "owner", "Build can start after approval."),
  ];
  return [
    stage("draw", "Draw variants per screen", "main", "Claude Opus draws in Main. Other models use one design child.", [work("design.variants")], [], ["design"]),
    stage("show", "Show screens", "main", "Show the designs grouped by screen."),
    stage("steer", "Owner picks and steers", "owner", "Pick a variant for each screen and give notes.", [], ["↺ Redraw until the owner approves."]),
    stage("spec", "Write design spec", "main", "UI units use the approved spec."),
  ];
}

function skillScreen(name, tab) {
  const skill = SKILLS[name] || SKILLS.build;
  if (!skill.flow || tab === "instructions") return skillPage(name, tab);
  const stages = stageModel(name);
  const selected = stages.find((stage) => stage.id === app.stages[name]) || stages[0];
  return h("section", { class: "skills-page" },
    h("div", { class: "flow-column", "data-scroll": "flow" },
      skillHeader(name, "flow"),
      h("div", { class: "actor-legend" }, ["main", "child", "owner"].map((actor) => h("span", null, h("i", { class: `actor ${actor}`, "aria-hidden": "true" }), { main: "Main agent (this thread)", child: "Child task", owner: "You decide" }[actor]))),
      h("ol", { class: "flow-stages", "aria-label": `${skill.label} stages` }, stages.map((stage) => h("li", { class: `flow-stage stage-${stage.id}${selected.id === stage.id ? " selected" : ""}` },
        h("i", { class: `actor ${stage.actor}`, "aria-hidden": "true" }),
        h("button", { type: "button", class: "stage-button", "aria-pressed": String(stage.id === selected.id), "data-fk": `stage:${stage.id}`, "aria-controls": "stage-controls", onclick: () => { app.stages[name] = stage.id; render(); if (innerWidth <= 1100) document.querySelector(".stage-panel")?.scrollIntoView({ block: "start" }); } },
          h("strong", { text: stage.title }), h("span", { class: "stage-description", text: stage.description }),
          stage.notes.length ? h("span", { class: "stage-notes" }, stage.notes.map((text) => h("span", { class: "flow-note", text }))) : null,
          stage.keys.length ? h("span", { class: "stage-values" }, stage.keys.slice(0, 3).map((key) => {
            const path = key.split(".");
            return h("span", { class: "stage-value" },
              h("code", { class: "stage-value-key", text: path[path.length - 1] }), h("code", { class: "stage-value-val", text: fmt(displayedLeaf(path).value) }),
              h("span", { class: "stage-value-help", text: summaryFor(path) }));
          })) : null))))),
    h("aside", { class: "stage-panel", id: "stage-controls", "data-scroll": "stage" },
      h("header", null, h("small", { class: "muted", text: "Stage" }), h("h2", { text: selected.title })),
      h("section", { class: "destination" }, h("div", { class: "destination-label" }, "Edits go to", h("strong", { text: maintainer() ? DEFAULTS_FILE : `${app.editIn === "project" ? "Project" : "User"} file` })),
        seg([{ value: "base", label: "Base settings", disabled: selected.keys.some((key) => key.startsWith("workflow.")) }, { value: "profile", label: `Profile: ${app.profile}` }],
          selected.keys.some((key) => key.startsWith("workflow.")) ? "profile" : app.scope === "profile" ? "profile" : "base", (scope) => { app.scope = scope; render(); }, { label: "Stage edit scope", disabled: !canEdit(), fk: "stage-scope" }),
        h("p", { class: "muted", text: "Workflow keys belong to a profile. Other profiles inherit unset keys from normal." })),
      selected.keys.length ? selected.keys.map((key) => {
        const path = key.split(".");
        return h("section", { class: "stage-field" }, h("div", { class: "field-heading" }, h("code", { text: key.replace(/^workflow\./, "") }), sourceBadge(path)),
          inlineControl(path), h("p", { class: "field-help", text: summaryFor(path) }), h("code", { class: "target-path", text: dotted(editTarget(path)) }));
      }) : h("p", { class: "muted", text: "This stage follows the skill's fixed steps." }),
      selected.roles.length ? h("section", { class: "stage-roles" }, h("h3", { text: "Roles in this stage" }),
        selected.roles.filter((role) => roleNames().includes(role)).map((role) => h("a", { class: "btn", href: `#/role/${role}`, text: role }))) : null));
}

// ---------- global keys and start ----------

function isField(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");
}

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    openReview();
    return;
  }
  if (event.key === "Escape") {
    if (app.review) {
      event.preventDefault();
      closeReview();
    } else if (app.issuesOpen) {
      app.issuesOpen = false;
      render();
    } else if (app.history) {
      app.history = null;
      render();
    } else if (!isField(document.activeElement) && ["role", "profile", "root"].includes(app.route.screen)) {
      closeModal();
    }
    return;
  }
  if (event.key === "/" && !isField(document.activeElement) && !app.review) {
    const filter = document.getElementById("filter");
    if (filter) {
      event.preventDefault();
      filter.focus();
    }
  }
});

document.addEventListener("pointerdown", () => { pointerDown = true; }, true);
document.addEventListener("pointerup", () => {
  pointerDown = false;
  if (renderPending) setTimeout(() => { if (renderPending) render(); }, 0);
}, true);
document.addEventListener("pointercancel", () => { pointerDown = false; }, true);


addEventListener("hashchange", () => {
  app.route = parseHash();
  remember();
  app.focusModal = false;
  app.history = null;
  render();
});

addEventListener("pagehide", () => navigator.sendBeacon(BASE + "api/close"));

addEventListener("beforeunload", (event) => {
  const drafts = [...Object.values(app.drafts), ...Object.values(app.fileDrafts).flatMap((store) => Object.values(store))];
  if (!totalQueued() && !drafts.some((draft) => draft?.dirty) && !dirtySkillFiles().length) return;
  event.preventDefault();
  event.returnValue = "";
});

app.route = parseHash();
remember();
void ping();
pingTimer = setInterval(ping, PING_MS);
void loadState();
