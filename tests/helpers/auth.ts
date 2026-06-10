import type { User } from "@prisma/client";
import { vi } from "vitest";

// Holds the user returned by the mocked lib/auth-user getCurrentUser.
// Tests call setCurrentUser after creating a user row; null simulates signed-out.
let currentUser: User | null = null;

export function setCurrentUser(user: User | null) {
  currentUser = user;
}

export function mockAuthUserModule() {
  return {
    getCurrentUser: vi.fn(async () => currentUser)
  };
}
