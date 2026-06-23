"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarCheck, ListChecks } from "lucide-react";

const items = [
  { href: "/evening", label: "회고", icon: CalendarCheck },
  { href: "/record", label: "기록", icon: ListChecks },
  { href: "/settings", label: "설정", icon: Bell },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="주요 화면">
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;

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
