import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Inter } from "next/font/google";
import "../index.css";
import "../mobile.css";
import { AuthProvider } from "@/lib/app-auth-sdk";
import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter({
  variable: "--font-inter",
  display: "swap",
  subsets: ["latin"],
});


export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content' };

export const metadata: Metadata = {
  title: "Prabhupada World Academy",
  description: "Track your Sadhana and Services",
  icons: {
    icon: "/favicon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonces are minted per request in proxy.ts. A static shell would ship
  // scripts that do not match that nonce.
  await connection();
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
