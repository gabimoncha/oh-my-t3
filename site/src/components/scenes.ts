import { Draw, type Point, type Scene } from "./metro";

// The animated pictures: one for each skill. The hero shows the ulw and swarm pictures side by side.
// All share one canvas (480 x 256) with three lanes, so that they read as one set.

const W = 480;
const H = 256;
const LANES = [64, 128, 192];
const MID = 128;
const SKILL_SPEED = 3.3;
const PAUSE = 300;

// A 45-degree branch from (x, from) to a lane, then straight on to x1.
const branch = (x: number, from: number, lane: number, x1: number): Point[] =>
  lane === from
    ? [
        [x, from],
        [x1, lane],
      ]
    : [
        [x, from],
        [x + 16, from],
        [x + 16 + Math.abs(lane - from), lane],
        [x1, lane],
      ];

// The mirror of branch: from a lane back to the line at (x1, to).
const join = (x: number, lane: number, to: number, x1: number): Point[] =>
  lane === to
    ? [
        [x, lane],
        [x1, to],
      ]
    : [
        [x, lane],
        [x1 - 16 - Math.abs(lane - to), lane],
        [x1 - 16, to],
        [x1, to],
      ];

// A dashed loop over a lane, from the station at x1 back to the station at x0.
const loopBack = (x0: number, x1: number, y: number, height = 32): Point[] => [
  [x1, y],
  [x1 - height, y - height],
  [x0 + height, y - height],
  [x0, y],
];

// The main thread plans and builds the units one after another. Then one review child and one QA
// child check the whole change. A finding goes back to Build for a fix, and the second pass shows in yellow.
function ulw(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.rail("M300 0 L300 256");
  g.station(28, MID, "goal", 0);
  g.text(28, MID + 36, "Goal", 0);
  const plan = g.line([[0, MID], [96, MID]], 0);
  g.station(96, MID, "plan", plan);
  g.text(96, MID + 36, "Plan", plan);
  let t = plan;
  let x = 96;
  for (const unit of [160, 200, 240]) {
    t = g.line([[x, MID], [unit, MID]], t + 100);
    g.station(unit, MID, "work", t);
    x = unit;
  }
  t = g.line([[240, MID], [300, MID]], t);
  g.station(300, MID, "review", t);
  t += PAUSE;
  g.verdict(170, 80, "finding", "closed", t);
  t = g.line(loopBack(200, 300, MID), t, { dash: true }) + 150;
  t = g.line([[200, MID], [300, MID]], t, { tone: "yellow" });
  t = g.line([[300, MID], [380, MID]], t + 150);
  g.station(380, MID, "verify", t);
  t = g.line([[380, MID], [460, MID]], t);
  g.station(460, MID, "done", t);
  g.text(200, 228, "Build", plan);
  g.text(292, 228, "Review", plan, { anchor: "end" });
  g.text(380, 228, "QA", plan);
  g.text(460, MID + 36, "Done", t);
  return g.scene();
}

function plan(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.rail("M300 0 L300 256");
  g.station(40, MID, "goal", 0);
  g.text(40, MID + 36, "Explore", 0);
  let t = g.line([[0, MID], [40, MID]], 0);
  t = g.line([[40, MID], [100, MID]], t + 200);
  g.station(100, MID, "work", t);
  g.text(100, MID + 36, "Ask", t);
  t = g.line([[100, MID], [180, MID]], t + 200);
  g.station(180, MID, "plan", t);
  g.text(180, MID + 36, "Write", t);
  t = g.line([[180, MID], [300, MID]], t);
  g.station(300, MID, "review", t);
  g.text(308, MID + 36, "Review", t, { anchor: "start" });
  t += PAUSE;
  g.verdict(190, 80, "blocker", "closed", t);
  t = g.line(loopBack(180, 300, MID), t, { dash: true }) + 150;
  t = g.line([[180, MID], [300, MID]], t, { tone: "yellow" }) + 150;
  g.verdict(312, 108, "approve", "open", t);
  t = g.line([[300, MID], [420, MID]], t + 200);
  g.station(420, MID, "done", t);
  g.text(420, MID + 36, ".omt/plans/", t, { style: "code", size: 14 });
  return g.scene();
}

