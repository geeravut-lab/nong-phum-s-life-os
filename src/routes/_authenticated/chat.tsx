import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PhumMark } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { chatWithPhum } from "@/lib/lifeos.functions";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
});

type Pending = {
  type: string;
  title: string | null;
  dueAt: string | null;
  priority: string | null;
  amount: number | null;
  category: string | null;
  spentOn: string | null;
  query: string | null;
};

function ChatPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const ask = useServerFn(chatWithPhum);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
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
  }, [messages, busy]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setPending(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;
      await supabase.from("chat_messages").insert({ user_id: uid, role: "user", content: text });
      qc.invalidateQueries({ queryKey: ["chat"] });

      const out = await ask({ data: { message: text, lang } });
      await supabase.from("chat_messages").insert({
        user_id: uid,
        role: "assistant",
        content: out.reply,
        action: out.action,
      });
      qc.invalidateQueries({ queryKey: ["chat"] });
      if (out.action && out.action.type !== "none" && out.action.type !== "daily_brief") {
        if (out.action.type === "create_reminder" || out.action.type === "add_expense") {
          setPending(out.action as Pending);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user!.id;
    try {
      if (pending.type === "create_reminder") {
        const { error } = await supabase.from("reminders").insert({
          user_id: uid,
          title: pending.title ?? "-",
          due_at: pending.dueAt,
          priority: pending.priority ?? "normal",
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("expenses").insert({
          user_id: uid,
          title: pending.title ?? "-",
          amount: pending.amount ?? 0,
          category: pending.category ?? "other",
          spent_on: pending.spentOn ?? new Date().toISOString().slice(0, 10),
        });
        if (error) throw error;
      }
      toast.success(t.saved);
      setPending(null);
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
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
        <div ref={bottom} />
      </div>

      {pending && (
        <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-medium">{t.confirmAction}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending.title}
            {pending.amount ? ` · ${pending.amount} ${t.baht}` : ""}
            {pending.dueAt ? ` · ${new Date(pending.dueAt).toLocaleString()}` : ""}
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={confirm}>
              {t.confirm}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              {t.cancel}
            </Button>
          </div>
        </div>
      )}

      <form
        onSubmit={send}
        className="fixed inset-x-0 bottom-14 z-10 mx-auto flex max-w-4xl gap-2 bg-background/95 p-3 backdrop-blur md:sticky md:bottom-0 md:p-0 md:pt-4"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t.chatPlaceholder}
        />
        <Button type="submit" size="icon" disabled={busy} aria-label={t.send}>
          <Send className="size-4" />
        </Button>
      </form>
    </AppShell>
  );
}
