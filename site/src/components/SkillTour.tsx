import { type AnimationEvent, type CSSProperties, type KeyboardEvent, useId, useState } from "react";
import { useInView } from "./inView";
import { Metro } from "./metro";
import { SKILL_SCENES } from "./scenes";

type Skill = { name: string; note: string; shows: string };

const ALL: Skill[] = [
  {
    name: "omt-ulw",
    note: "You want a task built, fixed, or shipped from start to end. Type $omt-ulw and the task.",
    shows:
      "The agent asks its questions, plans, and builds the change in its own thread. Then one review child fixes small findings and reports the rest, and one QA child runs the checks.",
  },
  {
    name: "omt-plan",
    note: "You want a reviewed plan before any code changes.",
    shows:
      "The agent explores the code, asks its questions in batches, and writes a plan. One model of the other family reviews it, for at most 2 rounds. The plan goes to .omt3/plans/.",
  },
  {
    name: "omt-design",
    note: "You want designs or mockups before UI work.",
    shows:
      "A Claude Opus main thread draws variants of each screen, or one design child does. You pick one and steer it until you approve it. Then the agent writes the design spec.",
  },
  {
    name: "omt-code-review",
    note: "You want a review of uncommitted changes, a branch, a commit, or a pull request.",
    shows:
      "A small diff gets 1 reviewer. A large diff gets up to 4 reviewers and 1 oracle. The agent merges their findings and makes the fixes that you approve.",
  },
  {
    name: "omt-setup",
    note: "You want to set up, configure, or update omt, or ask what it can do.",
    shows:
      "The agent answers from the omt CLI output and links the docs. For a change, it shows each command or edit first, runs a dry run where it can, and writes only after you agree.",
  },
];

// After a picture ends, the tour holds the last frame for this long, then goes to the next skill.
const HOLD = 2200;

// A pointer goes down the list of skills, and the picture of each skill plays next to it. A click or
// the arrow keys select a skill and stop the tour. Out of view, the tour pauses.
export function SkillTour() {
  const id = useId();
  const host = useInView<HTMLDivElement>();
  const [active, setActive] = useState(0);
  const [tour, setTour] = useState(true);
  const skill = ALL[active]!;
  const scene = SKILL_SCENES[skill.name]!;

  function select(index: number) {
    setTour(false);
    setActive(index);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? (active + 1) % ALL.length
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? (active - 1 + ALL.length) % ALL.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? ALL.length - 1
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    select(next);
    document.getElementById(`${id}-${next}`)?.focus();
  }

  function onClockEnd(event: AnimationEvent) {
    if (event.animationName !== "clock" || !tour) return;
    setActive((active + 1) % ALL.length);
  }

  const row = (item: Skill, index: number) => (
    <button
      key={item.name}
      type="button"
      role="tab"
      id={`${id}-${index}`}
      className="skill-row"
      aria-selected={index === active}
      aria-controls={`${id}-panel`}
      tabIndex={index === active ? 0 : -1}
      onClick={() => select(index)}
    >
      <span className="skill-name">
        <code>{item.name}</code>      </span>
      <span className="skill-note">{item.note}</span>
      {index === active ? (
        <span
          className="m-clock"
          style={{ "--total-d": `${scene.end + HOLD}ms`, "--total-m": `${scene.end + HOLD}ms` } as CSSProperties}
          onAnimationEnd={onClockEnd}
        />
      ) : null}
    </button>
  );

  return (
    <div className="skill-tour anim" ref={host}>
      <div className="skill-list" role="tablist" aria-orientation="vertical" aria-label="Skills" onKeyDown={onKeyDown}>
        {ALL.map((item, index) => row(item, index))}
      </div>
      <figure className="skill-stage" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${active}`}>
        <div key={skill.name} className="skill-art">
          <Metro scene={scene} />
        </div>
        <figcaption>{skill.shows}</figcaption>
      </figure>
    </div>
  );
}
