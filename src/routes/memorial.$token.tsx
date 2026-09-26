import { errorText } from "@/lib/errors";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  createWreathPaymentPublic,
  getMemorialVideo,
  markWreathPaid,
} from "@/lib/legacy-notify.functions";

export const Route = createFileRoute("/memorial/$token")({
  component: MemorialPublicPage,
});

function MemorialPublicPage() {
  const { token } = Route.useParams();
  const { t } = useI18n();
  const qc = useQueryClient();
  const runWreath = useServerFn(createWreathPaymentPublic);
  const runMarkPaid = useServerFn(markWreathPaid);
  const runVideo = useServerFn(getMemorialVideo);

  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [wreathAmt, setWreathAmt] = useState("");
  // A wreath or a tree planted in their name - the same transaction, a
  // different meaning, and the eco option the spec asks for.
  const [tributeKind, setTributeKind] = useState<"wreath" | "tree">("wreath");
  const [busy, setBusy] = useState(false);
  const [payInfo, setPayInfo] = useState<{
    wreathId: string;
    amount: number;
    qrUrl: string | null;
  } | null>(null);

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

  const videoQ = useQuery({
    queryKey: ["memorial-video", token],
    queryFn: () =>
      runVideo({ data: { token } }) as Promise<{ url: string | null; uploaded: boolean }>,
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
    try {
      const amount = wreathAmt ? Number(wreathAmt) : 0;
      const res = await runWreath({
        data: {
          memorialId: memQ.data.id,
          fromName: name.trim(),
          message: body.trim(),
          amount: Number.isFinite(amount) ? amount : 0,
          kind: tributeKind,
        },
      });
      toast.success(t.p6WreathSent);
      setBody("");
      setWreathAmt("");
      if (res.qrUrl) {
        setPayInfo({
          wreathId: res.wreathId,
          amount: res.amount,
          qrUrl: res.qrUrl,
        });
      } else {
        setPayInfo(null);
      }
      void qc.invalidateQueries({ queryKey: ["digital-wreaths", memQ.data.id] });
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
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
  const scheduleText = (m as { schedule_text?: string }).schedule_text;
  // An uploaded file is stored as storage:<path> and has to be signed before it
  // can be played; a pasted link is already playable.
  const videoUrl = videoQ.data?.url ?? null;
  const videoUploaded = videoQ.data?.uploaded ?? false;

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

        {videoUrl ? (
          <div className="mt-6 overflow-hidden rounded-xl border border-border">
            <p className="bg-muted/50 px-3 py-1.5 text-xs font-medium">{t.r2Video}</p>
            {videoUploaded ? (
              <video controls preload="metadata" className="w-full bg-black" src={videoUrl} />
            ) : /youtube\.com|youtu\.be|vimeo\.com/.test(videoUrl) ? (
              <div className="aspect-video w-full bg-black">
                <iframe
                  title="farewell"
                  src={
                    videoUrl.includes("watch?v=")
                      ? videoUrl.replace("watch?v=", "embed/")
                      : videoUrl.includes("youtu.be/")
                        ? videoUrl.replace("youtu.be/", "www.youtube.com/embed/")
                        : videoUrl
                  }
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <a
                href={videoUrl}
                target="_blank"
                rel="noreferrer"
                className="block px-3 py-3 text-sm text-primary underline"
              >
                {videoUrl}
              </a>
            )}
          </div>
        ) : null}

        {scheduleText ? (
          <section className="mt-6 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">{t.r2Schedule}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{scheduleText}</p>
          </section>
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
              <div className="flex justify-between gap-2">
                <span className="font-medium">
                  {w.from_name}
                  {(w as { kind?: string }).kind === "tree" ? (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      {t.ecoTreeBadge}
                    </Badge>
                  ) : null}
                </span>
                {Number(w.amount) > 0 ? (
                  <Badge variant={w.payment_status === "paid" ? "default" : "secondary"}>
                    ฿{Number(w.amount).toLocaleString()} · {w.payment_status}
                  </Badge>
                ) : null}
              </div>
              {w.message ? <p className="mt-1 text-muted-foreground">{w.message}</p> : null}
            </article>
          ))}
        </section>

        <section className="mt-8 space-y-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">{t.r2WreathPay}</h2>
          <Input
            placeholder={t.p6YourName}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            placeholder={t.p6LeaveMessage}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Input
            type="number"
            min={0}
            placeholder={t.r2WreathAmount}
            value={wreathAmt}
            onChange={(e) => setWreathAmt(e.target.value)}
          />
          <div className="space-y-1">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["wreath", t.ecoKindWreath],
                  ["tree", t.ecoKindTree],
                ] as const
              ).map(([kind, label]) => (
                <Button
                  key={kind}
                  size="sm"
                  variant={tributeKind === kind ? "default" : "outline"}
                  onClick={() => setTributeKind(kind)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {tributeKind === "tree" ? t.ecoNote : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !name.trim() || !body.trim()} onClick={postMessage}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {t.p6SendMessage}
            </Button>
            <Button variant="secondary" disabled={busy || !name.trim()} onClick={postWreath}>
              {t.p6SendWreath}
            </Button>
          </div>

          {payInfo?.qrUrl ? (
            <div className="mt-4 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-center">
              <p className="text-xs font-medium">
                {t.r2WreathQr} · ฿{payInfo.amount.toLocaleString()}
              </p>
              <img
                src={payInfo.qrUrl}
                alt="PromptPay QR"
                className="mx-auto h-48 w-48 rounded-lg bg-white p-2"
              />
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await runMarkPaid({ data: { wreathId: payInfo.wreathId } });
                    toast.success(t.r2WreathPaid);
                    setPayInfo(null);
                    void qc.invalidateQueries({
                      queryKey: ["digital-wreaths", m.id],
                    });
                  } catch (e) {
                    toast.error(errorText(e, t));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t.r2WreathMarkPaid}
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
