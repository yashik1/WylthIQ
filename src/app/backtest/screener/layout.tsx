import type { Metadata } from "next";

/** Strategy/date parameters are run configurations, not separate canonical pages. */
export const metadata: Metadata = {
  alternates: { canonical: "/backtest/screener" },
};

export default function ScreenerBacktestLayout({ children }: LayoutProps<"/backtest/screener">) {
  return children;
}
