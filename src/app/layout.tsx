import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";
import { copy } from "@/lib/copy";
import "./globals.css";

export const metadata: Metadata = {
  title: "Proof MVP",
  description: "짧은 계획, 확인, 기록으로 습관 실행을 이어가는 MVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <div className="app-frame">
          <header className="top-bar">
            <a className="brand" href="/">
              {copy.appName}
            </a>
          </header>
          {children}
          <AppNav />
        </div>
      </body>
    </html>
  );
}
