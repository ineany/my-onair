"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import Hls from "hls.js";

export interface HlsPlayerHandle {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seekTo: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  requestFullscreen: () => void;
  getVideoElement: () => HTMLVideoElement | null;
}

interface HlsPlayerProps {
  src: string;
  autoPlay?: boolean;
  onPlayStateChange?: (playing: boolean) => void;
  onVolumeChange?: (volume: number, muted: boolean) => void;
  onTimeUpdate?: (current: number, duration: number) => void;
  onError?: (error: string) => void;
  onStreamReady?: () => void;
}

const HlsPlayer = forwardRef<HlsPlayerHandle, HlsPlayerProps>(
  (
    {
      src,
      autoPlay = true,
      onPlayStateChange,
      onVolumeChange,
      onTimeUpdate,
      onError,
      onStreamReady,
    },
    ref
  ) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [errorMsg, setErrorMsg] = useState("");

    const destroyHls = useCallback(() => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    }, []);

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !src) return;

      setStatus("loading");
      setErrorMsg("");
      destroyHls();

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.addEventListener("loadedmetadata", () => {
          setStatus("ready");
          onStreamReady?.();
          if (autoPlay) video.play().catch(() => {});
        });
        video.addEventListener("error", () => {
          setStatus("error");
          const msg = "스트림을 불러올 수 없습니다";
          setErrorMsg(msg);
          onError?.(msg);
        });
      } else if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90,
        });
        hlsRef.current = hls;

        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setStatus("ready");
          onStreamReady?.();
          if (autoPlay) video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                setErrorMsg("네트워크 오류 - 재연결 시도 중...");
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                setErrorMsg("미디어 오류 - 복구 시도 중...");
                hls.recoverMediaError();
                break;
              default:
                setStatus("error");
                setErrorMsg("스트림을 재생할 수 없습니다");
                onError?.("스트림을 재생할 수 없습니다");
                destroyHls();
                break;
            }
          }
        });
      } else {
        setStatus("error");
        setErrorMsg("이 브라우저는 HLS 재생을 지원하지 않습니다");
        onError?.("HLS not supported");
      }

      return () => destroyHls();
    }, [src, autoPlay, destroyHls, onError, onStreamReady]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const handlePlay = () => onPlayStateChange?.(true);
      const handlePause = () => onPlayStateChange?.(false);
      const handleVolume = () =>
        onVolumeChange?.(Math.round(video.volume * 100), video.muted);
      const handleTime = () =>
        onTimeUpdate?.(video.currentTime, video.duration || 0);

      video.addEventListener("play", handlePlay);
      video.addEventListener("pause", handlePause);
      video.addEventListener("volumechange", handleVolume);
      video.addEventListener("timeupdate", handleTime);

      return () => {
        video.removeEventListener("play", handlePlay);
        video.removeEventListener("pause", handlePause);
        video.removeEventListener("volumechange", handleVolume);
        video.removeEventListener("timeupdate", handleTime);
      };
    }, [onPlayStateChange, onVolumeChange, onTimeUpdate]);

    useImperativeHandle(ref, () => ({
      play: () => videoRef.current?.play(),
      pause: () => videoRef.current?.pause(),
      togglePlay: () => {
        const v = videoRef.current;
        if (!v) return;
        v.paused ? v.play() : v.pause();
      },
      seekTo: (time: number) => {
        if (videoRef.current) videoRef.current.currentTime = time;
      },
      setVolume: (vol: number) => {
        if (videoRef.current) {
          videoRef.current.volume = vol / 100;
          videoRef.current.muted = vol === 0;
        }
      },
      toggleMute: () => {
        if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
      },
      requestFullscreen: () => {
        videoRef.current?.requestFullscreen?.();
      },
      getVideoElement: () => videoRef.current,
    }));

    return (
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          playsInline
          crossOrigin="anonymous"
        />

        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80">
            <div className="h-10 w-10 animate-spin rounded-full border-3 border-white/10 border-t-purple-500" />
            <p className="text-sm text-white/50">스트림 연결 중...</p>
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90">
            <i className="ri-error-warning-line text-4xl text-red-400" />
            <p className="text-sm text-white/50">{errorMsg}</p>
            <button
              onClick={() => {
                if (videoRef.current && src) {
                  setStatus("loading");
                  destroyHls();
                  const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
                  hlsRef.current = hls;
                  hls.loadSource(src);
                  hls.attachMedia(videoRef.current);
                  hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    setStatus("ready");
                    videoRef.current?.play().catch(() => {});
                  });
                }
              }}
              className="rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 px-5 py-2 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-purple-500/20"
            >
              <i className="ri-refresh-line mr-1" />
              다시 시도
            </button>
          </div>
        )}
      </div>
    );
  }
);

HlsPlayer.displayName = "HlsPlayer";

export default HlsPlayer;
