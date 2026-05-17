import { NextResponse } from "next/server";

export function isAdminEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_LOCAL_ADMIN === "true";
}

export function requireAdmin(): NextResponse | null {
  if (!isAdminEnabled()) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  return null;
}
