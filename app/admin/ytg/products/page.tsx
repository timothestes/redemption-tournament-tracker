export const metadata = { title: "YTG Store — Products" };

// WS-0 skeleton. WS-1 (tag sync) replaces this file wholesale — nothing
// else in the shell needs to change when it does.
export default function ProductsPage() {
  return (
    <div className="rounded-lg bg-card px-6 py-16 text-center">
      <h2 className="text-lg font-semibold mb-1">Products</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Bulk tag sync is coming soon. Card data will be diffed against live
        store tags, with additions and per-tag removal opt-ins applied in
        batches.
      </p>
    </div>
  );
}
