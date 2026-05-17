"use client";

import type { Entry } from "./TreeView";
import type { ProgressState } from "./ProgressBar";

type FileWritable = {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
};

type SaveFilePicker = (options?: {
  suggestedName?: string;
}) => Promise<{
  createWritable: () => Promise<FileWritable>;
}>;

function getSaveFilePicker(): SaveFilePicker | null {
  const picker = (globalThis as unknown as { showSaveFilePicker?: SaveFilePicker })
    .showSaveFilePicker;
  return typeof picker === "function" ? picker.bind(globalThis) : null;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function clickDownload(url: string, filename?: string) {
  const a = document.createElement("a");
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function parseError(res: Response): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.error || `HTTP ${res.status}`;
}

async function streamToDisk(
  url: string,
  filename: string,
  setProgress: (progress: ProgressState | null) => void,
): Promise<"completed" | "cancelled" | "started"> {
  const picker = getSaveFilePicker();
  if (!picker) {
    clickDownload(url, filename);
    setProgress({
      label: "브라우저 다운로드로 진행 중입니다.",
      detail: filename,
      indeterminate: true,
    });
    return "started";
  }

  let fileHandle: Awaited<ReturnType<SaveFilePicker>>;
  try {
    fileHandle = await picker({ suggestedName: filename });
  } catch (err) {
    if (!isAbortError(err)) throw err;
    setProgress({
      label: "다운로드가 취소되었습니다.",
      detail: filename,
    });
    return "cancelled";
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(await parseError(res));
  if (!res.body) throw new Error("다운로드 스트림을 열 수 없습니다.");

  const writable = await fileHandle.createWritable();
  const reader = res.body.getReader();
  const totalBytesHeader = res.headers.get("content-length");
  const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : undefined;
  let loadedBytes = 0;

  setProgress({
    label: "다운로드 중입니다.",
    loadedBytes,
    totalBytes,
    percent: totalBytes ? 0 : undefined,
    indeterminate: !totalBytes,
    detail: filename,
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      loadedBytes += value.byteLength;
      await writable.write(value);
      setProgress({
        label: "다운로드 중입니다.",
        loadedBytes,
        totalBytes,
        percent: totalBytes ? (loadedBytes / totalBytes) * 100 : undefined,
        indeterminate: !totalBytes,
        detail: filename,
      });
    }

    await writable.close();
    setProgress({
      label: "다운로드 완료",
      loadedBytes,
      totalBytes,
      percent: 100,
      detail: filename,
    });
    return "completed";
  } catch (err) {
    await writable.abort?.();
    throw err;
  }
}

export async function downloadEntryWithProgress(
  entry: Entry,
  setProgress: (progress: ProgressState | null) => void,
): Promise<"completed" | "cancelled" | "started"> {
  const filename = entry.type === "folder" ? `${entry.name}.zip` : entry.name;
  const mode = entry.type === "folder" ? "zip" : "stream";
  const url = `/api/admin/download?key=${encodeURIComponent(entry.key)}&mode=${mode}`;

  return streamToDisk(url, filename, setProgress);
}

export async function openPresignedFile(entry: Entry) {
  const res = await fetch(
    `/api/admin/download?key=${encodeURIComponent(entry.key)}`,
  );
  if (!res.ok) throw new Error(await parseError(res));

  const data = (await res.json()) as { url: string };
  clickDownload(data.url, entry.name);
}
