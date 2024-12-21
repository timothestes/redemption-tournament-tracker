"use client";

import { useState } from "react";
import { Sidebar } from "flowbite-react";
import { HiArrowSmRight, HiDocumentText, HiMenu } from "react-icons/hi";
import { FaTrophy, FaPlus, FaBookOpen } from "react-icons/fa6";
import { PiPencilLineBold } from "react-icons/pi";
import { TbCardsFilled, TbArrowGuideFilled } from "react-icons/tb";
import { AiOutlineForm } from "react-icons/ai";


const SideNav: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      <button
        onClick={toggleSidebar}
        className="fixed top-16 left-0 z-20 p-3.5 bg-primary text-primary-foreground md:hidden rounded"
      >
        <HiMenu size={24} />
      </button>
      <Sidebar
        aria-label="sidebar"
        className={`fixed h-full top-16 left-0 bg-primary transform ${isOpen ? "translate-x-0" : "-translate-x-full"} transition-transform md:translate-x-0 rounded-full`}
      >
        <Sidebar.Items>
          <Sidebar.ItemGroup>
            <Sidebar.Item href="/tracker/tournaments" icon={FaTrophy}>
              Tournaments
            </Sidebar.Item>
            <Sidebar.ItemGroup>
              <Sidebar.Collapse label="Resources" icon={HiDocumentText} className="pl-2">
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2023/11/REG_PDF_9.0.0.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={PiPencilLineBold}
                  className="pl-4"
                >
                  REG (Official Rulebook)
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2023/11/ORDIR_PDF_5.0.0.pdf"
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
                  href="https://landofredemption.com/wp-content/uploads/2024/03/Redemption_Host_Guide_2024.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={TbArrowGuideFilled}
                  className="pl-4"
                >
                  Hosting Guide
                </Sidebar.Item>
                <Sidebar.Item
                  href="https://landofredemption.com/wp-content/uploads/2024/09/Redemption-Tournament-Host-Application-2024.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={AiOutlineForm}
                  className="pl-4"
                >
                  Hosting Application
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
      </Sidebar>
    </>
  );
};

export default SideNav;
