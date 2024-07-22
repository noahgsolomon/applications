import { Theme } from "frosted-ui";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { LayoutProps } from "@/lib/types";
import Header from "./header";
import "frosted-ui/styles.css";
import "./globals.css";
import { ThemeProvider } from "./providers";
import { TRPCReactProvider } from "@/trpc/react";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Whop Applications",
  description: "Assisted tool to help filter applications.",
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.variable}>
        <TRPCReactProvider>
          <ThemeProvider>
            <Theme>
              <Header />
              {children}
            </Theme>
          </ThemeProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
