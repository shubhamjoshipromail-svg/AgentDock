import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./tokens.css";
import "./globals.css";

// One modern grotesk for the whole UI (display + body) and one mono for
// identities/machine truth. Geist ships inside the npm package — self-hosted,
// no build-time font fetch. tokens.css maps --font-display/--font-body/
// --font-mono onto these variables.

export const metadata: Metadata = {
  title: "AgentDock",
  description: "The control plane for AI agents"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
