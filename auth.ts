import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { prisma } from "./lib/prisma";
import { storeGoogleOAuthToken } from "./lib/execution/credentials";
import { recordProductEvent } from "./lib/analytics/product-events";

// Gmail scopes for the first-party Gmail MCP server: compose (drafts) + send.
const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send"
].join(" ");

if (!process.env.NEXTAUTH_URL && process.env.AUTH_URL) {
  process.env.NEXTAUTH_URL = process.env.AUTH_URL;
}

if (!process.env.NEXTAUTH_SECRET && process.env.AUTH_SECRET) {
  process.env.NEXTAUTH_SECRET = process.env.AUTH_SECRET;
}

const hasGoogleConfig = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],
  providers: hasGoogleConfig
    ? [
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID ?? "",
          clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          authorization: {
            params: {
              scope: GMAIL_SCOPES,
              // Needed to receive a refresh token so the Gmail server can act
              // server-side after the access token expires.
              access_type: "offline",
              prompt: "consent"
            }
          }
        })
      ]
    : [],
  secret: process.env.AUTH_SECRET,
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
