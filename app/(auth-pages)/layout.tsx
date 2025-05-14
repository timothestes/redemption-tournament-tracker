import Header from "../../components/header";
import Image from "next/image";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-full min-h-screen flex flex-col bg-background">
      <Header />
      <div className="flex-1 w-full flex flex-col items-center justify-center relative">
        {/* Background image with overlay gradient for better visual effect */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50 z-[1] dark:opacity-100 opacity-70"></div>
          <Image
            src="/lor-login-splash.webp"
            alt="Login background"
            fill
            priority
            className="object-cover dark:opacity-100 opacity-90" 
            quality={90}
          />
          {/* Additional overlay for light mode to soften the contrast */}
          <div className="absolute inset-0 bg-white/20 dark:bg-transparent"></div>
        </div>
        
        {/* Content container with softer background for light mode */}
        <div className="z-10 bg-white/80 dark:bg-black/80 p-8 rounded-lg shadow-lg max-w-md w-full border border-gray-200 dark:border-zinc-800 backdrop-blur-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
