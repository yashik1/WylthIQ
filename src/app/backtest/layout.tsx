import type { Metadata } from "next";

/** Backtest parameters describe a run, not a separate evergreen document. */
export const metadata: Metadata = {
  alternates: { canonical: "/backtest" },
};

export default function BacktestLayout({ children }: LayoutProps<"/backtest">) {
  return children;
}
