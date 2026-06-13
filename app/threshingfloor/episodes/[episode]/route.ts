import { readFile } from "fs/promises";
import path from "path";
import { createClient } from "@/utils/supabase/server";
import { normalizeEpisode } from "../../episodes";
import { buildViewerHtml } from "../../viewerHtml";

type Ctx = { params: Promise<{ episode: string }> };

function notFound() {
  return new Response("Not Found", { status: 404 });
}

// Public, anonymous, noindex viewer for a PUBLISHED episode outline.
export async function GET(_request: Request, { params }: Ctx) {
  const { episode: raw } = await params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return notFound();
  }
  const episode = normalizeEpisode(decoded);
  if (!episode) return notFound();

  // Anon role; get_published_outline is SECURITY DEFINER and granted to anon.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_published_outline", { ep: episode });
  if (error || !data) return notFound();

  const filePath = path.join(process.cwd(), "app/threshingfloor/outline.html");
  const shell = await readFile(filePath, "utf-8");
  const html = buildViewerHtml(shell, episode, data as Record<string, unknown>);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}
