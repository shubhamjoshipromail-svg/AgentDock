import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { prisma } from "./lib/prisma";

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
              scope: "openid email profile"
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
  }
};
