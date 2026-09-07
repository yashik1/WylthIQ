import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SignInLayout({ children }: LayoutProps<"/signin">) {
  return children;
}
