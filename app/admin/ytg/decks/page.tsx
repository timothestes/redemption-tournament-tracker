import { listDeckProducts } from "./actions";
import { listSales } from "./saleActions";
import DeckProductList from "./DeckProductList";
import SalesHistory from "./SalesHistory";

export const dynamic = "force-dynamic";

export default async function DecksPage() {
  const [res, salesRes] = await Promise.all([listDeckProducts(), listSales()]);
  if (res.success === false) {
    return (
      <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
        {res.error}
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <DeckProductList products={res.products} />
      <SalesHistory
        sales={salesRes.success === false ? [] : salesRes.sales}
        writesEnabled={salesRes.success === false ? false : salesRes.writesEnabled}
        loadError={salesRes.success === false ? salesRes.error : ""}
      />
    </div>
  );
}
