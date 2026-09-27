import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Mic, Paperclip, Send, Square } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PhumMark } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { analyzeDocument, chatWithPhum, transcribeAudio } from "@/lib/lifeos.functions";
import { applyPhumActions } from "@/lib/phum-actions";
import { BenefitCards } from "@/components/BenefitCards";
import { intakeDocument, routingNotes } from "@/lib/doc-intake";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: routeMeta("chat") }),
  component: ChatPage,
});

const MAX_RECORD_MS = 60_000;
const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

function ChatPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const ask = useServerFn(chatWithPhum);
  const analyze = useServerFn(analyzeDocument);
  const transcribe = useServerFn(transcribeAudio);
  const flags = useFeatureFlags();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  // The router can answer "what am I entitled to" with list_benefits, and the
  // prompt tells it the app will show cards under the reply. It never did.
  // Cleared on the next question, so the cards stay attached to the answer
  // that asked for them rather than trailing the rest of the conversation.
  const [showBenefits, setShowBenefits] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const firstLand = useRef(true);
  const frame = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: messages } = useQuery({
    queryKey: ["chat"],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("id, role, content")
        .order("created_at", { ascending: true })
        .limit(100);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!messages) return;
    const land = (behavior: ScrollBehavior) =>
      bottom.current?.scrollIntoView({ behavior, block: "end" });

    // Coming back to this page, the router restores the scroll offset the page
    // had when it was last left - and it does that after this effect runs, so
    // a single scrollIntoView here was being undone and the user landed in the
    // middle of the history. Two animation frames put us after the restore;
    // "auto" lands rather than animating away from wherever it dropped us.
    // Later messages still slide in, which is what a chat should feel like.
    if (firstLand.current) {
      firstLand.current = false;
      land("auto");
      const a = requestAnimationFrame(() => {
        land("auto");
        frame.current = requestAnimationFrame(() => land("auto"));
      });
      frame.current = a;
      return () => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
      };
    }
    land("smooth");
    return;
  }, [messages, busy, fileBusy, voiceBusy]);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const post = async (uid: string, role: "user" | "assistant", content: string) => {
    await supabase.from("chat_messages").insert({ user_id: uid, role, content });
    qc.invalidateQueries({ queryKey: ["chat"] });
  };

  const sendText = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setShowBenefits(false);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;
      await post(uid, "user", text);

      const out = await ask({ data: { message: text, lang } });
      const applied = await applyPhumActions(out.actions, uid);
      await post(uid, "assistant", out.reply);
      setShowBenefits(out.actions.some((a) => a.type === "list_benefits"));
      if (applied.length > 0) {
        // One line per record, so asking for two things and getting one is
        // visible rather than something the reply has to be re-read to catch.
        // The verb matters as much as the place: "saved" on a row that was
        // actually removed is the kind of thing people stop trusting.
        for (const a of applied) {
          const where =
            a.kind === "family"
              ? t.routedToFamily
              : a.kind === "reminder"
                ? a.verb === "saved"
                  ? t.routedToTasks
                  : t.routedToTasksRow
                : a.verb === "saved"
                  ? a.kind === "expense"
                    ? t.routedToExpense
                    : t.routedToIncome
                  : t.routedToMoneyRow;
          const verb =
            a.verb === "saved" ? t.phumSaved : a.verb === "updated" ? t.phumUpdated : t.phumDeleted;
          toast.success(`${verb} — ${where}${a.label ? ` · ${a.label}` : ""}`);
        }
        qc.invalidateQueries();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await sendText(text);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || fileBusy) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t.error);
      return;
    }
    setFileBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;
      await post(uid, "user", `📎 ${file.name}`);

      const intake = await intakeDocument(file, analyze, lang, uid);
      const { analysis } = intake;
      const notes = routingNotes(intake, t);

      await post(uid, "assistant", `${analysis.summary}\n\n✅ ${notes.join(" · ")}`);
      toast.success(t.phumSaved);
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setFileBusy(false);
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1] ?? "";
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const stopRecording = () => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
    setRecording(false);
  };

  const startRecording = async () => {
    if (recording || busy || fileBusy || voiceBusy) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error(t.voiceUnsupported);
      return;
    }
    const mimeType = pickMimeType();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        chunksRef.current = [];
        if (blob.size < 1000) {
          toast.error(t.voiceTooShort);
          return;
        }
        setVoiceBusy(true);
        try {
          const base64 = await blobToBase64(blob);
          const { text } = await transcribe({
            data: { base64, mimeType: blob.type || "audio/webm", lang },
          });
          await sendText(text);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t.error);
        } finally {
          setVoiceBusy(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      stopTimerRef.current = setTimeout(stopRecording, MAX_RECORD_MS);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      toast.error(
        e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError"
          ? t.voicePermissionDenied
          : t.voiceUnsupported,
      );
    }
  };

  const onMicClick = () => {
    if (recording) stopRecording();
    else void startRecording();
  };

  const anyBusy = busy || fileBusy || voiceBusy;

  return (
    <AppShell>
      <h1 className="text-xl font-semibold tracking-tight">{t.chatTitle}</h1>

      <div className="mt-4 space-y-3">
        {!messages?.length && (
          <div className="flex items-start gap-2">
            <PhumMark className="size-8 shrink-0" />
            <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5 text-sm">
              {t.chatEmpty}
            </div>
          </div>
        )}
        {messages?.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "flex justify-end" : "flex items-start gap-2"}
          >
            {m.role !== "user" && <PhumMark className="size-8 shrink-0" />}
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                  : "max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5 text-sm"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && <p className="pl-10 text-sm text-muted-foreground">{t.thinking}</p>}
        {fileBusy && <p className="pl-10 text-sm text-muted-foreground">{t.analyzing}</p>}
        {voiceBusy && <p className="pl-10 text-sm text-muted-foreground">{t.transcribing}</p>}
        {recording && (
          <p className="pl-10 text-sm font-medium text-destructive">{t.recordingHint}</p>
        )}
        {showBenefits && !anyBusy && <BenefitCards />}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={send}
        className="fixed inset-x-0 bottom-14 z-10 mx-auto flex max-w-4xl gap-2 bg-background/95 p-3 backdrop-blur md:sticky md:bottom-0 md:p-0 md:pt-4"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={onFile}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={anyBusy || recording}
          onClick={() => fileRef.current?.click()}
          aria-label={t.attachFile}
          title={t.attachFile}
        >
          <Paperclip className="size-4" />
        </Button>
        {/* Hidden when an admin has switched voice off. The server refuses the
            call either way - this is so nobody is offered a button that errors. */}
        {flags.enabled("voice_input") ? (
          <Button
            type="button"
            size="icon"
            variant={recording ? "destructive" : "outline"}
            disabled={anyBusy && !recording}
            onClick={onMicClick}
            aria-label={recording ? t.stopRecording : t.startRecording}
            title={recording ? t.stopRecording : t.startRecording}
          >
            {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
          </Button>
        ) : null}
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={recording ? t.recordingHint : t.chatPlaceholder}
          disabled={recording || voiceBusy}
        />
        <Button type="submit" size="icon" disabled={anyBusy || recording} aria-label={t.send}>
          <Send className="size-4" />
        </Button>
      </form>
    </AppShell>
  );
}
