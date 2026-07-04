import { zipSync, strToU8 } from "fflate";

// Smallest valid JPEG (1×1 white) — renders with naturalWidth 1.
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

export const FIXTURE_SET = "TST";
export const FIXTURE_CARDS = ["Test Hero Alpha", "Test Demon Beta", "Test Relic Gamma"];

const HEADER =
  "Name\tSet\tImageFile\tOfficialSet\tType\tBrigade\tStrength\tToughness\tClass\tIdentifier\tSpecialAbility\tRarity\tReference\tSound\tAlignment\tLegality";

const ROWS = [
  "Test Hero Alpha\tTST\tTest-Hero-Alpha\tTest Set\tHero\tSilver\t9\t9\tWarrior\t-\tTest ability alpha.\t-\tGenesis 1:1\t-\tGood\tRotation",
  "Test Demon Beta\tTST\tTest-Demon-Beta\tTest Set\tEvil Character\tOrange\t7\t7\t-\tDemon\tTest ability beta.\t-\tJob 1:1\t-\tEvil\tRotation",
  "Test Relic Gamma\tTST\tTest-Relic-Gamma\tTest Set\tArtifact\t-\t-\t-\t-\t-\tTest ability gamma.\t-\t-\t-\tNeutral\tRotation",
  "Other Card\tZZZ\tOther-Card\tOther Set\tHero\tBlue\t1\t1\t-\t-\tOther ability.\t-\t-\t-\tGood\tRotation",
];

export function buildFixtureZip(): Buffer {
  const jpeg = new Uint8Array(Buffer.from(TINY_JPEG_BASE64, "base64"));
  const files: Record<string, Uint8Array> = {
    "Test Plugin V1/sets/carddata.txt": strToU8([HEADER, ...ROWS].join("\n")),
    "Test Plugin V1/sets/setimages/general/Test-Hero-Alpha.jpg": jpeg,
    "Test Plugin V1/sets/setimages/general/Test-Demon-Beta.jpg": jpeg,
    // Test Relic Gamma deliberately has NO image (exercises the imageless path)
    "Test Plugin V1/sets/setimages/general/Other-Card.jpg": jpeg,
    "Test Plugin V1/packs/garbage.jpg": jpeg,
    "Test Plugin V1/version.txt": strToU8("v1"),
  };
  const zipped = zipSync(files, { level: 0 });
  return Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength);
}
