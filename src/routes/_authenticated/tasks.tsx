import { DateInput, DateTimeInput } from "@/components/ui/datetime-input";
import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listFamilyMemberLabels } from "@/lib/family.functions";
import { useState } from "react";
import { Download, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PhumQuickBar } from "@/components/PhumQuickBar";
import { TaskEditDialog, type EditableTask } from "@/components/TaskEditDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { errorText } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { completeReminder, reopenReminder } from "@/lib/reminder-actions";
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
  const [taskTab, setTaskTab] = useState<"open" | "done">("open");
  // Two tabs was all the page had. On a list of seventeen, "what did I give
  // to whom" and "what is urgent this week" are the two questions people
  // actually arrive with.
  const [fAssignee, setFAssignee] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const filtersOn = !!(fAssignee || fPriority || fFrom || fTo);
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

  // Two lists rather than one, because a finished errand sitting among the
  // live ones is what makes a to-do list stop being read. Ticking a row moves
  // it across; reopening moves it back.
  const matches = (r: {
    assignee_user_id: string | null;
    priority: string;
    due_at: string | null;
  }) => {
    if (fAssignee === "none" ? r.assignee_user_id : fAssignee && r.assignee_user_id !== fAssignee)
      return false;
    if (fPriority && r.priority !== fPriority) return false;
    // A task with no due date is not in any date range. Filtering by date is
    // asking "what is due between these days", and it has no answer.
    if (fFrom || fTo) {
      if (!r.due_at) return false;
      const day = new Date(r.due_at).toISOString().slice(0, 10);
      if (fFrom && day < fFrom) return false;
      if (fTo && day > fTo) return false;
    }
    return true;
  };

  const openTasks = (tasks ?? []).filter((r) => r.status !== "done" && matches(r));
  const doneTasks = (tasks ?? []).filter((r) => r.status === "done" && matches(r));
  const shown = taskTab === "open" ? openTasks : doneTasks;

  // Exactly the tab being looked at, not every task the account holds.
  const exportCsv = () => {
    if (shown.length === 0) {
      toast.info(t.exportNothing);
      return;
    }
    const rows = shown.map((r) => [
      r.title,
      r.status === "done" ? t.tasksTabDone : t.tasksTabOpen,
      r.due_at ? formatDay(new Date(r.due_at), lang, true) : "",
      r.priority === "high" ? t.high : r.priority === "low" ? t.low : t.normal,
      r.recurrence === "monthly" ? t.monthly : r.recurrence === "yearly" ? t.yearly : t.none,
      assigneeLabel(r.assignee_user_id) ?? "",
      r.is_shared ? "✓" : "",
      r.notes ?? "",
      r.last_completed_at ? formatDay(new Date(r.last_completed_at), lang, true) : "",
      r.created_at ? formatDay(new Date(r.created_at), lang, true) : "",
    ]);
    downloadCsv(
      `lifeos-tasks-${taskTab}`,
      [
        t.taskTitle,
        t.csvStatus,
        t.dueAt,
        t.priority,
        t.recurrence,
        t.r4Assignee,
        t.csvShared,
        t.note,
        t.csvCompletedAt,
        t.csvCreatedAt,
      ],
      rows,
    );
    toast.success(t.exportedRows.replace("{n}", String(rows.length)));
  };

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
        // Through the same server function as completing, for the same reason:
        // a shared or assigned task is not yours to update from the client.
        await reopenReminder(r.id);
      } else {
        const { advancedTo } = await completeReminder(r);
        if (advancedTo) toast.success(t.advancedTo(formatDay(advancedTo, lang)));
      }
    } catch (err) {
      // errorText, not the raw message: the server throws a code so the
      // sentence can be in the reader's language.
      toast.error(errorText(err, t));
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
              <DateTimeInput
                id="due"

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
      {family && shown.length ? (
        <p className="mb-2 text-xs text-muted-foreground">{t.sharedHint}</p>
      ) : null}

      {/* Each field takes the same share of the row - half of it on a phone,
          a fixed column on anything wider. Sized to their own content they
          came out visibly uneven, because a label as short as "ถึง" made its
          box narrower than the one beside it. */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="min-w-0 basis-[calc(50%-0.25rem)] space-y-1 sm:basis-40">
          <Label className="text-xs text-muted-foreground">{t.r4Assignee}</Label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={fAssignee}
            onChange={(e) => setFAssignee(e.target.value)}
          >
            <option value="">{t.filterAll}</option>
            <option value="none">{t.r4Anyone}</option>
            {(memberLabels ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 basis-[calc(50%-0.25rem)] space-y-1 sm:basis-40">
          <Label className="text-xs text-muted-foreground">{t.priority}</Label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={fPriority}
            onChange={(e) => setFPriority(e.target.value)}
          >
            <option value="">{t.filterAll}</option>
            <option value="high">{t.high}</option>
            <option value="normal">{t.normal}</option>
            <option value="low">{t.low}</option>
          </select>
        </div>
        <div className="min-w-0 basis-[calc(50%-0.25rem)] space-y-1 sm:basis-40">
          <Label className="text-xs text-muted-foreground" htmlFor="tf-from">
            {t.filterDueFrom}
          </Label>
          <DateInput
            id="tf-from"
            className="w-full"
            value={fFrom}
            onChange={(e) => setFFrom(e.target.value)}
          />
        </div>
        <div className="min-w-0 basis-[calc(50%-0.25rem)] space-y-1 sm:basis-40">
          <Label className="text-xs text-muted-foreground" htmlFor="tf-to">
            {t.filterDueTo}
          </Label>
          <DateInput
            id="tf-to"
            className="w-full"
            value={fTo}
            onChange={(e) => setFTo(e.target.value)}
          />
        </div>
        {filtersOn ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFAssignee("");
              setFPriority("");
              setFFrom("");
              setFTo("");
            }}
          >
            {t.filterClear}
          </Button>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={taskTab}
          onValueChange={(v) => setTaskTab(v as "open" | "done")}
          className="w-full max-w-xs"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="open">
              {t.tasksTabOpen}
              {openTasks.length > 0 ? ` (${openTasks.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="done">
              {t.tasksTabDone}
              {doneTasks.length > 0 ? ` (${doneTasks.length})` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="mr-1.5 size-4" />
          {t.exportCsv}
        </Button>
      </div>

      {filtersOn ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {t.filterMatched.replace("{n}", String(shown.length))}
        </p>
      ) : null}

      {shown.length ? (
        <ul className="space-y-2">
          {shown.map((r) => (
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
          {taskTab === "open" ? t.tasksEmpty : t.tasksDoneEmpty}
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
