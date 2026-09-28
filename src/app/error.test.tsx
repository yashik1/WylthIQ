import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ErrorBoundary from "./error";

/**
 * The screen a reader sees when a page fails.
 *
 * It is for readers, not operators: no diagnostics endpoint, and none of the
 * error's own text, which can name tables, queries or hosts.
 */
const render = (error: Error & { digest?: string }) =>
  renderToStaticMarkup(<ErrorBoundary error={error} reset={() => {}} />);

describe("the error screen", () => {
  const leaky = Object.assign(new Error('Failed query: select * from "broker_connections" postgres://user:pw@db'), {
    digest: "3743683023",
  });

  it("says the page is unavailable, and offers a way forward", () => {
    const html = render(leaky);
    expect(html).toContain("available right now");
    expect(html).toContain("Try again");
    expect(html).toContain("Back to the dashboard");
  });

  it("does not send readers to the health endpoint", () => {
    expect(render(leaky)).not.toContain("/api/health");
  });

  it("never shows the error's own message", () => {
    const html = render(leaky);
    expect(html).not.toContain("broker_connections");
    expect(html).not.toContain("postgres://");
    expect(render(new Error("TypeError in chart.tsx"))).not.toContain("chart.tsx");
  });

  it("keeps the short reference that ties it to the server log", () => {
    expect(render(leaky)).toContain("3743683023");
  });
});
