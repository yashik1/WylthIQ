import type { ReactNode } from "react";

export type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export type SearchPageProps = {
  searchParams: SearchParams;
};

export type StockPageProps = {
  params: Promise<{ symbol: string }>;
  searchParams: SearchParams;
};

export type LayoutPageProps = {
  children: ReactNode;
};
