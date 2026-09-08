import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, LogOut, Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { joinFamilyByCode } from "@/lib/lifeos.functions";
import { useI18n } from "@/lib/i18n";
import { formatDay } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/family")({
  head: () => ({
    meta: [
      { title: "ครอบครัว | น้องภูมิ" },
      { name: "description", content: "สร้างกลุ่มครอบครัว เชิญสมาชิกด้วยรหัส และแชร์เฉพาะเรื่องที่คุณเลือก" },
      { property: "og:title", content: "ครอบครัว | น้องภูมิ" },
      { property: "og:description", content: "สร้างกลุ่มครอบครัว เชิญสมาชิกด้วยรหัส และแชร์เฉพาะเรื่องที่คุณเลือก" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FamilyPage,
});

function FamilyPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const join = useServerFn(joinFamilyByCode);
  const [familyName, setFamilyName] = useState("");
  const [code, setCode] = useState("");

  const { data: membership, isLoading, isError } = useQuery({
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

  const { data: sharedItems } = useQuery({
    enabled: !!familyId,
    queryKey: ["family-shared", familyId],
    queryFn: async () => {
      const [docs, tasks, exp] = await Promise.all([
        supabase.from("documents").select("id, title, due_date").eq("is_shared", true),
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

  const family = membership?.families as
    | { id: string; name: string; invite_code: string; owner_id: string }
    | null
    | undefined;

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
                  <span className="truncate">{m.display_name ?? m.user_id.slice(0, 8)}</span>
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
        </div>
      )}
    </AppShell>
  );
}
