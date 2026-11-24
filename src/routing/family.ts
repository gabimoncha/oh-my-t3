import type { Capabilities, RoleConfig, Candidate } from "../types.ts";

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
