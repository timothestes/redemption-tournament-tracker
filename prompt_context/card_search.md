 # Card Search Page

 This page provides a dynamic, client-side search interface for the Redemption CCG card database with modern UX features.

 - **Data Loading & Parsing**: Fetches a raw, tab-delimited `carddata.txt` file from GitHub. Parses rows into structured `Card` objects with fields like name, type, strength, special ability, legality, etc.
- **Data Source & Images**: The URLs are defined in `constants.ts`:
  ```ts
  export const CARD_DATA_URL =
    "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt";
  export const CARD_IMAGE_BASE_URL =
    "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/setimages/general/";
  ```
 - **Flexible Filtering**:
   - Free-text searches across all card fields.
 - **Filter Shortcuts**: Clickable tabs to apply common filters (e.g., tournament legality, brigade color, etc.) instantly.
 - **Infinite Scrolling**: Renders cards in batches (50 at a time) and loads more as you scroll down.
 - **Responsive Gallery**: Displays card thumbnails in a grid. Each card has a zoom button to open a larger preview in a modal.
 - **Debug & Logging**: Clicking a card logs its full JSON representation and raw column mapping to the console for troubleshooting.

 Built with Next.js App Router (client components), Tailwind CSS for layout, Flowbite React for modal dialogs, and custom parsing logic from the original viewer.

## Data Columns
Each row in `carddata.txt` is a tab-delimited record with these columns:

| Field             | Description                       | Column Index |
|-------------------|-----------------------------------|--------------|
| Name              | Card title                       | 0            |
| Set               | Set code                         | 1            |
| ImageFile         | Image filename (no extension)    | 2            |
| OfficialSet       | Official set name (ignored)      | 3            |
| Type              | Card type (e.g. Promo, Dominant) | 4            |
| Brigade           | Brigade or affiliation           | 5            |
| Strength          | Strength value                   | 6            |
| Toughness         | Toughness value                  | 7            |
| Class             | Class or subtype (e.g. Warrior)  | 8            |
| Identifier        | Identifier text (e.g. tags)      | 9            |
| SpecialAbility    | Ability text                     | 10           |
| Rarity            | Rarity tier (Common, Rare, etc.) | 11           |
| Reference         | Bible reference                  | 12           |
| Sound             | Sound code (ignored)             | 13           |
| Alignment         | Alignment (Good, Evil)           | 14           |
| Legality          | Legality status (Rotation, etc.) | 15           |


## Example Card Object
Below is a sample `Card` object for:
```
Benaiah, Lion Slayer [2025 - 1st Place]\tPmo-P3\tBenaiah-Lion-Slayer-1st-place\tPromo\tHero\tPurple\t10\t12\tWarrior\t\tWhile alone, negate Enhancements (except good weapons) and other characters. Cannot be negated if equipped.\tRare\tII Samuel 23:20\t\tGood\tRotation
```
Parsed into JSON:
```json
{
  "dataLine": "Benaiah, Lion Slayer [2025 - 1st Place]\tPmo-P3\tBenaiah-Lion-Slayer-1st-place\tPromo\tHero\tPurple\t10\t12\tWarrior\t\tWhile alone, negate Enhancements (except good weapons) and other characters. Cannot be negated if equipped.\tRare\tII Samuel 23:20\t\tGood\tRotation",
  "name": "Benaiah, Lion Slayer [2025 - 1st Place]",
  "set": "Pmo-P3",
  "imgFile": "Benaiah-Lion-Slayer-1st-place",
  "type": "Promo",
  "brigade": "Hero",
  "strength": "Purple",
  "toughness": "10",
  "class": "Warrior",
  "identifier": "",
  "specialAbility": "While alone, negate Enhancements (except good weapons) and other characters. Cannot be negated if equipped.",
  "rarity": "Rare",
  "reference": "II Samuel 23:20",
  "alignment": "Good",
  "legality": "Rotation",
  "testament": ""
}
```
**Image URL**: The thumbnail and zoom images are served from:
```
${CARD_IMAGE_BASE_URL}Benaiah-Lion-Slayer-1st-place.jpg
```
 
## Additional Requirements
Imagine a cleaner, more interactive search experience where:
- **Clickable Facets**: Button or chip controls let you filter by brigade, card type, rarity, or other categories with a single click. Icons we can use for the filter buttons can be found in public/filter-icons
- **Dynamic Side Panel**: A collapsible sidebar displays active filters and provides sliders for numeric fields like strength/toughness.
- **Real-Time Feedback**: As you adjust filters, the grid updates instantly (with debounced or live search options).
- **Minimalist UI**: Icons, tooltips, and hover states replace verbose text, keeping the interface uncluttered and mobile-friendly.

This aims to make card discovery faster and more intuitive, bringing the power of advanced filtering into a polished, user-friendly design.
