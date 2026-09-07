import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ForgotPasswordLayout({ children }: LayoutProps<"/forgot-password">) {
  return children;
}
