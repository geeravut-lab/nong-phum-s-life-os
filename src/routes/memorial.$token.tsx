import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/memorial/$token")({
  component: MemorialPublicPage,
});

function MemorialPublicPage() {
  const { token } = Route.useParams();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [wreathAmt, setWreathAmt] = useState("");
  const [busy, setBusy] = useState(false);

  const memQ = useQuery({
    queryKey: ["memorial", token],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("memorials")
        .select("*")
        .eq("share_token", token)
        .eq("is_public", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const msgQ = useQuery({
    queryKey: ["memorial-messages", memQ.data?.id],
    enabled: !!memQ.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("memorial_messages")
        .select("*")
        .eq("memorial_id", memQ.data!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const wreathQ = useQuery({
    queryKey: ["digital-wreaths", memQ.data?.id],
    enabled: !!memQ.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("digital_wreaths")
        .select("*")
        .eq("memorial_id", memQ.data!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const postMessage = async () => {
    if (!memQ.data || !name.trim() || !body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("memorial_messages").insert({
      memorial_id: memQ.data.id,
      author_name: name.trim(),
      body: body.trim(),
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(t.p6MsgSent);
      setBody("");
      void qc.invalidateQueries({ queryKey: ["memorial-messages", memQ.data.id] });
    }
  };

  const postWreath = async () => {
    if (!memQ.data || !name.trim()) return;
    setBusy(true);
    const amount = wreathAmt ? Number(wreathAmt) : 0;
    const { error } = await supabase.from("digital_wreaths").insert({
      memorial_id: memQ.data.id,
      from_name: name.trim(),
      message: body.trim(),
      amount,
      payment_status: amount > 0 ? "pending" : "none",
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(t.p6WreathSent);
      setBody("");
      setWreathAmt("");
      void qc.invalidateQueries({ queryKey: ["digital-wreaths", memQ.data.id] });
    }
  };

  if (memQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!memQ.data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center">
        <p className="text-muted-foreground">{t.p6MemorialNotFound}</p>
      </div>
    );
  }

  const m = memQ.data;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-lg px-4 py-10">
        <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">
          Memorial
        </p>
        <h1 className="mt-2 text-center text-2xl font-semibold tracking-tight">{m.title}</h1>
        {m.story ? (
          <p className="mt-4 whitespace-pre-wrap text-center text-sm text-muted-foreground">
            {m.story}
          </p>
        ) : null}

        <section className="mt-8 space-y-2">
          <h2 className="text-sm font-semibold">{t.p6Tributes}</h2>
          {(msgQ.data ?? []).map((msg) => (
            <article key={msg.id} className="rounded-xl border border-border bg-card p-3 text-sm">
              <p className="font-medium">{msg.author_name}</p>
              <p className="mt-1 text-muted-foreground">{msg.body}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 space-y-2">
          <h2 className="text-sm font-semibold">{t.p6Wreaths}</h2>
          {(wreathQ.data ?? []).map((w) => (
            <article key={w.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{w.from_name}</span>
                {Number(w.amount) > 0 && (
                  <Badge variant="secondary">฿{Number(w.amount).toLocaleString()}</Badge>
                )}
              </div>
              {w.message ? <p className="mt-1 text-muted-foreground">{w.message}</p> : null}
            </article>
          ))}
        </section>

        <section className="mt-8 space-y-2 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">{t.p6LeaveMessage}</h2>
          <Input
            placeholder={t.p6YourName}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            rows={3}
            placeholder={t.p6YourMessage}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Input
            type="number"
            placeholder={t.p6WreathAmount}
            value={wreathAmt}
            onChange={(e) => setWreathAmt(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={postMessage}>
              {t.p6SendMessage}
            </Button>
            <Button disabled={busy} variant="secondary" onClick={postWreath}>
              {t.p6SendWreath}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
