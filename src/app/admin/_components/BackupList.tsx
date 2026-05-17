"use client";

import { useState } from "react";
import HostSelector from "./HostSelector";
import TreeView, { type Entry } from "./TreeView";
import ProgressBar, { type ProgressState } from "./ProgressBar";
import { downloadEntryWithProgress } from "./download-utils";

export default function BackupList() {
  const [host, setHost] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState<{
    text: string;
    kind: "ok" | "err";
  } | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);

  const handleAction = async (entry: Entry, action: "download" | "delete") => {
    if (action === "download") {
      setProgress(null);
      setMessage(null);
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
          text: `다운로드 실패: ${err instanceof Error ? err.message : String(err)}`,
          kind: "err",
        });
      }
    } else {
      const label = entry.type === "folder" ? "폴더 전체" : "파일";
      const ok = window.confirm(
        `${label}을(를) 삭제하시겠습니까?\n\n${entry.key}\n\n복구하려면 버전 관리에서 수동 복구가 필요합니다.`,
      );
      if (!ok) return;
      try {
        const key = entry.type === "folder" ? `${entry.key}` : entry.key;
        const res = await fetch(
          `/api/admin/object?key=${encodeURIComponent(key)}`,
          { method: "DELETE" },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setMessage({
          text: `삭제 완료: ${data.kind} (${data.deleted}개)`,
          kind: "ok",
        });
        setRefresh((v) => v + 1);
      } catch (err) {
        setMessage({
          text: `삭제 실패: ${err instanceof Error ? err.message : String(err)}`,
          kind: "err",
        });
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <HostSelector value={host} onChange={setHost} />
        <button
          onClick={() => setRefresh((v) => v + 1)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10"
        >
          <i className="ri-refresh-line mr-1" />
          새로고침
        </button>
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

      <TreeView host={host} refreshToken={refresh} onAction={handleAction} />
    </div>
  );
}
