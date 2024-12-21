"use client";

import SideNav from "../../components/side-nav";

export default function TournamentsLayout({ children }) {
  return (
    <div className="flex h-screen">
      <SideNav />
      <div className="flex-grow">{children}</div>
    </div>
  );
}