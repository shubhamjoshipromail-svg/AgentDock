import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
