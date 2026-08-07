import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Revenue OS",
  description: "A trustworthy operating cockpit for measurable revenue growth.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
