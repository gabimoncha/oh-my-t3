import { type CSSProperties, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CommandPlate } from "../components/Copy";
import { InstallSteps } from "../components/InstallSteps";
import { useInView } from "../components/inView";
import { HeroRuns } from "../components/HeroRuns";
import { SkillTour } from "../components/SkillTour";
import stateSvg from "../art/state-night.svg?raw";
import stateMobileSvg from "../art/state-m-night.svg?raw";
import {
  DOCS,
  INSTALL_GUIDE,
  NPM,
  NPM_OMT3,
  OH_MY_OPENAGENT,
  OH_MY_PI,
  REPO,
  T3_CODE,
  T3_CODE_REPO,
  VERSION,
  WALKTHROUGH,
} from "../site";

export const Route = createFileRoute("/")({
  component: Home,
});

type Step = {
  title: string;
  station: string;
  role?: { src: string; alt: string };
  body?: string;
};

const STEPS: Step[] = [
  { title: "Give a goal", station: "st8-00-night.svg" },
  {
    title: "Plan",
    station: "st8-08-night.svg",
    role: { src: "role-plans-night.svg", alt: "" },
    body: "The agent asks its questions, then writes a plan in .omt3/plans/.",
  },
  {
    title: "Build",
    station: "st8-16-night.svg",
    role: { src: "role-runs-night.svg", alt: "" },
    body: "The agent builds the change unit by unit in its own thread.",
  },
  {
    title: "Review",
    station: "st8-x32-night.svg",
    role: { src: "role-reviews-night.svg", alt: "" },
    body: "A child task on the other model family reviews the change.",
  },
  {
    title: "Test and report",
    station: "st8-48-night.svg",
    role: { src: "role-verifies-night.svg", alt: "" },
    body: "A QA child task runs every check, and the agent reports with evidence.",
  },
];

const OMT_FILES = [
  { path: ".omt3/plans/", note: "The plan of each run, split into units." },
  { path: ".omt3/ledger.jsonl", note: "One line for each task start and each result." },
  { path: ".omt3/config.jsonc", note: "The profile: the models, the checks, and the limits." },
];

const NAV = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Skills", href: "#skills" },
  { label: "Install", href: "#install" },
  { label: "Docs", href: DOCS },
  { label: "GitHub", href: REPO },
];

