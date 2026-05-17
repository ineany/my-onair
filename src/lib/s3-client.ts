import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketVersioningCommand,
  PutBucketEncryptionCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import os from "node:os";

export const AWS_REGION = process.env.AWS_REGION || "ap-northeast-2";
const EXPLICIT_BUCKET_NAME = process.env.BACKUP_BUCKET_NAME;
const BUCKET_PREFIX = process.env.BACKUP_BUCKET_PREFIX || "my-onair-backup";
const AUTO_CREATE_BUCKET = process.env.BACKUP_BUCKET_AUTO_CREATE === "true";
const S3_LIST_MAX_KEYS = parsePositiveInt(
  process.env.ADMIN_S3_LIST_MAX_KEYS,
  300,
);

let cachedBucket: string | null = null;
let cachedAccountId: string | null = null;
let bucketEnsured = false;
let ensureBucketPromise: Promise<string> | null = null;

export const s3 = new S3Client({ region: AWS_REGION });
const sts = new STSClient({ region: AWS_REGION });

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function getAccountId(): Promise<string> {
  if (cachedAccountId) return cachedAccountId;
  try {
    const res = await sts.send(new GetCallerIdentityCommand({}));
    if (!res.Account) throw new Error("Account ID 조회 실패");
    cachedAccountId = res.Account;
    return res.Account;
  } catch (err) {
    throw new Error(
      `AWS 인증 실패: ${err instanceof Error ? err.message : String(err)}. 'aws configure' 또는 자격증명을 확인하세요.`,
    );
  }
}

export async function getBucketName(): Promise<string> {
  if (cachedBucket) return cachedBucket;
  if (EXPLICIT_BUCKET_NAME) {
    cachedBucket = EXPLICIT_BUCKET_NAME;
    return cachedBucket;
  }
  const accountId = await getAccountId();
  cachedBucket = `${BUCKET_PREFIX}-${accountId}`;
  return cachedBucket;
}

export function getDefaultHost(): string {
  try {
    return os.hostname().split(".")[0] || "local";
  } catch {
    return "local";
  }
}

export async function ensureBucket(): Promise<string> {
  if (bucketEnsured) return getBucketName();
  if (ensureBucketPromise) return ensureBucketPromise;

  ensureBucketPromise = ensureBucketOnce().finally(() => {
    ensureBucketPromise = null;
  });

  return ensureBucketPromise;
}

async function ensureBucketOnce(): Promise<string> {
  const bucket = await getBucketName();

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    bucketEnsured = true;
    return bucket;
  } catch (err) {
    if (!AUTO_CREATE_BUCKET) {
      throw new Error(
        `S3 버킷 확인 실패: ${bucket}. 버킷을 미리 생성하거나 BACKUP_BUCKET_NAME에 기존 버킷명을 설정하세요. 자동 생성을 원하면 BACKUP_BUCKET_AUTO_CREATE=true와 s3:CreateBucket 권한이 필요합니다. 원인: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        CreateBucketConfiguration:
          AWS_REGION === "us-east-1"
            ? undefined
            : { LocationConstraint: AWS_REGION as never },
      }),
    );

    await s3
      .send(
        new PutPublicAccessBlockCommand({
          Bucket: bucket,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        }),
      )
      .catch(() => undefined);

    await s3
      .send(
        new PutBucketVersioningCommand({
          Bucket: bucket,
          VersioningConfiguration: { Status: "Enabled" },
        }),
      )
      .catch(() => undefined);

    await s3
      .send(
        new PutBucketEncryptionCommand({
          Bucket: bucket,
          ServerSideEncryptionConfiguration: {
            Rules: [
              { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
            ],
          },
        }),
      )
      .catch(() => undefined);

    bucketEnsured = true;
    return bucket;
  } catch (err) {
    throw new Error(
      `버킷 생성 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export type S3Entry = {
  type: "file" | "folder";
  key: string;
  name: string;
  size?: number;
  lastModified?: string;
};

export type S3ListResult = {
  entries: S3Entry[];
  truncated: boolean;
  maxKeys: number;
};

export async function listEntries(prefix: string): Promise<S3ListResult> {
  const bucket = await getBucketName();
  const normalized = prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix;

  const entries: S3Entry[] = [];

  try {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalized,
        Delimiter: "/",
        MaxKeys: S3_LIST_MAX_KEYS,
      }),
    );

    for (const cp of res.CommonPrefixes || []) {
      if (!cp.Prefix) continue;
      const name = cp.Prefix.slice(normalized.length).replace(/\/$/, "");
      entries.push({ type: "folder", key: cp.Prefix, name });
    }

    for (const obj of res.Contents || []) {
      if (!obj.Key || obj.Key === normalized) continue;
      const name = obj.Key.slice(normalized.length);
      if (!name) continue;
      entries.push({
        type: "file",
        key: obj.Key,
        name,
        size: obj.Size,
        lastModified: obj.LastModified?.toISOString(),
      });
    }

    return {
      entries,
      truncated: Boolean(res.IsTruncated),
      maxKeys: S3_LIST_MAX_KEYS,
    };
  } catch (err) {
    throw new Error(
      `S3 목록 조회 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { entries, truncated: false, maxKeys: S3_LIST_MAX_KEYS };
}

export async function listHosts(): Promise<string[]> {
  const bucket = await getBucketName();
  try {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Delimiter: "/" }),
    );
    return (res.CommonPrefixes || [])
      .map((cp) => cp.Prefix?.replace(/\/$/, ""))
      .filter((v): v is string => !!v);
  } catch (err) {
    const code = (err as { name?: string }).name;
    if (code === "NoSuchBucket") return [];
    throw new Error(
      `호스트 목록 조회 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function headObject(key: string) {
  const bucket = await getBucketName();
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  const bucket = await getBucketName();
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    throw new Error(
      `객체 삭제 실패 (${key}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function deletePrefix(prefix: string): Promise<number> {
  const bucket = await getBucketName();
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  let deleted = 0;
  let token: string | undefined;

  try {
    do {
      const res = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: normalized,
          ContinuationToken: token,
        }),
      );
      const keys = (res.Contents || []).map((o) => o.Key!).filter(Boolean);
      for (const key of keys) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        deleted++;
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  } catch (err) {
    throw new Error(
      `접두사 삭제 실패 (${prefix}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return deleted;
}

export async function makePresignedGetUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const bucket = await getBucketName();
  try {
    return await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn },
    );
  } catch (err) {
    throw new Error(
      `Pre-signed URL 발급 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function makePresignedPutUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const bucket = await getBucketName();
  try {
    return await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      { expiresIn },
    );
  } catch (err) {
    throw new Error(
      `Pre-signed 업로드 URL 발급 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
