"use client";

import Link from "next/link";
import { HiChevronRight } from "react-icons/hi";

interface BreadcrumbProps {
  items: {
    label: string;
    href?: string;
  }[];
}

const Breadcrumb: React.FC<BreadcrumbProps> = ({ items }) => {
  return (
    <nav className="flex" aria-label="Breadcrumb">
      <ol className="inline-flex items-center space-x-1 md:space-x-3">
        {items.map((item, index) => (
          <li key={index} className="inline-flex items-center">
            {index > 0 && (
              <HiChevronRight className="w-4 h-4 text-gray-400 mx-1" />
            )}
            {item.href ? (
              <Link
                href={item.href}
                className="inline-flex items-center text-sm font-medium text-gray-700 hover:text-blue-600 dark:text-gray-400 dark:hover:text-white"
              >
                {item.label}
              </Link>
            ) : (
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
};

export default Breadcrumb;
