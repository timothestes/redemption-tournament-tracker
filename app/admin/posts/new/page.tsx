import { notFound } from "next/navigation";
import TopNav from "@/components/top-nav";
import { getPosterContext } from "../lib/auth";
import PostEditor from "../components/PostEditor";

export const metadata = { title: "New post - RedemptionCCG App" };
export const dynamic = "force-dynamic";

export default async function NewPostPage() {
  const ctx = await getPosterContext();
  if (!ctx) notFound();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <PostEditor initial={null} />
    </div>
  );
}
