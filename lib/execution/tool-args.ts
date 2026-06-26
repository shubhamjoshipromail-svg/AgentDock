// Schema-aware argument coercion for MCP tool calls.
//
// The model is non-deterministic about HOW it passes a tool's arguments: it may
// emit a structured `arguments` object, or a legacy single `input` string. The
// engine must dispatch arguments that satisfy the tool's discovered JSON input
// schema regardless — without hardcoding any field name (e.g. "query"), and
// without ever sending `{}` (or args missing required fields) to a tool that
// declares required fields. When the arguments cannot be satisfied, that is an
// honest error naming the missing fields — never a silent mis-map.

export type JsonToolSchema = {
  type?: string;
  properties?: Record<string, { type?: string } | undefined>;
  required?: string[];
} | null | undefined;

// Canonical schemas for first-party tools. These mirror what the servers declare
// at tools/list and are used ONLY as a fallback when the discovered McpTool row
// has no inputSchema (e.g. seeded rows that never went through live discovery).
// A real discovered schema always takes precedence.
const FIRST_PARTY_TOOL_SCHEMAS: Record<string, JsonToolSchema> = {
  "search:web_search": {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"]
  },
  "gmail:send_email": {
    type: "object",
    properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
    required: ["to", "subject", "body"]
  },
  "gmail:create_draft": {
    type: "object",
    properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
    required: ["to", "subject", "body"]
  }
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasContent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

// Resolve the schema to coerce against: the discovered schema if it carries
// properties, otherwise the first-party canonical fallback, otherwise null.
export function resolveToolSchema(
  serverKey: string | null,
  toolName: string | null,
  discovered: unknown
): JsonToolSchema {
  if (isPlainObject(discovered) && isPlainObject((discovered as JsonToolSchema)?.properties)) {
    return discovered as JsonToolSchema;
  }
  if (serverKey && toolName) {
    return FIRST_PARTY_TOOL_SCHEMAS[`${serverKey}:${toolName}`] ?? null;
  }
  return null;
}

export type CoerceResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; missing: string[] };

// Build arguments that satisfy `schema` from whatever the model produced:
//   • a structured `arguments` object (preferred), and/or
//   • a legacy `input` string mapped to the schema's single missing/primary
//     STRING field (the field name comes from the schema — never assumed).
// Multi-field tools cannot be satisfied by a bare string → that is a clear error
// listing the missing required fields, not a silent `{ field: input }` mis-map.
export function coerceToolArgs(
  schema: JsonToolSchema,
  rawArgs: Record<string, unknown> | undefined | null,
  input: string | undefined
): CoerceResult {
  const args: Record<string, unknown> = isPlainObject(rawArgs) ? { ...rawArgs } : {};
  const trimmedInput = typeof input === "string" ? input.trim() : "";

  // No schema info: we cannot reason about required fields. Use the structured
  // args as-is; there is no required field we could be violating.
  if (!schema || !isPlainObject(schema.properties)) {
    return { ok: true, args };
  }

  const properties = schema.properties as Record<string, { type?: string } | undefined>;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const propType = (name: string) => properties[name]?.type ?? "string";

  const missingRequired = () => required.filter((field) => !hasContent(args[field]));

  // Try to place a legacy `input` string into the right field, by schema.
  if (trimmedInput) {
    const missing = missingRequired();
    if (missing.length === 1 && propType(missing[0]) === "string") {
      // Exactly one required string field is unfilled → that's where input goes.
      args[missing[0]] = trimmedInput;
    } else if (required.length === 0 && Object.keys(args).length === 0) {
      // No required fields and nothing structured given → fill the single primary
      // string property if there is one (e.g. an optional `query`).
      const primaryString = Object.keys(properties).find((name) => propType(name) === "string");
      if (primaryString) args[primaryString] = trimmedInput;
    }
    // Otherwise the bare string is insufficient (multi-field tool) → fall through
    // to the missing-required check, which reports an honest error.
  }

  const stillMissing = missingRequired();
  if (stillMissing.length > 0) {
    return { ok: false, missing: stillMissing };
  }
  return { ok: true, args };
}
