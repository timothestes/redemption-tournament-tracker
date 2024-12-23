import { EnvVarWarning } from "../components/env-var-warning";
import HeaderAuth from "../components/header-auth";
import { hasEnvVars } from "../utils/supabase/check-env-vars";
import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "next-themes";
import HomeIcon from "../components/home-icon";
import Background from "../components/ui/background";
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
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Background>
            <main className="min-h-screen flex flex-col items-center">
              <div className="flex-1 w-full flex flex-col gap-20 items-center">
                <nav className="w-full flex justify-center border-b border-b-foreground/10 h-17">
                  <div className="w-full max-w-1xl flex justify-between items-center p-3 px-5 text-sm">
                    <div className="flex gap-5 items-center font-semibold">
                      <div className="flex items-center gap-2">
                        <HomeIcon />
                      </div>
                    </div>
                    {
                      // @ts-ignore
                      !hasEnvVars ? <EnvVarWarning /> : <HeaderAuth />
                    }
                  </div>
                </nav>
                <div className="flex flex-col gap-20 max-w-5xl p-5">
                  {children}
                </div>
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

