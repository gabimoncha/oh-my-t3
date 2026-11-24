import { type CSSProperties, type ReactNode, useId } from "react";

// A small metro-map renderer for the animated pictures. A scene is a list of items, each with the
// time (ms) at which it appears. Lines draw at one speed, from their path length; stations, labels,
// and verdicts fade in when the line reaches them. CSS runs the timing (see "Metro scenes" in
// styles.css), so a scene plays when its host gets data-play, and shows its last frame without JS.

export type Point = [number, number];
export type Kind = "goal" | "plan" | "work" | "review" | "verify" | "done" | "pending" | "check" | "blocked";
export type Tone = "ink" | "yellow" | "muted" | "faint" | "green";
type TextStyle = "station" | "code" | "note";
type Anchor = "start" | "middle" | "end";
type Timed = { at: number; dim?: number };

export type Item =
  | { type: "rail"; d: string }
  | ({ type: "line"; d: string; dur: number; width: number; dash: boolean; tone: Tone } & Timed)
  | ({ type: "station"; x: number; y: number; kind: Kind } & Timed)
  | ({ type: "dot"; x: number; y: number; r: number } & Timed)
  | ({ type: "text"; x: number; y: number; lines: string[]; style: TextStyle; size: number; anchor: Anchor } & Timed)
  | ({ type: "verdict"; x: number; y: number; text: string; tone: "closed" | "open" | "steer" } & Timed);

export type Scene = { w: number; h: number; size: "s" | "l"; items: Item[]; end: number };

const INK = "#FFFFFF";
const GROUND = "#0A0A0A";
const PURPLE = "#AB7DF8";
const GREEN = "#3FB950";
const RED = "#F85149";
const GRAY = "#9198A1";
const TONES: Record<Tone, string> = {
  ink: INK,
  yellow: "#E3B341",
  muted: "#9A9A9A",
  faint: "#3A3A3A",
  green: GREEN,
};

const round = (n: number) => Math.round(n * 100) / 100;

