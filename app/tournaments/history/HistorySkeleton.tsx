"use client";

export default function HistorySkeleton() {
  return (
    <div className="max-w-[1200px] mx-auto px-5 py-6">
      {/* Header bar */}
      <div className="h-10 w-full rounded bg-muted animate-pulse mb-6" />
      {/* Card placeholders */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  );
}
