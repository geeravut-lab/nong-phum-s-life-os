import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listFamilyMemberLabels } from "@/lib/family.functions";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PhumQuickBar } from "@/components/PhumQuickBar";
import { TaskEditDialog, type EditableTask } from "@/components/TaskEditDialog";
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
import { completeReminder } from "@/lib/reminder-actions";
import { AttachmentControl } from "@/components/AttachmentControl";
import { loadLinkedDocs } from "@/lib/attachments";
import { isRepeating } from "@/lib/recurrence";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: routeMeta("tasks") }),
  component: TasksPage,
});

function TasksPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const runMemberLabels = useServerFn(listFamilyMemberLabels);
  const [editTask, setEditTask] = useState<EditableTask | null>(null);
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

  // Assignee names for shared family reminders, so the list shows a person
  // rather than nothing. Same resolver the family page uses.
  const { data: memberLabels } = useQuery({
    enabled: !!family,
    queryKey: ["family-member-labels", family],
    queryFn: async () => {
      const res = (await runMemberLabels({ data: { familyId: family! } })) as {
        members: Array<{ userId: string; label: string }>;
      };
      return res.members ?? [];
    },
  });

  const assigneeLabel = (userId: string | null | undefined) => {
    if (!userId) return null;
    return memberLabels?.find((m) => m.userId === userId)?.label ?? userId.slice(0, 6);
  };

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

  const linkedIds = (tasks ?? []).map((r) => r.source_document_id);
  const { data: linkedDocs } = useQuery({
    queryKey: ["linked-docs", "tasks", linkedIds.filter(Boolean).sort()],
    queryFn: () => loadLinkedDocs(linkedIds),
    enabled: !!tasks,
    staleTime: 4 * 60_000,
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

  const toggle = async (r: {
    id: string;
    status: string;
    due_at: string | null;
    recurrence: string;
  }) => {
    try {
      if (r.status === "done") {
        const { error } = await supabase
          .from("reminders")
          .update({ status: "open" })
          .eq("id", r.id);
        if (error) throw error;
      } else {
        const { advancedTo } = await completeReminder(r);
        if (advancedTo) toast.success(t.advancedTo(formatDay(advancedTo, lang)));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    qc.invalidateQueries({ queryKey: ["reminders"] });
  };

  // What the button will do, stated before the tap: a recurring reminder is
  // not closed by "done", it moves to the next occurrence.
  const doneLabel = (r: { recurrence: string; due_at: string | null }) =>
    isRepeating(r.recurrence) && r.due_at
      ? r.recurrence === "monthly"
        ? t.markDoneNextMonth
        : t.markDoneNextYear
      : t.markDone;

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

      {/* One line explaining the toggle, shown only when the user is in a
          family - otherwise no switch is rendered and the hint is noise. */}
      {family && tasks?.length ? (
        <p className="mb-2 text-xs text-muted-foreground">{t.sharedHint}</p>
      ) : null}

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
                  {assigneeLabel(r.assignee_user_id) ? (
                    <span>
                      {t.r4Assignee}: {assigneeLabel(r.assignee_user_id)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5">
                  <AttachmentControl
                    table="reminders"
                    rowId={r.id}
                    doc={(r.source_document_id && linkedDocs?.[r.source_document_id]) || null}
                    onChanged={() => qc.invalidateQueries()}
                  />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {family && (
                  // The switch carried only an aria-label, so sighted users saw
                  // an unlabelled toggle next to the done button and could not
                  // tell what it did. The text makes the purpose visible.
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {/* Always visible: hiding the label on small screens put
                        phone users back where they started, looking at an
                        unlabelled toggle. The short word fits the narrow row. */}
                    <span className="sm:hidden">{t.sharedShort}</span>
                    <span className="hidden sm:inline">{t.shared}</span>
                    <Switch
                      checked={r.is_shared}
                      onCheckedChange={(v) => share(r.id, v)}
                      aria-label={t.shared}
                    />
                  </label>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t.edit}
                  title={t.edit}
                  onClick={() =>
                    setEditTask({
                      id: r.id,
                      title: r.title,
                      dueAt: r.due_at,
                      notes: r.notes ?? "",
                      assigneeUserId: r.assignee_user_id ?? null,
                    })
                  }
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => toggle(r)}>
                  {r.status === "done" ? t.reopen : doneLabel(r)}
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
      <TaskEditDialog
        task={editTask}
        members={(memberLabels ?? []).map((m) => ({ userId: m.userId, label: m.label }))}
        onClose={() => setEditTask(null)}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ["reminders"] });
          void qc.invalidateQueries({ queryKey: ["unified-agenda"] });
        }}
      />
    </AppShell>
  );
}
