import { NextRequest, NextResponse } from "next/server";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { requireAdmin } from "@/lib/admin-guard";
import {
  s3,
  ensureBucket,
  getBucketName,
  getDefaultHost,
  makePresignedPutUrl,
} from "@/lib/s3-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeKey(input: string): string | null {
  // 절대 경로/상위 디렉토리 차단
  if (input.startsWith("/") || input.includes("..") || input.includes("\\")) {
    return null;
  }
  return input.replace(/^\/+/, "").replace(/\/+/g, "/");
}

function buildObjectKey(host: string, baseDir: string, relativePath: string) {
  const safePath = sanitizeKey(relativePath);
  if (!safePath) return null;

  const keyParts = [host || getDefaultHost()];
  if (baseDir) {
    const safeBase = sanitizeKey(baseDir);
    if (!safeBase) return null;
    keyParts.push(safeBase);
  }
  keyParts.push(safePath);

  return keyParts.join("/").replace(/\/+/g, "/");
}

export async function GET(req: NextRequest) {
  const guard = requireAdmin();
  if (guard) return guard;

  try {
    await ensureBucket();

    const host = req.nextUrl.searchParams.get("host") || getDefaultHost();
    const baseDir = req.nextUrl.searchParams.get("baseDir") || "";
    const relativePath = req.nextUrl.searchParams.get("path") || "";
    const key = buildObjectKey(host, baseDir, relativePath);

    if (!key) {
      return NextResponse.json(
        { error: "잘못된 경로 (상위 디렉토리 접근 차단)" },
        { status: 400 },
      );
    }

    const url = await makePresignedPutUrl(key, 3600);
    return NextResponse.json({ key, url, expiresIn: 3600 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const guard = requireAdmin();
  if (guard) return guard;

  try {
    if (!req.body) {
      return NextResponse.json(
        { error: "업로드 본문이 없습니다." },
        { status: 400 },
      );
    }

    await ensureBucket();
    const bucket = await getBucketName();
    const host = req.nextUrl.searchParams.get("host") || getDefaultHost();
    const baseDir = req.nextUrl.searchParams.get("baseDir") || "";
    const relativePath = req.nextUrl.searchParams.get("path") || "";
    const size = Number(req.headers.get("content-length") || 0);

    const key = buildObjectKey(host, baseDir, relativePath);
    if (!key) {
      return NextResponse.json(
        { error: "잘못된 경로 (상위 디렉토리 접근 차단)" },
        { status: 400 },
      );
    }

    const uploader = new Upload({
      client: s3,
      params: {
        Bucket: bucket,
        Key: key,
        Body: Readable.fromWeb(
          req.body as unknown as NodeReadableStream<Uint8Array>,
        ),
        StorageClass: "STANDARD_IA",
        ContentType:
          req.headers.get("content-type") || "application/octet-stream",
      },
    });

    await uploader.done();
    return NextResponse.json({ key, size, ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = requireAdmin();
  if (guard) return guard;

  try {
    await ensureBucket();
    const bucket = await getBucketName();

    const form = await req.formData();
    const host = (form.get("host") as string) || getDefaultHost();
    const baseDir = (form.get("baseDir") as string) || "";

    const files = form.getAll("files");
    if (files.length === 0) {
      return NextResponse.json(
        { error: "업로드할 파일이 없습니다." },
        { status: 400 },
      );
    }

    const results: Array<{ key: string; size: number; ok: boolean; error?: string }> = [];

    for (const item of files) {
      if (!(item instanceof File)) continue;

      // webkitdirectory의 webkitRelativePath가 name으로 들어옴
      // baseDir 지정 시 그 아래로 배치
      const relativePath =
        (form.get(`path:${item.name}`) as string) || item.name;
      const key = buildObjectKey(host, baseDir, relativePath);
      if (!key) {
        results.push({
          key: relativePath,
          size: item.size,
          ok: false,
          error: "잘못된 경로 (상위 디렉토리 접근 차단)",
        });
        continue;
      }

      try {
        const uploader = new Upload({
          client: s3,
          params: {
            Bucket: bucket,
            Key: key,
            Body: item.stream(),
            StorageClass: "STANDARD_IA",
            ContentType: item.type || "application/octet-stream",
          },
        });
        await uploader.done();
        results.push({ key, size: item.size, ok: true });
      } catch (err) {
        results.push({
          key,
          size: item.size,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const failed = results.filter((r) => !r.ok).length;
    return NextResponse.json({
      uploaded: results.length - failed,
      failed,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
