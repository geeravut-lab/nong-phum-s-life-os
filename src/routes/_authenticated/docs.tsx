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
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/docs")({
  component: DocsPage,
});

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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

  const { data: family } = useQuery({
    queryKey: ["my-family"],
    queryFn: async () => {
      const { data } = await supabase.from("family_members").select("family_id").maybeSingle();
      return data?.family_id ?? null;
    },
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;
      const base64 = await fileToBase64(file);
      const path = `${uid}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;

      const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
      if (upErr) throw upErr;

      const result = await analyze({
        data: { base64, mimeType: file.type || "application/pdf", fileName: file.name, lang },
      });

      const { error } = await supabase.from("documents").insert({
        user_id: uid,
        title: result.title,
        category: result.category,
        summary: result.summary,
        doc_date: result.docDate,
        due_date: result.dueDate,
        amount: result.amount,
        counterparty: result.counterparty,
        storage_path: path,
        mime_type: file.type,
        extracted: JSON.parse(JSON.stringify(result)),
      });
      if (error) throw error;

      if (result.isExpense && result.amount) {
        await supabase.from("expenses").insert({
          user_id: uid,
          title: result.title,
          amount: result.amount,
          category: result.category,
          spent_on: result.docDate ?? new Date().toISOString().slice(0, 10),
        });
      }
      qc.invalidateQueries();
      toast.success(result.title);
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
      due_at: doc.due_date ? new Date(doc.due_date).toISOString() : null,
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
