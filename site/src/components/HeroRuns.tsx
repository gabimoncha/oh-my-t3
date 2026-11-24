import { type AnimationEvent, type CSSProperties, useState } from "react";
import { useInView } from "./inView";
import { Metro } from "./metro";
import { SKILL_SCENES } from "./scenes";

// After a run ends, its panel holds the last frame for this long before the next panel plays.
const HOLD = 1200;

type Run = "ulw" | "review";
type Phase = Run | "done";

const RUNS: { id: Run; skill: string; label: string; goal: string; note: string }[] = [
  {
    id: "ulw",
    skill: "omt-ulw",
    label: "One goal, one change",
    goal: "$omt-ulw add OAuth to the API",
    note: "The agent plans and builds three units in its own thread. A Codex child reviews Claude's change, and a QA child runs the checks. A finding goes back for a fix, and the second pass shows in yellow.",
  },
  {
    id: "review",
    skill: "omt-code-review",
    label: "One diff, many reviewers",
    goal: "$omt-code-review this branch",
    note: "The agent splits a large diff into groups, and one reviewer reads each group. An oracle checks the whole change. The agent merges the findings and makes the fixes that you approve.",
  },
];

// The hero is split in two: ulw on the left, code review on the right. The ulw run plays first while
// the review panel shows its last frame, dimmed; then the review run plays. Both then stay on their
// last frame. Out of view, the runs pause.
export function HeroRuns() {
  const host = useInView<HTMLElement>();
  const [phase, setPhase] = useState<Phase>("ulw");
  const [round, setRound] = useState(0);

  function onClockEnd(event: AnimationEvent) {
    if (event.animationName !== "clock") return;
    setPhase(phase === "ulw" ? "review" : "done");
  }

  return (
    <section className="hero-runs wrap anim" ref={host} aria-label="Two example runs">
      {RUNS.map((run) => {
        const scene = SKILL_SCENES[run.skill]!;
        const waiting = run.id === "review" && phase === "ulw";
        return (
          <figure key={run.id} className="hero-run" data-state={phase === run.id ? "playing" : waiting ? "waiting" : "done"}>
            <figcaption className="hero-run-head">
              <code>{run.skill}</code>
              <span>{run.label}</span>
              {phase === run.id ? (
                <span
                  className="m-clock"
                  style={{ "--total-m": `${scene.end + HOLD}ms` } as CSSProperties}
                  onAnimationEnd={onClockEnd}
                />
              ) : null}
            </figcaption>
            <div key={waiting ? "waiting" : round} className={waiting ? "hero-art still" : "hero-art"}>
              <Metro scene={scene} />
            </div>
            <p className="hero-run-goal">
              <span className="meta">Example: </span>
              <code>{run.goal}</code>
            </p>
            <p className="hero-run-note">{run.note}</p>
          </figure>
        );
      })}
      {phase === "done" ? (
        <button
          type="button"
          className="hero-replay quiet-link"
          onClick={() => {
            setRound(round + 1);
            setPhase("ulw");
          }}
        >
          Play again
        </button>
      ) : null}
    </section>
  );
}
