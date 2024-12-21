"use client";

import { Sidebar } from "flowbite-react";
import { HiArrowSmRight, HiChartPie, HiUser, HiViewBoards } from "react-icons/hi";

const SideNav: React.FC = () => {
  return (
    <Sidebar aria-label="Default sidebar example" className="fixed h-full top-16 left-0">
      <Sidebar.Items>
        <Sidebar.ItemGroup>
          <Sidebar.Item href="/protected/tournaments" icon={HiChartPie}>
            Your Tournaments
          </Sidebar.Item>
          <Sidebar.Item href="/protected/tournaments/host" icon={HiViewBoards}>
            Host a Tournament
          </Sidebar.Item>
          <Sidebar.Item href="/protected/profile" icon={HiUser}>
            Profile
          </Sidebar.Item>
          <Sidebar.Item href="/protected/bug" icon={HiArrowSmRight}>
            Report a Bug
          </Sidebar.Item>
        </Sidebar.ItemGroup>
      </Sidebar.Items>
    </Sidebar>
  );
};

export default SideNav;
