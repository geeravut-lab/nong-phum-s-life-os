import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/CopyButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { errorText } from "@/lib/errors";
import { createWebhook, deleteWebhook, listWebhooks, testWebhook } from "@/lib/webhooks.functions";

type Row = {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  last_status: number | null;
  last_at: string | null;
  failure_count: number;
};

/**
 * Send this account's notifications to a url the user controls.
 *
 * This is how Life OS reaches email, a calendar or cloud storage without
 * registering an OAuth app with Google or Microsoft: the user points it at an
 * automation service and that service does the rest. The secret is shown once,
 * when the endpoint is created - the receiver needs it to verify the signature
 * on each delivery, and it is not readable afterwards.
 */
export function WebhooksCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const load = useServerFn(listWebhooks);
  const add = useServerFn(createWebhook);
  const remove = useServerFn(deleteWebhook);
  const test = useServerFn(testWebhook);

  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["webhooks"],
    queryFn: () => load() as Promise<{ endpoints: Row[] }>,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["webhooks"] });

  const onAdd = async () => {
    setBusy(true);
    try {
      const res = (await add({ data: { url: url.trim(), events: [] } })) as { secret: string };
      setFreshSecret(res.secret);
      setUrl("");
      toast.success(t.saved);
      refresh();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const onTest = async (id: string) => {
    setBusy(true);
    try {
      const res = (await test({ data: { id } })) as { status: number; message: string };
      if (res.status >= 200 && res.status < 300) toast.success(`${t.whTestOk} (${res.status})`);
      else toast.error(`${t.whTestFail} ${res.status || res.message}`);
      refresh();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <h2 className="text-sm font-semibold">{t.whTitle}</h2>
      <p className="mt-1 mb-3 text-xs text-muted-foreground">{t.whSub}</p>

      <div className="space-y-2">
        <Label htmlFor="wh-url">{t.whUrl}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="wh-url"
            placeholder="https://hook.example.com/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !url.trim().startsWith("https://")}
            onClick={() => void onAdd()}
          >
            {t.whAdd}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t.whUrlHint}</p>
      </div>

      {freshSecret ? (
        <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs font-medium">{t.whSecretOnce}</p>
          <div className="mt-1 flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all text-xs">{freshSecret}</code>
            <CopyButton value={freshSecret} className="shrink-0" />
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">{t.whSecretHow}</p>
        </div>
      ) : null}

      {(q.data?.endpoints ?? []).length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
          {(q.data?.endpoints ?? []).map((e) => (
            <li key={e.id} className="rounded-xl border border-border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="min-w-0 flex-1 truncate text-xs">{e.url}</code>
                {e.is_active ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {t.whActive}
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="text-[10px]">
                    {t.whDisabled}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {e.last_at ? `${t.whLast}: ${e.last_status ?? "—"}` : t.whNever}
                {e.failure_count > 0 ? ` · ${t.whFailures} ${e.failure_count}` : ""}
              </p>
              <div className="mt-1 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void onTest(e.id)}
                >
                  {t.whTest}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm(t.whDeleteConfirm)) return;
                    await remove({ data: { id: e.id } });
                    refresh();
                  }}
                >
                  {t.delete}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
