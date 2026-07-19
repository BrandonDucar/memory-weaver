import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://memory-weaver.bd420chef.chatgpt.site"),
  title: {
    default: "Memory Weaver",
    template: "%s · Memory Weaver",
  },
  description: "A local-first source weaving workspace by DreamNet.",
  applicationName: "Memory Weaver",
  manifest: "/manifest.webmanifest",
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    title: "Memory Weaver",
    description: "Weave your sources into portable, verifiable context.",
    images: [{ url: "/og.png", width: 1728, height: 909, alt: "Memory Weaver by DreamNet" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Memory Weaver",
    description: "Weave your sources into portable, verifiable context.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#19221f",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
