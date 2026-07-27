// First-party Google Docs tool logic, isolated from the MCP wiring so it can be
// unit tested with a mocked API (no real network, no real document created). The
// narrow DocsApi interface is structurally satisfied by google.docs("v1").

export type CreateDocInput = { title: string; body: string };
export type AppendToDocInput = { documentId: string; text: string };

export interface DocsApi {
  documents: {
    create: (params: { requestBody: { title: string } }) => Promise<{ data?: { documentId?: string | null } }>;
    batchUpdate: (params: {
      documentId: string;
      requestBody: { requests: Record<string, unknown>[] };
    }) => Promise<unknown>;
  };
}

export function docUrl(documentId: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}

// External write: creates a real document in the user's Drive and fills it with
// the supplied text. AgentDock gates this behind approval; the server itself just
// performs the write when called.
export async function createDoc(docs: DocsApi, input: CreateDocInput): Promise<string> {
  const created = await docs.documents.create({ requestBody: { title: input.title } });
  const documentId = created.data?.documentId;
  if (!documentId) throw new Error("Google Docs did not return a document id.");

  if (input.body.trim().length > 0) {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [{ insertText: { location: { index: 1 }, text: input.body } }]
      }
    });
  }

  return `Document created — "${input.title}". Link: ${docUrl(documentId)}`;
}

// External write: appends to an existing document the user already owns.
export async function appendToDoc(docs: DocsApi, input: AppendToDocInput): Promise<string> {
  await docs.documents.batchUpdate({
    documentId: input.documentId,
    requestBody: {
      requests: [{ insertText: { endOfSegmentLocation: {}, text: input.text } }]
    }
  });
  return `Appended to document. Link: ${docUrl(input.documentId)}`;
}
