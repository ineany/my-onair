import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const preferredRegion = "icn1";

const KBS_API_BASE =
  "https://cfpwwwapi.kbs.co.kr/api/v1/landing/live/channel_code";

interface ChannelConfig {
  name: string;
  channelCode: string;
  mediaType: string;
}

const channelMap: Record<string, ChannelConfig> = {
  ch1: { name: "KBS 1TV", channelCode: "11", mediaType: "tv" },
  ch2: { name: "KBS 2TV", channelCode: "12", mediaType: "tv" },
  news: { name: "KBS 뉴스24", channelCode: "14", mediaType: "tv" },
  drama: { name: "KBS 드라마", channelCode: "N91", mediaType: "tv" },
  joy: { name: "KBS Joy", channelCode: "N92", mediaType: "tv" },
};

interface KbsChannelItem {
  service_url: string;
  media_type: string;
  channel_code: string;
  channel_id: string;
}

interface KbsApiResponse {
  ret: number;
  channel_item: KbsChannelItem[];
}

async function fetchStreamUrl(
  channelCode: string,
  mediaType: string
): Promise<string | null> {
  const res = await fetch(`${KBS_API_BASE}/${channelCode}`, {
    headers: {
      Referer: "https://onair.kbs.co.kr/",
      Origin: "https://onair.kbs.co.kr",
    },
    next: { revalidate: 120 },
  });

  if (!res.ok) return null;

  const data: KbsApiResponse = await res.json();
  if (data.ret !== 0 || !data.channel_item) return null;

  const item = data.channel_item.find((i) => i.media_type === mediaType);
  return item?.service_url || null;
}

export async function GET(request: NextRequest) {
  const channelId = request.nextUrl.searchParams.get("channel");

  if (!channelId) {
    return NextResponse.json(
      { error: "channel 파라미터가 필요합니다" },
      { status: 400 }
    );
  }

  const config = channelMap[channelId];
  if (!config) {
    return NextResponse.json(
      { error: "존재하지 않는 채널입니다" },
      { status: 404 }
    );
  }

  const streamUrl = await fetchStreamUrl(config.channelCode, config.mediaType);

  if (!streamUrl) {
    return NextResponse.json(
      { error: "스트림 URL을 가져올 수 없습니다" },
      { status: 502 }
    );
  }

  const finalUrl = `/api/proxy?url=${encodeURIComponent(streamUrl)}`;

  return NextResponse.json({
    channel: channelId,
    name: config.name,
    streamUrl: finalUrl,
    type: "live",
  });
}
