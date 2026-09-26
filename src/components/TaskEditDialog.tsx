import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { deleteAgendaItem, updateAgendaItem } from "@/lib/agenda.functions";

export type EditableTask = {
  id: string;
  title: string;
  dueAt: string | null;
  notes: string;
  assigneeUserId: string | null;
};

export type MemberOption = { userId: string; label: string };

/**
 * One editor for a reminder, shared by every page that lists tasks.
 *
 * Tasks appear on Today, Tasks, the unified agenda and the family page, and
 * each of those grew its own partial controls. Keeping the form here means a
 * task edits the same way everywhere, and the rules stay in the two server
 * functions it calls rather than being re-implemented per page.
 */
export function TaskEditDialog(props: {
  task: EditableTask | null;
  /** Family members available as assignees; empty when not in a family. */
  members: MemberOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Mount only when there is a task, and key by its id.
  //
  // The fields are useState initialisers, which run once per mount. Rendering
  // this component permanently and returning null for "no task" meant those
  // initialisers ran while task was still null, so the form stayed empty when
  // a task arrived, and kept the previous task's values when another was
  // opened. The key makes React build a fresh form per task.
  if (!props.task) return null;
  return <TaskEditForm key={props.task.id} {...props} task={props.task} />;
}

function TaskEditForm({
  task,
  members,
  onClose,
  onSaved,
}: {
  task: EditableTask;
  members: MemberOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const runUpdate = useServerFn(updateAgendaItem);
  const runDelete = useServerFn(deleteAgendaItem);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [when, setWhen] = useState(() => toLocalInput(task.dueAt));
  const [notes, setNotes] = useState(task.notes);
  const [assignee, setAssignee] = useState(task.assigneeUserId ?? "");

  const save = async () => {
    setBusy(true);
    try {
      await runUpdate({
        data: {
          source: "task",
          id: task.id,
          title: title.trim(),
          ...(when ? { startsAt: new Date(when).toISOString() } : {}),
          notes,
          // Only send the assignee when the page offers the choice, so a page
          // without a member list cannot clear it by accident.
          ...(members.length > 0 ? { assigneeUserId: assignee || null } : {}),
        },
      });
      toast.success(t.saved);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t.agendaDeleteConfirm)) return;
    setBusy(true);
    try {
      await runDelete({ data: { source: "task", id: task.id } });
      toast.success(t.agendaDeleted);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md space-y-3 rounded-2xl bg-background p-4 shadow-lg">
        <h2 className="font-semibold">{t.agendaEdit ?? "แก้ไขรายการ"}</h2>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input
          type="datetime-local"
          step={60}
          lang="en-GB"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <Input value={notes} placeholder={t.note} onChange={(e) => setNotes(e.target.value)} />
        {members.length > 0 ? (
          <select
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            aria-label={t.r4Assignee}
          >
            <option value="">— {t.r4Assignee} —</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.label}
              </option>
            ))}
          </select>
        ) : null}
        <div className="flex justify-between gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void remove()}>
            {t.delete}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              {t.save}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ISO -> value for <input type="datetime-local">, which wants local wall clock. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
