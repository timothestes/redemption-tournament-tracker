interface EmptyStateProps {
  icon: string;
  title: string;
}

export function EmptyState({ icon, title }: EmptyStateProps) {
  return (
    <div className="py-16 text-center text-muted-foreground">
      <div className="text-4xl mb-3">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
    </div>
  );
}
