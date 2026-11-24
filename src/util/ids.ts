import { usageError } from "./errors.ts";

export const PLAN_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const UNIT_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function checkPlanSlug(slug: string, flag = "plan slug"): string {
  if (!PLAN_SLUG_RE.test(slug)) {
    throw usageError(`invalid ${flag} "${slug}"`, "a plan slug matches ^[a-z0-9][a-z0-9-]{0,63}$");
  }
  return slug;
}

export function checkUnitId(unit: string): string {
  if (!UNIT_ID_RE.test(unit)) throw usageError(`invalid --unit "${unit}"`, "a unit id matches ^[A-Za-z0-9._-]{1,64}$");
  return unit;
}

function sanitize(part: string, max: number): string {
  return part.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, max);
}

// Each part is capped so the round and attempt suffix always survives.
export function requestId(plan: string, unit: string, role: string, round = 1, attempt = 1): string {
  return ["omt", sanitize(plan, 64), sanitize(unit, 64), sanitize(role, 32), `r${round}`, `a${attempt}`].join(":");
}
