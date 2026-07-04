import Link from "next/link";

export type Crumb = { label: string; href?: string };

export default function ForgeBreadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 text-xs text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden>›</span>}
            {it.href ? (
              <Link href={it.href} className="hover:text-foreground hover:underline">{it.label}</Link>
            ) : (
              <span aria-current="page" className="font-medium text-foreground">{it.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
