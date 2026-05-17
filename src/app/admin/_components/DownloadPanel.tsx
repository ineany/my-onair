"use client";

import { useState } from "react";
import HostSelector from "./HostSelector";
import TreeView, { type Entry } from "./TreeView";
import ProgressBar, { type ProgressState } from "./ProgressBar";
import { downloadEntryWithProgress } from "./download-utils";

export default function DownloadPanel() {
  const [host, setHost] = useState("");
  const [message, setMessage] = useState<{
    text: string;
    kind: "ok" | "err";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);

  const handleAction = async (entry: Entry, action: "download" | "delete") => {
    if (action !== "download") return;
    setMessage(null);
    setProgress(null);
    setBusy(true);
    try {
      const result = await downloadEntryWithProgress(entry, setProgress);
      if (result === "cancelled") {
        setMessage({ text: `다운로드 취소: ${entry.name}`, kind: "ok" });
      } else if (result === "started") {
        setMessage({ text: `다운로드 시작: ${entry.name}`, kind: "ok" });
      } else {
        setMessage({ text: `다운로드 완료: ${entry.name}`, kind: "ok" });
      }
    } catch (err) {
      setMessage({
        text: `실패: ${err instanceof Error ? err.message : String(err)}`,
        kind: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <HostSelector value={host} onChange={setHost} />
        <div className="text-xs text-white/40">
          {busy ? "처리 중..." : "파일과 ZIP 다운로드 진행률을 표시합니다"}
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            message.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/30 bg-red-500/10 text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {progress && <ProgressBar progress={progress} />}

      <TreeView host={host} onAction={handleAction} />
    </div>
  );
}
