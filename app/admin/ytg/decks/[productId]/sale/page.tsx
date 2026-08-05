import { notFound } from "next/navigation";
import { previewSale } from "../../saleActions";
import SaleFlow from "./SaleFlow";

export const dynamic = "force-dynamic";

export default async function RecordSalePage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const res = await previewSale(productId, 1);
  if (res.success === false) {
    if (res.error === "forbidden") notFound();
    return (
      <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
        {res.error}
      </div>
    );
  }
  return <SaleFlow initialPreview={res.preview} />;
}
