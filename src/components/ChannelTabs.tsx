"use client";

export interface Channel {
  id: string;
  name: string;
  shortName: string;
  isLive: boolean;
  program: string;
  color: string;
  gradientFrom: string;
  gradientTo: string;
  icon: string;
}

export const channels: Channel[] = [
  { id: "ch1", name: "KBS 1TV", shortName: "1TV", isLive: true, program: "KBS 1TV 실시간", color: "#a855f7", gradientFrom: "#a855f7", gradientTo: "#4f46e5", icon: "ri-tv-line" },
  { id: "ch2", name: "KBS 2TV", shortName: "2TV", isLive: true, program: "KBS 2TV 실시간", color: "#3b82f6", gradientFrom: "#60a5fa", gradientTo: "#2563eb", icon: "ri-computer-line" },
  { id: "drama", name: "KBS 드라마", shortName: "드라마", isLive: true, program: "KBS 드라마 실시간", color: "#ec4899", gradientFrom: "#f472b6", gradientTo: "#e11d48", icon: "ri-movie-line" },
  { id: "joy", name: "KBS Joy", shortName: "Joy", isLive: true, program: "KBS Joy 실시간", color: "#10b981", gradientFrom: "#34d399", gradientTo: "#0d9488", icon: "ri-music-line" },
  { id: "news", name: "KBS 뉴스24", shortName: "뉴스24", isLive: true, program: "KBS 뉴스24 실시간", color: "#f59e0b", gradientFrom: "#fb923c", gradientTo: "#f59e0b", icon: "ri-newspaper-line" },
];

interface ChannelTabsProps {
  activeChannel: string;
  onChannelChange: (channel: Channel) => void;
}

export default function ChannelSidebar({ activeChannel, onChannelChange }: ChannelTabsProps) {
  return (
    <nav className="flex gap-2 overflow-x-auto pb-2 md:w-24 md:shrink-0 md:flex-col md:gap-3 md:overflow-visible md:pb-0">
      {channels.map((ch) => {
        const isActive = activeChannel === ch.id;
        return (
          <button
            key={ch.id}
            onClick={() => onChannelChange(ch)}
            className="group relative flex min-w-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl px-3 py-4 text-xs font-semibold transition-all duration-300 md:h-24 md:w-full md:gap-2 md:px-2 md:py-3"
            style={{
              background: isActive
                ? `linear-gradient(135deg, ${ch.gradientFrom}, ${ch.gradientTo})`
                : "rgba(255,255,255,0.05)",
              border: isActive ? "none" : "1px solid rgba(255,255,255,0.1)",
              backdropFilter: isActive ? "none" : "blur(12px)",
              color: isActive ? "#fff" : "rgba(255,255,255,0.6)",
              boxShadow: isActive ? `0 8px 32px ${ch.color}40` : "none",
            }}
          >
            <i className={`${ch.icon} text-xl md:text-2xl`} />
            <span className="text-[11px] md:text-xs">{ch.shortName}</span>

            {isActive && (
              <span className="absolute -right-1 top-1/2 hidden h-8 w-1 -translate-y-1/2 rounded-full bg-white md:block" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
