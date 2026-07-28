import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KeeperHub dashboard",
  description: "Minimal KeeperHub agent demo dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
