import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const restApiKey = process.env.KAKAO_REST_API_KEY;
  const redirectUri = process.env.KAKAO_REDIRECT_URI ?? `${url.origin}/api/kakao/callback`;

  if (!userId || !restApiKey) {
    return NextResponse.redirect(new URL("/settings?kakao=missing_config", url.origin));
  }

  const authorizeUrl = new URL("https://kauth.kakao.com/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", restApiKey);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "talk_message");
  authorizeUrl.searchParams.set("state", userId);

  return NextResponse.redirect(authorizeUrl);
}
