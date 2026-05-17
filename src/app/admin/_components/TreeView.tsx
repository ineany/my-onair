"use client";

import { useEffect, useState, useCallback } from "react";

export type Entry = {
  type: "file" | "folder";
  key: string;
  name: string;
  size?: number;
  lastModified?: string;
};

type TreeViewProps = {
  host: string;
  refreshToken?: number;
  onAction?: (entry: Entry, action: "download" | "delete") => void;
};

function formatSize(size?: number): string {
  if (size === undefined) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso?: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type FolderNode = {
  prefix: string;
  entries: Entry[];
  open: boolean;
  loading: boolean;
  truncated?: boolean;
  maxKeys?: number;
  error?: string;
};

export default function TreeView({ host, refreshToken, onAction }: TreeViewProps) {
  const [nodes, setNodes] = useState<Record<string, FolderNode>>({});
  const rootPrefix = host ? `${host}/` : "";

  const loadNode = useCallback(
    async (prefix: string, signal?: AbortSignal) => {
      setNodes((prev) => ({
        ...prev,
        [prefix]: {
          prefix,
          entries: prev[prefix]?.entries ?? [],
          open: true,
          loading: true,
          error: undefined,
        },
      }));
      try {
        const res = await fetch(
          `/api/admin/list?prefix=${encodeURIComponent(prefix)}`,
          { signal },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          entries: Entry[];
          truncated?: boolean;
          maxKeys?: number;
        };
        setNodes((prev) => ({
          ...prev,
          [prefix]: {
            prefix,
            entries: data.entries,
            open: true,
            loading: false,
            truncated: data.truncated,
            maxKeys: data.maxKeys,
          },
        }));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setNodes((prev) => ({
          ...prev,
          [prefix]: {
            prefix,
            entries: [],
            open: true,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },
    [],
  );

  useEffect(() => {
    if (!host) return;
    const controller = new AbortController();
    setNodes({});
    loadNode(rootPrefix, controller.signal);
    return () => controller.abort();
  }, [host, rootPrefix, loadNode, refreshToken]);

  const toggle = (folderKey: string) => {
    const existing = nodes[folderKey];
    if (existing?.open) {
      setNodes((prev) => ({
        ...prev,
        [folderKey]: { ...existing, open: false },
      }));
    } else if (existing) {
      setNodes((prev) => ({
        ...prev,
        [folderKey]: { ...existing, open: true },
      }));
    } else {
      void loadNode(folderKey);
    }
  };

  const renderNode = (prefix: string, depth: number) => {
    const node = nodes[prefix];
    if (!node) return null;

    if (node.loading && node.entries.length === 0) {
      return (
        <div
          className="px-3 py-2 text-xs text-white/40"
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
        >
          불러오는 중...
        </div>
      );
    }
    if (node.error) {
      return (
        <div
          className="px-3 py-2 text-xs text-red-300"
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
        >
          오류: {node.error}
        </div>
      );
    }
    if (node.entries.length === 0) {
      return (
        <div
          className="px-3 py-2 text-xs text-white/30"
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
        >
          (비어 있음)
        </div>
      );
    }

    const rows = node.entries.map((entry) => {
      if (entry.type === "folder") {
        const sub = nodes[entry.key];
        const open = sub?.open ?? false;
        return (
          <div key={entry.key}>
            <div
              className="group flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-white/5"
              style={{ paddingLeft: `${depth * 16 + 12}px` }}
            >
              <button
                className="flex flex-1 items-center gap-2 text-left text-white/90"
                onClick={() => toggle(entry.key)}
              >
                <i
                  className={
                    open ? "ri-arrow-down-s-line" : "ri-arrow-right-s-line"
                  }
                />
                <i className="ri-folder-line text-amber-300/80" />
                <span>{entry.name}</span>
              </button>
              {onAction && (
                <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    className="rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                    onClick={() => onAction(entry, "download")}
                    title="ZIP으로 다운로드"
                  >
                    <i className="ri-download-line" />
                  </button>
                  <button
                    className="rounded px-2 py-1 text-xs text-red-300/80 hover:bg-red-500/20 hover:text-red-200"
                    onClick={() => onAction(entry, "delete")}
                    title="삭제"
                  >
                    <i className="ri-delete-bin-line" />
                  </button>
                </div>
              )}
            </div>
            {open && renderNode(entry.key, depth + 1)}
          </div>
        );
      }
      return (
        <div
          key={entry.key}
          className="group flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-white/5"
          style={{ paddingLeft: `${depth * 16 + 32}px` }}
        >
          <i className="ri-file-line text-white/40" />
          <span className="flex-1 text-white/80">{entry.name}</span>
          <span className="w-24 text-right text-xs text-white/50">
            {formatSize(entry.size)}
          </span>
          <span className="hidden w-40 text-right text-xs text-white/40 sm:block">
            {formatDate(entry.lastModified)}
          </span>
          {onAction && (
            <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                className="rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => onAction(entry, "download")}
                title="다운로드"
              >
                <i className="ri-download-line" />
              </button>
              <button
                className="rounded px-2 py-1 text-xs text-red-300/80 hover:bg-red-500/20 hover:text-red-200"
                onClick={() => onAction(entry, "delete")}
                title="삭제"
              >
                <i className="ri-delete-bin-line" />
              </button>
            </div>
          )}
        </div>
      );
    });

    if (!node.truncated) return rows;

    return [
      ...rows,
      <div
        key={`${prefix}__truncated`}
        className="px-3 py-2 text-xs text-amber-200/80"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        항목이 많아 처음 {node.maxKeys ?? "일부"}개만 표시 중입니다.
      </div>,
    ];
  };

  if (!host) {
    return (
      <div className="p-4 text-sm text-white/50">호스트를 선택하세요.</div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/20">
      <div className="border-b border-white/10 px-3 py-2 text-xs text-white/50">
        s3://.../{rootPrefix}
      </div>
      <div className="max-h-[60vh] overflow-y-auto py-1">
        {renderNode(rootPrefix, 0)}
      </div>
    </div>
  );
}
