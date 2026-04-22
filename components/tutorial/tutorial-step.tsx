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
        <h3 className="text-lg font-medium text-foreground mb-2 text-center">
          {title}
        </h3>
        <div className="text-sm text-muted-foreground">
          {children}
        </div>
      </div>
    </li>
  );
}
