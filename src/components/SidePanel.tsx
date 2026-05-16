"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type PanelType = "schedule" | "episodes" | "chat";

const tabs: { id: PanelType; icon: string; label: string }[] = [
  { id: "schedule", icon: "ri-calendar-schedule-line", label: "편성표" },
  { id: "episodes", icon: "ri-play-list-line", label: "전체회차" },
  { id: "chat", icon: "ri-chat-3-line", label: "라이브챗" },
];

interface ScheduleItem {
  time: string;
  endTime: string;
  title: string;
  isOnAir?: boolean;
}

interface ProgramInfo {
  programCode: string;
  title: string;
  fullTitle: string;
  channelCode: string;
  actors: string;
  description: string;
  thumbnail: string;
  homepageUrl: string;
  episodeCount: number | null;
}

interface ChatMessage {
  id: number;
  user: string;
  text: string;
  isSystem?: boolean;
}

const initialMessages: ChatMessage[] = [
  { id: 1, user: "시청자1", text: "안녕하세요~ 오늘 방송 기대됩니다!" },
  { id: 2, user: "시청자2", text: "다들 좋은 저녁이에요 :)" },
  { id: 3, user: "시청자3", text: "오늘 개콘 라인업 궁금하다" },
  { id: 4, user: "운영자", text: "운영자: 채팅 매너를 지켜주세요.", isSystem: true },
  { id: 5, user: "시청자4", text: "화질이 정말 좋네요!" },
];

const USE_24H_CHANNELS = new Set(["drama", "joy"]);

function getCurrentMinutes(channelId: string): number {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  if (!USE_24H_CHANNELS.has(channelId) && h < 4) return (h + 24) * 60 + m;
  return h * 60 + m;
}

function computeStatuses(items: ScheduleItem[], channelId: string): ("past" | "on-air" | "upcoming")[] {
  const currentMin = getCurrentMinutes(channelId);

  return items.map((item) => {
    const [sh, sm] = item.time.split(":").map(Number);
    const [eh, em] = item.endTime.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    if (currentMin >= startMin && currentMin < endMin) return "on-air";
    if (currentMin >= endMin) return "past";
    return "upcoming";
  });
}


interface SidePanelProps {
  channelId?: string;
  maxHeight?: number;
}

