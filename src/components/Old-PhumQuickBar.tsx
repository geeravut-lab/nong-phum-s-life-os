import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { PhumMark } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { chatWithPhum } from "@/lib/lifeos.functions";
import { applyPhumAction } from "@/lib/phum-actions";

type Focus = "tasks" | "expenses" | "incomes";

const savedLabel = {
  reminder: "routedToTasks",
  expense: "routedToExpense",
  income: "routedToIncome",
} as const;

/**
 * One-line chat bar embedded in a module page: Nong Phum reads the message,
 * saves the matching record automatically and refreshes the page data.
 */
export function PhumQuickBar({ focus }: { focus: Focus }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const ask = useServerFn(chatWithPhum);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const placeholder =
    focus === "tasks"
      ? t.quickAskTasks
      : focus === "incomes"
        ? t.quickAskIncome
        : t.quickAskExpense;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;
      const out = await ask({ data: { message: text, lang, focus } });
      const applied = await applyPhumAction(out.action, uid);
      if (applied) {
        toast.success(t[savedLabel[applied.kind]]);
        qc.invalidateQueries();
      } else {
        toast.info(out.reply);
      }
      setInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mb-5 flex items-center gap-2 rounded-2xl border border-border bg-card p-2 pl-3 shadow-soft"
    >
      <PhumMark className="size-7 shrink-0" />
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={busy ? t.thinking : placeholder}
        disabled={busy}
        className="border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      <Button
        type="submit"
        size="icon"
        variant="secondary"
        disabled={busy || !input.trim()}
        aria-label={t.askPhum}
        title={t.askPhum}
      >
        <Send className="size-4" />
      </Button>
    </form>
  );
}
