"use client";

import { useState, useEffect } from "react";
import { HiMenu, HiDocumentText, HiArrowSmRight, HiUserAdd, HiShieldCheck } from "react-icons/hi";
import { IoClose } from "react-icons/io5";
import { FaTrophy, FaBookOpen } from "react-icons/fa6";
import { PiPencilLineBold } from "react-icons/pi";
import { TbCardsFilled, TbSearch } from "react-icons/tb";
import Image from "next/image";
import Link from "next/link";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { Button } from "./ui/button";
import { ThemeSwitcher } from "./theme-switcher";
import { createClient } from "../utils/supabase/client";
import { signOutAction } from "../app/actions";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { NATIONALS_CONFIG } from "../app/config/nationals";

const TopNav: React.FC = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isResourcesOpen, setIsResourcesOpen] = useState(false);
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [logoSrc, setLogoSrc] = useState('/lor.png');
  const [user, setUser] = useState(null);
  const { isAdmin } = useIsAdmin();
  const pathname = usePathname();
  const supabase = createClient();

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const toggleResources = () => {
    setIsResourcesOpen(!isResourcesOpen);
  };

  useEffect(() => {
    setMounted(true);
    const currentTheme = theme === 'system' ? resolvedTheme : theme;
    setLogoSrc(currentTheme === 'light' ? '/lor-lightmode.png' : '/lor.png');

    const getUser = async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      setUser(currentUser);
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [theme, resolvedTheme]);

  const isActive = (path: string) => pathname?.startsWith(path);

  const navLinks = [
    { href: "/register", label: NATIONALS_CONFIG.adminOnly ? `${NATIONALS_CONFIG.displayName} (Admin Only)` : `${NATIONALS_CONFIG.displayName}`, icon: HiUserAdd, highlight: true },
    { href: "/tracker/tournaments", label: "Tournaments", icon: FaTrophy },
    { href: "/decklist/my-decks", label: "My Decks", icon: TbCardsFilled },
    { href: "/decklist/card-search", label: "Deck Builder", icon: TbSearch },
    { href: "/decklist/generate", label: "Deck Check PDF", icon: TbCardsFilled },
  ];

  const adminLinks = [
    { href: "/admin/registrations", label: "Admin", icon: HiShieldCheck },
  ];

  const tournamentResources = [
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/REG_PDF_10.0.0.pdf", label: "REG (Official Rulebook)", icon: PiPencilLineBold },
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/ORDIR_PDF_6.0.0.pdf", label: "ORDIR (Dictionary)", icon: FaBookOpen },
    { href: "https://landofredemption.com/wp-content/uploads/2024/10/Deck_Building_Rules_1.2.pdf", label: "Deck Building Rules", icon: TbCardsFilled },
  ];

  const paragonResources = [
    { href: "https://landofredemption.com/wp-content/uploads/2025/11/Paragon-Format-Paragons-v1.pdf", label: "Paragon Cards" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/11/Paragon-Format-Rules-v1.pdf", label: "Paragon Rules" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/11/Paragon-Format-Lost-Souls-Color-v1.pdf", label: "Lost Souls (Color)" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/11/Paragon-Format-Lost-Souls-BW-v1.pdf", label: "Lost Souls (B&W)" },
  ];

  const hostResources = [
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/Redemption_Host_Guide_2025.pdf", label: "Hosting Guide" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/05/Redemption-Tournament-Host-Application-2025-1.pdf", label: "Hosting Application" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/11/Redemption-Tournament-Host-Application-2025-08.pdf", label: "Hosting Application" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/host_sign_in_sheets.pdf", label: "Sign In Sheet" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/Type-1-Deck-Check-Sheet-1.pdf", label: "T1 Deck Check Sheet" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/Reserve-List-T1.pdf", label: "T1 Reserve List" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/T2-Deck-Check-Sheet.pdf", label: "T2 Deck Check Sheet" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/Reserve-List-Type-2.pdf", label: "T2 Reserve List" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/host_winners_list.pdf", label: "Winners Form" },
  ];

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-white dark:bg-gray-900 shadow-sm">
      <div className="max-w-full mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/tracker/tournaments" className="flex-shrink-0">
            <div className="cursor-pointer">
              {mounted && (
                <Image
                  src={logoSrc}
                  alt="Home Icon"
                  width={120}
                  height={32}
                  style={{ width: "auto", height: "auto", maxHeight: "32px" }}
                  priority
                />
              )}
            </div>
          </Link>

          {/* Desktop Navigation - Center */}
          <div className="hidden md:flex md:items-center md:space-x-1 flex-1 justify-center">
            {navLinks.slice(0, 1).map((link) => {
              const Icon = link.icon;
              const isHighlight = link.highlight;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                    ${isHighlight
                      ? 'border-2 border-green-500 text-green-600 hover:bg-green-50 dark:border-green-400 dark:text-green-400 dark:hover:bg-green-950'
                      : isActive(link.href)
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}

            {/* Admin Links - Only for admins (right after Nationals) */}
            {isAdmin && adminLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors
                    ${isActive(link.href)
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}

            {/* Rest of nav links */}
            {navLinks.slice(1).map((link) => {
              const Icon = link.icon;
              const isHighlight = link.highlight;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                    ${isHighlight
                      ? 'border-2 border-green-500 text-green-600 hover:bg-green-50 dark:border-green-400 dark:text-green-400 dark:hover:bg-green-950'
                      : isActive(link.href)
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}

            {/* Resources Dropdown */}
            <div className="relative">
              <button
                onClick={toggleResources}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                  ${isResourcesOpen
                    ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                  }`}
              >
                <HiDocumentText className="w-4 h-4" />
                Resources
                <svg
                  className={`w-4 h-4 transition-transform ${isResourcesOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Resources Dropdown Menu */}
              {isResourcesOpen && (
                <div className="absolute left-0 mt-2 w-72 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5">
                  <div className="py-2">
                    {/* Tournament Resources */}
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Tournament Resources
                    </div>
                    {tournamentResources.map((resource) => {
                      const Icon = resource.icon;
                      return (
                        <a
                          key={resource.href}
                          href={resource.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <Icon className="w-4 h-4" />
                          {resource.label}
                        </a>
                      );
                    })}

                    {/* Paragon Resources */}
                    <div className="px-4 py-2 mt-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-t border-gray-200 dark:border-gray-700">
                      Paragon Resources
                    </div>
                    {paragonResources.map((resource) => (
                      <a
                        key={resource.href}
                        href={resource.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {resource.label}
                      </a>
                    ))}

                    {/* Host Resources */}
                    <div className="px-4 py-2 mt-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-t border-gray-200 dark:border-gray-700">
                      Host Resources
                    </div>
                    {hostResources.map((resource) => (
                      <a
                        key={resource.href}
                        href={resource.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {resource.label}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Report a Bug */}
            <Link
              href="/tracker/bug"
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                ${isActive('/tracker/bug')
                  ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              <HiArrowSmRight className="w-4 h-4" />
              Report a Bug
            </Link>
          </div>

          {/* Auth Section - Right Side */}
          <div className="hidden md:flex md:items-center md:gap-3">
            <ThemeSwitcher />
            {user ? (
              <>
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {user.email}
                </span>
                <form
                  action={signOutAction}
                >
                  <Button type="submit" variant="outline" size="sm">
                    Sign out
                  </Button>
                </form>
              </>
            ) : (
              <>
                <Button asChild size="sm" variant="outline">
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <Button asChild size="sm" variant="default">
                  <Link href="/sign-up">Sign up</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            onClick={toggleMobileMenu}
            className="md:hidden p-2 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {isMobileMenuOpen ? <IoClose size={24} /> : <HiMenu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-gray-200 dark:border-gray-700">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {/* Nationals link */}
            {navLinks.slice(0, 1).map((link) => {
              const Icon = link.icon;
              const isHighlight = link.highlight;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium transition-colors
                    ${isHighlight
                      ? 'border-2 border-green-500 text-green-600 hover:bg-green-50 dark:border-green-400 dark:text-green-400 dark:hover:bg-green-950'
                      : isActive(link.href)
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                >
                  <Icon className="w-5 h-5" />
                  {link.label}
                </Link>
              );
            })}

            {/* Admin Links - Only for admins (right after Nationals) */}
            {isAdmin && adminLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium transition-colors
                    ${isActive(link.href)
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                >
                  <Icon className="w-5 h-5" />
                  {link.label}
                </Link>
              );
            })}

            {/* Rest of nav links */}
            {navLinks.slice(1).map((link) => {
              const Icon = link.icon;
              const isHighlight = link.highlight;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium transition-colors
                    ${isHighlight
                      ? 'border-2 border-green-500 text-green-600 hover:bg-green-50 dark:border-green-400 dark:text-green-400 dark:hover:bg-green-950'
                      : isActive(link.href)
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                >
                  <Icon className="w-5 h-5" />
                  {link.label}
                </Link>
              );
            })}

            {/* Mobile Resources Section */}
            <div className="pt-2">
              <button
                onClick={toggleResources}
                className="flex items-center justify-between w-full px-3 py-2 rounded-md text-base font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <div className="flex items-center gap-3">
                  <HiDocumentText className="w-5 h-5" />
                  Resources
                </div>
                <svg
                  className={`w-4 h-4 transition-transform ${isResourcesOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isResourcesOpen && (
                <div className="mt-2 ml-8 space-y-1">
                  <div className="px-3 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Tournament Resources
                  </div>
                  {tournamentResources.map((resource) => {
                    const Icon = resource.icon;
                    return (
                      <a
                        key={resource.href}
                        href={resource.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <Icon className="w-4 h-4" />
                        {resource.label}
                      </a>
                    );
                  })}

                  <div className="px-3 py-1 mt-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-t border-gray-200 dark:border-gray-700 pt-2">
                    Paragon Resources
                  </div>
                  {paragonResources.map((resource) => (
                    <a
                      key={resource.href}
                      href={resource.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-3 py-2 rounded-md text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      {resource.label}
                    </a>
                  ))}

                  <div className="px-3 py-1 mt-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-t border-gray-200 dark:border-gray-700 pt-2">
                    Host Resources
                  </div>
                  {hostResources.map((resource) => (
                    <a
                      key={resource.href}
                      href={resource.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-3 py-2 rounded-md text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      {resource.label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Report a Bug */}
            <Link
              href="/tracker/bug"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium transition-colors
                ${isActive('/tracker/bug')
                  ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
            >
              <HiArrowSmRight className="w-5 h-5" />
              Report a Bug
            </Link>

            {/* Mobile Auth Section */}
            <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
              <div className="flex items-center justify-between px-3">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Theme</span>
                <ThemeSwitcher />
              </div>
              {user ? (
                <>
                  <div className="px-3 text-sm text-gray-600 dark:text-gray-300">
                    {user.email}
                  </div>
                  <form
                    action={signOutAction}
                    className="px-3"
                  >
                    <Button type="submit" variant="outline" size="sm" className="w-full">
                      Sign out
                    </Button>
                  </form>
                </>
              ) : (
                <div className="px-3 space-y-2">
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <Link href="/sign-in">Sign in</Link>
                  </Button>
                  <Button asChild size="sm" variant="default" className="w-full">
                    <Link href="/sign-up">Sign up</Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default TopNav;
