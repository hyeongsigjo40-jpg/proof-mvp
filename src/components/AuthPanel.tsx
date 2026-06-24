"use client";

import { FormEvent, useState } from "react";
import { Lock, Mail } from "lucide-react";
import { hasSupabaseConfig } from "@/lib/supabase";
import { signInWithPassword, signUpWithPassword } from "@/lib/proof-store";

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await authenticate("login");
  }

  async function authenticate(mode: "login" | "signup") {
    setPending(true);
    setMessage(null);

    try {
      if (mode === "login") {
        await signInWithPassword(email, password);
        setMessage("로그인했어요. 화면을 새로 불러옵니다.");
        window.location.reload();
      } else {
        await signUpWithPassword(email, password);
        setSignupSuccess(true);
        setMessage("계정이 생성됐어요.");
      }
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
    <>
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
          <button className="secondary-action no-margin" disabled={pending} onClick={() => void authenticate("signup")} type="button">
            계정 만들기
          </button>
        </div>
        {message ? <p className="form-message">{message}</p> : null}
      </form>

      {signupSuccess ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="signup-success-title">
            <h2 id="signup-success-title">계정이 생성됐어요</h2>
            <button className="primary-button" onClick={() => window.location.reload()} type="button">
              확인
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
