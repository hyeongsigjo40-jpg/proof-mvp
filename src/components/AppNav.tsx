"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Settings } from "lucide-react";

const items = [
  { href: "/", label: "홈", icon: Home },
  { href: "/settings", label: "설정", icon: Settings },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="side-nav" aria-label="주요 화면">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        return (
          <Link className={active ? "nav-item active" : "nav-item"} href={item.href} key={item.href}>
            <Icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
