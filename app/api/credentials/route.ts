import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../lib/auth-user";
import { listCredentialMetadata, storeProviderKey } from "../../../lib/execution/credentials";
import { parseJsonBody } from "../../../lib/validation/parse";
import { createCredentialSchema } from "../../../lib/validation/schemas";

// GET: metadata only (provider, last4, status). Never the key.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  const credentials = await listCredentialMetadata(user.id);
  return NextResponse.json({ credentials });
}

// POST: accept a key, encrypt server-side, return ONLY non-secret metadata.
// secrets: the key is never logged and never included in the response.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in to add a provider key." }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, createCredentialSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const metadata = await storeProviderKey(user.id, parsed.data.provider, parsed.data.key);
    return NextResponse.json({ credential: metadata }, { status: 201 });
  } catch (error) {
    // Never echo the key or the error detail (which could include input).
    const message = error instanceof Error && error.message.includes("CREDENTIAL_ENCRYPTION_KEY")
      ? "Server is not configured to store keys securely."
      : "Unable to store the provider key.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
