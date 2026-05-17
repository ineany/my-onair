import { NextRequest, NextResponse } from "next/server";
// @ts-expect-error @types/archiver does not expose the v8 ZipArchive export yet.
import { ZipArchive } from "archiver";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { requireAdmin } from "@/lib/admin-guard";
import {
  s3,
  ensureBucket,
  getBucketName,
  headObject,
  makePresignedGetUrl,
} from "@/lib/s3-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function downloadFilename(key: string): string {
  return (key.split("/").filter(Boolean).pop() || "download").replace(
    /["\\]/g,
    "_",
  );
}

function contentDisposition(filename: string): string {
  const asciiFallback = filename
    .replace(/["\\]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(req: NextRequest) {
  const guard = requireAdmin();
  if (guard) return guard;

  try {
    await ensureBucket();
    const bucket = await getBucketName();
    const key = req.nextUrl.searchParams.get("key");
    const mode = req.nextUrl.searchParams.get("mode") || "auto"; // auto|url|stream|zip

    if (!key) {
      return NextResponse.json({ error: "key가 필요합니다." }, { status: 400 });
    }

    if (key.includes("..")) {
      return NextResponse.json({ error: "잘못된 key" }, { status: 400 });
    }

    // 폴더 경로(슬래시 끝)이거나 mode=zip → ZIP 스트림
    const isFolderKey = key.endsWith("/");
    if (isFolderKey || mode === "zip") {
      return await streamZip(bucket, key.replace(/\/$/, ""));
    }

    // 파일 객체 존재 확인
    const head = await headObject(key);
    if (!head) {
      // 파일 없음 → 폴더로 시도
      const probe = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: `${key}/`,
          MaxKeys: 1,
        }),
      );
      if ((probe.KeyCount ?? 0) > 0) {
        return await streamZip(bucket, key);
      }
      return NextResponse.json(
        { error: `객체를 찾을 수 없습니다: ${key}` },
        { status: 404 },
      );
    }

    if (mode === "stream") {
      return await streamFile(bucket, key, head);
    }

    // 단일 파일 → Pre-signed URL
    const url = await makePresignedGetUrl(key, 3600);
    return NextResponse.json({ url, expiresIn: 3600 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

async function streamFile(
  bucket: string,
  key: string,
  head: Awaited<ReturnType<typeof headObject>>,
): Promise<Response> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = obj.Body as Readable | undefined;

  if (!body) {
    return NextResponse.json(
      { error: `객체 본문을 읽을 수 없습니다: ${key}` },
      { status: 404 },
    );
  }

  const headers = new Headers({
    "Content-Type":
      head?.ContentType || obj.ContentType || "application/octet-stream",
    "Content-Disposition": contentDisposition(downloadFilename(key)),
    "Cache-Control": "no-store",
  });

  const contentLength = head?.ContentLength ?? obj.ContentLength;
  if (contentLength !== undefined) {
    headers.set("Content-Length", String(contentLength));
  }

  return new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, {
    headers,
  });
}

async function streamZip(bucket: string, prefix: string): Promise<Response> {
  const prefixSlash = `${prefix}/`;

  // 객체 목록 수집
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefixSlash,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents || []) {
      if (!obj.Key || obj.Key.endsWith("/")) continue;
      keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  if (keys.length === 0) {
    return NextResponse.json(
      { error: `폴더가 비어 있거나 존재하지 않습니다: ${prefix}` },
      { status: 404 },
    );
  }

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const baseName = prefix.split("/").pop() || "backup";

  // archiver 출력 → Web ReadableStream
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      archive.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      archive.on("end", () => controller.close());
      archive.on("error", (err: Error) => controller.error(err));

      (async () => {
        try {
          for (const key of keys) {
            const obj = await s3.send(
              new GetObjectCommand({ Bucket: bucket, Key: key }),
            );
            const body = obj.Body as Readable | undefined;
            if (!body) continue;
            const relPath = key.slice(prefixSlash.length);
            archive.append(body, { name: `${baseName}/${relPath}` });
          }
          await archive.finalize();
        } catch (err) {
          controller.error(err);
        }
      })();
    },
    cancel() {
      archive.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition(`${baseName}.zip`),
      "Cache-Control": "no-store",
    },
  });
}
