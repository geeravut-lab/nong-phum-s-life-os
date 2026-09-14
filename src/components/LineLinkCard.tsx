import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ExternalLink, MessageCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getLineLink, recheckLineFriend, startLineLink, unlinkLine } from "@/lib/line.functions";
import { useI18n } from "@/lib/i18n";
import { formatDay } from "@/lib/format";

// Settings → LINE. Three states: not linked (connect), linked and a friend
// of the OA (good), linked but NOT a friend — which must read as "you will
// not get notifications yet", with the way to fix it, not as success.
export function LineLinkCard() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const start = useServerFn(startLineLink);
  const unlink = useServerFn(unlinkLine);
  const recheckFn = useServerFn(recheckLineFriend);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const status = useQuery({ queryKey: ["line-link"], queryFn: () => getLineLink() });

  const connect = useMutation({
    mutationFn: async () => {
      const { url } = await start({ data: { origin: window.location.origin } });
      window.location.href = url;
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  // Asks the OA (Messaging API profile) whether the user is a friend now —
  // no OAuth round-trip, no consent screen.
  const recheck = useMutation({
    mutationFn: () => recheckFn(),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(t.lineRecheckFailed);
        return;
      }
      toast[r.link.isFriend ? "success" : "warning"](r.link.isFriend ? t.lineFriendYes : t.lineFriendNo);
      qc.invalidateQueries({ queryKey: ["line-link"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const disconnect = useMutation({
    mutationFn: () => unlink(),
    onSuccess: () => {
      setConfirmOpen(false);
      toast.success(t.lineUnlinked);
      qc.invalidateQueries({ queryKey: ["line-link"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const s = status.data;
  const link = s?.link ?? null;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <MessageCircle className="size-4" />
        {t.lineTitle}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t.lineIntro}</p>

      {status.isLoading || !s ? (
        <Skeleton className="mt-3 h-10 w-full" />
      ) : !link && !s.configured ? (
        <p className="mt-3 text-sm text-muted-foreground">{t.lineNotConfigured}</p>
      ) : !link ? (
        <Button className="mt-3" onClick={() => connect.mutate()} disabled={connect.isPending}>
          {connect.isPending ? t.lineConnecting : t.lineConnect}
        </Button>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-3">
            {link.pictureUrl ? (
              <img src={link.pictureUrl} alt="" className="size-10 rounded-full object-cover" />
            ) : (
              <div className="size-10 rounded-full bg-muted" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{link.displayName ?? "LINE"}</p>
              <p className="text-xs text-muted-foreground">{t.lineLinkedAt(formatDay(new Date(link.linkedAt), lang))}</p>
            </div>
          </div>

          {link.isFriend ? (
            <p className="flex items-start gap-2 rounded-xl bg-primary/10 p-3 text-sm text-primary">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              {t.lineFriendYes}
            </p>
          ) : (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="flex items-start gap-2 font-medium text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {t.lineFriendNo}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {s.addFriendUrl && (
                  <Button asChild size="sm">
                    <a href={s.addFriendUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1.5 size-3.5" />
                      {t.lineAddFriend}
                    </a>
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => recheck.mutate()} disabled={recheck.isPending}>
                  <RefreshCw className={`mr-1.5 size-3.5 ${recheck.isPending ? "animate-spin" : ""}`} />
                  {t.lineRecheck}
                </Button>
              </div>
            </div>
          )}

          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            {t.lineUnlink}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(v) => !disconnect.isPending && setConfirmOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.lineUnlinkConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.lineUnlinkConfirmText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>{t.cancelBtn}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                disconnect.mutate();
              }}
              disabled={disconnect.isPending}
            >
              {t.lineUnlink}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
