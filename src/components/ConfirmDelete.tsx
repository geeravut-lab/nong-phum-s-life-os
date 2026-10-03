import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * A delete button that asks first.
 *
 * Most of the delete buttons in the app went straight to the delete: a
 * mis-tap on a phone list removed a contact, a document, a wish, with no
 * way back. The few that did ask each built their own dialog, so the
 * wording and the button order differed from screen to screen.
 *
 * `detail` is for whatever the reader needs to decide - how many rows point
 * at this document, what else goes with it - and is left out when there is
 * nothing to add beyond the name.
 */
export function ConfirmDelete({
  onConfirm,
  title,
  detail,
  disabled,
  children,
  size = "icon",
  variant = "ghost",
  className,
  confirmLabel,
}: {
  onConfirm: () => void | Promise<void>;
  /** What is about to go, in the reader's words: a document title, a person's name. */
  title?: string;
  detail?: ReactNode;
  disabled?: boolean;
  /** The button's own content; defaults to a bin icon via the caller. */
  children: ReactNode;
  size?: "icon" | "sm" | "default";
  variant?: "ghost" | "outline" | "destructive" | "secondary";
  className?: string;
  confirmLabel?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size={size}
          variant={variant}
          disabled={disabled}
          aria-label={t.delete}
          title={t.delete}
          className={className}
        >
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.confirmDeleteTitle}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              {title ? <p className="font-medium text-foreground">{title}</p> : null}
              <p>{t.confirmDeleteBody}</p>
              {detail ? <div className="text-xs">{detail}</div> : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t.cancel}</AlertDialogCancel>
          {/* Not AlertDialogAction: it closes the dialog on click, which would
              hide the spinner and let a second tap through on a slow delete. */}
          <Button variant="destructive" disabled={busy} onClick={() => void run()}>
            {confirmLabel ?? t.delete}
          </Button>
          <AlertDialogAction className="hidden" />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
