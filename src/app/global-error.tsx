"use client";

/**
 * The last resort: an error thrown in the root layout itself.
 *
 * `app/error.tsx` handles a page that fails, but it renders *inside* the
 * layout — so if the layout is what threw, it never appears and the visitor
 * gets a blank document. This replaces the whole document instead, which is
 * why it carries its own html and body tags.
 *
 * Deliberately styled inline and importing nothing. Anything it pulled in
 * could be the thing that just failed, and a fallback that can itself fail is
 * not a fallback. No detail from the error is shown: this fires on
 * infrastructure faults, and their messages tend to name internals.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f6fb",
          color: "#10111a",
          padding: 24,
          font: '16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <main style={{ maxWidth: "32rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 12px" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#5c5f70", margin: "0 0 24px" }}>
            The page could not be loaded. This is our fault rather than yours — trying
            again often works.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#3c4bd6",
              color: "#fff",
              border: 0,
              borderRadius: 8,
              padding: "10px 20px",
              font: "inherit",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
