import { Checkbox } from "../ui/checkbox";

export function TutorialStep({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="relative py-3">
      <div className="flex flex-col">
        <h3 className="text-lg font-medium text-gray-800 dark:text-gray-100 mb-2 text-center">
          {title}
        </h3>
        <div className="text-sm text-gray-600 dark:text-gray-300">
          {children}
        </div>
      </div>
    </li>
  );
}
