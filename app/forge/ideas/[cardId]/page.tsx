import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LegacyIdeaStudioRedirect({ params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  redirect(`/forge/cards/${cardId}`);
}
