"use client";

import { useState, useEffect } from "react";
import type { IconType } from "react-icons";
import { HiMenu, HiDocumentText, HiArrowSmRight, HiUserAdd, HiShieldCheck, HiGlobeAlt, HiSparkles, HiCalendar, HiCollection } from "react-icons/hi";
import { GiCrossedSwords } from "react-icons/gi";
import { IoClose } from "react-icons/io5";
import { FaTrophy, FaBookOpen } from "react-icons/fa6";
import { PiPencilLineBold } from "react-icons/pi";
import { TbCardsFilled, TbSearch } from "react-icons/tb";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "./ui/button";
import { ThemeSwitcher } from "./theme-switcher";
import { createClient } from "../utils/supabase/client";
import { getUserSafe } from "../utils/supabase/getUserSafe";
import { signOutAction } from "../app/actions";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { NATIONALS_CONFIG } from "../app/config/nationals";

// @supabase/ssr's createBrowserClient is already a singleton in the browser,
// but binding the result to a module-level const keeps the JS reference stable
// across renders. Otherwise [supabase]-keyed effects re-fire every render and
// cause repeated getUser() round-trips, which feeds the refresh-token storm.
const supabase = createClient();

const TopNav: React.FC = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isResourcesOpen, setIsResourcesOpen] = useState(false);
  const [isDecksOpen, setIsDecksOpen] = useState(false);
  const [isTournamentsOpen, setIsTournamentsOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const { isAdmin, permissions, loading: adminLoading } = useIsAdmin();
  const pathname = usePathname();

  // Nav is "ready" when both auth and admin checks have resolved
  const navReady = !authLoading && !adminLoading;

  const [isAdminOpen, setIsAdminOpen] = useState(false);

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
    setIsDecksOpen(false);
    setIsResourcesOpen(false);
    setIsAdminOpen(false);
    setIsTournamentsOpen(false);
  };

  const toggleMobileMenu = () => {
    if (isMobileMenuOpen) {
      closeMobileMenu();
    } else {
      setIsMobileMenuOpen(true);
    }
  };

  const closeAllDropdowns = () => {
    setIsResourcesOpen(false);
    setIsDecksOpen(false);
    setIsAdminOpen(false);
    setIsTournamentsOpen(false);
  };

  const toggleResources = () => {
    const next = !isResourcesOpen;
    closeAllDropdowns();
    setIsResourcesOpen(next);
  };

  const toggleDecks = () => {
    const next = !isDecksOpen;
    closeAllDropdowns();
    setIsDecksOpen(next);
  };

  const toggleAdmin = () => {
    const next = !isAdminOpen;
    closeAllDropdowns();
    setIsAdminOpen(next);
  };

  const toggleTournaments = () => {
    const next = !isTournamentsOpen;
    closeAllDropdowns();
    setIsTournamentsOpen(next);
  };


  // Auth effect — runs once on mount, listens for session changes
  useEffect(() => {
    const getUser = async () => {
      const currentUser = await getUserSafe(supabase);
      setUser(currentUser);
      setAuthLoading(false);
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = () => {
      closeAllDropdowns();
    };
    if (isDecksOpen || isResourcesOpen || isAdminOpen || isTournamentsOpen) {
      // Use a slight delay so the toggle click doesn't immediately re-close
      const timer = setTimeout(() => {
        document.addEventListener('click', handleClickOutside, { once: true });
      }, 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [isDecksOpen, isResourcesOpen, isAdminOpen, isTournamentsOpen]);

  const isActive = (path: string) => pathname?.startsWith(path);

  const PLAY_ALLOWED_EMAILS = ['baboonytim@gmail.com'];
  const canSeePlay = !!(user as any)?.email &&
    PLAY_ALLOWED_EMAILS.includes(((user as any).email as string).toLowerCase());

  type NavLink = { href: string; label: string; icon: IconType; highlight?: boolean; authRequired?: boolean; isNew?: boolean };

  const navLinks: NavLink[] = [
    { href: "/register", label: NATIONALS_CONFIG.adminOnly ? `${NATIONALS_CONFIG.displayName} (Admin Only)` : `${NATIONALS_CONFIG.displayName}`, icon: HiUserAdd, highlight: true },
    { href: "/play", label: "Play", icon: GiCrossedSwords },
    { href: "/decklist/card-search?new=true", label: "Deck Builder", icon: TbSearch },
    { href: "/spoilers", label: "Spoilers", icon: HiSparkles },
  ];

  const tournamentLinks: NavLink[] = [
    { href: "/tournaments", label: "Upcoming Events", icon: HiCalendar },
    { href: "/tracker/tournaments", label: "My Tournaments", icon: FaTrophy, authRequired: true },
  ];

  const deckLinks: NavLink[] = [
    { href: "/decklist/community", label: "Community Decks", icon: HiGlobeAlt, isNew: true },
    { href: "/decklist/my-decks", label: "My Decks", icon: TbCardsFilled, authRequired: true },
    { href: "/decklist/generate", label: "Deck Check PDF", icon: TbCardsFilled },
  ];

  const tournamentResources = [
    { href: "https://landofredemption.com/wp-content/uploads/2026/03/REG_PDF_11.0.0.pdf", label: "REG (Official Rulebook)", icon: PiPencilLineBold },
    { href: "https://landofredemption.com/wp-content/uploads/2026/03/ORDIR_PDF_7.0.0.pdf", label: "ORDIR (Dictionary)", icon: FaBookOpen },
    { href: "https://landofredemption.com/wp-content/uploads/2026/03/Deck_Building_Rules_1.3.pdf", label: "Deck Building Rules", icon: TbCardsFilled },
  ];

  const paragonResources = [
    { href: "https://landofredemption.com/wp-content/uploads/2025/11/Paragon-Format-Paragons-v1.pdf", label: "Paragon Cards" },
    { href: "https://landofredemption.com/wp-content/uploads/2026/03/Redemption-Paragon-Format-Rules-v1-1.pdf", label: "Paragon Rules" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/11/Paragon-Format-Lost-Souls-Color-v1.pdf", label: "Lost Souls (Color)" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/11/Paragon-Format-Lost-Souls-BW-v1.pdf", label: "Lost Souls (B&W)" },
  ];

  const hostResources = [
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/Redemption_Host_Guide_2025.pdf", label: "Hosting Guide" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/05/Redemption-Tournament-Host-Application-2025-1.pdf", label: "Hosting Application" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/11/Redemption-Tournament-Host-Application-2025-08.pdf", label: "Hosting Application" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/host_sign_in_sheets.pdf", label: "Sign In Sheet" },
    { href: "https://landofredemption.com/wp-content/uploads/2026/02/t1_deck_check.pdf", label: "T1 Deck Check Sheet" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/Reserve-List-T1.pdf", label: "T1 Reserve List" },
    { href: "https://landofredemption.com/wp-content/uploads/2026/02/t2_deck_check.pdf", label: "T2 Deck Check Sheet" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/Reserve-List-Type-2.pdf", label: "T2 Reserve List" },
    { href: "https://landofredemption.com/wp-content/uploads/2025/03/host_winners_list.pdf", label: "Winners Form" },
  ];

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background shadow-sm">
      <div className="max-w-full mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/decklist/community" className="flex-shrink-0">
            <div className="cursor-pointer" style={{ width: 120, height: 32 }}>
              <Image
                src="/lightmode_redemptionccgapp.webp"
                alt="RedemptionCCG App Logo"
                width={120}
                height={32}
                style={{ width: "auto", height: "auto", maxHeight: "32px" }}
                className="dark:hidden [.jayden_&]:hidden"
                priority
              />
              <Image
                src="/darkmode_redemptionccgapp.webp"
                alt="RedemptionCCG App Logo"
                width={120}
                height={32}
                style={{ width: "auto", height: "auto", maxHeight: "32px" }}
                className="hidden dark:block [.jayden_&]:block"
                priority
              />
            </div>
          </Link>

          {/* Desktop Navigation - Center */}
          <div className="hidden lg:flex lg:items-center lg:space-x-1 flex-1 justify-center">
            {navLinks.slice(0, 1).map((link) => {
              const Icon = link.icon;
              const isHighlight = link.highlight;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                    ${isHighlight
                      ? 'border-2 border-primary text-primary hover:bg-primary/10'
                      : isActive(link.href)
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}

            {/* Admin Dropdown - Only for admins */}
            {isAdmin && (
              <div className="relative">
                <button
                  onClick={toggleAdmin}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors
                    ${isAdminOpen || isActive('/admin')
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                >
                  <HiShieldCheck className="w-4 h-4" />
                  Admin
                  <svg
                    className={`w-4 h-4 transition-transform ${isAdminOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isAdminOpen && (
                  <div className="absolute left-0 mt-2 w-56 rounded-md shadow-lg bg-card ring-1 ring-black ring-opacity-5">
                    <div className="py-2">
                      {permissions.includes('manage_registrations') && (
                        <Link
                          href="/admin/registrations"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <HiUserAdd className="w-4 h-4" />
                          Registrations
                        </Link>
                      )}
                      {permissions.includes('manage_tags') && (
                        <Link
                          href="/admin/tags"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <TbCardsFilled className="w-4 h-4" />
                          Manage Tags
                        </Link>
                      )}
                      {permissions.includes('manage_spoilers') && (
                        <Link
                          href="/admin/spoilers"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <HiSparkles className="w-4 h-4" />
                          Manage Spoilers
                        </Link>
                      )}
                      {permissions.includes('manage_cards') && (
                        <Link
                          href="/admin/cards"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <HiCollection className="w-4 h-4" />
                          Manage Cards
                        </Link>
                      )}
                      {permissions.includes('manage_rulings') && (
                        <Link
                          href="/admin/rulings"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <HiDocumentText className="w-4 h-4" />
                          Manage Rulings
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Play link - after Admin (gated by allowlist) */}
            {canSeePlay && (
              <Link
                href="/play"
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                  ${isActive('/play')
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
              >
                <GiCrossedSwords className="w-4 h-4" />
                Play
              </Link>
            )}

            {/* Tournaments Dropdown */}
            <div className="relative">
              <button
                onClick={toggleTournaments}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                  ${isTournamentsOpen || isActive('/tournaments') || isActive('/tracker/tournaments')
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
              >
                <FaTrophy className="w-4 h-4" />
                Tournaments
                <svg
                  className={`w-4 h-4 transition-transform ${isTournamentsOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isTournamentsOpen && (
                <div className="absolute left-0 mt-2 w-56 rounded-md shadow-lg bg-card ring-1 ring-black ring-opacity-5">
                  <div className="py-2">
                    {tournamentLinks.map((link) => {
                      if (link.authRequired && !user) return null;
                      const Icon = link.icon;
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setIsTournamentsOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <Icon className="w-4 h-4" />
                          {link.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Rest of nav links */}
            {navLinks.slice(2).map((link) => {
              if (link.authRequired && !user) return null;
              const Icon = link.icon;
              const isHighlight = link.highlight;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                    ${isHighlight
                      ? 'border-2 border-primary text-primary hover:bg-primary/10'
                      : isActive(link.href)
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}

            {/* Decks Dropdown */}
            <div className="relative">
              <button
                onClick={toggleDecks}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                  ${isDecksOpen || isActive('/decklist')
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
              >
                <TbCardsFilled className="w-4 h-4" />
                Decks
                <svg
                  className={`w-4 h-4 transition-transform ${isDecksOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isDecksOpen && (
                <div className="absolute left-0 mt-2 w-56 rounded-md shadow-lg bg-card ring-1 ring-black ring-opacity-5">
                  <div className="py-2">
                    {deckLinks.map((link) => {
                      const Icon = link.icon;
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setIsDecksOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <Icon className="w-4 h-4" />
                          {link.label}
                          {link.isNew && (
                            <span className="ml-auto px-1.5 py-0.5 bg-primary/15 text-primary text-[10px] font-bold rounded uppercase">
                              New
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Resources Dropdown */}
            <div className="relative">
              <button
                onClick={toggleResources}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                  ${isResourcesOpen
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
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
                <div className="absolute left-0 mt-2 w-72 rounded-md shadow-lg bg-card ring-1 ring-black ring-opacity-5">
                  <div className="py-2">
                    {/* Tournament Resources */}
                    <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
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
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <Icon className="w-4 h-4" />
                          {resource.label}
                        </a>
                      );
                    })}

                    {/* Card Rulings */}
                    <Link
                      href="/rulings"
                      onClick={() => setIsResourcesOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                    >
                      <FaBookOpen className="w-4 h-4" />
                      Card Rulings
                    </Link>

                    {/* Paragon Resources */}
                    <div className="px-4 py-2 mt-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t border-border">
                      Paragon Resources
                    </div>
                    {paragonResources.map((resource) => (
                      <a
                        key={resource.href}
                        href={resource.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-4 py-2 text-sm text-foreground hover:bg-muted"
                      >
                        {resource.label}
                      </a>
                    ))}

                    {/* Host Resources */}
                    <div className="px-4 py-2 mt-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t border-border">
                      Host Resources
                    </div>
                    {hostResources.map((resource) => (
                      <a
                        key={resource.href}
                        href={resource.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-4 py-2 text-sm text-foreground hover:bg-muted"
                      >
                        {resource.label}
                      </a>
                    ))}

                    {/* Report a Bug */}
                    <div className="border-t border-border mt-2 pt-2">
                      <Link
                        href="/tracker/bug"
                        onClick={() => setIsResourcesOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <HiArrowSmRight className="w-4 h-4" />
                        Report a Bug
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Auth Section - Right Side */}
          <div className="hidden lg:flex lg:items-center lg:gap-3">
            <ThemeSwitcher />
            {!navReady ? (
              <div className="flex items-center gap-2">
                <div className="h-8 w-16 rounded-md bg-muted animate-pulse" />
                <div className="h-8 w-16 rounded-md bg-muted animate-pulse" />
              </div>
            ) : user ? (
              <>
                <span className="text-sm text-muted-foreground">
                  {user.email}
                </span>
                <form action={signOutAction}>
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
            className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            {isMobileMenuOpen ? <IoClose size={24} /> : <HiMenu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation */}
      {isMobileMenuOpen && (
        <div className="lg:hidden border-t border-border max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {/* Play + Nationals links */}
            {navLinks.slice(0, 2)
              .filter((link) => link.href !== '/play' || canSeePlay)
              .map((link) => {
              if (link.authRequired && !user) return null;
              const Icon = link.icon;
              const isHighlight = link.highlight;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={closeMobileMenu}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium transition-colors
                    ${isHighlight
                      ? 'border-2 border-primary text-primary hover:bg-primary/10'
                      : isActive(link.href)
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                    }`}
                >
                  <Icon className="w-5 h-5" />
                  {link.label}
                </Link>
              );
            })}

            {/* Admin Dropdown - Only for admins */}
            {isAdmin && (
              <div className="pt-2">
                <button
                  onClick={toggleAdmin}
                  className="flex items-center justify-between w-full px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-muted"
                >
                  <div className="flex items-center gap-3">
                    <HiShieldCheck className="w-5 h-5" />
                    Admin
                  </div>
                  <svg
                    className={`w-4 h-4 transition-transform ${isAdminOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isAdminOpen && (
                  <div className="mt-2 ml-8 space-y-1">
                    {permissions.includes('manage_registrations') && (
                      <Link
                        href="/admin/registrations"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <HiUserAdd className="w-4 h-4" />
                        Registrations
                      </Link>
                    )}
                    {permissions.includes('manage_tags') && (
                      <Link
                        href="/admin/tags"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <TbCardsFilled className="w-4 h-4" />
                        Manage Tags
                      </Link>
                    )}
                    {permissions.includes('manage_spoilers') && (
                      <Link
                        href="/admin/spoilers"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <HiSparkles className="w-4 h-4" />
                        Manage Spoilers
                      </Link>
                    )}
                    {permissions.includes('manage_cards') && (
                      <Link
                        href="/admin/cards"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <HiCollection className="w-4 h-4" />
                        Manage Cards
                      </Link>
                    )}
                    {permissions.includes('manage_rulings') && (
                      <Link
                        href="/admin/rulings"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <HiDocumentText className="w-4 h-4" />
                        Manage Rulings
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Mobile Tournaments Section */}
            <div className="pt-2">
              <button
                onClick={toggleTournaments}
                className="flex items-center justify-between w-full px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-muted"
              >
                <div className="flex items-center gap-3">
                  <FaTrophy className="w-5 h-5" />
                  Tournaments
                </div>
                <svg
                  className={`w-4 h-4 transition-transform ${isTournamentsOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isTournamentsOpen && (
                <div className="mt-2 ml-8 space-y-1">
                  {tournamentLinks.map((link) => {
                    if (link.authRequired && !user) return null;
                    const Icon = link.icon;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <Icon className="w-4 h-4" />
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Rest of nav links */}
            {navLinks.slice(2).map((link) => {
              if (link.authRequired && !user) return null;
              const Icon = link.icon;
              const isHighlight = link.highlight;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={closeMobileMenu}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium transition-colors
                    ${isHighlight
                      ? 'border-2 border-primary text-primary hover:bg-primary/10'
                      : isActive(link.href)
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                    }`}
                >
                  <Icon className="w-5 h-5" />
                  {link.label}
                </Link>
              );
            })}

            {/* Mobile Decks Section */}
            <div className="pt-2">
              <button
                onClick={toggleDecks}
                className="flex items-center justify-between w-full px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-muted"
              >
                <div className="flex items-center gap-3">
                  <TbCardsFilled className="w-5 h-5" />
                  Decks
                </div>
                <svg
                  className={`w-4 h-4 transition-transform ${isDecksOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isDecksOpen && (
                <div className="mt-2 ml-8 space-y-1">
                  {deckLinks.map((link) => {
                    const Icon = link.icon;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <Icon className="w-4 h-4" />
                        {link.label}
                        {link.isNew && (
                          <span className="ml-auto px-1.5 py-0.5 bg-primary/15 text-primary text-[10px] font-bold rounded uppercase">
                            New
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Mobile Resources Section */}
            <div className="pt-2">
              <button
                onClick={toggleResources}
                className="flex items-center justify-between w-full px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-muted"
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
                  <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
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
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <Icon className="w-4 h-4" />
                        {resource.label}
                      </a>
                    );
                  })}

                  {/* Card Rulings */}
                  <Link
                    href="/rulings"
                    onClick={closeMobileMenu}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                  >
                    <FaBookOpen className="w-4 h-4" />
                    Card Rulings
                  </Link>

                  <div className="px-3 py-1 mt-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t border-border pt-2">
                    Paragon Resources
                  </div>
                  {paragonResources.map((resource) => (
                    <a
                      key={resource.href}
                      href={resource.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                    >
                      {resource.label}
                    </a>
                  ))}

                  <div className="px-3 py-1 mt-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t border-border pt-2">
                    Host Resources
                  </div>
                  {hostResources.map((resource) => (
                    <a
                      key={resource.href}
                      href={resource.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                    >
                      {resource.label}
                    </a>
                  ))}

                  {/* Report a Bug */}
                  <div className="border-t border-border mt-2 pt-2">
                    <Link
                      href="/tracker/bug"
                      onClick={closeMobileMenu}
                      className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                    >
                      <HiArrowSmRight className="w-4 h-4" />
                      Report a Bug
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Mobile Auth Section */}
            <div className="pt-4 mt-4 border-t border-border space-y-3">
              <div className="flex items-center justify-between px-3">
                <span className="text-sm font-medium text-muted-foreground">Theme</span>
                <ThemeSwitcher />
              </div>
              {user ? (
                <>
                  <div className="px-3 text-sm text-muted-foreground">
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
