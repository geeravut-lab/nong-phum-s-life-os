import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Copy one string to the clipboard, and say whether it worked.
 *
 * Every page that produced a link used to print it and leave the user to
 * select it by hand, or called navigator.clipboard and swallowed the failure -
 * which is worse than not copying, because the user walks away believing they
 * have the link. The API is unavailable outside a secure context and in some
 * in-app browsers, so the failure is reported here rather than ignored.
 */
export function CopyButton({
  value,
  label,
  className = "",
  variant = "outline",
}: {
  value: string;
  /** Button text. Omit for an icon-only button (still labelled for screen readers). */
  label?: string;
  className?: string;
  variant?: "outline" | "ghost" | "secondary";
}) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      toast.success(t.copied);
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error(t.copyFailed);
    }
  };

  return (
    <Button
      size="sm"
      variant={variant}
      className={className}
      aria-label={label ?? t.copy}
      title={label ?? t.copy}
      onClick={() => void copy()}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {label ? <span className="ml-1">{label}</span> : null}
    </Button>
  );
}
