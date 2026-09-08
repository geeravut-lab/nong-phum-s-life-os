import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PhumQuickBar } from "@/components/PhumQuickBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { formatDay } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "เรื่องที่ต้องทำ | น้องภูมิ" },
      { name: "description", content: "จัดการเตือนความจำ งานที่เกิดซ้ำ และลำดับความสำคัญของเรื่องรอบตัวคุณ" },
      { property: "og:title", content: "เรื่องที่ต้องทำ | น้องภูมิ" },
      { property: "og:description", content: "จัดการเตือนความจำ งานที่เกิดซ้ำ และลำดับความสำคัญของเรื่องรอบตัวคุณ" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TasksPage,
});

function TasksPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("normal");
  const [recurrence, setRecurrence] = useState("none");

  const { data: family, isError: familyFailed } = useQuery({
    queryKey: ["my-family"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;
      // Filter by user_id: family_members_read lets a member read every row of
      // their own family (the members list needs that), so an unfiltered
      // maybeSingle() starts failing the moment a second member joins.
      const { data, error } = await supabase
        .from("family_members")
        .select("family_id")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) throw error;
      return data?.family_id ?? null;
    },
  });

  const { data: tasks } = useQuery({
    queryKey: ["reminders"],
    queryFn: async () => {
      const { data } = await supabase
        .from("reminders")
        .select("*")
        .order("status", { ascending: true })
        .order("due_at", { ascending: true });
      return data ?? [];
    },
  });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("reminders").insert({
      user_id: userData.user!.id,
      title,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      priority,
      recurrence,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setTitle("");
    setDueAt("");
    setOpen(false);
    qc.invalidateQueries();
  };

  const toggle = async (id: string, status: string) => {
    await supabase
      .from("reminders")
      .update({ status: status === "done" ? "open" : "done" })
      .eq("id", id);
    qc.invalidateQueries({ queryKey: ["reminders"] });
  };

  const share = async (id: string, next: boolean) => {
    await supabase
      .from("reminders")
      .update({ is_shared: next, family_id: next ? (family ?? null) : null })
      .eq("id", id);
    qc.invalidateQueries({ queryKey: ["reminders"] });
  };

  return (
    <AppShell>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t.tasksTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.tasksSub}</p>
        </div>
        <Button onClick={() => setOpen((v) => !v)}>
          <Plus className="mr-1.5 size-4" />
          {t.addTask}
        </Button>
      </header>

      <PhumQuickBar focus="tasks" />

      {open && (
        <form
          onSubmit={add}
          className="mb-5 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft"
        >
          <div className="space-y-1.5">
            <Label htmlFor="task-title">{t.taskTitle}</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="due">{t.dueAt}</Label>
              <Input
                id="due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t.priority}</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">{t.high}</SelectItem>
                  <SelectItem value="normal">{t.normal}</SelectItem>
                  <SelectItem value="low">{t.low}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t.recurrence}</Label>
              <Select value={recurrence} onValueChange={setRecurrence}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.none}</SelectItem>
                  <SelectItem value="monthly">{t.monthly}</SelectItem>
                  <SelectItem value="yearly">{t.yearly}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit">{t.add}</Button>
        </form>
      )}

      {familyFailed && (
        <p className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {t.familyLoadError}
        </p>
      )}

      {tasks?.length ? (
        <ul className="space-y-2">
          {tasks.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft"
            >
              <div className="min-w-0">
                <p
                  className={`truncate text-sm font-medium ${r.status === "done" ? "text-muted-foreground line-through" : ""}`}
                >
                  {r.title}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{r.due_at ? formatDay(new Date(r.due_at), lang, true) : "—"}</span>
                  {r.priority === "high" && <Badge variant="destructive">{t.high}</Badge>}
                  {r.recurrence !== "none" && (
                    <Badge variant="outline">
                      {r.recurrence === "monthly" ? t.monthly : t.yearly}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {family && (
                  <Switch
                    checked={r.is_shared}
                    onCheckedChange={(v) => share(r.id, v)}
                    aria-label={t.shared}
                  />
                )}
                <Button size="sm" variant="outline" onClick={() => toggle(r.id, r.status)}>
                  {r.status === "done" ? t.reopen : t.markDone}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t.tasksEmpty}
        </p>
      )}
    </AppShell>
  );
}
