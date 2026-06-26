import { describe, expect, it } from "vitest";

import { coerceToolArgs, resolveToolSchema } from "../lib/execution/tool-args";

const SEARCH_SCHEMA = { type: "object", properties: { query: { type: "string" } }, required: ["query"] };
const EMAIL_SCHEMA = {
  type: "object",
  properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
  required: ["to", "subject", "body"]
};

describe("resolveToolSchema", () => {
  it("prefers a discovered schema that has properties", () => {
    const discovered = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
    expect(resolveToolSchema("search", "web_search", discovered)).toBe(discovered);
  });

  it("falls back to the first-party canonical schema when none was discovered", () => {
    expect(resolveToolSchema("search", "web_search", null)).toEqual(SEARCH_SCHEMA);
    expect(resolveToolSchema("gmail", "send_email", undefined)).toEqual(EMAIL_SCHEMA);
    expect(resolveToolSchema("gmail", "create_draft", {})).toEqual(EMAIL_SCHEMA);
  });

  it("returns null for an unknown tool with no discovered schema", () => {
    expect(resolveToolSchema("mystery", "do_thing", null)).toBeNull();
  });
});

describe("coerceToolArgs — single-field tools (web_search)", () => {
  it("maps a legacy input string to the schema's required field (not hardcoded 'query')", () => {
    const schema = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
    expect(coerceToolArgs(schema, undefined, "types of carp")).toEqual({ ok: true, args: { q: "types of carp" } });
  });

  it("maps legacy input to query for web_search", () => {
    expect(coerceToolArgs(SEARCH_SCHEMA, null, "types of carp")).toEqual({ ok: true, args: { query: "types of carp" } });
  });

  it("uses structured arguments when the model provides them", () => {
    expect(coerceToolArgs(SEARCH_SCHEMA, { query: "lake victoria fish" }, undefined)).toEqual({ ok: true, args: { query: "lake victoria fish" } });
  });

  it("never dispatches an empty query — empty input with required field is an honest error", () => {
    expect(coerceToolArgs(SEARCH_SCHEMA, {}, "")).toEqual({ ok: false, missing: ["query"] });
    expect(coerceToolArgs(SEARCH_SCHEMA, undefined, undefined)).toEqual({ ok: false, missing: ["query"] });
  });
});

describe("coerceToolArgs — multi-field tools (send_email)", () => {
  it("accepts complete structured arguments", () => {
    const args = { to: "a@example.com", subject: "Hi", body: "Hello" };
    expect(coerceToolArgs(EMAIL_SCHEMA, args, undefined)).toEqual({ ok: true, args });
  });

  it("a bare input string is NOT mis-mapped to a single field — it is a clear error", () => {
    const result = coerceToolArgs(EMAIL_SCHEMA, undefined, "just send it");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["to", "subject", "body"]);
  });

  it("reports exactly which required fields are missing from a partial object", () => {
    const result = coerceToolArgs(EMAIL_SCHEMA, { to: "a@example.com" }, "ignored because >1 field missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["subject", "body"]);
  });

  it("fills the single remaining required field from input when only one is missing", () => {
    // to + subject present, body missing → input becomes the body.
    const result = coerceToolArgs(EMAIL_SCHEMA, { to: "a@example.com", subject: "Hi" }, "the email body");
    expect(result).toEqual({ ok: true, args: { to: "a@example.com", subject: "Hi", body: "the email body" } });
  });
});

describe("coerceToolArgs — no schema", () => {
  it("uses structured args as-is when no schema is known", () => {
    expect(coerceToolArgs(null, { anything: 1 }, undefined)).toEqual({ ok: true, args: { anything: 1 } });
  });

  it("does not invent a 'query' field when there is no schema", () => {
    // Without a schema we cannot know field names — no silent {query: input}.
    expect(coerceToolArgs(null, undefined, "some text")).toEqual({ ok: true, args: {} });
  });
});
