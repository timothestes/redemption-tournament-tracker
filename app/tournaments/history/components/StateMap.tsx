"use client";

import { useEffect, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import { stateAbbr, STATE_FIPS } from "@/lib/nationals/format";
import { CITY_COORDS } from "@/lib/nationals/cityCoords";

// Module-scope cache so repeated mounts share a single fetch.
let _topoPromise: Promise<Topology> | null = null;
function getTopoData(): Promise<Topology> {
  if (!_topoPromise) {
    _topoPromise = fetch("/data/us-states-10m.json")
      .then((r) => {
        if (!r.ok) throw new Error(`atlas fetch failed: ${r.status}`);
        return r.json() as Promise<Topology>;
      })
      .catch((e) => {
        _topoPromise = null; // allow retry on next mount
        throw e;
      });
  }
  return _topoPromise;
}

const W = 160;
const H = 112;

interface StateMapProps {
  location: string;
  className?: string;
}

export default function StateMap({ location, className = "w-40 h-28 text-primary" }: StateMapProps) {
  const [svgData, setSvgData] = useState<{
    pathD: string;
    pin: { cx: number; cy: number } | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function build() {
      try {
        const abbr = stateAbbr(location);
        if (!abbr) return;

        const fips = STATE_FIPS[abbr];
        if (!fips) return;

        const topo = await getTopoData();

        // topojson-client types require the object key to be on the topology.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const col = feature(topo, (topo as any).objects.states);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stateFeature = (col as any).features.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (f: any) => f.id === fips
        );
        if (!stateFeature) return;

        const proj = geoMercator().fitSize([W, H], stateFeature);
        const pathGen = geoPath().projection(proj);
        const pathD = pathGen(stateFeature);
        if (!pathD) return;

        let pin: { cx: number; cy: number } | null = null;
        const coords = CITY_COORDS[location];
        if (coords) {
          const [lat, lng] = coords;
          const pt = proj([lng, lat]);
          if (pt && pt[0] >= 0 && pt[0] <= W && pt[1] >= 0 && pt[1] <= H) {
            pin = { cx: pt[0], cy: pt[1] };
          }
        }

        if (!cancelled) setSvgData({ pathD, pin });
      } catch {
        // Fail-soft: leave svgData null, render nothing.
      }
    }

    build();
    return () => {
      cancelled = true;
    };
  }, [location]);

  if (!svgData) return <div className={className} aria-hidden />;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      aria-hidden
    >
      <path
        d={svgData.pathD}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        opacity={0.65}
      />
      {svgData.pin && (
        <circle
          cx={svgData.pin.cx.toFixed(1)}
          cy={svgData.pin.cy.toFixed(1)}
          r="2.8"
          fill="currentColor"
          opacity={0.9}
        />
      )}
    </svg>
  );
}
