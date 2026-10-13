import type { Metadata } from "next";
import { Geist, Roboto_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Point of sale", // the app sets "<store name> · Point of sale" once it knows the store
  description: "A simple point-of-sale workspace for store teams.",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

// Figures (prices, amounts, quantities, stock, barcodes) use a monospace
// font so columns of numbers line up: Consolas on Windows, Roboto Mono
// elsewhere (see fontFamily.mono in tailwind.config.ts).
const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.className} ${robotoMono.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
