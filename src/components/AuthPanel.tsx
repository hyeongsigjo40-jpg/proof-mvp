"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Lock, Mail } from "lucide-react";
import { hasSupabaseConfig } from "@/lib/supabase";
import { signInWithPassword } from "@/lib/proof-store";

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    try {
      await signInWithPassword(email, password);
      setMessage("로그인했어요. 화면을 새로 불러옵니다.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인증을 처리하지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  if (!hasSupabaseConfig) {
    return (
      <div className="notice">
        <strong>데모 모드</strong>
        <p>Supabase 환경변수가 없어 브라우저 저장소로 먼저 체험할 수 있어요.</p>
      </div>
    );
  }

  return (
    <form className="auth-panel" onSubmit={handleSubmit}>
      <label htmlFor="email">이메일</label>
      <div className="input-with-icon">
        <Mail size={18} aria-hidden="true" />
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </div>

      <label htmlFor="password">비밀번호</label>
      <div className="input-with-icon">
        <Lock size={18} aria-hidden="true" />
        <input
          id="password"
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="6자 이상"
        />
      </div>

      <div className="auth-actions">
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? "처리 중" : "로그인"}
        </button>
        <Link className="secondary-action no-margin" href="/signup">
          계정 만들기
        </Link>
      </div>
      {message ? <p className="form-message">{message}</p> : null}
    </form>
  );
}
