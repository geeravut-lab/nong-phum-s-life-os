import { Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarCheck,
  FileText,
  HandHelping,
  Home,
  ListTodo,
  MessageCircleHeart,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export function PhumMark({ className = "size-9" }: { className?: string }) {
  return (
    <span
      className={`inline-flex ${className} items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft`}
      aria-hidden="true"
    >
      <CalendarCheck className="size-1/2" />
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const nav = [
    { to: "/today", label: t.navToday, icon: Home },
    { to: "/chat", label: t.navChat, icon: MessageCircleHeart },
    { to: "/docs", label: t.navDocs, icon: FileText },
    { to: "/tasks", label: t.navTasks, icon: ListTodo },
    { to: "/money", label: t.navMoney, icon: Wallet },
    { to: "/family", label: t.navFamily, icon: Users },
    { to: "/helpme", label: t.navHelpMe, icon: HandHelping },
  ] as const;


  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen bg-background md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-4 md:flex">
        <Link to="/today" className="mb-6 flex items-center gap-2">
          <PhumMark />
          <span className="font-semibold tracking-tight">{t.appName}</span>
        </Link>
        {nav.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            activeProps={{ className: "bg-primary/10 text-primary" }}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        ))}
        <div className="mt-auto flex flex-col gap-1">
          <Link
            to="/settings"
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent"
            activeProps={{ className: "bg-primary/10 text-primary" }}
          >
            <Settings className="size-4" />
            {t.navSettings}
          </Link>
          <Button variant="ghost" size="sm" className="justify-start" onClick={signOut}>
            {t.signOut}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:hidden">
          <Link to="/today" className="flex items-center gap-2">
            <PhumMark className="size-8" />
            <span className="font-semibold">{t.appName}</span>
          </Link>
          <Link to="/settings" aria-label={t.navSettings}>
            <Settings className="size-5 text-muted-foreground" />
          </Link>
        </header>

        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-28 pt-5 md:pb-12 md:pt-8">
          {children}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-7 border-t border-border bg-background/95 backdrop-blur md:hidden">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex flex-col items-center gap-1 py-2 text-[10px] font-medium text-muted-foreground"
              activeProps={{ className: "text-primary" }}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
