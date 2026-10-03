import type { Metadata } from "next";
import "./globals.css";
import "@xyflow/react/dist/style.css";
import "./novice.css";

export const metadata: Metadata = {
  title: "BusinessFlowLens",
  description: "Turn interviews into readable business, system, and data maps.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
