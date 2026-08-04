import { notFound } from "next/navigation";
import { getParsedContents } from "../actions";
import ContentsWizard from "./ContentsWizard";

export const dynamic = "force-dynamic";

export default async function DeckWizardPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const res = await getParsedContents(productId);
  if (res.success === false) {
    if (res.error === "not_found") notFound();
    return (
      <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
        {res.error}
      </div>
    );
  }
  return <ContentsWizard product={res.product} initialLines={res.lines} linked={res.linked} />;
}
