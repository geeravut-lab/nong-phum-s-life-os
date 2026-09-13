import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { DELETE_CONFIRMATION_PHRASES, deleteMyAccount, getDeletionPreview } from "@/lib/account.functions";
import { useI18n } from "@/lib/i18n";

// The "danger zone" at the bottom of Settings. Opening the dialog fetches a
// preview of exactly what the cascade will remove, so the list the user reads
// is computed from their data, not a generic warning. Confirmation requires
// typing the phrase; the button stays disabled until it matches, and the
// server checks the phrase again.
export function DeleteAccountCard() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const del = useServerFn(deleteMyAccount);

  const preview = useQuery({
    queryKey: ["deletion-preview"],
    queryFn: () => getDeletionPreview(),
    enabled: open,
    staleTime: 0,
  });

  const phrase = lang === "en" ? DELETE_CONFIRMATION_PHRASES[1] : DELETE_CONFIRMATION_PHRASES[0];
  const confirmed = (DELETE_CONFIRMATION_PHRASES as readonly string[]).includes(typed.trim());

  const run = async () => {
    setBusy(true);
    try {
      await del({ data: { confirmation: typed.trim() } });
      // The auth row is gone; drop the local session so the guard does not
      // keep presenting a token that no longer resolves to anyone.
      await supabase.auth.signOut();
      toast.success(t.deleteDone);
      navigate({ to: "/" });
    } catch (err) {
      toast.error(`${t.deleteFailed} ${err instanceof Error ? err.message : ""}`.trim());
      setBusy(false);
    }
  };

  const p = preview.data;
  const money = p ? p.counts.expenses + p.counts.incomes : 0;

  return (
    <section className="rounded-2xl border border-destructive/40 bg-card p-4 shadow-soft">
      <h2 className="text-sm font-semibold text-destructive">{t.dangerZone}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t.deleteAccountIntro}</p>
      <Button
        variant="outline"
        className="mt-3 border-destructive/50 text-destructive hover:bg-destructive/10"
        onClick={() => {
          setTyped("");
          setOpen(true);
        }}
      >
        {t.deleteAccountBtn}
      </Button>

      <AlertDialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left text-sm">
                {preview.isLoading || !p ? (
                  <Skeleton className="h-24 w-full" />
                ) : (
                  <>
                    <p className="font-medium text-foreground">{t.deleteWillRemove}</p>
                    <ul className="list-disc space-y-1 pl-5">
                      <li>{t.deleteItemDocuments(p.counts.documents)}</li>
                      <li>{t.deleteItemReminders(p.counts.reminders)}</li>
                      <li>{t.deleteItemMoney(money)}</li>
                      <li>{t.deleteItemChat(p.counts.chat_messages)}</li>
                      {(p.counts.helper_profiles > 0 || p.counts.jobs > 0) && <li>{t.deleteItemHelpMe}</li>}
                      {p.counts.benefit_profiles > 0 && <li>{t.deleteItemBenefits}</li>}
                      {p.isSsoUser && <li>{t.deleteItemSso}</li>}
                    </ul>
                    {p.ownedFamilies
                      .filter((f) => f.otherMembers > 0)
                      .map((f) => (
                        <p
                          key={f.id}
                          className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 font-medium text-destructive"
                        >
                          {t.deleteFamilyWarning(f.name, f.otherMembers)}
                        </p>
                      ))}
                    {p.memberOfFamilies > 0 && <p>{t.deleteFamilyLeave(p.memberOfFamilies)}</p>}
                  </>
                )}
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="delete-confirm">
                    {t.deleteTypeToConfirm} <code className="rounded bg-muted px-1.5 py-0.5 font-semibold">{phrase}</code>
                  </Label>
                  <Input
                    id="delete-confirm"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t.cancelBtn}</AlertDialogCancel>
            {/* Not AlertDialogAction: it would close the dialog on click before the request finishes. */}
            <Button variant="destructive" disabled={!confirmed || busy || !p} onClick={run}>
              {busy ? t.deleting : t.deleteConfirmBtn}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
