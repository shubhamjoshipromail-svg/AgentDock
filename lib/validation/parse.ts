import { NextResponse } from "next/server";
import type { z } from "zod";

type ParseResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

export async function parseJsonBody<Schema extends z.ZodTypeAny>(
  request: Request,
  schema: Schema
): Promise<ParseResult<z.infer<Schema>>> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ message: "Invalid JSON body.", issues: [] }, { status: 400 })
    };
  }

  const result = schema.safeParse(raw);

  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Invalid request body.", issues: result.error.issues },
        { status: 400 }
      )
    };
  }

  return { ok: true, data: result.data };
}

export function parseQuery<Schema extends z.ZodTypeAny>(
  url: string,
  schema: Schema
): ParseResult<z.infer<Schema>> {
  const { searchParams } = new URL(url);
  const result = schema.safeParse(Object.fromEntries(searchParams.entries()));

  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Invalid query parameters.", issues: result.error.issues },
        { status: 400 }
      )
    };
  }

  return { ok: true, data: result.data };
}
