import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const userId = url.searchParams.get("state");
  const restApiKey = process.env.KAKAO_REST_API_KEY;
  const clientSecret = process.env.KAKAO_CLIENT_SECRET;
  const redirectUri = process.env.KAKAO_REDIRECT_URI ?? `${url.origin}/api/kakao/callback`;
  const supabase = createSupabaseAdmin();

  if (!code || !userId || !restApiKey || !supabase) {
    return NextResponse.redirect(new URL("/settings?kakao=missing_config", url.origin));
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: restApiKey,
    redirect_uri: redirectUri,
    code,
  });

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const tokenResponse = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
  });

  if (!tokenResponse.ok) {
    return NextResponse.redirect(new URL("/settings?kakao=token_error", url.origin));
  }

  const token = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
  };

  const { error } = await supabase
    .from("profiles")
    .update({
      kakao_linked: true,
      kakao_access_token: token.access_token,
      kakao_refresh_token: token.refresh_token ?? null,
    })
    .eq("id", userId);

  if (error) {
    return NextResponse.redirect(new URL("/settings?kakao=save_error", url.origin));
  }

  return NextResponse.redirect(new URL("/settings?kakao=linked", url.origin));
}
