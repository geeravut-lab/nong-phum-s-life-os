import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, LogOut, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuthUser } from "@/hooks/useAuthUser";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { joinFamilyByCode } from "@/lib/lifeos.functions";
import {
  assignFamilyTask,
  createFamilyEvent,
  deleteFamilyEvent,
  listFamilyCheckins,
  listFamilyEvents,
  listFamilyPermissions,
  postFamilyCheckin,
  upsertFamilyPermission,
  listFamilyMemberLabels,
} from "@/lib/family.functions";
import { useI18n } from "@/lib/i18n";
import { formatDay } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/family")({
  head: () => ({ meta: routeMeta("family") }),
  component: FamilyPage,
});

function FamilyPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { user } = useAuthUser();
  const join = useServerFn(joinFamilyByCode);
  const runListEvents = useServerFn(listFamilyEvents);
  const runCreateEvent = useServerFn(createFamilyEvent);
  const runDeleteEvent = useServerFn(deleteFamilyEvent);
  const runPostCheckin = useServerFn(postFamilyCheckin);
  const runListCheckins = useServerFn(listFamilyCheckins);
  const runAssign = useServerFn(assignFamilyTask);
  const runListPerms = useServerFn(listFamilyPermissions);
  const runUpsertPerm = useServerFn(upsertFamilyPermission);
  const runMemberLabels = useServerFn(listFamilyMemberLabels);

  const [familyName, setFamilyName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [evTitle, setEvTitle] = useState("");
  const [evWhen, setEvWhen] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [assignee, setAssignee] = useState("");
  const [checkNote, setCheckNote] = useState("");

  const {
    data: membership,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["family-membership"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;
      // Filter by user_id: family_members_read lets a member read every row of
      // their own family (the members list below needs that), so an unfiltered
      // maybeSingle() starts failing the moment a second member joins.
      const { data, error } = await supabase
        .from("family_members")
        .select("id, family_id, families(id, name, invite_code, owner_id)")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  const familyId = membership?.family_id ?? null;

  const { data: members } = useQuery({
    enabled: !!familyId,
    queryKey: ["family-members", familyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("family_members")
        .select("id, user_id, member_role, display_name, created_at")
        .eq("family_id", familyId!);
      return data ?? [];
    },
  });

  const { data: memberLabels } = useQuery({
    enabled: !!familyId,
    queryKey: ["family-member-labels", familyId],
    queryFn: async () => {
      const res = (await runMemberLabels({ data: { familyId: familyId! } })) as {
        members: Array<{ userId: string; label: string; role: string }>;
      };
      return res.members ?? [];
    },
  });

  const labelFor = (userId: string, fallback?: string | null) => {
    const hit = memberLabels?.find((x) => x.userId === userId);
    return hit?.label || fallback?.trim() || userId.slice(0, 8);
  };

  const { data: sharedItems } = useQuery({
    enabled: !!familyId,
    queryKey: ["family-shared", familyId],
    queryFn: async () => {
      const [docs, tasks, exp] = await Promise.all([
        supabase
          .from("documents")
          .select("id, title, due_date")
          .eq("is_shared", true)
          .eq("kind", "analyzed"),
        supabase.from("reminders").select("id, title, due_at").eq("is_shared", true),
        supabase.from("expenses").select("id, title, amount, spent_on").eq("is_shared", true),
      ]);
      return {
        docs: docs.data ?? [],
        tasks: tasks.data ?? [],
        expenses: exp.data ?? [],
      };
    },
  });

  const createFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user!.id;
    const { data: fam, error } = await supabase
      .from("families")
      .insert({ name: familyName, owner_id: uid })
      .select("id")
      .single();
    if (error || !fam) {
      toast.error(error?.message ?? t.error);
      return;
    }
    const { error: memberError } = await supabase
      .from("family_members")
      .insert({ family_id: fam.id, user_id: uid, member_role: "owner" });
    if (memberError) {
      toast.error(memberError.message);
      return;
    }
    setFamilyName("");
    qc.invalidateQueries();
  };

  const joinFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await join({ data: { code } });
    if (!res.ok) {
      toast.error(t.error);
      return;
    }
    setCode("");
    toast.success(res.name);
    qc.invalidateQueries();
  };

  const leave = async () => {
    if (!membership) return;
    await supabase.from("family_members").delete().eq("id", membership.id);
    qc.invalidateQueries();
  };

  const eventsQ = useQuery({
    enabled: !!familyId,
    queryKey: ["family-events", familyId],
    queryFn: async () => {
      const res = (await runListEvents({ data: { familyId: familyId! } })) as {
        events: Array<{
          id: string;
          title: string;
          starts_at: string;
          notes: string;
          created_by: string;
        }>;
      };
      return res.events ?? [];
    },
  });

  const checkinsQ = useQuery({
    enabled: !!familyId,
    queryKey: ["family-checkins", familyId],
    queryFn: async () => {
      const res = (await runListCheckins({ data: { familyId: familyId! } })) as {
        checkins: Array<{
          id: string;
          user_id: string;
          status: string;
          note: string;
          created_at: string;
        }>;
      };
      return res.checkins ?? [];
    },
  });

  const permsQ = useQuery({
    enabled: !!familyId,
    queryKey: ["family-perms", familyId],
    queryFn: async () => {
      const res = (await runListPerms({ data: { familyId: familyId! } })) as {
        permissions: Array<{
          user_id: string;
          can_view_docs: boolean;
          can_view_tasks: boolean;
          can_view_expenses: boolean;
          can_view_calendar: boolean;
          can_edit_shared: boolean;
        }>;
      };
      return res.permissions ?? [];
    },
  });

  const family = membership?.families as
    { id: string; name: string; invite_code: string; owner_id: string } | null | undefined;

  // deleteFamilyEvent allows the creator or the family owner; mirror that here
  // so members are not shown a button the server will refuse.
  const canDeleteEvent = (createdBy: string) =>
    !!user && (user.id === createdBy || user.id === family?.owner_id);

  const removeEvent = async (eventId: string) => {
    if (!window.confirm(t.agendaDeleteConfirm)) return;
    setBusy(true);
    try {
      await runDeleteEvent({ data: { eventId } });
      toast.success(t.agendaDeleted);
      void qc.invalidateQueries({ queryKey: ["family-events", familyId] });
      void qc.invalidateQueries({ queryKey: ["unified-agenda"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">{t.familyTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.familySub}</p>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t.loading}</p>
      ) : isError ? (
        // Not just a toast: falling through to the create/join forms would tell
        // someone who is already in a family that they have none.
        <p className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-sm text-destructive">
          {t.familyLoadError}
        </p>
      ) : !family ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <form
            onSubmit={createFamily}
            className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft"
          >
            <h2 className="text-sm font-semibold">{t.createFamily}</h2>
            <div className="space-y-1.5">
              <Label htmlFor="fam-name">{t.familyName}</Label>
              <Input
                id="fam-name"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                required
              />
            </div>
            <Button type="submit">{t.createFamily}</Button>
          </form>

          <form
            onSubmit={joinFamily}
            className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft"
          >
            <h2 className="text-sm font-semibold">{t.joinFamily}</h2>
            <div className="space-y-1.5">
              <Label htmlFor="fam-code">{t.inviteCode}</Label>
              <Input
                id="fam-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                required
              />
            </div>
            <Button type="submit" variant="secondary">
              {t.joinFamily}
            </Button>
          </form>

          <p className="sm:col-span-2 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t.noFamily}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users className="size-5 text-primary" />
                <span className="font-semibold">{family.name}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={leave}>
                <LogOut className="mr-1.5 size-4" />
                {t.leave}
              </Button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t.inviteCode}</span>
              <code className="rounded-lg bg-muted px-2 py-1 text-sm font-semibold tracking-widest">
                {family.invite_code}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(family.invite_code);
                  toast.success(t.saved);
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h2 className="mb-3 text-sm font-semibold">{t.members}</h2>
            <ul className="space-y-2">
              {members?.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{labelFor(m.user_id, m.display_name)}</span>
                  <Badge variant="outline">{m.member_role}</Badge>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h2 className="mb-3 text-sm font-semibold">{t.sharedItems}</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t.docsTitle}</p>
                <ul className="space-y-1 text-sm">
                  {sharedItems?.docs.map((d) => (
                    <li key={d.id} className="truncate">
                      {d.title}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t.tasksTitle}</p>
                <ul className="space-y-1 text-sm">
                  {sharedItems?.tasks.map((r) => (
                    <li key={r.id} className="truncate">
                      {r.title}
                      {r.due_at ? ` · ${formatDay(new Date(r.due_at), lang)}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t.moneyTitle}</p>
                <ul className="space-y-1 text-sm">
                  {sharedItems?.expenses.map((x) => (
                    <li key={x.id} className="truncate">
                      {x.title} · {Number(x.amount).toLocaleString()} {t.baht}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* R4 Calendar */}
          <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h2 className="mb-3 text-sm font-semibold">{t.r4Calendar}</h2>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder={t.r4EventTitle}
                value={evTitle}
                onChange={(e) => setEvTitle(e.target.value)}
              />
              <Input
                type="datetime-local"
                value={evWhen}
                onChange={(e) => setEvWhen(e.target.value)}
              />
              <Button
                size="sm"
                disabled={busy || !evTitle.trim() || !evWhen}
                onClick={async () => {
                  if (!familyId) return;
                  setBusy(true);
                  try {
                    await runCreateEvent({
                      data: {
                        familyId,
                        title: evTitle.trim(),
                        startsAt: new Date(evWhen).toISOString(),
                      },
                    });
                    setEvTitle("");
                    setEvWhen("");
                    void qc.invalidateQueries({ queryKey: ["family-events", familyId] });
                    toast.success(t.saved);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : t.error);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t.r4AddEvent}
              </Button>
            </div>
            {(eventsQ.data?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">{t.r4NoEvents}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {(eventsQ.data ?? []).map((ev) => (
                  <li
                    key={ev.id}
                    className="flex justify-between gap-2 rounded-lg border border-border p-2"
                  >
                    <span className="font-medium">{ev.title}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatDay(new Date(ev.starts_at), lang)}
                      </span>
                      {canDeleteEvent(ev.created_by) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label={t.delete}
                          title={t.delete}
                          onClick={() => void removeEvent(ev.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* R4 Care check-in */}
          <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h2 className="mb-3 text-sm font-semibold">{t.r4Checkin}</h2>
            <Input
              className="mb-2"
              placeholder={t.r4CheckinNote}
              value={checkNote}
              onChange={(e) => setCheckNote(e.target.value)}
            />
            <div className="mb-3 flex flex-wrap gap-2">
              {(
                [
                  ["ok", t.r4CheckinOk],
                  ["need_help", t.r4CheckinHelp],
                  ["emergency", t.r4CheckinEmerg],
                ] as const
              ).map(([st, label]) => (
                <Button
                  key={st}
                  size="sm"
                  variant={
                    st === "ok" ? "default" : st === "emergency" ? "destructive" : "secondary"
                  }
                  disabled={busy}
                  onClick={async () => {
                    if (!familyId) return;
                    setBusy(true);
                    try {
                      await runPostCheckin({
                        data: {
                          familyId,
                          status: st,
                          note: checkNote.trim() || undefined,
                        },
                      });
                      setCheckNote("");
                      void qc.invalidateQueries({ queryKey: ["family-checkins", familyId] });
                      toast.success(t.saved);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : t.error);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t.r4CheckinRecent}</p>
            <ul className="space-y-1 text-xs">
              {(checkinsQ.data ?? []).slice(0, 8).map((c) => {
                const who = labelFor(
                  c.user_id,
                  members?.find((m) => m.user_id === c.user_id)?.display_name,
                );
                return (
                  <li key={c.id} className="flex justify-between gap-2">
                    <span>
                      {who} ·{" "}
                      {c.status === "ok"
                        ? t.r4CheckinOk
                        : c.status === "emergency"
                          ? t.r4CheckinEmerg
                          : t.r4CheckinHelp}
                      {c.note ? ` — ${c.note}` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDay(new Date(c.created_at), lang)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* R4 Assign task */}
          <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h2 className="mb-3 text-sm font-semibold">{t.r4AssignTask}</h2>
            <div className="flex flex-col gap-2">
              <Input
                placeholder={t.r4TaskTitle}
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
              />
              <Input
                type="datetime-local"
                value={taskDue}
                onChange={(e) => setTaskDue(e.target.value)}
              />
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">{t.r4Anyone}</option>
                {(members ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {labelFor(m.user_id, m.display_name)}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={busy || !taskTitle.trim()}
                onClick={async () => {
                  if (!familyId) return;
                  setBusy(true);
                  try {
                    await runAssign({
                      data: {
                        familyId,
                        title: taskTitle.trim(),
                        dueAt: taskDue ? new Date(taskDue).toISOString() : undefined,
                        assigneeUserId: assignee || undefined,
                      },
                    });
                    setTaskTitle("");
                    setTaskDue("");
                    setAssignee("");
                    void qc.invalidateQueries({ queryKey: ["family-shared", familyId] });
                    void qc.invalidateQueries({ queryKey: ["reminders"] });
                    toast.success(t.saved);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : t.error);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {t.r4Assign}
              </Button>
            </div>
          </section>

          {/* R4 Permissions (owner) */}
          <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h2 className="mb-1 text-sm font-semibold">{t.r4Permissions}</h2>
            <p className="mb-3 text-xs text-muted-foreground">{t.r4OwnerOnly}</p>
            <ul className="space-y-3">
              {(members ?? []).map((m) => {
                const perm = (permsQ.data ?? []).find((x) => x.user_id === m.user_id);
                const defaults = {
                  can_view_docs: perm?.can_view_docs ?? true,
                  can_view_tasks: perm?.can_view_tasks ?? true,
                  can_view_expenses: perm?.can_view_expenses ?? true,
                  can_view_calendar: perm?.can_view_calendar ?? true,
                  can_edit_shared: perm?.can_edit_shared ?? false,
                };
                return (
                  <li key={m.id} className="rounded-lg border border-border p-2 text-sm">
                    <p className="mb-2 font-medium">{labelFor(m.user_id, m.display_name)}</p>
                    <div className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-3">
                      {(
                        [
                          ["docs", t.r4PermDocs, defaults.can_view_docs],
                          ["tasks", t.r4PermTasks, defaults.can_view_tasks],
                          ["expenses", t.r4PermMoney, defaults.can_view_expenses],
                          ["calendar", t.r4PermCal, defaults.can_view_calendar],
                          ["edit", t.r4PermEdit, defaults.can_edit_shared],
                        ] as const
                      ).map(([key, label, val]) => (
                        <label key={key} className="flex items-center gap-1">
                          <input type="checkbox" defaultChecked={val} id={`${m.user_id}-${key}`} />
                          {label}
                        </label>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={busy}
                      onClick={async () => {
                        if (!familyId) return;
                        const get = (k: string) =>
                          (document.getElementById(`${m.user_id}-${k}`) as HTMLInputElement | null)
                            ?.checked ?? true;
                        setBusy(true);
                        try {
                          await runUpsertPerm({
                            data: {
                              familyId,
                              userId: m.user_id,
                              canViewDocs: get("docs"),
                              canViewTasks: get("tasks"),
                              canViewExpenses: get("expenses"),
                              canViewCalendar: get("calendar"),
                              canEditShared: get("edit"),
                            },
                          });
                          void qc.invalidateQueries({ queryKey: ["family-perms", familyId] });
                          toast.success(t.saved);
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : t.error);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {t.r4PermSave}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </AppShell>
  );
}
