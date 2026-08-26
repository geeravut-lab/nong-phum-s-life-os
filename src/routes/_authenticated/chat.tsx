import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Paperclip, Send } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PhumMark } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { analyzeDocument, chatWithPhum } from "@/lib/lifeos.functions";
import { applyPhumAction } from "@/lib/phum-actions";
import { intakeDocument } from "@/lib/doc-intake";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "คุยกับน้องภูมิ | Life OS" },
      { name: "description", content: "พิมพ์บอกน้องภูมิเป็นภาษาคน แล้วให้ช่วยสร้างเตือนความจำ บันทึกค่าใช้จ่าย หรือค้นเอกสาร" },
      { property: "og:title", content: "คุยกับน้องภูมิ | Life OS" },
      { property: "og:description", content: "พิมพ์บอกน้องภูมิเป็นภาษาคน แล้วให้ช่วยสร้างเตือนความจำ บันทึกค่าใช้จ่าย หรือค้นเอกสาร" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const ask = useServerFn(chatWithPhum);
  const analyze = useServerFn(analyzeDocument);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

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
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, fileBusy]);

  const post = async (uid: string, role: "user" | "assistant", content: string) => {
    await supabase.from("chat_messages").insert({ user_id: uid, role, content });
    qc.invalidateQueries({ queryKey: ["chat"] });
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;
      await post(uid, "user", text);

      const out = await ask({ data: { message: text, lang } });
      const applied = await applyPhumAction(out.action, uid);
      await post(uid, "assistant", out.reply);
      if (applied) {
        const label =
          applied.kind === "reminder"
            ? t.routedToTasks
            : applied.kind === "expense"
              ? t.routedToExpense
              : t.routedToIncome;
        toast.success(`${t.phumSaved} — ${label}`);
        qc.invalidateQueries();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
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

      const { analysis, routed } = await intakeDocument(file, analyze, lang, uid);

      const notes: string[] = [t.savedToDocs];
      if (routed.includes("expense")) notes.push(t.routedToExpense);
      if (routed.includes("income")) notes.push(t.routedToIncome);
      if (routed.includes("reminder")) notes.push(t.routedToTasks);

      await post(uid, "assistant", `${analysis.summary}\n\n✅ ${notes.join(" · ")}`);
      toast.success(t.phumSaved);
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setFileBusy(false);
    }
  };

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
          disabled={busy || fileBusy}
          onClick={() => fileRef.current?.click()}
          aria-label={t.attachFile}
          title={t.attachFile}
        >
          <Paperclip className="size-4" />
        </Button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t.chatPlaceholder}
        />
        <Button type="submit" size="icon" disabled={busy || fileBusy} aria-label={t.send}>
          <Send className="size-4" />
        </Button>
      </form>
    </AppShell>
  );
}
