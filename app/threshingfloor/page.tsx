import { notFound } from "next/navigation";
import TopNav from "../../components/top-nav";
import { requireThreshingFloor } from "./api/auth";

export const metadata = {
  title: "The Threshing Floor",
  robots: { index: false, follow: false },
};

export default async function ThreshingFloorPage() {
  const auth = await requireThreshingFloor();
  if (!auth) notFound();

  return (
    <div className="flex h-dvh flex-col">
      <TopNav />
      <iframe
        src="/threshingfloor/outline"
        title="The Threshing Floor — Episode Outline"
        className="w-full flex-1 border-0"
      />
    </div>
  );
}
