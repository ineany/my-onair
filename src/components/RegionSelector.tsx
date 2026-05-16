"use client";

import { useState, useRef, useEffect } from "react";

interface RegionGroup {
  label: string;
  regions: string[];
}

const regionGroups: RegionGroup[] = [
  { label: "수도권", regions: ["서울", "경기", "인천"] },
  { label: "영남", regions: ["부산", "울산", "대구", "창원"] },
  { label: "호남", regions: ["광주", "목포", "순천"] },
  { label: "충청", regions: ["대전", "청주", "충주"] },
  { label: "강원", regions: ["춘천", "강릉", "원주"] },
];

export default function RegionSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeRegion, setActiveRegion] = useState("서울");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative mt-4">
      <button
        onClick={() => setIsOpen((p) => !p)}
        className="glass-card flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-sm text-white/60 transition-all hover:text-white/80"
      >
        <i className="ri-map-pin-line text-purple-400" />
        <span className="flex-1 text-left">지역 채널 - {activeRegion}</span>
        <i className={`ri-arrow-down-s-line transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="glass absolute top-[calc(100%+8px)] right-0 left-0 z-50 grid grid-cols-2 gap-4 rounded-2xl p-5 sm:grid-cols-3 lg:grid-cols-5">
          {regionGroups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <h4 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-purple-400/60">
                {group.label}
              </h4>
              {group.regions.map((region) => (
                <button
                  key={region}
                  onClick={() => {
                    setActiveRegion(region);
                    setIsOpen(false);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-left text-xs transition-all ${
                    activeRegion === region
                      ? "bg-purple-500/20 font-medium text-purple-300"
                      : "text-white/50 hover:bg-white/5 hover:text-white/80"
                  }`}
                >
                  {region}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
