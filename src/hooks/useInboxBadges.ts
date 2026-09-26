import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";

export type AppNotification = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  ref_table: string | null;
  ref_id: string | null;
  read_at: string | null;
  created_at: string;
};

/** Map notification kind → primary nav path for red-dot badges */
function kindToNav(kind: string, href: string | null): string {
  if (href?.startsWith("/helpme")) return "/helpme";
  if (href?.startsWith("/local")) return "/local";
  if (href?.startsWith("/admin")) return "/admin";
  if (kind.startsWith("job_") || kind === "payment" || kind === "safety") return "/helpme";
  if (kind === "local") return "/local";
  return href?.split("?")[0] || "/today";
}

export function useInboxBadges() {
  const { user } = useAuthUser();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["app-notifications", user?.id],
    enabled: !!user?.id,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_notifications")
        .select("id,user_id,kind,title,body,href,ref_table,ref_id,read_at,created_at")
        .eq("user_id", user!.id)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as AppNotification[];
    },
  });

  // Realtime: new notifications for this user
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`inbox-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "app_notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["app-notifications", user.id] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "app_notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["app-notifications", user.id] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);

  const unreadByNav = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of q.data ?? []) {
      if (n.read_at) continue;
      const path = kindToNav(n.kind, n.href);
      map.set(path, (map.get(path) ?? 0) + 1);
    }
    return map;
  }, [q.data]);

  const totalUnread = q.data?.length ?? 0;

  return {
    notifications: q.data ?? [],
    unreadByNav,
    totalUnread,
    isLoading: q.isLoading,
    refresh: () => qc.invalidateQueries({ queryKey: ["app-notifications", user?.id] }),
  };
}

export async function markNotificationsReadForPath(userId: string, path: string) {
  const { data } = await supabase
    .from("app_notifications")
    .select("id,href,kind")
    .eq("user_id", userId)
    .is("read_at", null)
    .limit(100);
  const ids = (data ?? []).filter((n) => kindToNav(n.kind, n.href) === path).map((n) => n.id);
  if (!ids.length) return;
  await supabase
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids);
}

export async function markAllNotificationsRead(userId: string) {
  await supabase
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
}
