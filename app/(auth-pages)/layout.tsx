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
        {/* Full-page background image with increased opacity */}
        <Image
          src="/login-splash.png"
          alt="Login background"
          fill
          priority
          className="object-cover opacity-60 dark:opacity-70"
          quality={100}
        />
        
        {/* Content container with proper background for better contrast in both modes */}
        <div className="z-10 bg-white/90 dark:bg-black/80 p-8 rounded-lg shadow-lg max-w-md w-full border border-gray-200 dark:border-zinc-800">
          {children}
        </div>
      </div>
    </div>
  );
}
