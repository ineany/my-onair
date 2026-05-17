"use client";

export type ProgressState = {
  label: string;
  percent?: number;
  loadedBytes?: number;
  totalBytes?: number;
  detail?: string;
  indeterminate?: boolean;
};

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function ProgressBar({ progress }: { progress: ProgressState }) {
  const percent =
    progress.percent === undefined
      ? undefined
      : Math.max(0, Math.min(100, progress.percent));
  const byteLabel =
    progress.loadedBytes !== undefined
      ? progress.totalBytes
        ? `${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)}`
        : formatBytes(progress.loadedBytes)
      : null;

  return (
    <div className="rounded-xl border border-purple-500/20 bg-purple-500/10 p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="text-purple-100">{progress.label}</span>
        <span className="text-white/50">
          {percent !== undefined ? `${percent.toFixed(0)}%` : byteLabel}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/40">
        <div
          className={`h-full rounded-full bg-gradient-to-r from-purple-400 to-pink-400 transition-all ${
            progress.indeterminate ? "animate-pulse" : ""
          }`}
          style={{ width: `${percent ?? 45}%` }}
        />
      </div>
      {progress.detail && (
        <div className="mt-2 truncate text-xs text-white/45" title={progress.detail}>
          {progress.detail}
        </div>
      )}
    </div>
  );
}
