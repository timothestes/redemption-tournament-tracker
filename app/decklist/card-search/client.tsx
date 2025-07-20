"use client";
import React, { useEffect, useState, useMemo } from "react";
import { CARD_DATA_URL, CARD_IMAGE_BASE_URL, OT_BOOKS, NT_BOOKS, GOSPEL_BOOKS } from "./constants";
import { Modal, Button } from "flowbite-react";
import clsx from "clsx";

// Card data structure
interface Card {
  dataLine: string;
  name: string;
  set: string;
  imgFile: string;
  type: string;
  brigade: string;
  strength: string;
  toughness: string;
  class: string;
  identifier: string;
  specialAbility: string;
  rarity: string;
  reference: string;
  alignment: string;
  legality: string;
  testament: string;
}

export default function CardSearchClient() {
  const [cards, setCards] = useState<Card[]>([]);
  const [query, setQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState({
    brigade: [] as string[],
    type: [] as string[],
    rarity: [] as string[],
  });
  const [visibleCount, setVisibleCount] = useState(50);
  const [modalCard, setModalCard] = useState<Card | null>(null);

  useEffect(() => {
    fetch(CARD_DATA_URL)
      .then((res) => res.text())
      .then((text) => {
        const lines = text.split("\n").filter((l) => l.trim());
        const parsed = lines.map((line) => {
          const cols = line.split("\t");
          return {
            dataLine: line,
            name: cols[0] || "",
            set: cols[1] || "",
            imgFile: cols[2] || "",
            type: cols[4] || "",
            brigade: cols[5] || "",
            strength: cols[6] || "",
            toughness: cols[7] || "",
            class: cols[8] || "",
            identifier: cols[9] || "",
            specialAbility: cols[10] || "",
            rarity: cols[11] || "",
            reference: cols[12] || "",
            alignment: cols[14] || "",
            legality: cols[15] || "",
            testament: "",
          } as Card;
        });
        setCards(parsed);
      })
      .catch(console.error);
  }, []);

  const brigades = useMemo(() => Array.from(new Set(cards.map((c) => c.brigade))).filter(Boolean), [cards]);
  const types = useMemo(() => Array.from(new Set(cards.map((c) => c.type))).filter(Boolean), [cards]);
  const rarities = useMemo(() => Array.from(new Set(cards.map((c) => c.rarity))).filter(Boolean), [cards]);

  const filtered = useMemo(
    () =>
      cards
        .filter((c) => Object.values(c).join(" ").toLowerCase().includes(query.toLowerCase()))
        .filter((c) => {
          if (selectedFilters.brigade.length && !selectedFilters.brigade.includes(c.brigade)) return false;
          if (selectedFilters.type.length && !selectedFilters.type.includes(c.type)) return false;
          if (selectedFilters.rarity.length && !selectedFilters.rarity.includes(c.rarity)) return false;
          return true;
        }),
    [cards, query, selectedFilters]
  );

  const visibleCards = filtered.slice(0, visibleCount);

  function toggleFilter(category: keyof typeof selectedFilters, value: string) {
    setSelectedFilters((prev) => {
      const arr = prev[category];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...prev, [category]: next };
    });
  }

  return (
    <div className="flex">
      <aside className="w-64 p-4 border-r overflow-auto">
        <input
          type="text"
          placeholder="Search cards..."
          className="w-full mb-4 p-2 border rounded"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <FilterSection label="Brigade" options={brigades} selected={selectedFilters.brigade} onToggle={(v) => toggleFilter("brigade", v)} />
        <FilterSection label="Type" options={types} selected={selectedFilters.type} onToggle={(v) => toggleFilter("type", v)} />
        <FilterSection label="Rarity" options={rarities} selected={selectedFilters.rarity} onToggle={(v) => toggleFilter("rarity", v)} />
        {visibleCount < filtered.length && (
          <Button onClick={() => setVisibleCount((vc) => vc + 50)} size="sm" className="w-full">
            Load More
          </Button>
        )}
      </aside>
      <main className="flex-1 p-4 overflow-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {visibleCards.map((c) => (
            <div key={c.dataLine} className="cursor-pointer" onClick={() => setModalCard(c)}>
              <img src={`${CARD_IMAGE_BASE_URL}${c.imgFile}.jpg`} alt={c.name} className="w-full h-auto rounded shadow" />
              <p className="text-sm mt-1 text-center truncate">{c.name}</p>
            </div>
          ))}
        </div>
      </main>
      {modalCard && (
        <Modal show onClose={() => setModalCard(null)}>
          <Modal.Header>{modalCard.name}</Modal.Header>
          <Modal.Body>
            <img src={`${CARD_IMAGE_BASE_URL}${modalCard.imgFile}.jpg`} alt={modalCard.name} className="w-full h-auto" />
            <Attribute label="Type" value={modalCard.type} />
            <Attribute label="Brigade" value={modalCard.brigade} />
            <Attribute label="Rarity" value={modalCard.rarity} />
            <Attribute label="Ability" value={modalCard.specialAbility} />
          </Modal.Body>
          <Modal.Footer>
            <Button onClick={() => setModalCard(null)}>Close</Button>
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}

// Helper sub-components
function FilterSection({ label, options, selected, onToggle }: { label: string; options: string[]; selected: string[]; onToggle: (v: string) => void; }) {
  return (
    <div className="mb-4">
      <h3 className="font-semibold">{label}</h3>
      <div className="flex flex-wrap gap-2 mt-2">
        {options.map((opt) => (
          <button key={opt} className={clsx("px-2 py-1 border rounded text-sm", selected.includes(opt) && "bg-blue-200")} onClick={() => onToggle(opt)}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function Attribute({ label, value }: { label: string; value: string }) {
  return <p className="text-sm"><strong>{label}:</strong> {value}</p>;
}
