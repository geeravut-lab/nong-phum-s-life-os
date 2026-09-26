import { toast } from "sonner";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { CalendarDays, FileText,
  HandHelping,
  Heart,
  MapPinned,
  Feather,
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
  Download,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useAuthUser } from "@/hooks/useAuthUser";
import {
  markNotificationsReadForPath,
  useInboxBadges,
} from "@/hooks/useInboxBadges";

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

function NavDot({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-red-500 ring-2 ring-background"
      aria-hidden
    />
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const { data: isAdmin } = useIsAdmin();
  const { user } = useAuthUser();

  const planQ = useQuery({
    queryKey: ["my-plan-badge", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("plan_tier, plan_expires_at")
        .eq("id", user!.id)
        .maybeSingle();
      return data as { plan_tier: string | null; plan_expires_at: string | null } | null;
    },
    staleTime: 60_000,
  });
  const planLabel =
    planQ.data?.plan_tier === "family"
      ? "Family"
      : planQ.data?.plan_tier === "premium"
        ? "Premium"
        : "Free";


  const [deferredPrompt, setDeferredPrompt] = useState<{
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  } | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setIsStandalone(standalone);
    // Capture any prompt stored early by root bootstrap
    const early = (window as unknown as { __pwaDeferred?: {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    } }).__pwaDeferred;
    if (early) setDeferredPrompt(early);
    const handler = (e: Event) => {
      e.preventDefault();
      const ev = e as unknown as {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: string }>;
      };
      (window as unknown as { __pwaDeferred?: typeof ev }).__pwaDeferred = ev;
      setDeferredPrompt(ev);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const onInstallApp = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch {
        /* ignore */
      }
      setDeferredPrompt(null);
      return;
    }
    const ua = navigator.userAgent || "";
    const isIos = /iPad|iPhone|iPod/.test(ua);
    if (isIos) {
      toast.message(t.installAppIos);
    } else {
      toast.message(t.installAppUnavailable);
    }
  };



  const adminPending = useQuery({
    queryKey: ["admin-pending-total"],
    enabled: !!isAdmin,
    refetchInterval: 15000,
    queryFn: async () => {
      const [d, s, p, prem] = await Promise.all([
        supabase.from("donations").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("safety_reports").select("id", { count: "exact", head: true }).in("status", ["open", "reviewing"]),
        supabase.from("job_payments").select("id", { count: "exact", head: true }).eq("payment_status", "held"),
        supabase.from("premium_payments").select("id", { count: "exact", head: true }).eq("payment_status", "pending"),
      ]);
      return (d.count ?? 0) + (s.count ?? 0) + (p.count ?? 0) + (prem.count ?? 0);
    },
  });
  const adminPendingTotal = adminPending.data ?? 0;

  
  const qc = useQueryClient();

  // Re-check admin role after login / user switch (no full page refresh needed)
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void qc.invalidateQueries({ queryKey: ["is-admin"] });
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [qc]);

  const { unreadByNav, totalUnread } = useInboxBadges();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const activeNavBase = useMemo(() => {
    if (!pathname) return "";
    if (pathname.startsWith("/helpme") || pathname.startsWith("/helper-dashboard")) return "/helpme";
    if (pathname.startsWith("/local")) return "/local";
    if (pathname.startsWith("/admin")) return "/admin";
    return pathname;
  }, [pathname]);

  // Hide red dots for the section the user is already viewing
  const visibleUnreadByNav = useMemo(() => {
    const map = new Map(unreadByNav);
    if (activeNavBase) map.delete(activeNavBase);
    return map;
  }, [unreadByNav, activeNavBase]);

  // Mark as read when entering a section OR when new notifs arrive while already there
  useEffect(() => {
    if (!user?.id || !activeNavBase) return;
    void markNotificationsReadForPath(user.id, activeNavBase).then(() => {
      void qc.invalidateQueries({ queryKey: ["app-notifications", user.id] });
    });
  }, [activeNavBase, user?.id, totalUnread, qc]);

  const nav = [
    { to: "/today", label: t.navToday, icon: Home },
    { to: "/chat", label: t.navChat, icon: MessageCircleHeart },
    { to: "/docs", label: t.navDocs, icon: FileText },
    { to: "/tasks", label: t.navTasks, icon: ListTodo },
    { to: "/agenda", label: t.navAgenda ?? "Agenda", icon: CalendarDays },
    { to: "/money", label: t.navMoney, icon: Wallet },
    { to: "/family", label: t.navFamily, icon: Users },
    { to: "/helpme", label: t.navHelpMe, icon: HandHelping },
    { to: "/benefits", label: t.navBenefits, icon: ShieldCheck },
    { to: "/decide", label: t.navDecide, icon: Scale },
    { to: "/local", label: t.navLocal, icon: MapPinned },
    { to: "/legacy", label: t.navLegacy, icon: Feather },
    { to: "/support", label: t.navSupport, icon: Heart },
  ] as const;

  const primaryNav = nav.slice(0, 4);
  const moreNav = nav.slice(4);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const linkClass =
    "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent";
  const activeClass = "bg-primary/10 text-primary";

  const hasBadge = (to: string) => (visibleUnreadByNav.get(to) ?? 0) > 0;
  const visibleTotal = useMemo(() => {
    let n = 0;
    for (const v of visibleUnreadByNav.values()) n += v;
    return n;
  }, [visibleUnreadByNav]);
  const moreHasBadge = moreNav.some((i) => hasBadge(i.to)) || hasBadge("/admin");

  return (
    <div className="min-h-screen bg-background md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <div className="shrink-0 border-b border-border p-4">
          <Link to="/today" className="flex items-center gap-2">
            <PhumMark />
            <span className="font-semibold tracking-tight">{t.appName}</span>
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {planLabel}
            </span>
            {visibleTotal > 0 && (
              <span className="ml-auto size-2 animate-pulse rounded-full bg-red-500" />
            )}
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
              <span className="relative">
                <item.icon className="size-4 shrink-0" />
                <NavDot show={hasBadge(item.to)} />
              </span>
              <span className="truncate">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="shrink-0 space-y-1 border-t border-border p-3">
          {isAdmin ? (
            <Link to="/admin" className={linkClass} activeProps={{ className: activeClass }}>
              <span className="relative">
                <ShieldEllipsis className="size-4 shrink-0" />
                <NavDot show={hasBadge("/admin")} />
              </span>
              <span className="truncate">{t.navAdmin}
                {adminPendingTotal > 0 ? (
                  <span className="ml-1 inline-block size-2 animate-pulse rounded-full bg-destructive" />
                ) : null}</span>
            </Link>
          ) : null}
          <Link to="/settings" className={linkClass} activeProps={{ className: activeClass }}>
            <Settings className="size-4 shrink-0" />
            <span className="truncate">{t.navSettings}</span>
          </Link>
          {!isStandalone ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => void onInstallApp()}
            >
              <Download className="size-4 shrink-0" />
              <span className="truncate">{t.installApp}</span>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
            {t.signOut}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 md:px-6 md:py-8">
          {children}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
          {primaryNav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium text-muted-foreground"
              activeProps={{ className: "text-primary" }}
            >
              <span className="relative">
                <item.icon className="size-5" />
                <NavDot show={hasBadge(item.to)} />
              </span>
              <span className="max-w-full truncate px-0.5">{item.label}</span>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium text-muted-foreground"
          >
            <span className="relative">
              <MoreHorizontal className="size-5" />
              <NavDot show={moreHasBadge} />
            </span>
            <span className="max-w-full truncate px-0.5">{t.navMore}</span>
          </button>
        </nav>

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
                    <span className="relative">
                      <item.icon className="size-4 shrink-0" />
                      <NavDot show={hasBadge(item.to)} />
                    </span>
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
                  <span className="relative">
                    <ShieldEllipsis className="size-4 shrink-0" />
                    <NavDot show={hasBadge("/admin")} />
                  </span>
                  <span className="truncate">{t.navAdmin}
                {adminPendingTotal > 0 ? (
                  <span className="ml-1 inline-block size-2 animate-pulse rounded-full bg-destructive" />
                ) : null}</span>
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
              {!isStandalone ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    setMoreOpen(false);
                    void onInstallApp();
                  }}
                >
                  <Download className="size-4 shrink-0" />
                  <span className="truncate">{t.installApp}</span>
                </Button>
              ) : null}
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
