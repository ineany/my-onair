import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { ensureBucket, listHosts, getDefaultHost } from "@/lib/s3-client";

export async function GET() {
  const guard = requireAdmin();
  if (guard) return guard;

  try {
    await ensureBucket();
    const hosts = await listHosts();
    return NextResponse.json({
      hosts,
      defaultHost: getDefaultHost(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
