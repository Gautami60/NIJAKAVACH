import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NIJAKAVACH (निजकवच) — Personal Data Exposure Discovery & Removal",
  description: "Transparent, evidence-backed personal data exposure discovery and removal platform for Indian consumers, built on the DPDP Act 2023.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased selection:bg-orange-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
