import { notFound } from "next/navigation";
import { requireForge } from "./lib/auth";
import TopNav from "../../components/top-nav";
import "./forge-fonts.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <div className="flex-1">{children}</div>
    </div>
  );
}
