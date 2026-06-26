interface SectionTitleProps {
  title: string;
  sub?: string;
}

export function SectionTitle({ title, sub }: SectionTitleProps) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <h2 className="font-cinzel text-2xl text-foreground">{title}</h2>
      {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
    </div>
  );
}
