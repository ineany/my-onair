import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { deleteObject, deletePrefix, headObject } from "@/lib/s3-client";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest) {
  const guard = requireAdmin();
  if (guard) return guard;

  try {
    const key = req.nextUrl.searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "key가 필요합니다." }, { status: 400 });
    }
    if (key.includes("..")) {
      return NextResponse.json({ error: "잘못된 key" }, { status: 400 });
    }

    // 보호: 빈 키나 루트 슬래시는 거부
    const trimmed = key.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!trimmed) {
      return NextResponse.json(
        { error: "최상위 삭제는 허용되지 않습니다." },
        { status: 400 },
      );
    }

    const isFolderRequest = key.endsWith("/");

    if (isFolderRequest) {
      const deleted = await deletePrefix(trimmed);
      return NextResponse.json({ kind: "folder", deleted });
    }

    // 파일 우선 시도, 없으면 폴더로 처리
    const head = await headObject(trimmed);
    if (head) {
      await deleteObject(trimmed);
      return NextResponse.json({ kind: "file", deleted: 1 });
    }

    const deleted = await deletePrefix(trimmed);
    if (deleted === 0) {
      return NextResponse.json(
        { error: `객체를 찾을 수 없습니다: ${key}` },
        { status: 404 },
      );
    }
    return NextResponse.json({ kind: "folder", deleted });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
