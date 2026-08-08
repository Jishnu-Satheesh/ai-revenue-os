import type { Metadata } from "next";
import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { Manrope } from "next/font/google";
import { cn } from "@/lib/utils";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "AI Revenue OS",
  description: "A trustworthy operating cockpit for measurable revenue growth.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("font-sans", manrope.variable)}>
      <body>
        <QueryProvider>
          {children}
          {/* Sonner is the project's mutation acknowledgement surface; it must be
              mounted once at the root for any feature toast to appear. */}
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