function design(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.rail("M300 0 L300 256");
  g.station(40, MID, "goal", 0);
  g.text(40, MID + 36, "Frame", 0);
  const start = g.line([[0, MID], [40, MID]], 0);
  const names = ["A", "B", "C"];
  const dropped: number[] = [];
  const reviewed = LANES.map((lane, i) => {
    const first = g.items.length;
    let t = g.line(branch(40, MID, lane, 180), start + i * 120);
    g.station(180, lane, "work", t);
    g.text(180, lane - 24, names[i]!, t, { style: "code", size: 14 });
    t = g.line([[180, lane], [300, lane]], t);
    g.station(300, lane, "review", t);
    if (i !== 1) for (let index = first; index < g.items.length; index++) dropped.push(index);
    return t;
  });
  // You pick B: the lanes of A and C dim.
  const pick = Math.max(...reviewed) + PAUSE;
  for (const index of dropped) {
    const item = g.items[index]!;
    if (item.type !== "rail") item.dim = pick;
  }
  g.verdict(312, 108, "you pick B", "open", pick);
  let t = pick + 500;
  g.verdict(214, 120, "steer", "steer", t);
  t = g.line(loopBack(180, 300, MID, 24), t, { dash: true }) + 150;
  t = g.line([[180, MID], [300, MID]], t, { tone: "yellow" });
  t = g.line([[300, MID], [440, MID]], t + 150);
  g.station(440, MID, "done", t);
  g.text(440, MID + 36, "Spec", t);
  g.text(180, 228, "Variants", start);
  g.text(308, 228, "You review", start, { anchor: "start" });
  return g.scene();
}

function codeReview(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.rail("M260 0 L260 256");
  g.station(40, MID, "goal", 0);
  g.text(40, MID + 36, "Target", 0);
  let t = g.line([[0, MID], [40, MID]], 0);
  t = g.line([[40, MID], [112, MID]], t + 150);
  g.station(112, MID, "plan", t);
  g.text(112, MID + 36, "Split", t);
  const split = t;
  const arrivals = LANES.map((lane, i) => {
    let at = g.line(branch(112, MID, lane, 260), split + i * 100);
    g.station(260, lane, "review", at);
    if (i === 0) g.verdict(282, 40, "finding", "closed", at + 200);
    at += PAUSE;
    return g.line(join(260, lane, MID, 372), at);
  });
  t = Math.max(...arrivals);
  g.station(372, MID, "verify", t);
  g.text(372, MID + 36, "Oracle", t);
  t = g.line([[372, MID], [448, MID]], t + 200);
  g.station(448, MID, "done", t);
  g.text(448, MID + 36, "Report", t);
  g.text(268, 228, "Reviewers", split, { anchor: "start" });
  return g.scene();
}

function research(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.station(40, MID, "goal", 0);
  g.text(40, MID + 36, "Question", 0);
  let t = g.line([[0, MID], [40, MID]], 0);
  t = g.line([[40, MID], [112, MID]], t + 150);
  g.station(112, MID, "plan", t);
  g.text(112, MID + 36, "Split", t);
  const split = t;
  const sources = ["repo", "docs", "web"];
  const arrivals = LANES.map((lane, i) => {
    let at = g.line(branch(112, MID, lane, 230), split + i * 140);
    g.station(230, lane, "work", at);
    g.text(230, lane - 24, sources[i]!, at, { style: "code", size: 14 });
    at += PAUSE + i * 200;
    return g.line(join(230, lane, MID, 352), at);
  });
  t = Math.max(...arrivals);
  g.station(352, MID, "verify", t);
  g.text(352, MID + 36, "Check", t);
  t = g.line([[352, MID], [448, MID]], t + 200);
  g.station(448, MID, "done", t);
  g.text(448, MID + 36, "Answer", t);
  return g.scene();
}

