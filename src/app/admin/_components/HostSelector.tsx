"use client";

import { useEffect, useState } from "react";

type Props = {
  value: string;
  onChange: (host: string) => void;
};

export default function HostSelector({ value, onChange }: Props) {
  const [hosts, setHosts] = useState<string[]>([]);
  const [defaultHost, setDefaultHost] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/admin/hosts", {
          signal: controller.signal,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          hosts: string[];
          defaultHost: string;
        };
        if (cancelled) return;
        setHosts(data.hosts);
        setDefaultHost(data.defaultHost);
        if (!value) {
          const initial = data.hosts.includes(data.defaultHost)
            ? data.defaultHost
            : data.hosts[0] || data.defaultHost;
          onChange(initial);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [onChange]);

  if (loading) {
    return <div className="text-xs text-white/40">호스트 목록 로딩...</div>;
  }
  if (error) {
    return <div className="text-xs text-red-300">오류: {error}</div>;
  }

  const options = hosts.length > 0 ? hosts : [defaultHost].filter(Boolean);

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-white/60">호스트</label>
      <select
        value={value || defaultHost}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-sm text-white outline-none focus:border-purple-500/50"
      >
        {options.map((h) => (
          <option key={h} value={h} className="bg-[#0a0b1e]">
            {h}
            {h === defaultHost ? " (현재)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
