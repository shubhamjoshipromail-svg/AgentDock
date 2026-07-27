"use client";

// The app is a single client tree. Without this, any render throw white-screens
// the entire product with no recovery path -- and on the demo path a blank panel
// is indistinguishable from "nothing happened".
//
// It shows the real error message rather than a generic apology: this is a
// governance tool, and hiding what went wrong is the same failure mode as
// inventing what went right.
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main style={{ padding: "3rem 1.5rem", maxWidth: 640, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>Something broke on this screen</h1>
          <p style={{ opacity: 0.8, marginBottom: "1rem" }}>
            Your runs and audit history are unaffected — this is a display failure, not a run failure.
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              padding: "0.75rem",
              border: "1px solid rgba(127,127,127,0.35)",
              borderRadius: 8,
              fontSize: "0.8rem",
              marginBottom: "1rem"
            }}
          >
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
          <button onClick={reset} style={{ padding: "0.5rem 0.9rem", borderRadius: 8, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
