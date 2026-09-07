import type { Metadata } from "next";

/** Comparison selections live in the query string, so keep /compare as the canonical document. */
export const metadata: Metadata = {
  alternates: { canonical: "/compare" },
};

export default function CompareLayout({ children }: LayoutProps<"/compare">) {
  return children;
}
