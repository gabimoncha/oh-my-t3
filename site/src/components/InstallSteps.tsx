import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import { CopyButton } from "./Copy";

type Channel = "bun" | "pnpm" | "mise" | "once";
type Scope = "user" | "project";

const CHANNELS: { id: Channel; label: string; command: string; note: ReactNode }[] = [
  { id: "bun", label: "Bun", command: "bun add -g oh-my-t3", note: "Also needs Node 22 or later." },
  { id: "pnpm", label: "pnpm", command: "pnpm add -g oh-my-t3", note: "Needs Node 22 or later." },
  {
    id: "mise",
    label: "mise",
    command: "mise use -g github:gabimoncha/oh-my-t3",
    note: "Installs the release binary. Needs no Node.",
  },
  {
    id: "once",
    label: "Run once",
    command: "npx oh-my-t3 --version",
    note: (
      <>
        Installs nothing. <code>bunx oh-my-t3</code> also works.
      </>
    ),
  },
];

const SCOPES: { id: Scope; label: string }[] = [
  { id: "user", label: "All projects" },
  { id: "project", label: "One project" },
];

function skillCommands(channel: Channel, scope: Scope): { comment?: string; lines: string[]; note: string } {
  const omt = channel === "once" ? "npx oh-my-t3" : "omt";
  if (scope === "user") {
    return {
      lines: [`${omt} install --hooks`, `${omt} doctor`],
      note: "For every project. A project then needs no install of its own.",
    };
  }
  return {
    comment: "# in the folder of your project",
    lines: [`${omt} install --project --hooks`, `${omt} doctor --project`],
    note: channel === "once" ? "A one-shot run can install into one project only." : "For this repository only.",
  };
}

type TabsProps<T extends string> = {
  label: string;
  tabs: { id: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  copy: string;
  children: ReactNode;
};

// A tab list with automatic activation: the arrow keys, Home, and End move the selection. The copy
// button is in the panel; on a wide screen, CSS moves it up to the right end of the tab row.
function Tabs<T extends string>({ label, tabs, value, onChange, copy, children }: TabsProps<T>) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const enabled = tabs.filter((tab) => !tab.disabled);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = enabled.findIndex((tab) => tab.id === value);
    const next =
      event.key === "ArrowRight"
        ? enabled[(index + 1) % enabled.length]
        : event.key === "ArrowLeft"
          ? enabled[(index - 1 + enabled.length) % enabled.length]
          : event.key === "Home"
            ? enabled[0]
            : event.key === "End"
              ? enabled[enabled.length - 1]
              : undefined;
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  }

  return (
    <div className="tabbed" data-copy-root>
      <div className="tabbed-head">
        <div className="tab-list" role="tablist" aria-label={label} ref={list} onKeyDown={onKeyDown}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${id}-${tab.id}`}
              data-tab={tab.id}
              aria-selected={tab.id === value}
              aria-controls={`${id}-panel`}
              aria-disabled={tab.disabled || undefined}
              tabIndex={tab.id === value ? 0 : -1}
              onClick={() => !tab.disabled && onChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="tab-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`}>
        {children}
        <CopyButton text={copy} variant="solid" />
      </div>
    </div>
  );
}

export function InstallSteps() {
  const [channel, setChannel] = useState<Channel>("bun");
  const [chosenScope, setScope] = useState<Scope>("user");
  // A one-shot run cannot install for the user: omt refuses a user install from the npx cache.
  const scope = channel === "once" ? "project" : chosenScope;
  const current = CHANNELS.find((item) => item.id === channel)!;
  const skills = skillCommands(channel, scope);

  return (
    <ol className="install-steps">
      <li>
        <h3>
          <span className="step-no">1</span> Get the omt command
        </h3>
        <Tabs label="Install channel" tabs={CHANNELS} value={channel} onChange={setChannel} copy={current.command}>
          <pre>
            <code>{current.command}</code>
          </pre>
        </Tabs>
        <p className="step-note">{current.note}</p>
      </li>
      <li>
        <h3>
          <span className="step-no">2</span> Install the skills
        </h3>
        <Tabs
          label="Install scope"
          tabs={SCOPES.map((item) => ({ ...item, disabled: channel === "once" && item.id === "user" }))}
          value={scope}
          onChange={setScope}
          copy={skills.lines.join("\n")}
        >
          <pre>
            {skills.comment ? <span className="comment">{skills.comment}{"\n"}</span> : null}
            <code>{skills.lines.join("\n")}</code>
          </pre>
        </Tabs>
        <p className="step-note">{skills.note}</p>
      </li>
    </ol>
  );
}
