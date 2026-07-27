import { describe, expect, it, vi } from "vitest";

import { createEvent, listEvents, type CalendarApi } from "../servers/calendar/calendar-tools";
import { appendToDoc, createDoc, docUrl, type DocsApi } from "../servers/docs/docs-tools";
import { CURATED_SERVER_REGISTRATIONS } from "../lib/registry/server-registrations";

// ============================================================================
// CALENDAR + DOCS ARRIVE THROUGH THE GENERIC PATH (Chunk 24 Phase 3).
//
// The acceptance bar is that adding a tool changes NO execution code: the gate,
// broker, queue, audit and approval flow are untouched. What a new tool needs is
// an adapter (an MCP server that knows the vendor's API) plus registration DATA.
// These tests cover the adapters and assert the registration data is shaped so
// the existing governance treats them correctly.
// ============================================================================

function fakeCalendar(): { api: CalendarApi; inserted: Record<string, unknown>[] } {
  const inserted: Record<string, unknown>[] = [];
  const api: CalendarApi = {
    events: {
      list: vi.fn(async () => ({
        data: {
          items: [
            { summary: "Standup", start: { dateTime: "2026-08-01T09:00:00Z" }, end: { dateTime: "2026-08-01T09:15:00Z" } },
            { summary: null, start: { date: "2026-08-02" }, end: { date: "2026-08-03" } }
          ]
        }
      })),
      insert: vi.fn(async ({ requestBody }) => {
        inserted.push(requestBody);
        return { data: { htmlLink: "https://calendar.google.com/event?eid=abc" } };
      })
    }
  };
  return { api, inserted };
}

function fakeDocs(): { api: DocsApi; updates: Record<string, unknown>[] } {
  const updates: Record<string, unknown>[] = [];
  const api: DocsApi = {
    documents: {
      create: vi.fn(async () => ({ data: { documentId: "doc-123" } })),
      batchUpdate: vi.fn(async ({ requestBody }) => {
        updates.push(requestBody);
        return {};
      })
    }
  };
  return { api, updates };
}

describe("calendar adapter", () => {
  it("lists events without writing anything", async () => {
    const { api, inserted } = fakeCalendar();
    const text = await listEvents(api, {});

    expect(text).toContain("Standup");
    expect(text).toContain("(untitled)"); // an all-day event with no summary
    expect(inserted).toHaveLength(0);
  });

  it("reports honestly when the window is empty", async () => {
    const api: CalendarApi = {
      events: { list: vi.fn(async () => ({ data: { items: [] } })), insert: vi.fn() }
    };
    expect(await listEvents(api, {})).toMatch(/no events found/i);
  });

  it("creates an event and returns its link", async () => {
    const { api, inserted } = fakeCalendar();
    const text = await createEvent(api, {
      summary: "Review",
      start: "2026-08-01T15:00:00Z",
      end: "2026-08-01T15:30:00Z",
      attendees: "a@example.com, b@example.com"
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ summary: "Review" });
    expect(inserted[0].attendees).toEqual([{ email: "a@example.com" }, { email: "b@example.com" }]);
    expect(text).toContain("https://calendar.google.com/event");
  });

  it("omits attendees entirely when none are given", async () => {
    const { api, inserted } = fakeCalendar();
    await createEvent(api, { summary: "Solo", start: "s", end: "e" });
    expect(inserted[0]).not.toHaveProperty("attendees");
  });
});

describe("docs adapter", () => {
  it("creates a document, inserts the body, and returns a usable link", async () => {
    const { api, updates } = fakeDocs();
    const text = await createDoc(api, { title: "Competitive brief", body: "Findings" });

    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0])).toContain("Findings");
    expect(text).toContain(docUrl("doc-123"));
  });

  it("skips the body write when the body is empty", async () => {
    const { api, updates } = fakeDocs();
    await createDoc(api, { title: "Empty", body: "   " });
    expect(updates).toHaveLength(0);
  });

  it("fails loudly if Docs returns no document id, rather than reporting success", async () => {
    const api: DocsApi = {
      documents: { create: vi.fn(async () => ({ data: {} })), batchUpdate: vi.fn() }
    };
    await expect(createDoc(api, { title: "t", body: "b" })).rejects.toThrow(/document id/i);
  });

  it("appends to an existing document", async () => {
    const { api, updates } = fakeDocs();
    const text = await appendToDoc(api, { documentId: "doc-9", text: "more" });
    expect(JSON.stringify(updates[0])).toContain("more");
    expect(text).toContain(docUrl("doc-9"));
  });
});

describe("registration data keeps the isolation floor", () => {
  it("calendar and docs are registered and declare NO host environment", () => {
    for (const key of ["calendar", "docs"]) {
      const reg = CURATED_SERVER_REGISTRATIONS.find((r) => r.serverKey === key);
      expect(reg, `${key} must be registered`).toBeTruthy();
      // Their only secret is the brokered OAuth token, injected per call.
      expect(reg?.envAllowlist ?? []).toEqual([]);
      expect(reg?.credentialProvider).toBe("google");
      expect(reg?.tokenEnvVar).toBe("GOOGLE_ACCESS_TOKEN");
    }
  });

  it("they reuse the existing google broker provider — no new credential code", () => {
    const providers = new Set(
      CURATED_SERVER_REGISTRATIONS.map((r) => r.credentialProvider).filter(Boolean)
    );
    // gmail, calendar and docs all authenticate through one provider entry.
    expect(Array.from(providers)).toEqual(["google"]);
  });
});
