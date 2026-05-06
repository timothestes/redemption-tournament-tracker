"use client";

import { Breadcrumb as FlowbiteBreadcrumb } from "flowbite-react";
import { HiHome } from "react-icons/hi";

interface BreadcrumbProps {
  items: {
    label: string;
    href?: string;
  }[];
}

const itemTheme = {
  base: "group flex items-center",
  chevron: "mx-1 h-4 w-4 text-muted-foreground group-first:hidden md:mx-2",
  href: {
    off: "flex items-center text-sm font-medium text-foreground",
    on: "flex items-center text-sm font-medium text-muted-foreground hover:text-primary",
  },
  icon: "mr-2 h-4 w-4",
};

const Breadcrumb: React.FC<BreadcrumbProps> = ({ items }) => {
  return (
    <FlowbiteBreadcrumb aria-label="Breadcrumb navigation">
      {items.map((item, index) => (
        <FlowbiteBreadcrumb.Item
          key={index}
          href={item.href}
          icon={index === 0 ? HiHome : undefined}
          theme={itemTheme}
        >
          {item.label}
        </FlowbiteBreadcrumb.Item>
      ))}
    </FlowbiteBreadcrumb>
  );
};

export default Breadcrumb;
