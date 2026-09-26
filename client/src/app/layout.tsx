import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { CrimeBoxProvider } from "@/context/CrimeBoxContext";
import { ToastProvider } from "@/components/ui/Toast";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Crime Evidence System",
  description: "Evidence Management Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} antialiased bg-background text-foreground font-sans`}
      >
        <ToastProvider>
          <AuthProvider>
            <CrimeBoxProvider>{children}</CrimeBoxProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}

