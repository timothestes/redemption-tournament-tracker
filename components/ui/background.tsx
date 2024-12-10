import React from "react";

const Background: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div
      className="min-h-screen w-full bg-cover bg-center"
      style={{ backgroundImage: "url('/login-splash.png')" }}
    >
      {children}
    </div>
  );
};

export default Background;
