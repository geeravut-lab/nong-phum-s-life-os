import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { Bell, ExternalLink, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { catLabel, useI18n } from "@/lib/i18n";
import { analyzeDocument } from "@/lib/lifeos.functions";
import { intakeDocument } from "@/lib/doc-intake";
import { formatMoney } from "@/lib/format";
import { bangkokDateAtHour } from "@/lib/time";

const MAX_UPLOAD_MB = 10;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export const Route = createFileRoute("/_authenticated/docs")({
  head: () => ({
    meta: [
      { title: "คลังเอกสาร | น้องภูมิ" },
      { name: "description", content: "อัปโหลดรูปหรือ PDF แล้วน้องภูมิอ่าน สรุป จัดหมวด และดึงวันครบกำหนดให้" },
      { property: "og:title", content: "คลังเอกสาร | น้องภูมิ" },
      { property: "og:description", content: "อัปโหลดรูปหรือ PDF แล้วน้องภูมิอ่าน สรุป จัดหมวด และดึงวันครบกำหนดให้" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DocsPage,
});

function DocsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeDocument);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data } = await supabase
        .from("documents")
        .select("*")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

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

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // Base64 inflates by ~33% on the way to the model, and every provider caps
    // request size. Reject here so the user gets a clear message instead of a
    // provider error after a long upload.
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(
        lang === "en"
          ? `That file is too large (max ${MAX_UPLOAD_MB} MB). Try a photo or a smaller scan.`
          : `ไฟล์ใหญ่เกินไปครับ (ไม่เกิน ${MAX_UPLOAD_MB} MB) ลองถ่ายรูปหรือย่อไฟล์ก่อนนะครับ`,
      );
      return;
    }
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { analysis, routed } = await intakeDocument(file, analyze, lang, userData.user!.id);

      const notes: string[] = [t.savedToDocs];
      if (routed.includes("expense")) notes.push(t.routedToExpense);
      if (routed.includes("income")) notes.push(t.routedToIncome);
      if (routed.includes("reminder")) notes.push(t.routedToTasks);
      toast.success(`${analysis.title} — ${notes.join(" · ")}`);
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (path: string | null) => {
    if (!path) return;
    const { data } = await supabase.storage.from("documents").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };

  const remove = async (id: string, path: string | null) => {
    if (path) await supabase.storage.from("documents").remove([path]);
    await supabase.from("documents").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["documents"] });
  };

  const makeReminder = async (doc: { id: string; title: string; due_date: string | null }) => {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("reminders").insert({
      user_id: userData.user!.id,
      title: doc.title,
      // A document only knows the day; 09:00 Bangkok is a sensible reminder
      // hour, not the 07:00 that UTC-midnight parsing would produce.
      due_at: doc.due_date ? bangkokDateAtHour(doc.due_date, 9) : null,
      source_document_id: doc.id,
      priority: "high",
    });
    if (error) toast.error(error.message);
    else toast.success(t.saved);
  };

  const toggleShare = async (id: string, next: boolean) => {
    const { error } = await supabase
      .from("documents")
      .update({ is_shared: next, family_id: next ? (family ?? null) : null })
      .eq("id", id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["documents"] });
  };

  return (
    <AppShell>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t.docsTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.docsSub}</p>
        </div>
        <Button onClick={() => fileInput.current?.click()} disabled={busy}>
          <Upload className="mr-1.5 size-4" />
          {busy ? t.analyzing : t.upload}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={onFile}
        />
      </header>

      {familyFailed && (
        <p className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {t.familyLoadError}
        </p>
      )}

      {busy && <Skeleton className="mb-4 h-28 w-full" />}

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : docs?.length ? (
        <div className="space-y-3">
          {docs.map((d) => (
            <Card key={d.id} className="shadow-soft">
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{d.title}</h2>
                  <Badge variant="secondary">{catLabel(d.category, lang)}</Badge>
                  {d.due_date && (
                    <Badge variant="outline">
                      {t.dueDate}: {d.due_date}
                    </Badge>
                  )}
                  {d.amount != null && (
                    <Badge variant="outline">
                      {formatMoney(Number(d.amount))} {t.baht}
                    </Badge>
                  )}
                </div>
                {d.counterparty && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.counterparty}: {d.counterparty}
                  </p>
                )}
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d.summary}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openFile(d.storage_path)}>
                    <ExternalLink className="mr-1.5 size-3.5" />
                    {t.download}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => makeReminder(d)}>
                    <Bell className="mr-1.5 size-3.5" />
                    {t.createReminderFromDoc}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => remove(d.id, d.storage_path)}
                  >
                    <Trash2 className="mr-1.5 size-3.5" />
                    {t.delete}
                  </Button>
                  {family && (
                    <div className="ml-auto flex items-center gap-2">
                      <Label htmlFor={`sh-${d.id}`} className="text-xs text-muted-foreground">
                        {t.shared}
                      </Label>
                      <Switch
                        id={`sh-${d.id}`}
                        checked={d.is_shared}
                        onCheckedChange={(v) => toggleShare(d.id, v)}
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t.docsEmpty}
        </p>
      )}
    </AppShell>
  );
}
