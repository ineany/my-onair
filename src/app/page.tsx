"use client";

import dynamic from "next/dynamic";
import { useState, useRef, useEffect } from "react";
import Header from "@/components/Header";
import ChannelSidebar, { channels, type Channel } from "@/components/ChannelTabs";
import Footer from "@/components/Footer";
import ScrollToTop from "@/components/ScrollToTop";

const VideoPlayer = dynamic(() => import("@/components/VideoPlayer"), { ssr: false });
const SidePanel = dynamic(() => import("@/components/SidePanel"), { ssr: false });

export default function Home() {
  const [activeChannel, setActiveChannel] = useState<Channel>(channels[0]);
  const playerRef = useRef<HTMLDivElement>(null);
  const [playerHeight, setPlayerHeight] = useState(0);

  useEffect(() => {
    const el = playerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setPlayerHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 md:flex-row md:items-start md:gap-6 md:p-6 md:pt-4">
        {/* 왼쪽: 채널 사이드바 */}
        <ChannelSidebar
          activeChannel={activeChannel.id}
          onChannelChange={setActiveChannel}
        />

        {/* 중앙: 비디오 플레이어 */}
        <section ref={playerRef} className="flex min-w-0 flex-1 flex-col">
          <VideoPlayer
            currentProgram={activeChannel.program}
            channelId={activeChannel.id}
          />
        </section>

        {/* 오른쪽: 편성표 사이드 패널 */}
        <SidePanel
          channelId={activeChannel.id}
          maxHeight={playerHeight}
        />
      </main>

      <Footer />
      <ScrollToTop />
    </div>
  );
}
