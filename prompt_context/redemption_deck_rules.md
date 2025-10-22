# Redemption CCG Deck Building Rules

## Official Deck Construction Rules

### Deck Size Requirements

#### Minimum Deck Sizes by Format
- **Type 1**: 50-154 cards
- **Type 2**: 100-252 cards

### Lost Soul Requirements

The number of Lost Souls required in a deck is based on the **Main Deck size ONLY** (Reserve cards do NOT count toward this requirement).

#### Lost Soul Chart

| Deck Size | Required Lost Souls | Deck Size | Required Lost Souls | Deck Size | Required Lost Souls | Deck Size | Required Lost Souls |
|-----------|---------------------|-----------|---------------------|-----------|---------------------|-----------|---------------------|
| 50-56     | 7                   | 100-105   | 14                  | 155-161   | 22                  | 211-217   | 30                  |
| 57-63     | 8                   | 106-112   | 15                  | 162-168   | 23                  | 218-224   | 31                  |
| 64-70     | 9                   | 113-119   | 16                  | 169-175   | 24                  | 225-231   | 32                  |
| 71-77     | 10                  | 120-126   | 17                  | 176-182   | 25                  | 232-238   | 33                  |
| 78-84     | 11                  | 127-133   | 18                  | 183-189   | 26                  | 239-245   | 34                  |
| 85-91     | 12                  | 134-140   | 19                  | 190-196   | 27                  | 246-252   | 35                  |
| 92-98     | 13                  | 141-147   | 20                  | 197-203   | 28                  |           |                     |
| 99-105*   | 14                  | 148-154   | 21                  | 204-210   | 29                  |           |                     |



### Card Quantity Limits

We will not be enforcing card quality limits at this time.

#### Special Cases
- **Dominants**: 
  - Maximum 1 copy per deck of each unique Dominant
  - **Total Dominants cannot exceed the number of Lost Souls in your deck**

### Reserve Rules

- **Reserve size (T1)**: Up to 10 cards maximum
- **Reserve size (T2)**: Up to 15 cards maximum
- Dominants and lost souls cannot be in the reserve

### Validation Formula

To calculate the required number of Lost Souls for a given **Main Deck** size:

```javascript
function getRequiredLostSouls(mainDeckSize) {
  if (mainDeckSize < 50) return 0; // Invalid deck size
  if (mainDeckSize >= 50 && mainDeckSize <= 56) return 7;
  if (mainDeckSize >= 57 && mainDeckSize <= 63) return 8;
  if (mainDeckSize >= 64 && mainDeckSize <= 70) return 9;
  if (mainDeckSize >= 71 && mainDeckSize <= 77) return 10;
  if (mainDeckSize >= 78 && mainDeckSize <= 84) return 11;
  if (mainDeckSize >= 85 && mainDeckSize <= 91) return 12;
  if (mainDeckSize >= 92 && mainDeckSize <= 98) return 13;
  if (mainDeckSize >= 99 && mainDeckSize <= 105) return 14;
  if (mainDeckSize >= 106 && mainDeckSize <= 112) return 15;
  if (mainDeckSize >= 113 && mainDeckSize <= 119) return 16;
  if (mainDeckSize >= 120 && mainDeckSize <= 126) return 17;
  if (mainDeckSize >= 127 && mainDeckSize <= 133) return 18;
  if (mainDeckSize >= 134 && mainDeckSize <= 140) return 19;
  if (mainDeckSize >= 141 && mainDeckSize <= 147) return 20;
  if (mainDeckSize >= 148 && mainDeckSize <= 154) return 21;
  if (mainDeckSize >= 155 && mainDeckSize <= 161) return 22;
  if (mainDeckSize >= 162 && mainDeckSize <= 168) return 23;
  if (mainDeckSize >= 169 && mainDeckSize <= 175) return 24;
  if (mainDeckSize >= 176 && mainDeckSize <= 182) return 25;
  if (mainDeckSize >= 183 && mainDeckSize <= 189) return 26;
  if (mainDeckSize >= 190 && mainDeckSize <= 196) return 27;
  if (mainDeckSize >= 197 && mainDeckSize <= 203) return 28;
  if (mainDeckSize >= 204 && mainDeckSize <= 210) return 29;
  if (mainDeckSize >= 211 && mainDeckSize <= 217) return 30;
  if (mainDeckSize >= 218 && mainDeckSize <= 224) return 31;
  if (mainDeckSize >= 225 && mainDeckSize <= 231) return 32;
  if (mainDeckSize >= 232 && mainDeckSize <= 238) return 33;
  if (mainDeckSize >= 239 && mainDeckSize <= 245) return 34;
  if (mainDeckSize >= 246 && mainDeckSize <= 252) return 35;
  return Math.ceil((mainDeckSize - 50) / 7) + 7; // Extrapolate for larger decks
}
```

The pattern: **Every 7 cards adds 1 Lost Soul requirement**, starting at 7 Lost Souls for 50-56 cards.

**Example**: A 50-56 card Main Deck requires exactly 7 Lost Souls. If you have a 10-card Reserve, your total deck is 60-66 cards, but you still only need 7 Lost Souls (based on the 50-56 Main Deck size).
