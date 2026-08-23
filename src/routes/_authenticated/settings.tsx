import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [dark, setDark] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").maybeSingle();
      return data ?? null;
    },
  });

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile?.display_name]);

  useEffect(() => {
    const stored = window.localStorage.getItem("phum-theme");
    const isDark = stored === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggleTheme = (next: boolean) => {
    setDark(next);
    window.localStorage.setItem("phum-theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  };

  const changeLang = async (next: Lang) => {
    setLang(next);
    await supabase.from("profiles").update({ language: next }).eq("id", profile!.id);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", profile!.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t.saved);
    qc.invalidateQueries({ queryKey: ["profile"] });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <AppShell>
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">{t.settingsTitle}</h1>
      </header>

      <div className="space-y-4">
        <form
          onSubmit={save}
          className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft"
        >
          <div className="space-y-1.5">
            <Label htmlFor="name">{t.displayName}</Label>
            <Input
              id="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <Button type="submit">{t.save}</Button>
        </form>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <h2 className="mb-3 text-sm font-semibold">{t.language}</h2>
          <div className="flex gap-2">
            <Button
              variant={lang === "th" ? "default" : "outline"}
              size="sm"
              onClick={() => void changeLang("th")}
            >
              {t.thai}
            </Button>
            <Button
              variant={lang === "en" ? "default" : "outline"}
              size="sm"
              onClick={() => void changeLang("en")}
            >
              {t.english}
            </Button>
          </div>
        </section>

        <section className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-soft">
          <div>
            <h2 className="text-sm font-semibold">{t.theme}</h2>
            <p className="text-xs text-muted-foreground">{dark ? t.dark : t.light}</p>
          </div>
          <Switch checked={dark} onCheckedChange={toggleTheme} aria-label={t.theme} />
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <h2 className="text-sm font-semibold">{t.privacy}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.privacyText}</p>
        </section>

        <Button variant="outline" onClick={signOut}>
          {t.signOut}
        </Button>
      </div>
    </AppShell>
  );
}
