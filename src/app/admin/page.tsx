"use client";

import { useState } from "react";
import Header from "@/components/Header";
import BackupList from "./_components/BackupList";
import UploadPanel from "./_components/UploadPanel";
import DownloadPanel from "./_components/DownloadPanel";

const TABS = [
  { id: "list", label: "백업 목록", icon: "ri-list-check-2" },
  { id: "upload", label: "업로드", icon: "ri-upload-cloud-2-line" },
  { id: "download", label: "다운로드", icon: "ri-download-cloud-2-line" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function AdminPage() {
  const [tab, setTab] = useState<TabId>("list");

  // 클라이언트 측 가드 (서버 미들웨어와 이중 차단)
  if (typeof window !== "undefined") {
    if (process.env.NEXT_PUBLIC_ENABLE_LOCAL_ADMIN !== "true") {
      return null;
    }
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-lg shadow-lg shadow-purple-500/20">
            <i className="ri-shield-keyhole-line" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">백업 관리</h1>
            <p className="text-xs text-white/50">
              로컬 전용 — S3 백업/복원 콘솔
            </p>
          </div>
        </div>

        <div className="mb-6 flex gap-2 border-b border-white/10">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-purple-400 text-white"
                  : "border-transparent text-white/60 hover:text-white/90"
              }`}
            >
              <i className={t.icon} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="glass-dark rounded-2xl p-4 md:p-6">
          {tab === "list" && <BackupList />}
          {tab === "upload" && <UploadPanel />}
          {tab === "download" && <DownloadPanel />}
        </div>
      </main>
    </>
  );
}
