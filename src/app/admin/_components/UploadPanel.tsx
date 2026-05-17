"use client";

import { useEffect, useRef, useState } from "react";
import HostSelector from "./HostSelector";
import ProgressBar, {
  formatBytes,
  type ProgressState,
} from "./ProgressBar";

const MAX_CONCURRENT_UPLOADS = 2;

type ResultRow = {
  key: string;
  size: number;
  ok: boolean;
  error?: string;
  skipped?: boolean;
  checksumOk?: boolean;
  localSha256?: string;
  s3Sha256?: string;
};

type BackupDoneEvent = {
  uploaded: number;
  failed: number;
  skipped?: number;
  source: string;
  results: ResultRow[];
};

type BackupProgressEvent = Partial<BackupDoneEvent> & {
  type: "status" | "start" | "progress" | "verify" | "file" | "done" | "error";
  message?: string;
  error?: string;
  result?: ResultRow;
  key?: string;
  uploadedFiles?: number;
  totalFiles?: number;
  uploadedBytes?: number;
  totalBytes?: number;
  currentFileLoaded?: number;
  currentFileSize?: number;
};

type UploadJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

type UploadJob = {
  id: string;
  path: string;
  host: string;
  verifyChecksum: boolean;
  skipExisting: boolean;
  status: UploadJobStatus;
  progress: ProgressState | null;
  results: ResultRow[];
  summary: string | null;
  error: string | null;
  uploaded: number;
  skipped: number;
  failed: number;
  expanded: boolean;
  createdAt: number;
};

function summarizeDone(data: BackupDoneEvent): string {
  return `완료: 업로드 ${data.uploaded}건 / 건너뜀 ${data.skipped ?? 0}건 / 실패 ${data.failed}건`;
}

function statusLabel(status: UploadJobStatus): string {
  switch (status) {
    case "queued":
      return "대기";
    case "running":
      return "진행 중";
    case "done":
      return "완료";
    case "failed":
      return "실패";
    case "cancelled":
      return "취소";
  }
}

function statusClass(status: UploadJobStatus): string {
  switch (status) {
    case "queued":
      return "border-white/10 bg-white/5 text-white/60";
    case "running":
      return "border-purple-400/30 bg-purple-500/15 text-purple-100";
    case "done":
      return "border-emerald-400/30 bg-emerald-500/15 text-emerald-100";
    case "failed":
      return "border-red-400/30 bg-red-500/15 text-red-100";
    case "cancelled":
      return "border-amber-400/30 bg-amber-500/15 text-amber-100";
  }
}

