import type { Capabilities, LedgerEntry, RoleConfig, Candidate } from "../types.ts";

// Maps each provider instance id that a configured candidate names together with a driver to that driver.
// The first candidate in role order wins.
export function configuredDrivers(roles: Record<string, RoleConfig>): Map<string, string> {
  const drivers = new Map<string, string>();
  for (const role of Object.values(roles)) {
    for (const candidate of role.chain) {
      if (candidate.provider !== undefined && candidate.driver !== undefined && !drivers.has(candidate.provider)) {
        drivers.set(candidate.provider, candidate.driver);
      }
    }
  }
  return drivers;
}

// The worker side calls this too (see workerFamily), so both sides of a family comparison map a
// provider instance id to the same driver kind.
// A driver that runs models of more than one vendor (cursor, opencode) counts as its own family.
export function candidateFamily(
  candidate: Pick<Candidate, "provider" | "driver">,
  caps?: Capabilities,
  drivers?: Map<string, string>,
): string | undefined {
  const { provider, driver } = candidate;
  const registered = provider === undefined ? undefined : caps?.providers.find((p) => p.providerInstanceId === provider);
  if (registered !== undefined) return registered.driverKind;
  if (driver !== undefined) return driver;
  if (provider === undefined) return undefined;
  return drivers?.get(provider) ?? provider;
}

// The --against value names a provider instance or a driver kind.
export function workerFamily(against: string, caps?: Capabilities, drivers?: Map<string, string>): string {
  return candidateFamily({ provider: against }, caps, drivers) ?? against;
}

// A stable partition. Candidates outside the worker's family come first, then the worker's family, each in configured order.
export function crossFamilyOrder(
  chain: Candidate[],
  family: string,
  caps?: Capabilities,
  drivers?: Map<string, string>,
): number[] {
  const indexes = chain.map((_, index) => index);
  const same = (index: number): boolean => {
    const candidate = chain[index];
    return candidate !== undefined && candidateFamily(candidate, caps, drivers) === family;
  };
  return [...indexes.filter((index) => !same(index)), ...indexes.filter(same)];
}

export interface WorkerPick {
  provider: string;
  from: "unit" | "plan";
}

function isWorkerRole(entry: LedgerEntry, roles: Record<string, RoleConfig>, plan: string): boolean {
  if (entry.status !== "dispatched" || entry.plan !== plan) return false;
  const role = Object.hasOwn(roles, entry.role) ? roles[entry.role] : undefined;
  return role !== undefined && (role.result === "work" || role.result === "plan");
}

// Picks the worker for --against auto from ledger entries in file order.
// warn gets one message per worker entry whose provider is set but is not a non-empty string.
export function pickWorker(
  entries: LedgerEntry[],
  roles: Record<string, RoleConfig>,
  plan: string,
  unit?: string,
  warn?: (message: string) => void,
): WorkerPick | undefined {
  const workers: { unit: string | undefined; provider: string }[] = [];
  for (const entry of entries) {
    if (!isWorkerRole(entry, roles, plan)) continue;
    const provider: unknown = entry.provider;
    if (provider === undefined) continue;
    if (typeof provider !== "string" || provider === "") {
      warn?.(
        `skipped a ledger entry with an invalid provider ${JSON.stringify(provider)} (role ${entry.role}, unit ${entry.unit ?? "none"}, ts ${entry.ts})`,
      );
      continue;
    }
    workers.push({ unit: entry.unit, provider });
  }
  if (unit !== undefined) {
    const last = workers.filter((worker) => worker.unit === unit).at(-1);
    if (last !== undefined) return { provider: last.provider, from: "unit" };
  }
  // Only the last worker entry of each unit counts, for the unit count and for the tie rule.
  const lastByUnit = new Map<string, { provider: string; position: number }>();
  workers.forEach((worker, position) => lastByUnit.set(worker.unit ?? "", { provider: worker.provider, position }));
  const units = new Map<string, number>();
  const latest = new Map<string, number>();
  for (const { provider, position } of lastByUnit.values()) {
    units.set(provider, (units.get(provider) ?? 0) + 1);
    latest.set(provider, Math.max(latest.get(provider) ?? -1, position));
  }
  let best: string | undefined;
  for (const [provider, count] of units) {
    if (best === undefined) {
      best = provider;
      continue;
    }
    const bestCount = units.get(best) ?? 0;
    const later = (latest.get(provider) ?? -1) > (latest.get(best) ?? -1);
    if (count > bestCount || (count === bestCount && later)) best = provider;
  }
  return best === undefined ? undefined : { provider: best, from: "plan" };
}
