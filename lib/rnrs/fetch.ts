import { FORMATS, RNRS_PROXY, SEASONS, SEASON_SHEETS } from "./config";
import { parseSheetCsv } from "./parse";
import type { FormatKey, NormalizedData, PlayerFormatResult } from "./types";

/**
 * Fetch and parse every season × format sheet through the proxy, in parallel.
 * Runs server-side; results are cached for an hour (`revalidate: 3600`). A sheet
 * that fails to load degrades to an empty array rather than breaking the page.
 */
export async function fetchAllRnrsData(): Promise<NormalizedData> {
  const data: NormalizedData = {};

  await Promise.all(
    SEASONS.map(async (season) => {
      const formats: Partial<Record<FormatKey, PlayerFormatResult[]>> = {};
      await Promise.all(
        FORMATS.map(async ({ key }) => {
          const id = SEASON_SHEETS[season][key];
          try {
            const res = await fetch(
              `${RNRS_PROXY}/?sheet=${key}&season=${season}&id=${id}`,
              { next: { revalidate: 3600 } },
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            formats[key] = parseSheetCsv(await res.text());
          } catch {
            formats[key] = [];
          }
        }),
      );
      data[season] = formats;
    }),
  );

  return data;
}
