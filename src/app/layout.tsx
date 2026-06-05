import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Migräne-Tracker",
  description: "Persönliches Migräne-Tagebuch",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
