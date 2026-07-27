import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "./prisma";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/;

function requestHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function readIdempotencyKey(request: Request):
  | { ok: true; key: string }
  | { ok: false; response: NextResponse } {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY.test(key)) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "A valid Idempotency-Key header is required for this operation." },
        { status: 400 }
      )
    };
  }
  return { ok: true, key };
}

export async function runIdempotently(options: {
  request: Request;
  userId: string;
  scope: "flow_plan" | "flow_save" | "approval_resolve";
  input: unknown;
  work: () => Promise<NextResponse>;
}): Promise<NextResponse> {
  const parsedKey = readIdempotencyKey(options.request);
  if (!parsedKey.ok) return parsedKey.response;
  const hash = requestHash(options.input);

  let recordId: string;
  try {
    const created = await prisma.idempotencyRecord.create({
      data: {
        userId: options.userId,
        scope: options.scope,
        key: parsedKey.key,
        requestHash: hash
      },
      select: { id: true }
    });
    recordId = created.id;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: { userId_scope_key: { userId: options.userId, scope: options.scope, key: parsedKey.key } }
    });
    if (existing.requestHash !== hash) {
      return NextResponse.json(
        { message: "This Idempotency-Key was already used for a different request." },
        { status: 409 }
      );
    }
    if (existing.status === "completed" && existing.response != null && existing.httpStatus != null) {
      return NextResponse.json(existing.response, {
        status: existing.httpStatus,
        headers: { "Idempotency-Replayed": "true" }
      });
    }
    return NextResponse.json(
      { message: "This operation is already in progress." },
      { status: 409, headers: { "Retry-After": "1" } }
    );
  }

  try {
    const response = await options.work();
    if (response.status >= 500) {
      await prisma.idempotencyRecord.delete({ where: { id: recordId } });
      return response;
    }
    const body = await response.clone().json();
    await prisma.idempotencyRecord.update({
      where: { id: recordId },
      data: {
        status: "completed",
        response: body as Prisma.InputJsonValue,
        httpStatus: response.status,
        completedAt: new Date()
      }
    });
    return response;
  } catch (error) {
    await prisma.idempotencyRecord.deleteMany({ where: { id: recordId } });
    throw error;
  }
}
