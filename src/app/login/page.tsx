"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { copy } from "@/lib/copy";
import { signInWithPassword } from "@/lib/proof-store";
import { hasSupabaseConfig } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    try {
      await signInWithPassword(email, password);
      router.push("/");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인을 처리하지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-screen">
      <Link className="auth-screen-brand" href="/">
        {copy.appName}
      </Link>

      <section className="auth-screen-center" aria-labelledby="login-title">
        {!hasSupabaseConfig ? (
          <div className="auth-screen-copy">
            <p className="auth-screen-eyebrow">Demo mode</p>
            <h1 id="login-title">데모 모드로 체험 중입니다</h1>
            <p>Supabase 환경변수가 없어 별도 로그인 없이 홈에서 바로 체험할 수 있어요.</p>
            <Link className="auth-screen-primary" href="/">
              홈으로 돌아가기
            </Link>
          </div>
        ) : (
          <>
            <div className="auth-screen-copy">
              <p className="auth-screen-eyebrow">Proof 계정</p>
              <h1 id="login-title">로그인하기</h1>
              <p>이전에 만든 계정으로 로그인하고 기록을 이어서 관리하세요.</p>
            </div>

            <form className="auth-screen-form" onSubmit={handleSubmit}>
              <label className="auth-screen-field" htmlFor="login-email">
                <span>이메일 주소</span>
                <div className="auth-screen-control">
                  <Mail size={18} aria-hidden="true" />
                  <input
                    autoComplete="email"
                    autoFocus
                    id="login-email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                    type="email"
                    value={email}
                  />
                </div>
              </label>

              <label className="auth-screen-field" htmlFor="login-password">
                <span>비밀번호</span>
                <div className="auth-screen-control">
                  <Lock size={18} aria-hidden="true" />
                  <input
                    autoComplete="current-password"
                    id="login-password"
                    minLength={6}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="비밀번호"
                    required
                    type={showPassword ? "text" : "password"}
                    value={password}
                  />
                  <button
                    aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                    className="auth-screen-icon-button"
                    onClick={() => setShowPassword((current) => !current)}
                    type="button"
                  >
                    {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
                  </button>
                </div>
              </label>

              <button className="auth-screen-primary" disabled={pending} type="submit">
                {pending ? "처리 중" : "로그인"}
              </button>

              {message ? <p className="form-message">{message}</p> : null}
            </form>

            <div className="auth-screen-divider" aria-hidden="true">
              <span />
              <strong>또는</strong>
              <span />
            </div>

            <Link className="auth-screen-secondary" href="/signup">
              계정 생성하기
            </Link>
          </>
        )}
      </section>

      <Link className="auth-screen-back" href="/">
        <ArrowLeft size={16} aria-hidden="true" />
        홈으로 돌아가기
      </Link>
    </main>
  );
}
