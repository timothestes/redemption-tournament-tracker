import React from "react";

const Background: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return (
    <div
      className="min-h-screen w-full relative"
      style={{
        backgroundImage: "url('/login-splash.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        transformOrigin: "center",
      }}
    >
      <div className="absolute inset-0 bg-black bg-opacity-60"></div>
      <div className="relative z-10">{children}</div>
    </div>
  );
};

export default Background;
