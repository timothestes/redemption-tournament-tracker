"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "flowbite-react";
import { HiArrowSmRight, HiDocumentText, HiMenu } from "react-icons/hi";
import { IoClose } from "react-icons/io5";
import { FaTrophy, FaBookOpen } from "react-icons/fa6";
import { PiPencilLineBold } from "react-icons/pi";
import { TbCardsFilled, TbArrowGuideFilled } from "react-icons/tb";
import { AiOutlineForm } from "react-icons/ai";
import Image from "next/image";
import Link from "next/link";
import { ThemeSwitcher } from "./theme-switcher";
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
        className={`max-md:fixed top-0 sticky left-0 w-64 h-screen shrink-0 bg-primary transform z-50 overflow-hidden ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        } transition-transform md:translate-x-0 shadow-lg rounded border-none flex flex-col`}
      >
        <div className="bg-primary">
          <button
            onClick={toggleSidebar}
            className="bg-primary p-1 text-primary-foreground md:hidden rounded"
          >
            <IoClose size={20} />
          </button>
        </div>
        <Link href="/tracker/tournaments" passHref>
          <div className="cursor-pointer">
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
        <hr className="border-t border-gray-200 my-2 mb-6" />
        <Sidebar.Items className="flex-grow">
          <Sidebar.ItemGroup>
            <Sidebar.Item href="/tracker/tournaments" icon={FaTrophy}>
              Tournaments
            </Sidebar.Item>
            <Sidebar.ItemGroup>
              <Sidebar.Item href="/decklist/generate" icon={TbCardsFilled}>
                Deck Check PDF
              </Sidebar.Item>
            </Sidebar.ItemGroup>
            <Sidebar.ItemGroup>
              <Sidebar.Collapse
                label="Resources"
                icon={HiDocumentText}
                className="pl-2"
              >
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/REG_PDF_10.0.0.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={PiPencilLineBold}
                  className="pl-4"
                >
                  REG (Official Rulebook)
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/ORDIR_PDF_6.0.0.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={FaBookOpen}
                  className="pl-4"
                >
                  ORDIR (Dictionary)
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2024/10/Deck_Building_Rules_1.2.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={TbCardsFilled}
                  className="pl-4"
                >
                  Deck Building Rules
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/Redemption_Host_Guide_2025.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={TbArrowGuideFilled}
                  className="pl-4"
                >
                  Hosting Guide
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/Redemption-Tournament-Host-Application-2025.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={AiOutlineForm}
                  className="pl-4"
                >
                  2025 Hosting Application
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/host_sign_in_sheets.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={AiOutlineForm}
                  className="pl-4"
                >
                  Sign In Sheet
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/host_winners_list.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={AiOutlineForm}
                  className="pl-4"
                >
                  Winners Form
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/Type-1-Deck-Check-Sheet-1.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={AiOutlineForm}
                  className="pl-4"
                >
                  T1 Deck Check Sheet
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/T2-Deck-Check-Sheet.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={AiOutlineForm}
                  className="pl-4"
                >
                  T2 Deck Check Sheet
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/Reserve-List-Type-2.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={AiOutlineForm}
                  className="pl-4"
                >
                  T2 Reserve List
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2025/03/Reserve-List-T1.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={AiOutlineForm}
                  className="pl-4"
                >
                  T1 Reserve List
                </Sidebar.Item>
              </Sidebar.Collapse>
            </Sidebar.ItemGroup>
            <Sidebar.ItemGroup>
              {/* <Sidebar.Item href="/tracker/profile" icon={HiUser}>
                Profile
              </Sidebar.Item> */}
              <Sidebar.Item href="/tracker/bug" icon={HiArrowSmRight}>
                Report a Bug
              </Sidebar.Item>
            </Sidebar.ItemGroup>
          </Sidebar.ItemGroup>
        </Sidebar.Items>
        
        {/* Theme toggle at bottom of sidebar */}
        <div className="p-4 border-t border-gray-200 mt-auto flex justify-center">
          <ThemeSwitcher />
        </div>
      </Sidebar>
    </>
  );
};

export default SideNav;
