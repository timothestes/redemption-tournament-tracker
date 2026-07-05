import { redirect } from "next/navigation";

// The playtest games lobby now lives at /forge/play. This route is kept so old
// links, bookmarks, and the in-game "Back to lobby" path still resolve.
export default function ForgePlaytestGamesPage() {
  redirect("/forge/play");
}