async function readBackupProgress(
  res: Response,
  setProgress: (progress: ProgressState | null) => void,
  setResults: (updater: (prev: ResultRow[]) => ResultRow[]) => void,
): Promise<BackupDoneEvent> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (!res.body) throw new Error("진행률 스트림을 열 수 없습니다.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneEvent: BackupDoneEvent | null = null;

  const handleEvent = (event: BackupProgressEvent) => {
    if (event.type === "error") {
      throw new Error(event.error || "백업 중 오류가 발생했습니다.");
    }

    if (event.type === "status") {
      setProgress({
        label: event.message || "준비 중입니다.",
        indeterminate: true,
      });
      return;
    }

    if (event.type === "start") {
      setProgress({
        label: "S3 업로드를 시작합니다.",
        loadedBytes: 0,
        totalBytes: event.totalBytes,
        percent: 0,
        detail: `${event.totalFiles ?? 0}개 파일`,
      });
      return;
    }

    if (event.type === "file") {
      if (event.result) setResults((prev) => [...prev, event.result!]);
      const uploadedBytes = event.uploadedBytes ?? 0;
      const totalBytes = event.totalBytes ?? 0;
      const uploadedFiles = event.uploadedFiles ?? 0;
      const totalFiles = event.totalFiles ?? 0;
      const percent = totalBytes
        ? (uploadedBytes / totalBytes) * 100
        : totalFiles
          ? (uploadedFiles / totalFiles) * 100
          : undefined;

      setProgress({
        label: `S3 업로드 중입니다. (${uploadedFiles}/${totalFiles})`,
        loadedBytes: uploadedBytes,
        totalBytes: totalBytes || undefined,
        percent,
        detail: event.result?.key,
      });
      return;
    }

    if (event.type === "progress") {
      const uploadedBytes = event.uploadedBytes ?? 0;
      const totalBytes = event.totalBytes ?? 0;
      const percent = totalBytes ? (uploadedBytes / totalBytes) * 100 : undefined;
      const currentFileLoaded = event.currentFileLoaded ?? 0;
      const currentFileSize = event.currentFileSize ?? 0;
      const currentFilePercent = currentFileSize
        ? `, 현재 파일 ${((currentFileLoaded / currentFileSize) * 100).toFixed(0)}%`
        : "";

      setProgress({
        label: `S3 업로드 중입니다. (${event.uploadedFiles ?? 0}/${event.totalFiles ?? 0}${currentFilePercent})`,
        loadedBytes: uploadedBytes,
        totalBytes: totalBytes || undefined,
        percent,
        detail: event.key,
      });
      return;
    }

    if (event.type === "verify") {
      setProgress({
        label: `SHA-256 checksum 검증 중입니다. (${event.uploadedFiles ?? 0}/${event.totalFiles ?? 0})`,
        loadedBytes: event.uploadedBytes,
        totalBytes: event.totalBytes,
        percent:
          event.totalBytes && event.uploadedBytes
            ? (event.uploadedBytes / event.totalBytes) * 100
            : undefined,
        detail: event.key,
        indeterminate: true,
      });
      return;
    }

    if (event.type === "done") {
      doneEvent = {
        uploaded: event.uploaded ?? 0,
        failed: event.failed ?? 0,
        skipped: event.skipped ?? 0,
        source: event.source || "",
        results: event.results || [],
      };
      setProgress({
        label: "S3 업로드 완료",
        percent: 100,
        detail: doneEvent.source,
      });
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) handleEvent(JSON.parse(line) as BackupProgressEvent);
      newlineIndex = buffer.indexOf("\n");
    }
  }

  const tail = buffer.trim();
  if (tail) handleEvent(JSON.parse(tail) as BackupProgressEvent);
  if (!doneEvent) throw new Error("완료 이벤트를 받지 못했습니다.");
  return doneEvent;
}

