import { GeistSans } from "geist/font/sans";
import { Cinzel } from "next/font/google";
import { ThemeProvider } from "next-themes";
import Background from "../components/ui/background"; // Using the improved background
import "./globals.css";

const cinzel = Cinzel({ subsets: ["latin"], variable: "--font-cinzel" });

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata = {
  metadataBase: new URL(defaultUrl),
  title: "RedemptionCCG App",
  description: "The best way to experience Redemption online",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.className} ${cinzel.variable}`} suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          themes={["light", "dark", "jayden", "system"]}
        >
          <Background>
            <main className="min-h-screen flex flex-col">{children}</main>
          </Background>
        </ThemeProvider>
      </body>
    </html>
  );
}
