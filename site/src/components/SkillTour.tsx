import { type AnimationEvent, type CSSProperties, type KeyboardEvent, useId, useState } from "react";
import { useInView } from "./inView";
import { Metro } from "./metro";
import { SKILL_SCENES } from "./scenes";

type Skill = { name: string; note: string; shows: string; tag?: string };

const AGENT_SKILLS: Skill[] = [
  {
    name: "omt-ulw",
    note: "You want a task built, fixed, or shipped from start to end. Type $omt-ulw and the task, or say start ulw.",
    shows:
      "The agent asks its questions, plans, and builds the change in its own thread. Then one review child fixes small findings and reports the rest, and one QA child runs the checks.",
  },
  {
    name: "omt-plan",
    note: "You want a reviewed plan before any code changes.",
    shows:
      "The agent explores the code, asks its questions in batches, and writes a plan. One model of the other family reviews it, for at most 2 rounds. The plan goes to .omt/plans/.",
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
    name: "omt-research",
    note: "You need an answer with sources from the repository, library docs, or the web.",
    shows:
      "The agent answers a narrow question itself. For a broad one, it searches the repository, library docs, and the web at the same time, checks each claim, and writes an answer with sources.",
  },
  {
    name: "omt-setup",
    note: "You want to set up, configure, or update omt, or ask what it can do.",
    shows:
      "The agent answers from the omt CLI output and links the docs. For a change, it shows each command or edit first, runs a dry run where it can, and writes only after you agree.",
  },
];

const NAMED_SKILLS: Skill[] = [
  {
    name: "omt-swarm",
    tag: "opt-in",
    note: "You have a plan with independent tracks, and each needs its own worktree thread.",
    shows:
      "Each track builds and checks in its own T3 worktree thread. Then one review covers all tracks, the tracks merge, one QA run checks the result, and one pull request ships it.",
  },
  {
    name: "omt",
    note: "You want the list of workflows and CLI commands.",
    shows: "omt lists the workflows, tells when to use each one, and lists the CLI commands.",
  },
];

const ALL = [...AGENT_SKILLS, ...NAMED_SKILLS];

// After a picture ends, the tour holds the last frame for this long, then goes to the next skill.
const HOLD = 2200;

// The agent starts the first six by itself; you start the last two by name. A pointer goes down
// the list of skills, and the picture of each skill plays next to it. A click or
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
        <code>{item.name}</code>
        {index >= AGENT_SKILLS.length ? <span className="skill-tag">{item.tag ?? "by name only"}</span> : null}
      </span>
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
