import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  const enabled = process.env.NEXT_PUBLIC_ENABLE_LOCAL_ADMIN === "true";
  if (!enabled) {
    return new NextResponse("Not Found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
