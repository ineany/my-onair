import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

export async function GET(req: NextRequest) {
  const guard = requireAdmin();
  if (guard) return guard;

  if (process.platform !== "darwin") {
    return NextResponse.json(
      { error: "로컬 경로 선택은 현재 macOS에서만 지원합니다." },
      { status: 400 },
    );
  }

  const kind = req.nextUrl.searchParams.get("kind") === "file" ? "file" : "folder";
  const prompt =
    kind === "file"
      ? "Select one or more files to back up"
      : "Select one or more folders to back up";
  const chooseCommand =
    kind === "file"
      ? `choose file with prompt "${prompt}" with multiple selections allowed`
      : `choose folder with prompt "${prompt}" with multiple selections allowed`;
  const script = `
set selectedItems to ${chooseCommand}
set output to ""
repeat with selectedItem in selectedItems
  set output to output & POSIX path of selectedItem & linefeed
end repeat
return output
`;

  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      timeout: 5 * 60 * 1000,
    });
    const paths = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return NextResponse.json({ path: paths[0] || "", paths, kind });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("User canceled") || message.includes("-128")) {
      return NextResponse.json({ cancelled: true, kind });
    }

    return NextResponse.json(
      { error: `경로 선택 실패: ${message}` },
      { status: 500 },
    );
  }
}
