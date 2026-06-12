import { readFile } from "fs/promises";
import path from "path";
import { notFoundResponse, requireThreshingFloor } from "./api/auth";

export async function GET() {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();

  const filePath = path.join(process.cwd(), "app/threshingfloor/outline.html");
  const html = await readFile(filePath, "utf-8");

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store",
    },
  });
}
