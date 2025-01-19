import React from "react";
import Image from "next/image";
import Link from "next/link";

const HomeIcon: React.FC = () => {
  return (
    <Link href="/" passHref>
      <div className="cursor-pointer ml-auto">
        <Image
          src="/lor.png"
          alt="Home Icon"
          width={100}
          height={22}
          style={{ width: 'auto', height: 'auto' }}
          priority
        />
      </div>
    </Link>
  );
};

export default HomeIcon;
