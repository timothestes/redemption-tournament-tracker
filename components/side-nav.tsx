import React from "react";

const SideNav: React.FC = () => {
  return (
    <nav className="w-45 h-full bg-gray-800 text-white flex flex-col p-5 fixed left-0 top-16">
      <div className="mb-4">
        <h2 className="text-lg font-semibold mb-2">Dashboard</h2>
        <ul className="space-y-2">
          <li>
            <a href="/protected/tournaments" className="block p-2 rounded hover:bg-gray-700">
              Tournaments
            </a>
          </li>
        </ul>
      </div>
      <div className="border-b border-gray-700 my-4"></div>

      <div className="mb-4">
        <h2 className="text-lg font-semibold mb-2">Settings</h2>
        <ul className="space-y-2">
          <li>
            <a href="/protected/profile" className="block p-2 rounded hover:bg-gray-700">
              Profile
            </a>
          </li>
          <li>
            <a href="/protected/preferences" className="block p-2 rounded hover:bg-gray-700">
              Preferences
            </a>
          </li>
        </ul>
      </div>
      <div className="border-b border-gray-700 my-4"></div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Help</h2>
        <ul className="space-y-2">
          <li>
            <a href="/protected/bugs" className="block p-2 rounded hover:bg-gray-700">
              Report a bug
            </a>
          </li>
        </ul>
      </div>
    </nav>
  );
};

export default SideNav;
