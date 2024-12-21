"use client";

import { useState } from "react";
import { Sidebar } from "flowbite-react";
import { HiArrowSmRight, HiChartPie, HiUser, HiViewBoards, HiMenu } from "react-icons/hi";

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
            <Sidebar.Item href="/protected/tournaments" icon={HiChartPie}>
              Your Tournaments
            </Sidebar.Item>
            <Sidebar.Item href="/protected/tournaments/host" icon={HiViewBoards}>
              Host a Tournament
            </Sidebar.Item>
            <Sidebar.ItemGroup>
              <Sidebar.Item href="/protected/profile" icon={HiUser}>
                Profile
              </Sidebar.Item>
              <Sidebar.Item href="/protected/bug" icon={HiArrowSmRight}>
                Report a Bug
              </Sidebar.Item>
            </Sidebar.ItemGroup>
            <Sidebar.Collapse label="More Options">
              <Sidebar.Item href="#">
                Placeholder 1
              </Sidebar.Item>
              <Sidebar.Item href="#">
                Placeholder 2
              </Sidebar.Item>
              <Sidebar.Item href="#">
                Placeholder 3
              </Sidebar.Item>
            </Sidebar.Collapse>
          </Sidebar.ItemGroup>
        </Sidebar.Items>
      </Sidebar>
    </>
  );
};

export default SideNav;
