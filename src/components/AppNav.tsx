"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Home, NotebookText, Settings } from "lucide-react";

const items = [
  { href: "/", label: "홈", icon: Home },
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

function resolveScopedHref(href: string, activeScope: string | null) {
  if (!activeScope) return href;
  if (href === "/") return `/?debug=1&scope=${encodeURIComponent(activeScope)}`;
  if (href === "/record") return `/record?scope=${encodeURIComponent(activeScope)}`;
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
  const activeScope = useActiveDebugScope();

  function resolveHref(href: string) {
    return resolveScopedHref(href, activeScope);
  }

  return (
    <nav className="side-nav" aria-label="주요 화면">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const href = resolveHref(item.href);

        return (
          <Link className={active ? "nav-item active" : "nav-item"} href={href} key={item.href}>
            <Icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
