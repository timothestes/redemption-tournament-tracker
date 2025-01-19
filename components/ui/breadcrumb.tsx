"use client";

import { Breadcrumb as FlowbiteBreadcrumb } from "flowbite-react";
import { HiHome } from "react-icons/hi";

interface BreadcrumbProps {
  items: {
    label: string;
    href?: string;
  }[];
}

const Breadcrumb: React.FC<BreadcrumbProps> = ({ items }) => {
  return (
    <FlowbiteBreadcrumb aria-label="Breadcrumb navigation">
      {items.map((item, index) => (
        <FlowbiteBreadcrumb.Item
          key={index}
          href={item.href}
          icon={index === 0 ? HiHome : undefined}
        >
          {item.label}
        </FlowbiteBreadcrumb.Item>
      ))}
    </FlowbiteBreadcrumb>
  );
};

export default Breadcrumb;
