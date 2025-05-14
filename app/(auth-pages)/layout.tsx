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
        {/* Background image positioned below the header and centered */}
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
          <Image
            src="/lor-login-splash.webp"
            alt="Login background"
            width={1400}
            height={900}
            priority
            className="object-contain mt-16 scale-110" // More margin-top and scaling for better visibility
            quality={100}
          />
        </div>
        
        {/* Content container with proper background for better contrast in both modes */}
        <div className="z-10 bg-white/90 dark:bg-black/80 p-8 rounded-lg shadow-lg max-w-md w-full border border-gray-200 dark:border-zinc-800">
          {children}
        </div>
      </div>
    </div>
  );
}
