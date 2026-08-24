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

if __name__ == "__main__":
    cards = load_jsonl()
    gen_brigades(cards)
    print(f"brigades.json: {len(cards)} rows")
