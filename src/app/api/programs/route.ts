import { NextRequest, NextResponse } from "next/server";

export const preferredRegion = "icn1";

interface RawProgram {
  program_code: string;
  title: string;
  program_title: string;
  channel_code: string;
  actors: string | null;
  staff: string | null;
  program_intention_short: string | null;
  program_intention: string | null;
  homepage_url: string | null;
  deliberation_grade_code: string | null;
  episode_total_number: number | null;
  program_start_date: string | null;
  program_end_date: string | null;
  image_list: {
    image_w?: string;
    image_h?: string;
    pc_thumb_home1_img_url?: string;
    mobile_thumb_home1_img_url?: string;
  };
}

export interface ProgramInfo {
  programCode: string;
  title: string;
  fullTitle: string;
  channelCode: string;
  actors: string;
  description: string;
  thumbnail: string;
  homepageUrl: string;
  episodeCount: number | null;
}

// 우리 채널 ID → KBS channel_code 매핑
const channelCodeMap: Record<string, string[]> = {
  ch1: ["11"],
  ch2: ["12"],
  drama: ["11", "12"],
  joy: ["11", "12"],
  news: ["11"],
};

let cachedData: { programs: ProgramInfo[]; fetchedAt: number } | null = null;
const CACHE_TTL = 3600_000; // 1시간

async function fetchPrograms(): Promise<ProgramInfo[]> {
  if (cachedData && Date.now() - cachedData.fetchedAt < CACHE_TTL) {
    return cachedData.programs;
  }

  const res = await fetch(
    "https://static.kbs.co.kr/kanal/weeklypopularprograms.json",
    { headers: { "User-Agent": "Mozilla/5.0" } }
  );
  const json = await res.json();
  const raw: RawProgram[] = json.data || [];

  const programs: ProgramInfo[] = raw.map((p) => ({
    programCode: p.program_code,
    title: p.title,
    fullTitle: p.program_title,
    channelCode: p.channel_code,
    actors: p.actors || "",
    description: p.program_intention_short || p.program_intention || "",
    thumbnail:
      p.image_list?.pc_thumb_home1_img_url ||
      p.image_list?.image_w ||
      p.image_list?.mobile_thumb_home1_img_url ||
      "",
    homepageUrl: p.homepage_url
      ? `https://program.kbs.co.kr${p.homepage_url}`
      : "",
    episodeCount: p.episode_total_number,
  }));

  cachedData = { programs, fetchedAt: Date.now() };
  return programs;
}

export async function GET(request: NextRequest) {
  const channelId = request.nextUrl.searchParams.get("channel");

  try {
    const allPrograms = await fetchPrograms();

    if (channelId) {
      const codes = channelCodeMap[channelId];
      if (!codes) {
        return NextResponse.json({ programs: allPrograms });
      }
      const filtered = allPrograms.filter((p) =>
        codes.includes(p.channelCode)
      );
      return NextResponse.json({ programs: filtered });
    }

    return NextResponse.json({ programs: allPrograms });
  } catch (err) {
    const message = err instanceof Error ? err.message : "프로그램 로딩 실패";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
