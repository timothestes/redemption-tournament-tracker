import { EnvVarWarning } from "../components/env-var-warning";
import HeaderAuth from "../components/header-auth";
import { hasEnvVars } from "../utils/supabase/check-env-vars";
import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "next-themes";
import HomeIcon from "../components/home-icon";
import Background from "../components/ui/background";
import "./globals.css";
import Header from "../components/header";
import SideNav from "../components/side-nav";

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
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Background>
            <main className="min-h-screen flex">{children}</main>
          </Background>
        </ThemeProvider>
      </body>
    </html>
  );
}
