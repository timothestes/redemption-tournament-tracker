import { listDeckProducts } from "./actions";
import DeckProductList from "./DeckProductList";

export const dynamic = "force-dynamic";

export default async function DecksPage() {
  const res = await listDeckProducts();
  if (res.success === false) {
    return (
      <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
        {res.error}
      </div>
    );
  }
  return <DeckProductList products={res.products} />;
}
