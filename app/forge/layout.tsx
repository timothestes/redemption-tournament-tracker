import { notFound } from "next/navigation";
import { requireForge } from "./lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  return <div className="min-h-screen">{children}</div>;
}
