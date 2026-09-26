import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { notifyJobChat } from "@/lib/marketplace-notify.functions";
import { useEffect, useRef, useState } from "react";
import { Flag, ImagePlus, Loader2, Siren, Send, ShieldBan } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  listJobEvidence,
  listJobMessages,
  sendJobMessage,
  uploadJobEvidence,
} from "@/lib/marketplace-chat";
import { blockUser, submitSafetyReport } from "@/lib/marketplace-safety";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useI18n } from "@/lib/i18n";

type Props = {
  jobId: string;
  counterpartyUserId?: string | null;
  enabled?: boolean;
};

export function JobWorkspace({ jobId, counterpartyUserId, enabled = true }: Props) {
  const { t } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const runNotifyChat = useServerFn(notifyJobChat);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const messages = useQuery({
    queryKey: ["job-messages", jobId],
    queryFn: () => listJobMessages(jobId),
    enabled: enabled && !!jobId,
  });

  const evidence = useQuery({
    queryKey: ["job-evidence", jobId],
    queryFn: () => listJobEvidence(jobId),
    enabled: enabled && !!jobId,
  });

  // Supabase Realtime for job_messages
  useEffect(() => {
    if (!enabled || !jobId) return;
    const channel = supabase
      .channel(`job-msg-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "job_messages",
          filter: `job_id=eq.${jobId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["job-messages", jobId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, enabled, qc]);

  // Keep latest message pinned above the input
  useEffect(() => {
    if (!enabled) return;
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.data, enabled, jobId]);

  if (!enabled) return null;

  const send = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await sendJobMessage(jobId, body);
      // The insert above runs as the sender, so it cannot write the other
      // side's notification; this asks the server to do it.
      await runNotifyChat({ data: { jobId } }).catch(() => undefined);
      setBody("");
      qc.invalidateQueries({ queryKey: ["job-messages", jobId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await uploadJobEvidence(jobId, file);
      toast.success(t.evidenceUploaded);
      qc.invalidateQueries({ queryKey: ["job-evidence", jobId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const onReport = async (emergency = false) => {
    if (!emergency && reportReason.trim().length < 3) return;
    setBusy(true);
    try {
      await submitSafetyReport({
        jobId,
        targetUserId: counterpartyUserId ?? null,
        reason: emergency ? "emergency" : reportReason,
        details: emergency ? "Emergency alert from Help Me job chat" : reportDetails,
        isEmergency: emergency,
      });
      toast.success(emergency ? t.emergencySent : t.reportSubmitted);
      setReportOpen(false);
      setReportReason("");
      setReportDetails("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const onBlock = async () => {
    if (!counterpartyUserId) return;
    if (!window.confirm(t.blockConfirm)) return;
    setBusy(true);
    try {
      await blockUser(counterpartyUserId);
      toast.success(t.blockDone);
      await submitSafetyReport({
        jobId,
        targetUserId: counterpartyUserId ?? null,
        reason: "blocked",
        details: "User blocked from Help Me",
      }).catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-4 rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t.jobWorkspace}</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t.emergencyConfirm)) void onReport(true);
            }}
          >
            <Siren className="mr-1 size-3.5" />
            {t.emergencyBtn}
          </Button>
          {counterpartyUserId && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setReportOpen((v) => !v)}
              >
                <Flag className="mr-1 size-3.5" />
                {t.reportUser}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={onBlock}>
                <ShieldBan className="mr-1 size-3.5" />
                {t.blockUser}
              </Button>
            </>
          )}
        </div>
      </div>

      {reportOpen && (
        <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <Input
            placeholder={t.reportReasonPlaceholder}
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            maxLength={80}
          />
          <Textarea
            rows={2}
            placeholder={t.reportDetailsPlaceholder}
            value={reportDetails}
            onChange={(e) => setReportDetails(e.target.value)}
            maxLength={2000}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || reportReason.trim().length < 3}
              onClick={() => onReport(false)}
            >
              {t.submitReport}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReportOpen(false)}>
              {t.cancelBtn}
            </Button>
          </div>
        </div>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{t.evidenceTitle}</p>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={onFile}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="mr-1 size-3.5" />
              {t.evidenceAdd}
            </Button>
          </div>
        </div>
        {(evidence.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.evidenceEmpty}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {(evidence.data ?? []).map((ev) => (
              <li key={ev.id} className="overflow-hidden rounded-lg border border-border">
                {ev.url && ev.mime_type?.startsWith("image/") ? (
                  <a href={ev.url} target="_blank" rel="noreferrer">
                    <img src={ev.url} alt={ev.title} className="h-20 w-20 object-cover" />
                  </a>
                ) : (
                  <a
                    href={ev.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-20 w-28 items-center justify-center p-2 text-xs underline"
                  >
                    {ev.title}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {t.jobChatTitle}{" "}
          <Badge variant="secondary" className="ml-1">
            live
          </Badge>
        </p>
        <div
          ref={listRef}
          className="mb-2 flex max-h-56 flex-col gap-2 overflow-y-auto rounded-xl bg-muted/40 p-3"
        >
          {(messages.data ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">{t.jobChatEmpty}</p>
          )}
          {(messages.data ?? []).map((m) => {
            const mine = m.sender_id === user?.id;
            return (
              <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    mine
                      ? "max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                      : "max-w-[80%] rounded-2xl rounded-bl-sm bg-background px-3 py-1.5 text-sm"
                  }
                >
                  {m.body}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} aria-hidden className="h-px w-full shrink-0" />
        </div>
        <div className="flex gap-2">
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t.jobChatPlaceholder}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button size="icon" disabled={busy || !body.trim()} onClick={send} aria-label={t.send}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </section>
    </div>
  );
}
