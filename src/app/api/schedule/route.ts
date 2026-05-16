import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const preferredRegion = "icn1";

interface ScheduleItem {
  time: string;
  endTime: string;
  title: string;
  isOnAir?: boolean;
  subtitle?: string;
  programImage?: string;
}

interface ScheduleResponse {
  channel: string;
  date: string;
  nowPlaying?: {
    title: string;
    subtitle: string;
    startTime: string;
    endTime: string;
    image?: string;
  };
  upNext?: {
    title: string;
    subtitle: string;
    startTime: string;
    endTime: string;
  };
  schedule: ScheduleItem[];
}

const channelConfig: Record<string, {
  kbsApiCode: string;
  scheduleSource: { type: "kbs" | "kbsn"; code: string };
}> = {
  ch1:   { kbsApiCode: "11",  scheduleSource: { type: "kbs", code: "11" } },
  ch2:   { kbsApiCode: "12",  scheduleSource: { type: "kbs", code: "12" } },
  drama: { kbsApiCode: "N91", scheduleSource: { type: "kbsn", code: "drama" } },
  joy:   { kbsApiCode: "N92", scheduleSource: { type: "kbsn", code: "joy" } },
  news:  { kbsApiCode: "14",  scheduleSource: { type: "kbs", code: "11" } },
};

const BROADCAST_DAY_START_HOUR = 4;

function formatTime(raw: string): string {
  const h = raw.substring(0, 2);
  const m = raw.substring(2, 4);
  return `${h}:${m}`;
}

/**
 * 방송 편성일 기준 날짜 반환.
 * 새벽 4시 이전이면 전날 편성표를 사용한다.
 */
function getBroadcastDate(): Date {
  const now = new Date();
  if (now.getHours() < BROADCAST_DAY_START_HOUR) {
    now.setDate(now.getDate() - 1);
  }
  return now;
}

function getBroadcastDateStr(): string {
  const d = getBroadcastDate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function getDayLabel(): string {
  const d = getBroadcastDate();
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

async function fetchOnAirNow(channelCode: string) {
  try {
    const url = `https://static.api.kbs.co.kr/mediafactory/v1/schedule/onair_now?local_station_code=00&channel_code=${channelCode}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 60 },
    });
    const data = await res.json();

    const channel = data.find((c: { channel_code: string }) => c.channel_code === channelCode);
    if (!channel?.schedules?.length) return { now: null, next: null };

    const schedules = channel.schedules;
    const now = schedules[0]
      ? {
          title: schedules[0].program_title,
          subtitle: schedules[0].program_subtitle || "",
          startTime: formatTime(schedules[0].service_start_time),
          endTime: formatTime(schedules[0].service_end_time),
          image: schedules[0].image_w || undefined,
        }
      : null;

    const next = schedules[1]
      ? {
          title: schedules[1].program_title,
          subtitle: schedules[1].program_subtitle || "",
          startTime: formatTime(schedules[1].service_start_time),
          endTime: formatTime(schedules[1].service_end_time),
        }
      : null;

    return { now, next };
  } catch {
    return { now: null, next: null };
  }
}

async function fetchKbsSchedule(chCode: string): Promise<ScheduleItem[]> {
  try {
    const url = `http://able.kbs.co.kr/list/pyunsung.html?ch=${chCode}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 3600 },
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: ScheduleItem[] = [];

    $("table tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 2) return;
      const timeText = $(cells[0]).text().trim();
      const title = $(cells[1]).text().trim();
      if (!timeText || !title) return;
      const match = timeText.match(/(\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})/);
      if (match) {
        items.push({ time: match[1], endTime: match[2], title });
      }
    });

    return items;
  } catch {
    return [];
  }
}

async function fetchKbsnSchedule(bdcstCode: string): Promise<ScheduleItem[]> {
  try {
    const dateStr = getBroadcastDateStr();
    const url = `https://www.kbsn.co.kr/schedule/?wdate=${dateStr}&bdcst_code=${bdcstCode}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 3600 },
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    const timeBlocks: { time: string; title: string }[] = [];

    $(".sch_list li, .schedule_list li, .list_area li").each((_, el) => {
      const timeEl = $(el).find(".sch_time, .time, strong").first();
      const titleEl = $(el).find(".sch_tit, .title, .tit, a").first();
      const time = timeEl.text().trim();
      const title = titleEl.text().trim();
      if (time && title && /^\d{2}:\d{2}$/.test(time)) {
        timeBlocks.push({ time, title });
      }
    });

    if (timeBlocks.length === 0) {
      const text = $("body").text();
      const regex = new RegExp("(\\d{2}:\\d{2})\\s*\\n\\s*(.+?)(?=\\d{2}:\\d{2}|\\n\\n|위 편성표|$)", "gs");
      let m;
      while ((m = regex.exec(text)) !== null) {
        const time = m[1].trim();
        let title = m[2].trim().split("\n")[0].trim();
        title = title.replace(/[생본녹]\s*\d+\s*$/, "").trim();
        if (time && title && title.length > 1) {
          timeBlocks.push({ time, title });
        }
      }
    }

    const items: ScheduleItem[] = [];
    for (let i = 0; i < timeBlocks.length; i++) {
      const endTime = i + 1 < timeBlocks.length
        ? timeBlocks[i + 1].time
        : addMinutes(timeBlocks[i].time, 60);
      items.push({ time: timeBlocks[i].time, endTime, title: timeBlocks[i].title });
    }

    return items;
  } catch {
    return [];
  }
}

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  const channelId = request.nextUrl.searchParams.get("channel");

  if (!channelId) {
    return NextResponse.json({ error: "channel 파라미터가 필요합니다" }, { status: 400 });
  }

  const config = channelConfig[channelId];
  if (!config) {
    return NextResponse.json({ error: "편성표를 지원하지 않는 채널입니다" }, { status: 404 });
  }

  const [onAir, scheduleItems] = await Promise.all([
    fetchOnAirNow(config.kbsApiCode),
    config.scheduleSource.type === "kbs"
      ? fetchKbsSchedule(config.scheduleSource.code)
      : fetchKbsnSchedule(config.scheduleSource.code),
  ]);

  if (onAir.now) {
    for (const item of scheduleItems) {
      if (item.time === onAir.now.startTime) {
        item.isOnAir = true;
        break;
      }
    }
  }

  const response: ScheduleResponse = {
    channel: channelId,
    date: getDayLabel(),
    nowPlaying: onAir.now || undefined,
    upNext: onAir.next || undefined,
    schedule: scheduleItems,
  };

  return NextResponse.json(response);
}
