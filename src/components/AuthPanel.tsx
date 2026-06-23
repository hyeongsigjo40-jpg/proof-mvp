"use client";

import { FormEvent, useState } from "react";
import { Mail } from "lucide-react";
import { hasSupabaseConfig } from "@/lib/supabase";
import { signInWithEmail } from "@/lib/proof-store";

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    try {
      await signInWithEmail(email);
      setMessage("메일함에서 로그인 링크를 확인해주세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "메일을 보내지 못했어요.");
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
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? "보내는 중" : "로그인 링크 받기"}
      </button>
      {message ? <p className="form-message">{message}</p> : null}
    </form>
  );
}