export default function SidePanel({ channelId = "ch1", maxHeight }: SidePanelProps) {
  const [activeTab, setActiveTab] = useState<PanelType>("schedule");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const onAirRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(100);
  const didScrollToLive = useRef(false);

  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [statuses, setStatuses] = useState<("past" | "on-air" | "upcoming")[]>([]);
  const [programs, setPrograms] = useState<ProgramInfo[]>([]);
  const [programsLoading, setProgramsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setScheduleLoading(true);

    fetch(`/api/schedule?channel=${channelId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.schedule && data.schedule.length > 0) {
          setSchedule(data.schedule);
          setStatuses(computeStatuses(data.schedule, channelId));
        } else {
          setSchedule([]);
        }
        setScheduleLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setSchedule([]);
          setScheduleLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [channelId]);

  useEffect(() => {
    if (schedule.length === 0) return;
    const interval = setInterval(() => setStatuses(computeStatuses(schedule, channelId)), 30000);
    return () => clearInterval(interval);
  }, [schedule]);

  useEffect(() => {
    let cancelled = false;
    setProgramsLoading(true);

    fetch(`/api/programs?channel=${channelId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setPrograms(data.programs || []);
        setProgramsLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setPrograms([]);
          setProgramsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [channelId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (activeTab === "schedule" && statuses.length > 0 && !didScrollToLive.current) {
      didScrollToLive.current = true;
      setTimeout(() => {
        const el = onAirRef.current;
        const container = el?.closest("[data-schedule-list]");
        if (el && container) {
          container.scrollTop = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
        }
      }, 300);
    }
  }, [activeTab, statuses]);

  useEffect(() => {
    didScrollToLive.current = false;
  }, [channelId]);

  const sendMessage = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    setMessages((prev) => [
      ...prev,
      { id: msgIdRef.current++, user: "나", text },
    ]);
    setChatInput("");
  }, [chatInput]);

  const heightStyle = maxHeight && maxHeight > 0
    ? { maxHeight: `${maxHeight}px`, height: `${maxHeight}px` }
    : undefined;

  return (
    <aside
      className="glass mt-4 flex w-full flex-col overflow-hidden rounded-3xl md:sticky md:mt-0 md:w-80 md:shrink-0"
      style={heightStyle}
    >
      {/* Tabs */}
      <div className="flex shrink-0 gap-1 border-b border-white/5 p-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-medium transition-all ${
              activeTab === tab.id
                ? "bg-purple-500/20 text-purple-300"
                : "text-white/40 hover:bg-white/5 hover:text-white/70"
            }`}
          >
            <i className={`${tab.icon} text-sm`} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Schedule tab */}
      {activeTab === "schedule" && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between px-5 py-4">
            <h3 className="text-lg font-bold text-white/90">오늘의 편성표</h3>
            <a
              href="https://schedule.kbs.co.kr"
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg text-white/30 transition-colors hover:text-purple-400"
            >
              <i className="ri-arrow-right-s-line" />
            </a>
          </div>

          {scheduleLoading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/10 border-t-purple-500" />
              <p className="text-xs text-white/40">편성표 불러오는 중...</p>
            </div>
          ) : schedule.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2">
              <i className="ri-calendar-close-line text-2xl text-white/20" />
              <p className="text-sm text-white/30">편성표를 불러올 수 없습니다</p>
            </div>
          ) : (
            <div data-schedule-list className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth: "thin" }}>
              <div className="flex flex-col gap-2">
                {schedule.map((item, i) => {
                  const status = statuses[i] || "upcoming";
                  const isLive = status === "on-air";
                  return (
                    <div
                      key={i}
                      ref={isLive ? onAirRef : undefined}
                      className={`flex items-center gap-4 rounded-xl px-4 py-3.5 transition-all duration-200 hover:translate-x-1 ${
                        isLive
                          ? "border border-purple-500/30 bg-purple-500/15 shadow-lg shadow-purple-500/10"
                          : "bg-white/[0.06] hover:bg-white/10"
                      }`}
                    >
                      <span
                        className={`min-w-[3.5rem] text-[15px] font-bold tabular-nums ${
                          isLive ? "text-purple-400" : "text-white/50"
                        }`}
                      >
                        {item.time}
                      </span>
                      <span
                        className={`flex-1 truncate text-[15px] ${
                          status === "past"
                            ? "text-white/30"
                            : isLive
                              ? "font-semibold text-white"
                              : "text-white/70"
                        }`}
                      >
                        {item.title}
                      </span>
                      {isLive && (
                        <span className="shrink-0 rounded-full bg-purple-500 px-3 py-1 text-[11px] font-bold tracking-wide text-white">
                          LIVE NOW
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Episodes tab */}
      {activeTab === "episodes" && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-white/5 px-5 py-3">
            <h3 className="text-sm font-bold text-white/90">인기 프로그램</h3>
          </div>
          {programsLoading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white/40">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/10 border-t-purple-500" />
              <span className="text-xs">프로그램 불러오는 중...</span>
            </div>
          ) : programs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-white/30">
              <i className="ri-film-line text-3xl" />
              <span className="text-sm">프로그램 정보가 없습니다</span>
            </div>
          ) : (
            <ul className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
              {programs.map((prog, i) => (
                <li key={prog.programCode + i}>
                  <a
                    href={prog.homepageUrl || "#"}
                    target={prog.homepageUrl ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    className="flex gap-3 border-b border-white/5 px-5 py-3 transition-all hover:bg-white/5"
                  >
                    <div className="group/thumb relative flex h-[68px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[#1a1a3e] to-[#0a0b1e]">
                      {prog.thumbnail ? (
                        <img
                          src={prog.thumbnail}
                          alt={prog.title}
                          className="h-full w-full object-cover transition-transform group-hover/thumb:scale-105"
                        />
                      ) : (
                        <i className="ri-film-line text-[28px] text-white/20" />
                      )}
                      {prog.homepageUrl && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/thumb:bg-black/40">
                          <i className="ri-external-link-line text-xl text-white opacity-0 transition-opacity group-hover/thumb:opacity-100" />
                        </div>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                      <p className="truncate text-sm font-semibold text-white/90">{prog.title}</p>
                      {prog.actors && (
                        <p className="truncate text-xs text-white/30">
                          <i className="ri-user-star-line mr-1" />
                          {prog.actors}
                        </p>
                      )}
                      {prog.description && (
                        <p className="line-clamp-2 text-xs leading-relaxed text-white/50">{prog.description}</p>
                      )}
                      {prog.episodeCount && (
                        <span className="text-[11px] text-white/30">총 {prog.episodeCount}회</span>
                      )}
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Chat tab */}
      {activeTab === "chat" && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4" style={{ scrollbarWidth: "thin" }}>
            {messages.map((msg) => (
              <div key={msg.id} className="flex flex-wrap gap-1.5 text-sm leading-relaxed">
                {!msg.isSystem && (
                  <span className="font-semibold text-purple-400">{msg.user}</span>
                )}
                <span className={msg.isSystem ? "text-xs italic text-white/30" : "break-all text-white/80"}>
                  {msg.text}
                </span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div className="flex shrink-0 gap-2 border-t border-white/5 px-4 py-3">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="메시지를 입력하세요..."
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white outline-none transition-all placeholder:text-white/20 focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20"
            />
            <button
              onClick={sendMessage}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-lg text-white transition-all hover:shadow-lg hover:shadow-purple-500/20"
            >
              <i className="ri-send-plane-fill" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
