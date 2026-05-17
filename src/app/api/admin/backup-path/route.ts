import { NextRequest, NextResponse } from "next/server";
import { Upload } from "@aws-sdk/lib-storage";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream, statSync } from "node:fs";
import type { Stats } from "node:fs";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import path from "node:path";
import os from "node:os";
import { requireAdmin } from "@/lib/admin-guard";
import {
  s3,
  ensureBucket,
  getBucketName,
  getDefaultHost,
} from "@/lib/s3-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CollectedFile = {
  path: string;
  size: number;
  mtimeMs: number;
};

type BackupResult = {
  key: string;
  size: number;
  ok: boolean;
  error?: string;
  skipped?: boolean;
  checksumOk?: boolean;
  localSha256?: string;
  s3Sha256?: string;
};

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

async function collectFiles(rootPath: string): Promise<CollectedFile[]> {
  const stat = statSync(rootPath);
  if (stat.isFile()) {
    return [{ path: rootPath, size: stat.size, mtimeMs: stat.mtimeMs }];
  }

  const out: CollectedFile[] = [];
  const stack = [rootPath];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        const fileStat = statSync(full);
        out.push({ path: full, size: fileStat.size, mtimeMs: fileStat.mtimeMs });
      }
    }
  }
  return out;
}

function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  payload: unknown,
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
}

async function sha256Stream(stream: AsyncIterable<unknown>): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of stream) {
    hash.update(chunk as string | Buffer | Uint8Array);
  }
  return hash.digest("hex");
}

function sha256File(filePath: string): Promise<string> {
  return sha256Stream(createReadStream(filePath));
}

async function sha256S3Object(bucket: string, key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error("S3 객체 본문을 읽을 수 없습니다.");
  return sha256Stream(res.Body as Readable);
}

async function hasMatchingUploadedObject(
  bucket: string,
  key: string,
  file: CollectedFile,
): Promise<boolean> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const remoteMtimeMs = Number.parseInt(
      head.Metadata?.["local-mtime-ms"] || "",
      10,
    );
    return (
      head.ContentLength === file.size &&
      Number.isFinite(remoteMtimeMs) &&
      Math.abs(remoteMtimeMs - Math.trunc(file.mtimeMs)) < 1000
    );
  } catch {
    return false;
  }
}

async function streamBackupProgress(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  absPath: string,
  host: string,
  stat: Stats,
  verifyChecksum: boolean,
  skipExisting: boolean,
) {
  const baseName = path.basename(absPath);
  const rootDir = stat.isFile() ? path.dirname(absPath) : absPath;
  const results: BackupResult[] = [];

  try {
    sendEvent(controller, encoder, {
      type: "status",
      message: "파일 목록을 수집하는 중입니다.",
    });

    const files = await collectFiles(absPath);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

    sendEvent(controller, encoder, {
      type: "status",
      message: "S3 버킷을 확인하는 중입니다.",
    });

    await ensureBucket();
    const bucket = await getBucketName();

    sendEvent(controller, encoder, {
      type: "start",
      source: absPath,
      bucket,
      host,
      totalFiles: files.length,
      totalBytes,
    });

    let uploadedFiles = 0;
    let uploadedBytes = 0;

    for (const file of files) {
      const rel = stat.isFile()
        ? baseName
        : path.join(baseName, path.relative(rootDir, file.path));
      const key = `${host}/${rel}`.replace(/\\/g, "/").replace(/\/+/g, "/");

      let result: BackupResult;

      try {
        if (skipExisting && (await hasMatchingUploadedObject(bucket, key, file))) {
          result = { key, size: file.size, ok: true, skipped: true };
          results.push(result);
          uploadedFiles++;
          uploadedBytes += file.size;

          sendEvent(controller, encoder, {
            type: "file",
            result,
            uploadedFiles,
            uploadedBytes,
            totalFiles: files.length,
            totalBytes,
          });
          continue;
        }

        let currentFileLoaded = 0;
        const uploader = new Upload({
          client: s3,
          params: {
            Bucket: bucket,
            Key: key,
            Body: createReadStream(file.path),
            StorageClass: "STANDARD_IA",
            Metadata: {
              "local-size": String(file.size),
              "local-mtime-ms": String(Math.trunc(file.mtimeMs)),
            },
          },
        });

        uploader.on("httpUploadProgress", (progress) => {
          const loaded = progress.loaded ?? currentFileLoaded;
          currentFileLoaded = loaded;
          sendEvent(controller, encoder, {
            type: "progress",
            key,
            uploadedFiles,
            totalFiles: files.length,
            currentFileLoaded: loaded,
            currentFileSize: file.size,
            uploadedBytes: uploadedBytes + loaded,
            totalBytes,
          });
        });

        await uploader.done();
        result = { key, size: file.size, ok: true };

        if (verifyChecksum) {
          sendEvent(controller, encoder, {
            type: "verify",
            key,
            uploadedFiles,
            totalFiles: files.length,
            uploadedBytes: uploadedBytes + file.size,
            totalBytes,
          });

          const [localSha256, s3Sha256] = await Promise.all([
            sha256File(file.path),
            sha256S3Object(bucket, key),
          ]);
          const checksumOk = localSha256 === s3Sha256;
          result = {
            ...result,
            ok: checksumOk,
            checksumOk,
            localSha256,
            s3Sha256,
            error: checksumOk ? undefined : "SHA-256 checksum 불일치",
          };
        }
      } catch (err) {
        result = {
          key,
          size: file.size,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      results.push(result);
      uploadedFiles++;
      uploadedBytes += file.size;

      sendEvent(controller, encoder, {
        type: "file",
        result,
        uploadedFiles,
        uploadedBytes,
        totalFiles: files.length,
        totalBytes,
      });
    }

    const failed = results.filter((r) => !r.ok).length;
    const skipped = results.filter((r) => r.skipped).length;
    sendEvent(controller, encoder, {
      type: "done",
      source: absPath,
      uploaded: results.length - failed - skipped,
      failed,
      skipped,
      bucket,
      host,
      results,
    });
  } catch (err) {
    sendEvent(controller, encoder, {
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    controller.close();
  }
}

export async function POST(req: NextRequest) {
  const guard = requireAdmin();
  if (guard) return guard;

  try {
    const body = await req.json();
    const rawPath = String(body.path || "").trim();
    const host = String(body.host || getDefaultHost());
    const verifyChecksum = body.verifyChecksum === true;
    const skipExisting = body.skipExisting !== false;

    if (!rawPath) {
      return NextResponse.json({ error: "path가 필요합니다." }, { status: 400 });
    }

    const absPath = path.resolve(expandHome(rawPath));

    let stat: Stats;
    try {
      stat = statSync(absPath);
    } catch {
      return NextResponse.json(
        { error: `경로가 존재하지 않습니다: ${absPath}` },
        { status: 400 },
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void streamBackupProgress(
          controller,
          encoder,
          absPath,
          host,
          stat,
          verifyChecksum,
          skipExisting,
        );
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
