import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "next-themes";
import Background from "../components/ui/background";
import { ThemeSwitcher } from "../components/theme-switcher";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Land of Redemption Tournament Tracker",
  description: "A new way to host Redemption Tournaments",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={GeistSans.className} suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Background>
            <main className="min-h-screen flex flex-col">{children}</main>
          </Background>
        </ThemeProvider>
      </body>
    </html>
  );
}
