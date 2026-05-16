"use client";

import Link from "next/link";
import { useState } from "react";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="glass-dark sticky top-0 z-50">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-lg font-bold shadow-lg shadow-purple-500/20">
            <i className="ri-live-line" />
          </div>
          <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-xl font-extrabold tracking-tight text-transparent">
            MY ON AIR
          </span>
        </Link>

        {/* Search - desktop only */}
        <div className="hidden md:flex">
          <div className="relative">
            <i className="ri-search-line pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-sm text-white/40" />
            <input
              type="text"
              placeholder="프로그램 검색..."
              className="w-72 rounded-full border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-sm text-white outline-none transition-all placeholder:text-white/30 focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20"
            />
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          <button className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-all hover:bg-white/10 hover:text-white md:hidden">
            <i className="ri-search-line text-lg" />
          </button>
          <button className="glass-card hidden items-center gap-2 rounded-xl px-5 py-2 text-sm font-medium text-white/80 transition-all hover:text-white sm:flex">
            <i className="ri-user-line" />
            로그인
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-all hover:bg-white/10 hover:text-white md:hidden"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <i className={menuOpen ? "ri-close-line text-lg" : "ri-menu-line text-lg"} />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="border-t border-white/5 px-4 pb-4 md:hidden">
          <div className="mt-3 flex flex-col gap-1">
            <button className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white/80 hover:bg-white/5">
              <i className="ri-user-line" />
              로그인
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
