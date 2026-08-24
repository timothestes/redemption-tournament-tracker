#!/usr/bin/env python3
"""Generate parity fixtures from the Python API. Run from the API repo root:
   cd /Users/timestes/projects/redemption-tournament-api && \
   PYTHONPATH=. python3 <tracker>/lib/decksheets/__tests__/fixtures/generate_fixtures.py
Reads only; never touches the Lackey-wired generators."""
import json, os, sys

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

from src.utilities.brigades import normalize_brigade_field

def load_jsonl():
    cards = []
    with open("assets/carddata/carddata.jsonl", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                cards.append(json.loads(line))
    return cards

def gen_brigades(cards):
    rows = []
    for c in cards:
        rows.append({
            "name": c["name"], "brigade": c.get("brigade", ""),
            "alignment": c.get("alignment", ""),
            "expected": normalize_brigade_field(c.get("brigade", ""), c.get("alignment", ""), c["name"]),
        })
    with open(os.path.join(OUT_DIR, "brigades.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)

def gen_counts():
    from src.utilities.decklist import Decklist
    out = {}
    deck_dir = os.path.join(OUT_DIR, "decks")
    for fname in sorted(os.listdir(deck_dir)):
        if not fname.endswith(".txt"):
            continue
        d = Decklist(os.path.join(deck_dir, fname), deck_type="type_2", bypass_assertions=True)
        out[fname] = {"m_count": d.calculate_m_count(), **d.calculate_aod_breakdown()}
    with open(os.path.join(OUT_DIR, "counts.json"), "w") as f:
        json.dump(out, f, indent=1)
    return out

if __name__ == "__main__":
    cards = load_jsonl()
    gen_brigades(cards)
    print(f"brigades.json: {len(cards)} rows")
    counts = gen_counts()
    print(f"counts.json: {len(counts)} decks")
    for fname, vals in counts.items():
        print(f"  {fname}: {vals}")
