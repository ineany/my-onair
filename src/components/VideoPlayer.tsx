"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import HlsPlayer, { type HlsPlayerHandle } from "./HlsPlayer";

interface VideoPlayerProps {
  currentProgram: string;
  channelId: string;
}

export default function VideoPlayer({ currentProgram, channelId }: VideoPlayerProps) {
  const playerRef = useRef<HlsPlayerHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [streamUrl, setStreamUrl] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [isLive, setIsLive] = useState(true);
  const [showOverlay, setShowOverlay] = useState(false);
  const prevVolume = useRef(80);
  const overlayTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const fetchStream = async () => {
      try {
        const res = await fetch(`/api/stream?channel=${channelId}`);
        const data = await res.json();
        if (data.streamUrl) {
          setStreamUrl(data.streamUrl);
          setIsLive(data.type === "live");
        }
      } catch {
        setStreamUrl("");
      }
    };
    fetchStream();
  }, [channelId]);

  const togglePlay = useCallback(() => {
    playerRef.current?.togglePlay();
  }, []);

  const handleToggleMute = useCallback(() => {
    if (!isMuted) {
      prevVolume.current = volume;
      setVolume(0);
      setIsMuted(true);
      playerRef.current?.setVolume(0);
    } else {
      setVolume(prevVolume.current);
      setIsMuted(false);
      playerRef.current?.setVolume(prevVolume.current);
    }
  }, [isMuted, volume]);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value);
      setVolume(val);
      setIsMuted(val === 0);
      playerRef.current?.setVolume(val);
    },
    []
  );

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    const video = playerRef.current?.getVideoElement();

    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }

    if (container?.requestFullscreen) {
      container.requestFullscreen();
    } else if (video) {
      const v = video as HTMLVideoElement & {
        webkitEnterFullscreen?: () => void;
        webkitRequestFullscreen?: () => void;
      };
      if (v.webkitEnterFullscreen) {
        v.webkitEnterFullscreen();
      } else if (v.webkitRequestFullscreen) {
        v.webkitRequestFullscreen();
      }
    }
  }, []);

  const handleScreenClick = useCallback(() => {
    setShowOverlay(true);
    clearTimeout(overlayTimer.current);
    overlayTimer.current = setTimeout(() => setShowOverlay(false), 3000);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "f":
        case "F":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "m":
        case "M":
          e.preventDefault();
          handleToggleMute();
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((v) => {
            const next = Math.min(100, v + 5);
            playerRef.current?.setVolume(next);
            return next;
          });
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((v) => {
            const next = Math.max(0, v - 5);
            playerRef.current?.setVolume(next);
            setIsMuted(next === 0);
            return next;
          });
          break;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, toggleFullscreen, handleToggleMute]);

  const volumeIcon =
    isMuted || volume === 0
      ? "ri-volume-mute-fill"
      : volume < 50
        ? "ri-volume-down-fill"
        : "ri-volume-up-fill";

  return (
    <div ref={containerRef} className="glass overflow-hidden rounded-3xl">
      {/* Video area */}
      <div className="group relative aspect-video w-full bg-black" onClick={handleScreenClick}>
        {streamUrl ? (
          <HlsPlayer
            ref={playerRef}
            src={streamUrl}
            autoPlay
            onPlayStateChange={setIsPlaying}
            onVolumeChange={(v, m) => {
              setVolume(v);
              setIsMuted(m);
            }}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-gradient-to-br from-[#0a0b1e] via-[#1a1a3e] to-[#0a0b1e]">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-blue-500" />
            <div className="flex flex-col items-center gap-2">
              <p className="text-lg font-semibold text-white/80">STREAMING SOON</p>
              <div className="flex items-center gap-2 text-sm text-white/40">
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                서버 연결 중...
              </div>
            </div>
          </div>
        )}

        {/* LIVE badge */}
        {isLive && streamUrl && (
          <div className="glass absolute left-4 top-4 flex items-center gap-2 rounded-full px-3 py-1">
            <span className="h-2 w-2 animate-[blink_1.5s_infinite] rounded-full bg-purple-500" />
            <span className="text-xs font-bold text-white/90">LIVE</span>
          </div>
        )}

        {/* Play overlay */}
        {showOverlay && streamUrl && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-3xl text-white backdrop-blur-sm transition-all hover:scale-110 hover:bg-white/25"
            >
              <i className={isPlaying ? "ri-pause-large-fill" : "ri-play-large-fill"} />
            </button>
          </div>
        )}

        {/* Bottom gradient + info */}
        {streamUrl && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-10">
            <p className="text-sm font-medium text-white/90">{currentProgram}</p>
          </div>
        )}

        {/* Hover controls */}
        <div className="absolute inset-x-0 bottom-0 translate-y-full opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <div className="h-1 w-full bg-white/10">
            <div className="relative h-full w-1/3 bg-gradient-to-r from-purple-500 to-pink-500">
              <span className="absolute -top-1.5 right-0 h-4 w-4 rounded-full border-2 border-white bg-purple-500 shadow-md" />
            </div>
          </div>
        </div>
      </div>

      {/* Control bar */}
      <div className="flex items-center justify-between gap-2 bg-black/30 px-3 py-2 backdrop-blur-sm sm:px-4 sm:py-2.5">
        <div className="flex items-center gap-1">
          <button
            onClick={togglePlay}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-white/60 transition-all hover:bg-white/10 hover:text-white"
            title="재생/정지 (Space)"
          >
            <i className={isPlaying ? "ri-pause-fill" : "ri-play-fill"} />
          </button>

          <button
            onClick={handleToggleMute}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-white/60 transition-all hover:bg-white/10 hover:text-white"
            title="음소거 (M)"
          >
            <i className={volumeIcon} />
          </button>

          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={handleVolumeChange}
            className="hidden h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/10 sm:block [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400 [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-125"
          />

          {isLive && (
            <span className="ml-1 flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-bold text-red-400">
              <span className="h-1.5 w-1.5 animate-[blink_1.5s_infinite] rounded-full bg-red-500" />
              LIVE
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-lg text-white/60 transition-all hover:bg-white/10 hover:text-white sm:flex"
            title="PIP"
            onClick={() => {
              const video = playerRef.current?.getVideoElement();
              if (video && document.pictureInPictureEnabled) {
                if (document.pictureInPictureElement) {
                  document.exitPictureInPicture();
                } else {
                  video.requestPictureInPicture();
                }
              }
            }}
          >
            <i className="ri-picture-in-picture-2-line" />
          </button>
          <button
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-lg text-white/60 transition-all hover:bg-white/10 hover:text-white sm:flex"
            title="설정"
          >
            <i className="ri-settings-3-line" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-white/60 transition-all hover:bg-white/10 hover:text-white"
            title="전체화면 (F)"
          >
            <i className="ri-fullscreen-line" />
          </button>
        </div>
      </div>

      {/* Program info & share */}
      <div className="flex items-center justify-between border-t border-white/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-white/90">{currentProgram}</h2>
          <span className="rounded-full bg-purple-500/20 px-2.5 py-0.5 text-xs font-medium text-purple-300">
            실시간
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-all hover:bg-white/10 hover:text-white" title="공유">
            <i className="ri-share-line" />
          </button>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-all hover:bg-white/10 hover:text-white" title="링크 복사">
            <i className="ri-link" />
          </button>
        </div>
      </div>
    </div>
  );
}