// The same grid as ulw, so that the two read side by side in the hero: the tracks leave the plan at
// different times and speeds, and each builds and checks in its own thread. Then one review covers
// every track, the tracks merge, one QA run checks the merged code, and one pull request ends the run.
function swarm(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.rail("M300 0 L300 256");
  g.station(28, MID, "plan", 0);
  g.text(28, MID + 36, "Plan", 0);
  const split = g.line([[0, MID], [96, MID]], 0);
  g.station(96, MID, "plan", split);
  g.text(96, MID + 36, "Split", split);
  const offsets = [0, 700, 1400];
  const speeds = [1, 1.3, 1.1];
  const arrivals = LANES.map((lane, i) => {
    const speed = speeds[i]!;
    let t = g.line(branch(96, MID, lane, 200), split + offsets[i]!, { speed });
    g.station(200, lane, "work", t);
    t = g.line([[200, lane], [250, lane]], t, { speed });
    g.station(250, lane, "verify", t);
    return g.line([[250, lane], [300, lane]], t, { speed });
  });
  const review = Math.max(...arrivals);
  for (const lane of LANES) g.station(300, lane, "review", review);
  const merged = Math.max(...LANES.map((lane) => g.line(join(300, lane, MID, 380), review + PAUSE)));
  g.station(380, MID, "work", merged);
  g.text(380, MID + 36, "Merge", merged);
  let t = g.line([[380, MID], [424, MID]], merged);
  g.station(424, MID, "verify", t);
  g.text(424, 100, "QA", t);
  t = g.line([[424, MID], [456, MID]], t);
  g.bar(456, MID, t);
  g.text(456, MID + 36, "PR", t);
  g.text(200, 228, "Build", split);
  g.text(292, 228, "Review", split, { anchor: "end" });
  return g.scene();
}

// Each change shows first, runs as a dry run where it can, and writes only after you agree.
function setup(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.rail("M300 0 L300 256");
  g.station(40, MID, "goal", 0);
  g.text(40, MID + 36, "Doctor", 0);
  let t = g.line([[0, MID], [40, MID]], 0);
  t = g.line([[40, MID], [140, MID]], t + 150);
  g.station(140, MID, "plan", t);
  g.text(140, MID + 36, "Show", t);
  t = g.line([[140, MID], [220, MID]], t + 150);
  g.station(220, MID, "verify", t);
  g.text(220, MID + 36, "Dry run", t);
  t = g.line([[220, MID], [300, MID]], t);
  g.station(300, MID, "review", t);
  g.text(308, MID + 36, "You agree", t, { anchor: "start" });
  t += PAUSE;
  g.verdict(312, 108, "yes", "open", t);
  t = g.line([[300, MID], [440, MID]], t + 200);
  g.station(440, MID, "done", t);
  g.text(440, MID + 36, "Write", t);
  return g.scene();
}

function router(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.station(48, MID, "plan", 0);
  g.text(48, MID + 36, "omt", 0, { style: "code", size: 14 });
  let t = g.line([[0, MID], [48, MID]], 0);
  t = g.line([[48, MID], [120, MID]], t + 150);
  const names = ["ulw", "plan", "design", "code-review", "research", "setup", "swarm"];
  names.forEach((name, i) => {
    const lane = MID + (i - (names.length - 1) / 2) * 26;
    const end = g.line(branch(120, MID, lane, 300), t + i * 90, { radius: 10 });
    g.bar(300, lane, end, { length: 20 });
    g.text(316, lane + 5, `omt-${name}`, end, { style: "code", size: 14, anchor: "start" });
  });
  return g.scene();
}

export const SKILL_SCENES: Record<string, Scene> = {
  "omt-ulw": ulw(),
  "omt-plan": plan(),
  "omt-design": design(),
  "omt-code-review": codeReview(),
  "omt-research": research(),
  "omt-setup": setup(),
  "omt-swarm": swarm(),
  omt: router(),
};
