import { getSetReviewQueue } from "@/app/forge/lib/review";
import ReviewQueue from "./ReviewQueue";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = await params;
  const items = await getSetReviewQueue(setId);
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Review queue</h2>
      <ReviewQueue items={items} />
    </div>
  );
}
