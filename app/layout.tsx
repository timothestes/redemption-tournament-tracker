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
            <main className="min-h-screen flex">
              <SideNav />
              <div className="flex-1 w-full flex flex-col gap-20 items-center">
                <Header />
                <div className="flex flex-col w-full">{children}</div>
                {/* Insert footer here! */}
                {/* <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs py-16"> */}
                {/* <p>Switch theme</p> */}
                {/* <ThemeSwitcher /> */}
                {/* </footer> */}
              </div>
            </main>
          </Background>
        </ThemeProvider>
      </body>
    </html>
  );
}
