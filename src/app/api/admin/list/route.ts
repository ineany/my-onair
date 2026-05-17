import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { listEntries, ensureBucket } from "@/lib/s3-client";

export async function GET(req: NextRequest) {
  const guard = requireAdmin();
  if (guard) return guard;

  try {
    await ensureBucket();
    const prefix = req.nextUrl.searchParams.get("prefix") || "";

    if (prefix.includes("..")) {
      return NextResponse.json(
        { error: "잘못된 prefix" },
        { status: 400 },
      );
    }

    const result = await listEntries(prefix);
    return NextResponse.json({ prefix, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
