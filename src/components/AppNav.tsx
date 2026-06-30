"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Home, NotebookText, Settings, Target } from "lucide-react";

const items = [
  { href: "/", label: "홈", icon: Home },
  { href: "/", label: "목표", icon: Target, mobileOnly: true, view: "goal" },
  { href: "/record", label: "기록", icon: NotebookText },
  { href: "/settings", label: "설정", icon: Settings },
];

function useActiveDebugScope() {
  const searchParams = useSearchParams();
  const debugScope = searchParams.get("scope");
  const debugEnabled = searchParams.get("debug") === "1" || Boolean(debugScope?.startsWith("debug:"));
  const [debugSessionId, setDebugSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!debugEnabled || debugScope?.startsWith("debug:")) return;
    setDebugSessionId(window.localStorage.getItem("proof-elastic-debug-session"));
  }, [debugEnabled, debugScope]);

  const activeScope = debugScope?.startsWith("debug:")
    ? debugScope
    : debugEnabled && debugSessionId
      ? `debug:${debugSessionId}`
      : null;

  return activeScope;
}

function resolveScopedHref(href: string, activeScope: string | null, view?: string) {
  if (href === "/") {
    const params = new URLSearchParams();
    if (view) params.set("view", view);
    if (activeScope) {
      params.set("debug", "1");
      params.set("scope", activeScope);
    }
    const query = params.toString();
    return query ? `/?${query}` : "/";
  }
  if (activeScope && href === "/record") return `/record?scope=${encodeURIComponent(activeScope)}`;
  return href;
}

export function BrandLink({ children, className }: { children: ReactNode; className?: string }) {
  const activeScope = useActiveDebugScope();

  return (
    <Link className={className} href={resolveScopedHref("/", activeScope)}>
      {children}
    </Link>
  );
}

export function AppNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeScope = useActiveDebugScope();
  const activeView = searchParams.get("view");

  function resolveHref(href: string, view?: string) {
    return resolveScopedHref(href, activeScope, view);
  }

  function isActive(href: string, view?: string) {
    if (view === "goal") {
      return pathname === "/" && activeView === "goal";
    }
    if (href === "/") {
      return pathname === "/" && activeView !== "goal";
    }
    return pathname.startsWith(href);
  }

  return (
    <nav className="side-nav" aria-label="주요 화면">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href, item.view);
        const href = resolveHref(item.href, item.view);
        const className = [
          "nav-item",
          active ? "active" : "",
          item.mobileOnly ? "mobile-only" : "",
        ].filter(Boolean).join(" ");

        return (
          <Link className={className} href={href} key={`${item.href}-${item.label}`}>
            <Icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
