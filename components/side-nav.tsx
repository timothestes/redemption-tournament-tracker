import React from "react";

const SideNav: React.FC = () => {
  return (
    <nav className="fixed top-0 left-0 h-full w-64 bg-gray-800 text-white p-4 shadow-lg">
      <ul>
        <li className="mb-2">
          <a href="#" className="hover:underline">
            Tournaments
          </a>
        </li>
      </ul>
    </nav>
  );
};

export default SideNav;
