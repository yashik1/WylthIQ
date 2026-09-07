import type { Metadata } from "next";

/**
 * Filter/sort query strings are useful for sharing, but they are variants of
 * the same screener page rather than separate documents. Keep one canonical
 * URL while leaving the filtered pages crawlable and useful to visitors.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/screen" },
};

export default function ScreenLayout({ children }: LayoutProps<"/screen">) {
  return children;
}