function Home() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <HeroRuns />
        <Install />
        <HowItWorks />
        <States />
        <Evidence />
        <Skills />
        <WhoItIsFor />
        <Details />
        <Closing />
      </main>
      <Footer />
    </>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="header wrap">
      <a className="brand" href="/" aria-label="oh-my-t3, home">
        <span>oh-my-</span>
        <img className="brand-t3" src="/img/t3-icon.png" width={32} height={32} alt="" />
      </a>
      <nav aria-label="Main">
        <button
          type="button"
          className="menu-button"
          aria-expanded={open}
          aria-controls="nav-links"
          onClick={() => setOpen(!open)}
        >
          Menu
        </button>
        <ul id="nav-links" className="nav-links" data-open={open}>
          {NAV.map((item) => (
            <li key={item.label}>
              <a href={item.href} onClick={() => setOpen(false)}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero wrap">
      <h1>
        Give the agent a goal.
        <br /> Get back reviewed work.
      </h1>
      <p className="lead">
        oh-my-t3 adds plans, roles, task briefs, and reviews to the agents that you run in T3 Code. The agent plans
        and builds the change in its own thread. Then two T3 child tasks check it: a model of the other family reviews
        it, and a QA task runs the checks.
      </p>
      <div className="hero-actions">
        <CommandPlate command="npx oh-my-t3" />
        <a className="quiet-link" href="#install">
          Other ways to install
        </a>
      </div>
    </section>
  );
}

function Install() {
  return (
    <section id="install" className="section wrap" aria-labelledby="install-title">
      <h2 id="install-title">Install</h2>
      <InstallSteps />
      <p className="install-after muted">
        Then restart your T3 agent sessions. <span className="no-ligatures">--hooks</span> adds the "start ulw" phrase to
        Claude Code. The <a href={INSTALL_GUIDE}>install guide</a> lists each file and the uninstall.
      </p>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="section how" aria-labelledby="how-title">
      <div className="wrap">
        <h2 id="how-title">How it works</h2>
      </div>
      <div className="how-roles wrap" aria-hidden="true">
        {STEPS.map((step) => (
          <div key={step.title}>{step.role ? <img src={`/img/${step.role.src}`} width={96} height={96} alt="" /> : null}</div>
        ))}
        <div />
      </div>
      <div className="how-line wrap" aria-hidden="true">
        <div className="how-line-inner">
          <span className="how-route" />
          <span className="how-review" />
          {[...STEPS.map((step) => step.station), "st8-64-night.svg"].map((station, i) => (
            <img
              key={station}
              className={station.includes("x32") ? "how-station interchange" : "how-station"}
              style={{ "--col": i } as CSSProperties}
              src={`/img/${station}`}
              alt=""
            />
          ))}
        </div>
      </div>
      <ol className="how-steps wrap">
        {STEPS.map((step, i) => (
          <li key={step.title} className={step.title === "Review" ? "is-review" : undefined}>
            <span className="how-rail" aria-hidden="true">
              <img className="how-rail-station" src={`/img/${step.station}`} alt="" />
            </span>
            <div className="how-text">
              <h3>
                <span className="meta">{i + 1}</span> {step.title}
              </h3>
              {i === 0 ? (
                <p className="muted">
                  Type <code>$omt-ulw</code> and the goal in a T3 thread.
                </p>
              ) : (
                <p className="muted">{step.body}</p>
              )}
            </div>
            {step.role ? <img className="how-role" src={`/img/${step.role.src}`} width={64} height={64} alt="" /> : null}
          </li>
        ))}
        <li className="is-done">
          <span className="how-rail" aria-hidden="true">
            <img className="how-rail-station" src="/img/st8-64-night.svg" alt="" />
          </span>
          <div className="how-text">
            <h3>Done</h3>
          </div>
        </li>
      </ol>
    </section>
  );
}

// The verdict marks get the class of their label, so that both light up together: the first red X
// is "request changes", the second is "block", and the green check is "approve". A yellow line goes
// on the edge from Built to In review, for the second pass after a request for changes.
function inlineChart(svg: string, secondPass: string): string {
  let red = 0;
  return svg
    .replace(/<svg ([^>]*?) role="img" aria-label="[^"]*">/, '<svg $1 aria-hidden="true" focusable="false">')
    .replace(/<title>[^<]*<\/title>/, "")
    .replace(/(<path d="M[^"]*" fill="none" stroke="#FFFFFF" stroke-width="8"[^>]*\/>)/, (line) =>
      `${line}<path class="second-pass" d="${secondPass}" pathLength="1" fill="none" stroke="#E3B341" stroke-width="8"/>`,
    )
    .replace(/<path ([^>]*stroke="#F85149" stroke-width="2.5")/g, (_, rest) => `<path class="${red++ === 0 ? "request" : "block"}" ${rest}`)
    .replace(/<path ([^>]*stroke="#3FB950" stroke-width="2.5")/, '<path class="approve" $1');
}

const STATE_CHART = inlineChart(stateSvg, "M160 112 L280 112");
const STATE_CHART_MOBILE = inlineChart(stateMobileSvg, "M120 104 L120 200");

// Two trips through the chart, one after the other, as offsets along a path. In the first, the
// review requests changes: the change stops at Built, In review, Built again, In review again,
// and Tested, and ends at Done. In the second, the review blocks the change: it stops at Built
// and In review, and ends at Blocked.
type Trip = { path: string; stops: number[] };

const STATE_TRIPS: Record<"desktop" | "mobile", { fixed: Trip; blocked: Trip }> = {
  desktop: {
    fixed: {
      path: "M40 112 L280 112 L255.314 87.3137 Q244 76 228 76 L212 76 Q196 76 184.686 87.3137 L160 112 L520 112",
      stops: [16.07, 32.15, 51.78, 67.85, 83.93],
    },
    blocked: {
      path: "M40 112 L284 112 L324.686 152.686 Q336 164 336 180 L336 224",
      stops: [31.92, 63.84],
    },
  },
  mobile: {
    fixed: {
      path: "M120 24 L120 200 L92.4853 172.485 Q84 164 84 152 Q84 140 92.4853 131.515 L120 104 L120 376",
      stops: [14.0, 30.8, 52.4, 69.2, 86.0],
    },
    blocked: {
      path: "M120 24 L120 200 L164.686 244.686 Q176 256 192 256 L232 256",
      stops: [25.84, 56.85],
    },
  },
};

function Unit({ trip, className }: { trip: Trip; className: string }) {
  const style = { offsetPath: `path("${trip.path}")` } as Record<string, string>;
  trip.stops.forEach((stop, index) => {
    style[`--p${index + 1}`] = `${stop}%`;
  });
  return <span className={`unit-token ${className}`} style={style as CSSProperties} />;
}

function Units({ trips }: { trips: { fixed: Trip; blocked: Trip } }) {
  return (
    <>
      <Unit trip={trips.fixed} className="fixed" />
      <Unit trip={trips.blocked} className="blocked" />
    </>
  );
}

function States() {
  const chart = useInView<HTMLElement>();
  return (
    <section className="section-tight split wrap" aria-label="The states of one change, and the two parts of omt">
      <div className="col-even">
        <h3>The states of one change</h3>
        <figure className="chart" ref={chart}>
          <div className="chart-desktop" aria-hidden="true">
            <div className="chart-art" dangerouslySetInnerHTML={{ __html: STATE_CHART }} />
            <Units trips={STATE_TRIPS.desktop} />
            <span className="st-label tiny center" style={{ left: 0, top: 138, width: 80 }}>Planned</span>
            <span className="st-label tiny center" style={{ left: 120, top: 138, width: 80 }}>Built</span>
            <span className="st-label tiny right" style={{ left: 176, top: 140, width: 90 }}>In review</span>
            <span className="st-label tiny center" style={{ left: 360, top: 138, width: 80 }}>Tested</span>
            <span className="st-label tiny center" style={{ left: 480, top: 138, width: 80 }}>Done</span>
            <span className="verdict closed request" style={{ left: 163, top: 46, width: 130 }}>request changes</span>
            <span className="verdict open approve" style={{ left: 332.2, top: 82, width: 70 }}>approve</span>
            <span className="verdict closed block" style={{ left: 366, top: 168, width: 60 }}>block</span>
            <span className="st-label tiny center" style={{ left: 291, top: 250, width: 90 }}>Blocked</span>
          </div>
          <div className="chart-mobile" aria-hidden="true">
            <div className="chart-art" dangerouslySetInnerHTML={{ __html: STATE_CHART_MOBILE }} />
            <Units trips={STATE_TRIPS.mobile} />
            <span className="st-label tiny" style={{ left: 150, top: 14 }}>Planned</span>
            <span className="st-label tiny" style={{ left: 150, top: 94 }}>Built</span>
            <span className="st-label tiny" style={{ left: 150, top: 166 }}>In review</span>
            <span className="st-label tiny" style={{ left: 150, top: 286 }}>Tested</span>
            <span className="st-label tiny" style={{ left: 150, top: 366 }}>Done</span>
            <span className="verdict closed request" style={{ left: 18.4, top: 126, width: 70 }}>request</span>
            <span className="verdict closed request" style={{ left: 18.4, top: 146, width: 70 }}>changes</span>
            <span className="verdict open approve" style={{ left: 56.4, top: 238, width: 60 }}>approve</span>
            <span className="verdict closed block" style={{ left: 200, top: 220, width: 50 }}>block</span>
            <span className="st-label tiny" style={{ left: 256, top: 246, width: 80 }}>Blocked</span>
          </div>
          <ul className="sr-only">
            <li>Planned, then built, then in review.</li>
            <li>In review, approve: the change is tested, then done.</li>
            <li>In review, request changes: the change goes back to built for a fix, and is reviewed again.</li>
            <li>In review, block: the change is blocked until the plan changes.</li>
          </ul>
          <figcaption className="muted">A review can send the change back for a fix, or block it until the plan changes.</figcaption>
        </figure>
      </div>
      <div className="col-narrow two-parts">
        <h3>Two parts</h3>
        <p>The skills tell the agent how to plan, build, review, and test.</p>
        <p>The omt CLI does the fixed steps: the config, the model for each role, the task briefs, and the ledger.</p>
        <p className="muted">No runtime dependencies or telemetry. Update checks are opt-in.</p>
      </div>
    </section>
  );
}

function Evidence() {
  return (
    <section className="section wrap" aria-labelledby="evidence-title">
      <h2 id="evidence-title" className="h2-wide">
        You can read the plan, the task count, and each review verdict in files under .omt3/.
      </h2>
      <div className="split evidence">
        <div className="col-even evidence-files">
          <dl className="rows files">
            {OMT_FILES.map((row) => (
              <div key={row.path}>
                <dt>
                  <code>{row.path}</code>
                </dt>
                <dd className="muted">{row.note}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            A plan and its ledger stay in .omt3/ after context compaction and across sessions, so one plan can run for
            days.
          </p>
          <p>
            <a className="strong-link" href={WALKTHROUGH}>
              Read the walkthrough
            </a>
          </p>
        </div>
        <div className="col-narrow evidence-runs">
          <p className="meta">From the walkthrough of two real runs on the omt repository, one station per unit:</p>
          <div className="run-row">
            <img src="/img/ev4-night.svg" width={112} height={24} alt="" />
            <p className="figure-text">One run had 4 units and used 29 child tasks in 2 hours 20 minutes.</p>
          </div>
          <div className="run-row">
            <img src="/img/ev10-night.svg" width={304} height={24} alt="" />
            <p className="figure-text">The other had 10 units and used 128 child tasks over 5 days.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Skills() {
  return (
    <section id="skills" className="section wrap" aria-labelledby="skills-title">
      <h2 id="skills-title">Skills</h2>
      <SkillTour />
      <div className="split roles">
        <div className="col-even">
          <h3>Roles</h3>
          <p className="muted">
            Skills name roles, never models. A role is a kind of child task with an ordered list of models. When T3
            refuses one, the agent tries the next. Review roles run on the other model family. Profiles change the
            workflow switches, the limits, and the roles. <code>omt roles</code> lists them.
          </p>
        </div>
        <div className="col-even">
          <ul className="plain muted roles-list">
            <li>
              <span className="meta">Find</span> explore, research
            </li>
            <li>
              <span className="meta">Check</span> plan-review, review, oracle, guardrail, qa
            </li>
            <li>
              <span className="meta">Build</span> execute, ui, design, writing
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function WhoItIsFor() {
  return (
    <section className="section wrap" aria-labelledby="who-title">
      <h2 id="who-title">Who it is for</h2>
      <div className="split">
        <div className="col-even">
          <h3>Use omt if</h3>
          <p className="figure-text">
            You use T3 Code and want an agent to plan and finish work that has several steps. With both Claude Code and
            Codex, Claude and Codex review each other's work.
          </p>
        </div>
        <div className="col-even">
          <h3>Do not use omt if</h3>
          <ul className="plain muted body-large">
            <li>
              You do not use T3 Code. The workflows need a T3 Code thread to start child tasks.
            </li>
            <li>
              You want a quick edit with no plan and no review. omt plans, reviews, and tests even a small task, with
              at least 2 child tasks.
            </li>
            <li>You want a hosted service or a scheduler that runs in the background. omt has neither.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function Details() {
  return (
    <section className="section-tight split wrap" aria-label="Requirements and credits">
      <div className="col-even">
        <h3>Requirements</h3>
        <ul className="plain requirements muted">
          <li>
            The latest <a href={T3_CODE}>T3 Code</a> release.
          </li>
          <li>Claude Code, Codex, or both, enabled in T3. Design and UI tasks can run with either provider.</li>
          <li>git.</li>
          <li>Node 22 or later, except for the release binary.</li>
        </ul>
        <p className="meta small">This is version {VERSION}. The config format and the CLI output can change.</p>
      </div>
      <div className="col-even">
        <h3>Credits</h3>
        <p className="muted">
          oh-my-t3 uses ideas from oh-my-openagent (fallback chains, the ultrawork loop, plan reviews), oh-my-pi
          (model roles and the review recipe), and T3 Code (orchestrator v2, which runs the child tasks). It copies no
          code or prompts from oh-my-openagent.
        </p>
        <ul className="credit-links">
          <li>
            <a href={OH_MY_OPENAGENT}>oh-my-openagent</a>
          </li>
          <li>
            <a href={OH_MY_PI}>oh-my-pi</a>
          </li>
          <li>
            <a href={T3_CODE_REPO}>T3 Code</a>
          </li>
        </ul>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="closing wrap" aria-labelledby="closing-title">
      <h2 id="closing-title">Run omt once, with no install.</h2>
      <CommandPlate command="npx oh-my-t3" />
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer wrap">
      <hr />
      <div className="footer-row">
        <p>
          <span>oh-my-t3</span> <span className="meta">MIT license</span>
        </p>
        <ul>
          <li>
            <a href={REPO}>GitHub</a>
          </li>
          <li>
            <a href={NPM}>oh-my-t3 on npm</a>
          </li>
          <li>
            <a href={NPM_OMT3}>Aliases on npm</a>
          </li>
          <li>
            <a href={T3_CODE}>T3 Code</a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
