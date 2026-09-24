import { Link, useNavigate } from "@tanstack/react-router";
import {
  FileText,
  HandHelping,
  Heart,
  MapPinned,
  Scale,
  ShieldCheck,
  Home,
  ListTodo,
  MessageCircleHeart,
  MoreHorizontal,
  Settings,
  ShieldEllipsis,
  Users,
  Wallet,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsAdmin } from "@/hooks/useIsAdmin";

export function PhumMark({ className = "size-9" }: { className?: string }) {
  return (
    <img
      src="/logo-256.png"
      alt=""
      aria-hidden="true"
      className={`${className} rounded-2xl object-cover shadow-soft`}
    />
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const { data: isAdmin } = useIsAdmin();

  const nav = [
    { to: "/today", label: t.navToday, icon: Home },
    { to: "/chat", label: t.navChat, icon: MessageCircleHeart },
    { to: "/docs", label: t.navDocs, icon: FileText },
    { to: "/tasks", label: t.navTasks, icon: ListTodo },
    { to: "/money", label: t.navMoney, icon: Wallet },
    { to: "/family", label: t.navFamily, icon: Users },
    { to: "/helpme", label: t.navHelpMe, icon: HandHelping },
    { to: "/benefits", label: t.navBenefits, icon: ShieldCheck },
    { to: "/decide", label: t.navDecide, icon: Scale },
    { to: "/local", label: t.navLocal, icon: MapPinned },
    { to: "/support", label: t.navSupport, icon: Heart },
  ] as const;

  const primaryNav = nav.slice(0, 4);
  const moreNav = nav.slice(4);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const linkClass =
    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent";
  const activeClass = "bg-primary/10 text-primary";

  return (
    <div className="min-h-screen bg-background md:flex">
      {/* Desktop sidebar — scrollable when nav exceeds viewport */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <div className="shrink-0 border-b border-border p-4">
          <Link to="/today" className="flex items-center gap-2">
            <PhumMark />
            <span className="font-semibold tracking-tight">{t.appName}</span>
          </Link>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-3">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={linkClass}
              activeProps={{ className: activeClass }}
            >
              <item.icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="shrink-0 space-y-1 border-t border-border p-3">
          {isAdmin ? (
            <Link to="/admin" className={linkClass} activeProps={{ className: activeClass }}>
              <ShieldEllipsis className="size-4 shrink-0" />
              <span className="truncate">{t.navAdmin}</span>
            </Link>
          ) : null}
          <Link to="/settings" className={linkClass} activeProps={{ className: activeClass }}>
            <Settings className="size-4 shrink-0" />
            <span className="truncate">{t.navSettings}</span>
          </Link>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
            {t.signOut}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 md:px-6 md:py-8">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
          {primaryNav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium text-muted-foreground"
              activeProps={{ className: "text-primary" }}
            >
              <item.icon className="size-5" />
              <span className="max-w-full truncate px-0.5">{item.label}</span>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium text-muted-foreground"
          >
            <MoreHorizontal className="size-5" />
            <span className="max-w-full truncate px-0.5">{t.navMore}</span>
          </button>
        </nav>

        {/* Mobile "More" sheet — scrollable; Admin pinned near top of secondary actions */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent
            side="left"
            className="flex h-dvh max-h-dvh w-[min(18rem,85vw)] flex-col gap-0 p-0"
          >
            <SheetHeader className="shrink-0 border-b border-border p-4">
              <SheetTitle className="flex items-center gap-2 text-left">
                <PhumMark className="size-8" />
                {t.appName}
              </SheetTitle>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
              <div className="flex flex-col gap-1">
                {moreNav.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className={linkClass}
                    activeProps={{ className: activeClass }}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="shrink-0 space-y-1 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {isAdmin ? (
                <Link
                  to="/admin"
                  onClick={() => setMoreOpen(false)}
                  className={linkClass}
                  activeProps={{ className: activeClass }}
                >
                  <ShieldEllipsis className="size-4 shrink-0" />
                  <span className="truncate">{t.navAdmin}</span>
                </Link>
              ) : null}
              <Link
                to="/settings"
                onClick={() => setMoreOpen(false)}
                className={linkClass}
                activeProps={{ className: activeClass }}
              >
                <Settings className="size-4 shrink-0" />
                <span className="truncate">{t.navSettings}</span>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  setMoreOpen(false);
                  void signOut();
                }}
              >
                {t.signOut}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
