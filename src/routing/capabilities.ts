import type {
  Capabilities,
  ModelCapability,
  OptionChoice,
  OptionDescriptor,
  ProviderCapability,
} from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { isRecord } from "../util/json.ts";

type Json = Record<string, unknown>;

function fail(message: string): never {
  throw new OmtError("capabilities_parse", `capabilities: ${message}`, {
    hint: "pass the saved result of the orchestrator_capabilities tool",
  });
}

function hasProviders(value: unknown): value is Json {
  return isRecord(value) && Array.isArray(value.providers);
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return undefined;
  }
}

function fromContentItems(items: unknown[]): Json | undefined {
  for (const item of items) {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") continue;
    const parsed = tryParse(item.text);
    if (hasProviders(parsed)) return parsed;
  }
  return undefined;
}

function unwrap(value: unknown): Json {
  if (hasProviders(value)) return value;
  const items = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.content) ? value.content : undefined;
  const found = items === undefined ? undefined : fromContentItems(items);
  if (found === undefined) {
    fail("expected an object with a providers array, or an MCP content wrapper that holds one");
  }
  return found;
}

function requiredString(obj: Json, key: string, where: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value === "") fail(`${where}.${key} must be a non-empty string`);
  return value;
}

function optionalString(obj: Json, key: string, where: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") fail(`${where}.${key} must be a string`);
  return value;
}

function optionalArray(obj: Json, key: string, where: string): unknown[] {
  const value = obj[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${where}.${key} must be an array`);
  return value;
}

function objectAt(value: unknown, where: string): Json {
  if (!isRecord(value)) fail(`${where} must be an object`);
  return value;
}

function parseChoice(value: unknown, where: string): OptionChoice {
  const obj = objectAt(value, where);
  const choice: OptionChoice = { id: requiredString(obj, "id", where) };
  const label = optionalString(obj, "label", where);
  if (label !== undefined) choice.label = label;
  if (obj.isDefault === true) choice.isDefault = true;
  return choice;
}

// Newer T3 builds send an option as { id, values, default } with no type and no choice objects.
function parseCompactDescriptor(obj: Json, where: string): OptionDescriptor {
  const id = requiredString(obj, "id", where);
  const values = optionalArray(obj, "values", where);
  if (values.length > 0 && values.every((v) => typeof v === "boolean")) return { id, type: "boolean" };
  return {
    id,
    type: "select",
    options: values.map((v, i) => {
      if (typeof v !== "string" || v === "") fail(`${where}.values[${i}] must be a non-empty string or a boolean`);
      return v === obj.default ? { id: v, isDefault: true } : { id: v };
    }),
  };
}

function parseDescriptor(value: unknown, where: string): OptionDescriptor {
  const obj = objectAt(value, where);
  if (obj.type === undefined && Array.isArray(obj.values)) return parseCompactDescriptor(obj, where);
  const descriptor: OptionDescriptor = {
    id: requiredString(obj, "id", where),
    type: requiredString(obj, "type", where),
  };
  const label = optionalString(obj, "label", where);
  if (label !== undefined) descriptor.label = label;
  if (obj.options !== undefined && obj.options !== null) {
    descriptor.options = optionalArray(obj, "options", where).map((c, i) => parseChoice(c, `${where}.options[${i}]`));
  }
  return descriptor;
}

function parseModel(value: unknown, where: string): ModelCapability {
  const obj = objectAt(value, where);
  const label = optionalString(obj, "label", where);
  return {
    id: requiredString(obj, "id", where),
    ...(label === undefined ? {} : { label }),
    options: optionalArray(obj, "options", where).map((d, i) => parseDescriptor(d, `${where}.options[${i}]`)),
  };
}

function parseProvider(value: unknown, where: string): ProviderCapability {
  const obj = objectAt(value, where);
  const displayName = optionalString(obj, "displayName", where);
  return {
    providerInstanceId: requiredString(obj, "providerInstanceId", where),
    driverKind: requiredString(obj, "driverKind", where),
    ...(displayName === undefined ? {} : { displayName }),
    canRunChildTask: obj.canRunChildTask === true,
    constraints: optionalArray(obj, "constraints", where).map((c, i) => {
      if (typeof c !== "string") fail(`${where}.constraints[${i}] must be a string`);
      return c;
    }),
    models: optionalArray(obj, "models", where).map((m, i) => parseModel(m, `${where}.models[${i}]`)),
  };
}

export function parseCapabilities(text: string): Capabilities {
  const raw = tryParse(text);
  if (raw === undefined) fail("the input is not valid JSON");
  const obj = unwrap(raw);
  const caps: Partial<Capabilities> = {};
  for (const key of ["inheritedProviderInstanceId", "inheritedModel", "runtimeMode", "interactionMode"] as const) {
    const value = optionalString(obj, key, "capabilities");
    if (value !== undefined) caps[key] = value;
  }
  caps.providers = (obj.providers as unknown[]).map((p, i) => parseProvider(p, `providers[${i}]`));
  return caps as Capabilities;
}
