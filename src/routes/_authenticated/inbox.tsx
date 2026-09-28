import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useI18n } from "@/lib/i18n";
import { errorText } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { NOT_LEGACY_TRIGGER_ROW, renderNotification } from "@/lib/notifications.shared";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({ meta: routeMeta("today") }),
  component: InboxPage,
});

type Row = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  params: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

/**
 * Everything that has been written to this user's notifications.
 *
 * The rows have always existed - they are what drives the red dot on the menu -
 * but there was nowhere to read them, so the dot said "something happened" and
 * the only way to find out what was to guess which page. Text is rendered from
 * the kind and its values where a template exists, so an English reader gets
 * English even though the row was written in Thai on the server.
 */
function InboxPage() {
  const { t, lang } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["inbox", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_notifications")
        .select("id,kind,title,body,href,params,read_at,created_at")
        .eq("user_id", user!.id)
        .or(NOT_LEGACY_TRIGGER_ROW)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const markAll = async () => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("app_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", user!.id)
        .is("read_at", null);
      if (error) throw error;
      void qc.invalidateQueries({ queryKey: ["inbox", user?.id] });
      void qc.invalidateQueries({ queryKey: ["app-notifications", user?.id] });
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const rows = q.data ?? [];
  const unread = rows.filter((r) => !r.read_at).length;

  return (
    <AppShell>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t.inboxTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.inboxSub}</p>
        </div>
        {unread > 0 ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void markAll()}>
            {t.inboxMarkAll} ({unread})
          </Button>
        ) : null}
      </header>

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.inboxEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const { title, body } = renderNotification(r, t);
            return (
              <li
                key={r.id}
                className={`rounded-2xl border p-3 shadow-soft ${
                  r.read_at ? "border-border bg-card" : "border-primary/40 bg-primary/5"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{title}</span>
                  {!r.read_at ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {t.inboxUnread}
                    </Badge>
                  ) : null}
                </div>
                {/* A body is a summary line plus "label: value" lines (see
                    notice-detail.ts), so the newlines have to survive - without
                    this the due date runs into the assignee's name. */}
                {body ? (
                  <p className="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">{body}</p>
                ) : null}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {formatDay(new Date(r.created_at), lang, true)}
                </p>
                {r.href ? (
                  <Button size="sm" variant="ghost" className="mt-1" asChild>
                    <Link to={r.href}>{t.inboxOpen}</Link>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
