import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal Room Starter",
  description: "A clean-room starter for a creator intelligence workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
