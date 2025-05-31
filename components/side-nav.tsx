"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "flowbite-react";
import { HiArrowSmRight, HiDocumentText, HiMenu } from "react-icons/hi";
import { IoClose } from "react-icons/io5";
import { FaTrophy, FaBookOpen } from "react-icons/fa6";
import { PiPencilLineBold } from "react-icons/pi";
import { TbCardsFilled } from "react-icons/tb";
import Image from "next/image";
import Link from "next/link";
import { useTheme } from "next-themes";

const SideNav: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [logoSrc, setLogoSrc] = useState('/lor.png');

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    setMounted(true);
    const currentTheme = theme === 'system' ? resolvedTheme : theme;
    setLogoSrc(currentTheme === 'light' ? '/lor-lightmode.png' : '/lor.png');
  }, [theme, resolvedTheme]);

  return (
    <>
      <button
        onClick={toggleSidebar}
        className="max-md:absolute top-[14px] left-3 z-20 p-2 bg-primary text-primary-foreground md:hidden rounded"
      >
        <HiMenu size={20} />
      </button>
      <Sidebar
        aria-label="sidebar"
        className={`max-md:fixed top-0 sticky left-0 w-64 h-screen shrink-0 transform z-50 overflow-hidden ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        } transition-transform md:translate-x-0 shadow-lg rounded border-none flex flex-col
        bg-gradient-to-b from-white to-gray-100 dark:from-gray-900 dark:to-gray-800
        `}
      >
        <div className="bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
          <button
            onClick={toggleSidebar}
            className="p-1 text-primary-foreground md:hidden rounded"
          >
            <IoClose size={20} />
          </button>
        </div>
        <Link href="/tracker/tournaments" passHref>
          <div className="cursor-pointer px-3 py-2">
            {mounted && (
              <Image
                src={logoSrc}
                alt="Home Icon"
                width={180}
                height={40}
                style={{ width: "auto", height: "auto" }}
                priority
              />
            )}
          </div>
        </Link>
        <div className="px-4">
          <hr className="border-t border-gray-200 dark:border-gray-700 my-2 mb-6 opacity-60" />
        </div>
        <Sidebar.Items className="flex-grow">
          <Sidebar.ItemGroup className="space-y-1">
            <Sidebar.Item 
              href="/tracker/tournaments" 
              icon={FaTrophy}
              className="hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
            >
              Tournaments
            </Sidebar.Item>
            <Sidebar.ItemGroup className="space-y-1">
              <Sidebar.Item 
                href="/decklist/generate" 
                icon={TbCardsFilled}
                className="hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
              >
                Deck Check PDF
              </Sidebar.Item>
            </Sidebar.ItemGroup>
            <Sidebar.ItemGroup className="space-y-1">
              <Sidebar.Collapse
                label="Resources"
                icon={HiDocumentText}
                className="pl-2 hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200 font-medium
                          [&[data-active='true']]:border-l-4 [&[data-active='true']]:border-gray-300 [&[data-active='true']]:dark:border-gray-600"
              >
                {/* Tournament Resources Heading */}
                <div className="pl-4 pt-2 pb-1 text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">TOURNAMENT RESOURCES</div>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/REG_PDF_10.0.0.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={PiPencilLineBold}
                  className="pl-4 hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
                >
                  REG (Official Rulebook)
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/ORDIR_PDF_6.0.0.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={FaBookOpen}
                  className="pl-4 hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
                >
                  ORDIR (Dictionary)
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2024/10/Deck_Building_Rules_1.2.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={TbCardsFilled}
                  className="pl-4 hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
                >
                  Deck Building Rules
                </Sidebar.Item>
                
                {/* Host Resources Heading */}
                <div className="pl-4 pt-2 pb-1 text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">HOST RESOURCES</div>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/Redemption_Host_Guide_2025.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pl-4 hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
                >
                  Hosting Guide
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/05/Redemption-Tournament-Host-Application-2025-1.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pl-4 hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
                >
                  Hosting Application
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/host_sign_in_sheets.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pl-4 hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
                >
                  Sign In Sheet
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/Type-1-Deck-Check-Sheet-1.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pl-4 hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
                >
                  T1 Deck Check Sheet
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/Reserve-List-T1.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pl-4 hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
                >
                  T1 Reserve List
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/T2-Deck-Check-Sheet.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pl-4 hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
                >
                  T2 Deck Check Sheet
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/Reserve-List-Type-2.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pl-4 hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
                >
                  T2 Reserve List
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/host_winners_list.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pl-4 hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
                >
                  Winners Form
                </Sidebar.Item>
              </Sidebar.Collapse>
            </Sidebar.ItemGroup>
            <Sidebar.ItemGroup className="space-y-1">
              <Sidebar.Item 
                href="/tracker/bug" 
                icon={HiArrowSmRight}
                className="hover:bg-gray-100/70 dark:hover:bg-gray-700/70 transition-colors duration-200"
              >
                Report a Bug
              </Sidebar.Item>
            </Sidebar.ItemGroup>
          </Sidebar.ItemGroup>
        </Sidebar.Items>
      </Sidebar>
    </>
  );
};

export default SideNav;
