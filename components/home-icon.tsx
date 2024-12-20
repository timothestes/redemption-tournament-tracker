import React from "react";
import Image from "next/image";
import Link from "next/link";

const HomeIcon: React.FC = () => {
  return (
    <Link href="/protected/tournaments" passHref>
      <div className="cursor-pointer ml-auto">
        <Image
          src="/lor.png"
          alt="Home Icon"
          width={180} // Set the desired width
          height={40} // Set the desired height
        />
      </div>
    </Link>
  );
};

export default HomeIcon;