// A polyline with rounded corners, in the style of the drawn art: straight runs and 45-degree turns.
export function rail(input: Point[], radius = 16): string {
  const points = input.filter((point, i) => i === 0 || point[0] !== input[i - 1]![0] || point[1] !== input[i - 1]![1]);
  const [first, ...rest] = points;
  if (!first) return "";
  let d = `M${round(first[0])} ${round(first[1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [ax, ay] = points[i - 1]!;
    const [px, py] = points[i]!;
    const [bx, by] = points[i + 1]!;
    const inLength = Math.hypot(px - ax, py - ay);
    const outLength = Math.hypot(bx - px, by - py);
    const cut = Math.min(radius, inLength / 2, outLength / 2);
    const sx = px - ((px - ax) / inLength) * cut;
    const sy = py - ((py - ay) / inLength) * cut;
    const ex = px + ((bx - px) / outLength) * cut;
    const ey = py + ((by - py) / outLength) * cut;
    d += ` L${round(sx)} ${round(sy)} Q${round(px)} ${round(py)} ${round(ex)} ${round(ey)}`;
  }
  const last = rest[rest.length - 1];
  if (last) d += ` L${round(last[0])} ${round(last[1])}`;
  return d;
}

// The length of a path made of absolute M, L, and Q commands.
export function pathLength(d: string): number {
  const tokens = d.match(/[MLQ]|-?\d*\.?\d+/g) ?? [];
  let i = 0;
  let x = 0;
  let y = 0;
  let length = 0;
  let command = "M";
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MLQ]/.test(tokens[i]!)) command = tokens[i++]!;
    if (command === "M") {
      x = next();
      y = next();
    } else if (command === "L") {
      const nx = next();
      const ny = next();
      length += Math.hypot(nx - x, ny - y);
      x = nx;
      y = ny;
    } else {
      const cx = next();
      const cy = next();
      const nx = next();
      const ny = next();
      let px = x;
      let py = y;
      for (let step = 1; step <= 24; step++) {
        const t = step / 24;
        const qx = (1 - t) ** 2 * x + 2 * (1 - t) * t * cx + t * t * nx;
        const qy = (1 - t) ** 2 * y + 2 * (1 - t) * t * cy + t * t * ny;
        length += Math.hypot(qx - px, qy - py);
        px = qx;
        py = qy;
      }
      x = nx;
      y = ny;
    }
  }
  return length;
}

type LineOptions = { dash?: boolean; tone?: Tone; width?: number; speed?: number; dim?: number; radius?: number };
type TextOptions = { style?: TextStyle; size?: number; anchor?: Anchor; dim?: number };

// Builds a scene. Each drawing call takes its start time and returns the time it ends, so a scene
// reads as a sequence: const t = draw.line(path, 0); draw.station(x, y, "work", t).
export class Draw {
  readonly items: Item[] = [];
  end = 0;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly size: "s" | "l",
    readonly msPerPx: number,
  ) {}

  private reach(at: number) {
    this.end = Math.max(this.end, at);
  }

  rail(d: string) {
    this.items.push({ type: "rail", d });
  }

  line(path: string | Point[], at: number, options: LineOptions = {}): number {
    const d = typeof path === "string" ? path : rail(path, options.radius);
    const dur = Math.round(pathLength(d) * this.msPerPx * (options.speed ?? 1));
    this.items.push({
      type: "line",
      d,
      at,
      dur,
      dim: options.dim,
      dash: options.dash ?? false,
      tone: options.tone ?? "ink",
      width: options.width ?? (this.size === "l" ? 16 : 8),
    });
    this.reach(at + dur);
    return at + dur;
  }

  station(x: number, y: number, kind: Kind, at: number, dim?: number): number {
    this.items.push({ type: "station", x, y, kind, at, dim });
    this.reach(at + 240);
    return at;
  }

  dot(x: number, y: number, r: number, at: number) {
    this.items.push({ type: "dot", x, y, r, at });
    this.reach(at + 240);
  }

  text(x: number, y: number, text: string | string[], at: number, options: TextOptions = {}) {
    this.items.push({
      type: "text",
      x,
      y,
      at,
      dim: options.dim,
      lines: typeof text === "string" ? [text] : text,
      style: options.style ?? "station",
      size: options.size ?? 16,
      anchor: options.anchor ?? "middle",
    });
    this.reach(at + 240);
  }

  verdict(x: number, y: number, text: string, tone: "closed" | "open" | "steer", at: number) {
    this.items.push({ type: "verdict", x, y, text, tone, at });
    this.reach(at + 240);
  }

  scene(): Scene {
    return { w: this.w, h: this.h, size: this.size, items: this.items, end: this.end };
  }
}

// The dot patterns inside the stations, copied from the drawn hero art: the offset of each cell from
// the center. Small stations (r 14) use 2 px cells, large ones (r 22) use 4 px cells.
const PATTERNS = {
  s: {
    plan: "-3,-8 5,-8 -7,-4 1,-4 9,-4 -11,0 -3,0 5,0 -7,4 1,4 -3,8",
    work: "-7,-8 -3,-8 1,-8 5,-8 -11,-4 -7,-4 -3,-4 1,-4 5,-4 9,-4 -11,0 -7,0 -3,0 1,0 5,0 9,0 -7,4 -3,4 1,4 5,4 -3,8 1,8",
    review:
      "-5,-14 -1,-14 3,-14 -7,-12 -3,-12 1,-12 5,-12 -9,-10 -5,-10 -1,-10 3,-10 7,-10 -11,-8 -7,-8 -3,-8 1,-8 5,-8 9,-8 -13,-6 -9,-6 -5,-6 -1,-6 3,-6 7,-6 11,-6 -15,-4 -11,-4 -7,-4 -3,-4 1,-4 5,-4 9,-4 13,-4 -13,-2 -9,-2 -5,-2 -1,-2 3,-2 7,-2 11,-2 -15,0 -11,0 -7,0 -3,0 1,0 5,0 9,0 13,0 -13,2 -9,2 -5,2 -1,2 3,2 7,2 11,2 -11,4 -7,4 -3,4 1,4 5,4 9,4 -13,6 -9,6 -5,6 -1,6 3,6 7,6 11,6 -11,8 -7,8 -3,8 1,8 5,8 9,8 -9,10 -5,10 -1,10 3,10 7,10 -7,12 -3,12 1,12 5,12",
    verify:
      "-5,-10 -1,-10 3,-10 -7,-8 -5,-8 -3,-8 -1,-8 1,-8 3,-8 5,-8 -9,-6 -5,-6 -1,-6 3,-6 7,-6 -11,-4 -9,-4 -7,-4 -5,-4 -3,-4 -1,-4 1,-4 3,-4 5,-4 7,-4 9,-4 -9,-2 -5,-2 -1,-2 3,-2 7,-2 -11,0 -9,0 -7,0 -5,0 -3,0 -1,0 1,0 3,0 5,0 7,0 9,0 -9,2 -5,2 -1,2 3,2 7,2 -9,4 -7,4 -5,4 -3,4 -1,4 1,4 3,4 5,4 7,4 -5,6 -1,6 3,6 -5,8 -3,8 -1,8 1,8 3,8",
  },
  l: {
    plan: "-8,-16 -16,-8 0,-8 -8,0 8,0 0,8",
    work: "-8,-16 0,-16 -16,-8 -8,-8 0,-8 8,-8 -16,0 -8,0 0,0 8,0 -8,8 0,8 8,8",
    review:
      "-8,-24 0,-24 8,-24 -12,-20 -4,-20 4,-20 12,-20 -16,-16 -8,-16 0,-16 8,-16 16,-16 -20,-12 -12,-12 -4,-12 4,-12 12,-12 20,-12 -24,-8 -16,-8 -8,-8 0,-8 8,-8 16,-8 -20,-4 -12,-4 -4,-4 4,-4 12,-4 20,-4 -24,0 -16,0 -8,0 0,0 8,0 16,0 -20,4 -12,4 -4,4 4,4 12,4 20,4 -24,8 -16,8 -8,8 0,8 8,8 16,8 -20,12 -12,12 -4,12 4,12 12,12 -16,16 -8,16 0,16 8,16 -12,20 -4,20 4,20",
    verify:
      "-8,-16 -4,-16 0,-16 4,-16 -12,-12 -4,-12 4,-12 -16,-8 -12,-8 -8,-8 -4,-8 0,-8 4,-8 8,-8 12,-8 -12,-4 -4,-4 4,-4 12,-4 -16,0 -12,0 -8,0 -4,0 0,0 4,0 8,0 12,0 -12,4 -4,4 4,4 12,4 -12,8 -8,8 -4,8 0,8 4,8 8,8 -4,12 4,12",
  },
};

const SIZES = {
  s: { r: 14, ring: 12, ringWidth: 4, reviewR: 18, reviewRing: 16, cell: 2, glyph: 1 },
  l: { r: 22, ring: 19, ringWidth: 6, reviewR: 30, reviewRing: 27, cell: 4, glyph: 1.6 },
};

function cells(pattern: string, x: number, y: number, cell: number): string {
  return pattern
    .split(" ")
    .map((pair) => {
      const [dx, dy] = pair.split(",").map(Number);
      return `M${x + dx!} ${y + dy!}h${cell}v${cell}h-${cell}z`;
    })
    .join("");
}

function Station({ x, y, kind, size }: { x: number; y: number; kind: Kind; size: "s" | "l" }) {
  const s = SIZES[size];
  const review = kind === "review";
  const r = review ? s.reviewR : s.r;
  const ring = review ? s.reviewRing : s.ring;
  if (kind === "done") return <circle cx={x} cy={y} r={s.r} fill={PURPLE} />;
  const dashed = kind === "pending" ? `${round((Math.PI * 2 * ring) / 16)} ${round((Math.PI * 2 * ring) / 16)}` : undefined;
  const stroke = kind === "pending" ? GRAY : kind === "check" ? GREEN : kind === "blocked" ? RED : INK;
  const g = s.glyph;
  return (
    <>
      <circle cx={x} cy={y} r={r} fill={GROUND} />
      {kind === "plan" || kind === "work" || kind === "review" || kind === "verify" ? (
        <path d={cells(PATTERNS[size][kind], x, y, s.cell)} fill={INK} shapeRendering="crispEdges" />
      ) : null}
      {kind === "check" ? (
        <path
          d={`M${x - 5.5 * g} ${y + 0.3 * g} L${x - 1.65 * g} ${y + 3.85 * g} L${x + 5.5 * g} ${y - 3.3 * g}`}
          fill="none"
          stroke={GREEN}
          strokeWidth={3 * g}
          strokeLinecap="square"
        />
      ) : null}
      {kind === "blocked" ? (
        <path
          d={`M${x - 4.5 * g} ${y - 4.5 * g} L${x + 4.5 * g} ${y + 4.5 * g} M${x + 4.5 * g} ${y - 4.5 * g} L${x - 4.5 * g} ${y + 4.5 * g}`}
          fill="none"
          stroke={RED}
          strokeWidth={3 * g}
          strokeLinecap="square"
        />
      ) : null}
      <circle cx={x} cy={y} r={ring} fill="none" stroke={stroke} strokeWidth={s.ringWidth} strokeDasharray={dashed} />
    </>
  );
}

const time = ({ at, dim }: Timed, dur?: number) =>
  ({
    "--at": `${at}ms`,
    ...(dur === undefined ? {} : { "--dur": `${dur}ms` }),
    ...(dim === undefined ? {} : { "--dim": `${dim}ms` }),
  }) as CSSProperties;

const popClass = (item: Timed) => (item.dim === undefined ? "m-pop" : "m-pop m-dim");

function Verdict({ item }: { item: Extract<Item, { type: "verdict" }> }) {
  const { x, y } = item;
  const color = item.tone === "closed" ? RED : item.tone === "open" ? GREEN : TONES.muted;
  const glyph =
    item.tone === "closed"
      ? `M${x} ${y - 9} L${x + 8} ${y - 1} M${x + 8} ${y - 9} L${x} ${y - 1}`
      : item.tone === "open"
        ? `M${x} ${y - 4.5} L${x + 3.5} ${y - 1.2} L${x + 9.5} ${y - 7.2}`
        : `M${x} ${y - 5} L${x + 8} ${y - 5} M${x + 4} ${y - 9} L${x + 8} ${y - 5} L${x + 4} ${y - 1}`;
  return (
    <g className={popClass(item)} style={time(item)}>
      <path d={glyph} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="square" />
      <text x={x + 15} y={y} className="m-verdict" fill={color}>
        {item.text}
      </text>
    </g>
  );
}

export function Metro({ scene, className }: { scene: Scene; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const { w, h, size, items } = scene;
  const dash = size === "l" ? "24 12" : "16 8";
  const out: ReactNode[] = [];
  const masks: ReactNode[] = [];
  // Draw order: the review rail, then lines, then stations, then labels on top.
  const layer = (item: Item) =>
    item.type === "rail" ? 0 : item.type === "line" ? 1 : item.type === "text" || item.type === "verdict" ? 3 : 2;
  const sorted = items.map((item, index) => ({ item, index })).sort((a, b) => layer(a.item) - layer(b.item));

  for (const { item, index } of sorted) {
    const key = `${item.type}-${index}`;
    switch (item.type) {
      case "rail":
        out.push(<path key={key} d={item.d} fill="none" stroke={PURPLE} strokeWidth={size === "l" ? 16 : 8} />);
        break;
      case "line": {
        const mask = item.dash ? `${id}-m${index}` : undefined;
        if (mask) {
          masks.push(
            <mask key={mask} id={mask} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
              <path d={item.d} fill="none" stroke={INK} strokeWidth={item.width + 2} strokeDasharray={dash} />
            </mask>,
          );
        }
        out.push(
          <path
            key={key}
            className={item.dim === undefined ? "m-seg" : "m-seg m-dim"}
            d={item.d}
            pathLength={1}
            fill="none"
            stroke={TONES[item.tone]}
            strokeWidth={item.width}
            mask={mask ? `url(#${mask})` : undefined}
            style={time(item, item.dur)}
          />,
        );
        break;
      }
      case "station":
        out.push(
          <g key={key} className={popClass(item)} style={time(item)}>
            <Station x={item.x} y={item.y} kind={item.kind} size={size} />
          </g>,
        );
        break;
      case "dot":
        out.push(
          <circle key={key} className={popClass(item)} style={time(item)} cx={item.x} cy={item.y} r={item.r} fill={INK} />,
        );
        break;
      case "text":
        out.push(
          <text
            key={key}
            className={`${popClass(item)} m-${item.style}`}
            style={time(item)}
            x={item.x}
            y={item.y}
            fontSize={item.size}
            textAnchor={item.anchor}
          >
            {item.lines.map((line, i) => (
              <tspan key={line} x={item.x} dy={i === 0 ? 0 : item.size * 1.4}>
                {line}
              </tspan>
            ))}
          </text>,
        );
        break;
      case "verdict":
        out.push(<Verdict key={key} item={item} />);
        break;
    }
  }

  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      {masks.length ? <defs>{masks}</defs> : null}
      {out}
    </svg>
  );
}
