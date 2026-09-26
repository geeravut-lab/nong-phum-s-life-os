import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { exportMyData } from "@/lib/export.functions";

/**
 * The export half of PDPA's "export and deletion". Sits beside
 * DeleteAccountCard so both halves are in the same place in Settings.
 */
export function ExportDataCard() {
  const { t } = useI18n();
  const run = useServerFn(exportMyData);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const res = (await run()) as { filename: string; json: string };
      // Written in the browser so the export never has to be stored server-side.
      const blob = new Blob([res.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t.exportDone);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
      <h2 className="text-sm font-semibold">{t.exportTitle}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t.exportText}</p>
      <Button className="mt-3" variant="outline" disabled={busy} onClick={() => void download()}>
        <Download className="mr-2 size-4" />
        {busy ? t.exportPreparing : t.exportButton}
      </Button>
    </section>
  );
}
