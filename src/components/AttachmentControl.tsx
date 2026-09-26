import { useRef, useState } from "react";
import { FileText, Paperclip, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  attachFile,
  AttachmentError,
  detachFile,
  MAX_ATTACHMENT_MB,
  openAttachment,
  type AttachableTable,
  type LinkedDoc,
} from "@/lib/attachments";
import { useI18n } from "@/lib/i18n";

// The file slot on an expense / income / reminder card. Three states:
//   nothing linked          → "แนบใบเสร็จ"
//   kind = 'attachment'     → thumbnail (image) or file chip, open on tap,
//                             replace / remove
//   kind = 'analyzed'       → "เอกสารต้นทาง" chip opening the vault's file;
//                             no replace/remove — the vault owns that document
type Props = {
  table: AttachableTable;
  rowId: string;
  doc: LinkedDoc | null;
  onChanged: () => void;
};

export function AttachmentControl({ table, rowId, doc, onChanged }: Props) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const pick = () => input.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      await attachFile(table, rowId, file, userData.user!.id);
      toast.success(t.attachDone);
      onChanged();
    } catch (err) {
      if (err instanceof AttachmentError) {
        toast.error(
          err.code === "too_large"
            ? t.docsFileTooLarge(MAX_ATTACHMENT_MB)
            : t.attachTypeUnsupported,
        );
      } else {
        toast.error(`${t.attachFailed} ${err instanceof Error ? err.message : ""}`.trim());
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      await detachFile(table, rowId, doc);
      toast.success(t.attachRemoved);
      setConfirm(false);
      onChanged();
    } catch (err) {
      toast.error(`${t.attachFailed} ${err instanceof Error ? err.message : ""}`.trim());
    } finally {
      setBusy(false);
    }
  };

  const open = () =>
    doc?.storage_path && openAttachment(doc.storage_path).catch((err) => toast.error(err.message));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={onFile}
      />

      {!doc ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={pick}
        >
          <Paperclip className="mr-1 size-3.5" />
          {busy ? t.attachUploading : t.attachReceipt}
        </Button>
      ) : doc.kind === "attachment" ? (
        <>
          <button
            type="button"
            onClick={open}
            title={doc.title}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-0.5 pr-2 text-xs hover:bg-muted"
          >
            {doc.thumbUrl ? (
              <img src={doc.thumbUrl} alt="" className="size-8 rounded-md object-cover" />
            ) : (
              <span className="flex size-8 items-center justify-center rounded-md bg-muted">
                <FileText className="size-4" />
              </span>
            )}
            <span className="max-w-[10rem] truncate">{doc.title}</span>
          </button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={busy}
            onClick={pick}
            title={t.attachReplace}
          >
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-destructive"
            disabled={busy}
            onClick={() => setConfirm(true)}
            title={t.attachRemove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={open}
          title={doc.title}
        >
          <FileText className="mr-1 size-3.5" />
          {t.attachSourceDoc}
        </Button>
      )}

      <AlertDialog open={confirm} onOpenChange={(v) => !busy && setConfirm(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.attachRemoveConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.attachRemoveConfirmText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t.cancelBtn}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
              disabled={busy}
            >
              {t.attachRemove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
