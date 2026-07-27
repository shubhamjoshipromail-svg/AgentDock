// First-party Google Calendar tool logic, isolated from the MCP wiring so it can
// be unit tested with a mocked API (no real network, no real event created). The
// narrow CalendarApi interface is structurally satisfied by google.calendar("v3").

export type ListEventsInput = { timeMin?: string; timeMax?: string; maxResults?: number };
export type CreateEventInput = {
  summary: string;
  start: string;
  end: string;
  description?: string;
  attendees?: string;
};

type ApiEvent = {
  summary?: string | null;
  htmlLink?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
};

export interface CalendarApi {
  events: {
    list: (params: {
      calendarId: string;
      timeMin?: string;
      timeMax?: string;
      maxResults?: number;
      singleEvents?: boolean;
      orderBy?: string;
    }) => Promise<{ data?: { items?: ApiEvent[] } }>;
    insert: (params: {
      calendarId: string;
      requestBody: Record<string, unknown>;
    }) => Promise<{ data?: ApiEvent }>;
  };
}

function when(slot: ApiEvent["start"]): string {
  return slot?.dateTime ?? slot?.date ?? "unknown time";
}

// Read-only: lists events from the user's primary calendar. No writes.
export async function listEvents(calendar: CalendarApi, input: ListEventsInput): Promise<string> {
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: input.timeMin ?? new Date().toISOString(),
    timeMax: input.timeMax,
    maxResults: Math.min(Math.max(input.maxResults ?? 10, 1), 50),
    singleEvents: true,
    orderBy: "startTime"
  });

  const items = res.data?.items ?? [];
  if (items.length === 0) return "No events found in that window.";
  return items
    .map((e, i) => `${i + 1}. ${e.summary ?? "(untitled)"} — ${when(e.start)} to ${when(e.end)}`)
    .join("\n");
}

// External write: creates a real event on the user's calendar, and can invite
// other people. AgentDock gates this behind approval; the server itself just
// performs the write when called.
export async function createEvent(calendar: CalendarApi, input: CreateEventInput): Promise<string> {
  const attendees = (input.attendees ?? "")
    .split(/[,\s]+/)
    .map((a) => a.trim())
    .filter(Boolean)
    .map((email) => ({ email }));

  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start },
      end: { dateTime: input.end },
      ...(attendees.length ? { attendees } : {})
    }
  });

  const link = res.data?.htmlLink;
  const who = attendees.length ? `, inviting ${attendees.map((a) => a.email).join(", ")}` : "";
  return `Event created — "${input.summary}" from ${input.start} to ${input.end}${who}.${link ? ` Link: ${link}` : ""}`;
}
