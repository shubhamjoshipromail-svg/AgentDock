import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { prisma } from "./lib/prisma";
import { storeGoogleOAuthToken } from "./lib/execution/credentials";
import { recordProductEvent } from "./lib/analytics/product-events";

// Scopes for the first-party Google MCP servers. One consent covers every Google
// tool because they share the `google` credential-broker provider.
//
// NOTE: this list is a code constant, which is the one genuinely un-generic part
// of adding a Google tool — everything else (registration, discovery, grants,
// execution, audit) is data. Adding a scope forces every existing user to
// re-consent, so add them deliberately, not speculatively.
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  // Gmail: drafts + send
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  // Calendar: read and create events on the user's own calendars
  "https://www.googleapis.com/auth/calendar.events",
  // Docs: create and edit documents, limited to files this app creates
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file"
].join(" ");

if (!process.env.NEXTAUTH_URL && process.env.AUTH_URL) {
  process.env.NEXTAUTH_URL = process.env.AUTH_URL;
}

if (!process.env.NEXTAUTH_SECRET && process.env.AUTH_SECRET) {
  process.env.NEXTAUTH_SECRET = process.env.AUTH_SECRET;
}

const hasGoogleConfig = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const authSecret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],
  providers: hasGoogleConfig
    ? [
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID ?? "",
          clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          authorization: {
            params: {
              scope: GOOGLE_SCOPES,
              // Needed to receive a refresh token so the Gmail server can act
              // server-side after the access token expires.
              access_type: "offline",
              prompt: "consent"
            }
          }
        })
      ]
    : [],
  secret: authSecret,
  session: {
    strategy: "database"
  },
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }

      return session;
    }
  },
  events: {
    // Funnel: a brand-new user row was created (fires once, on first sign-in).
    async createUser({ user }) {
      if (user.id) await recordProductEvent(user.id, "signup");
    },
    // Capture the Google OAuth token on sign-in and store it ENCRYPTED, keyed to
    // the user. The token is never returned to the client or the agent; only the
    // run engine reads it (decrypted) to hand to the Gmail MCP server's env.
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !account.access_token || !user.id) return;
      await storeGoogleOAuthToken(user.id, {
        accessToken: account.access_token,
        refreshToken: account.refresh_token ?? null,
        expiresAt: account.expires_at ? account.expires_at * 1000 : null
      });
    }
  }
};
