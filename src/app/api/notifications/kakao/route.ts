import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

type ProfileRow = {
  id: string;
  habit_name: string;
  kakao_access_token: string | null;
  checkin_time: string;
};

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase service role config" }, { status: 500 });
  }

  const appUrl = process.env.APP_URL ?? new URL(request.url).origin;
  const now = new Date();
  const koreaTime = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(now);

  const { data, error } = await supabase
    .from("profiles")
    .select("id, habit_name, kakao_access_token, checkin_time")
    .eq("kakao_linked", true)
    .eq("checkin_time", `${koreaTime}:00`);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ProfileRow[];
  const results = await Promise.allSettled(rows.map((row) => sendKakaoMemo(row, appUrl)));

  return NextResponse.json({
    time: koreaTime,
    attempted: rows.length,
    sent: results.filter((result) => result.status === "fulfilled").length,
  });
}

async function sendKakaoMemo(profile: ProfileRow, appUrl: string) {
  if (!profile.kakao_access_token) {
    throw new Error("Missing Kakao access token");
  }

  const templateObject = {
    object_type: "text",
    text: `Proof 저녁 회고 시간이에요.\n오늘을 확인하고 내일의 한 줄을 정해볼까요?`,
    link: {
      web_url: `${appUrl}/evening`,
      mobile_web_url: `${appUrl}/evening`,
    },
    button_title: "저녁 회고 열기",
  };

  const response = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${profile.kakao_access_token}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: new URLSearchParams({
      template_object: JSON.stringify(templateObject),
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}