export default function UploadPanel() {
  const [host, setHost] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [picking, setPicking] = useState(false);
  const [verifyChecksum, setVerifyChecksum] = useState(false);
  const [skipExisting, setSkipExisting] = useState(true);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const nextIdRef = useRef(1);

  const updateJob = (
    id: string,
    updater: (job: UploadJob) => UploadJob,
  ) => {
    setJobs((prev) => prev.map((job) => (job.id === id ? updater(job) : job)));
  };

  const enqueuePaths = (paths: string[]) => {
    const cleanPaths = paths.map((p) => p.trim()).filter(Boolean);
    if (cleanPaths.length === 0) return;

    setJobs((prev) => [
      ...prev,
      ...cleanPaths.map((path) => ({
        id: `upload-${Date.now()}-${nextIdRef.current++}`,
        path,
        host,
        verifyChecksum,
        skipExisting,
        status: "queued" as const,
        progress: null,
        results: [],
        summary: null,
        error: null,
        uploaded: 0,
        skipped: 0,
        failed: 0,
        expanded: false,
        createdAt: Date.now(),
      })),
    ]);
  };

  const pickLocalPaths = async (kind: "file" | "folder") => {
    setPicking(true);
    try {
      const res = await fetch(`/api/admin/pick-path?kind=${kind}`);
      const data = (await res.json().catch(() => ({}))) as {
        path?: string;
        paths?: string[];
        cancelled?: boolean;
        error?: string;
      };

      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (!data.cancelled) {
        const paths = data.paths?.length ? data.paths : [data.path || ""];
        setLocalPath(paths[0] || localPath);
        enqueuePaths(paths);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setJobs((prev) => [
        ...prev,
        {
          id: `upload-${Date.now()}-${nextIdRef.current++}`,
          path: kind === "file" ? "파일 선택" : "폴더 선택",
          host,
          verifyChecksum,
          skipExisting,
          status: "failed",
          progress: null,
          results: [],
          summary: null,
          error: message,
          uploaded: 0,
          skipped: 0,
          failed: 1,
          expanded: false,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setPicking(false);
    }
  };

  const runJob = async (job: UploadJob) => {
    try {
      const res = await fetch("/api/admin/backup-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: job.path,
          host: job.host,
          verifyChecksum: job.verifyChecksum,
          skipExisting: job.skipExisting,
        }),
      });

      const data = await readBackupProgress(
        res,
        (progress) =>
          updateJob(job.id, (current) => ({
            ...current,
            progress,
          })),
        (updater) =>
          updateJob(job.id, (current) => ({
            ...current,
            results: updater(current.results),
          })),
      );

      updateJob(job.id, (current) => ({
        ...current,
        status: data.failed > 0 ? "failed" : "done",
        progress: {
          label: data.failed > 0 ? "일부 파일 실패" : "업로드 완료",
          percent: 100,
          detail: data.source,
        },
        results: data.results || current.results,
        summary: summarizeDone(data),
        error: data.failed > 0 ? `${data.failed}개 파일 실패` : null,
        uploaded: data.uploaded,
        skipped: data.skipped ?? 0,
        failed: data.failed,
      }));
    } catch (err) {
      updateJob(job.id, (current) => ({
        ...current,
        status: "failed",
        progress: null,
        error: err instanceof Error ? err.message : String(err),
        failed: Math.max(current.failed, 1),
      }));
    }
  };

  useEffect(() => {
    const running = jobs.filter((job) => job.status === "running").length;
    const slots = MAX_CONCURRENT_UPLOADS - running;
    if (slots <= 0) return;

    const nextJobs = jobs
      .filter((job) => job.status === "queued")
      .slice(0, slots);
    if (nextJobs.length === 0) return;

    const ids = new Set(nextJobs.map((job) => job.id));
    setJobs((prev) =>
      prev.map((job) =>
        ids.has(job.id)
          ? {
              ...job,
              status: "running",
              progress: {
                label: "업로드 작업을 시작합니다.",
                detail: job.path,
                indeterminate: true,
              },
              error: null,
            }
          : job,
      ),
    );

    nextJobs.forEach((job) => {
      void runJob({ ...job, status: "running" });
    });
  }, [jobs]);

  const removeQueuedJob = (id: string) => {
    setJobs((prev) =>
      prev.filter((job) => !(job.id === id && job.status === "queued")),
    );
  };

  const toggleJobExpanded = (id: string) => {
    updateJob(id, (job) => ({ ...job, expanded: !job.expanded }));
  };

  const clearFinishedJobs = () => {
    setJobs((prev) =>
      prev.filter((job) => job.status === "queued" || job.status === "running"),
    );
  };

  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const doneCount = jobs.filter((job) => job.status === "done").length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const uploadedTotal = jobs.reduce((sum, job) => sum + job.uploaded, 0);
  const skippedTotal = jobs.reduce((sum, job) => sum + job.skipped, 0);

  return (
    <div className="space-y-6">
      <div>
        <HostSelector value={host} onChange={setHost} />
      </div>

      <section className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
          <i className="ri-folder-open-line text-purple-300" />
          로컬 경로 백업 큐
        </div>
        <div className="text-xs text-white/50">
          파일/폴더를 여러 개 선택해 큐에 추가할 수 있습니다. 동시에 최대 {MAX_CONCURRENT_UPLOADS}개 작업을 실행합니다.
        </div>
        <label className="flex items-center gap-2 text-xs text-white/60">
          <input
            type="checkbox"
            checked={skipExisting}
            onChange={(e) => setSkipExisting(e.target.checked)}
            disabled={picking}
            className="h-4 w-4 accent-purple-500"
          />
          이미 완료된 동일 파일 건너뛰기
          <span className="text-white/35">
            (같은 S3 key, 파일 크기, 수정 시간이 일치하면 재업로드하지 않습니다)
          </span>
        </label>
        <label className="flex items-center gap-2 text-xs text-white/60">
          <input
            type="checkbox"
            checked={verifyChecksum}
            onChange={(e) => setVerifyChecksum(e.target.checked)}
            disabled={picking}
            className="h-4 w-4 accent-purple-500"
          />
          업로드 후 SHA-256 checksum 검증
          <span className="text-white/35">
            (작업을 큐에 넣는 시점의 설정으로 적용됩니다)
          </span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            placeholder="/Users/n15190/Documents/work 또는 ~/photos"
            className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-purple-500/50"
            disabled={picking}
          />
          <button
            type="button"
            onClick={() => {
              if (localPath.trim()) enqueuePaths([localPath]);
            }}
            disabled={picking || !localPath.trim()}
            className="rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-purple-500/20 disabled:opacity-50"
          >
            큐에 추가
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void pickLocalPaths("file")}
            disabled={picking}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            <i className="ri-file-search-line mr-1" />
            파일 선택 후 추가
          </button>
          <button
            type="button"
            onClick={() => void pickLocalPaths("folder")}
            disabled={picking}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            <i className="ri-folder-search-line mr-1" />
            폴더 선택 후 추가
          </button>
          {jobs.length > 0 && (
            <button
              type="button"
              onClick={clearFinishedJobs}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60 hover:bg-white/10 hover:text-white"
            >
              완료 작업 정리
            </button>
          )}
        </div>
      </section>

      {jobs.length > 0 && (
        <section className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            <span>대기 {queuedCount}</span>
            <span>진행 {runningCount}</span>
            <span>완료 {doneCount}</span>
            <span>실패 {failedCount}</span>
            <span>업로드 {uploadedTotal}</span>
            <span>건너뜀 {skippedTotal}</span>
          </div>
          <div className="space-y-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-xl border border-white/10 bg-black/20 p-3"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(job.status)}`}
                      >
                        {statusLabel(job.status)}
                      </span>
                      <span className="text-xs text-white/40">
                        host: {job.host || "(기본)"}
                      </span>
                    </div>
                    <div className="truncate text-sm text-white/85" title={job.path}>
                      {job.path}
                    </div>
                    <div className="mt-1 text-xs text-white/40">
                      업로드 {job.uploaded} / 건너뜀 {job.skipped} / 실패 {job.failed}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {job.status === "queued" && (
                      <button
                        type="button"
                        onClick={() => removeQueuedJob(job.id)}
                        className="rounded border border-white/10 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                      >
                        제거
                      </button>
                    )}
                    {job.results.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleJobExpanded(job.id)}
                        className="rounded border border-white/10 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                      >
                        {job.expanded ? "접기" : `결과 ${job.results.length}개`}
                      </button>
                    )}
                  </div>
                </div>

                {job.progress && <ProgressBar progress={job.progress} />}

                {job.error && (
                  <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {job.error}
                  </div>
                )}

                {job.summary && (
                  <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                    {job.summary}
                  </div>
                )}

                {job.expanded && job.results.length > 0 && (
                  <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-white/10">
                    {job.results.map((r, i) => (
                      <div
                        key={`${r.key}-${i}`}
                        className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-xs last:border-0"
                      >
                        <i
                          className={
                            r.skipped
                              ? "ri-skip-forward-line text-sky-300"
                              : r.ok
                                ? "ri-checkbox-circle-line text-emerald-400"
                                : "ri-error-warning-line text-red-400"
                          }
                        />
                        <span className="flex-1 truncate text-white/80" title={r.key}>
                          {r.key}
                        </span>
                        <span className="w-20 text-right text-white/50">
                          {formatBytes(r.size)}
                        </span>
                        {r.skipped && (
                          <span className="w-20 text-right text-sky-300/80">
                            skipped
                          </span>
                        )}
                        {r.checksumOk !== undefined && (
                          <span
                            className={`w-24 text-right ${
                              r.checksumOk
                                ? "text-emerald-300/80"
                                : "text-red-300/80"
                            }`}
                            title={
                              r.checksumOk
                                ? `SHA-256 일치: ${r.localSha256}`
                                : `로컬: ${r.localSha256}\nS3: ${r.s3Sha256}`
                            }
                          >
                            {r.checksumOk ? "checksum OK" : "checksum 실패"}
                          </span>
                        )}
                        {r.error && (
                          <span
                            className="w-40 truncate text-right text-red-300/80"
                            title={r.error}
                          >
                            {r.error}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
