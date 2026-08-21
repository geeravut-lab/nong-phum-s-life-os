import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useI18n } from "@/lib/i18n";
import { PhumMark } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "เข้าสู่ระบบน้องภูมิ | Life OS ผู้ช่วยส่วนตัว" },
      {
        name: "description",
        content:
          "เข้าสู่ระบบหรือสมัครใช้งานน้องภูมิ ผู้ช่วย Life OS ที่ช่วยจัดการเอกสาร เตือนความจำ ค่าใช้จ่าย และเรื่องครอบครัวของคุณ",
      },
      { property: "og:title", content: "เข้าสู่ระบบน้องภูมิ | Life OS ผู้ช่วยส่วนตัว" },
      {
        property: "og:description",
        content: "เข้าสู่ระบบเพื่อให้น้องภูมิช่วยดูแลเรื่องรอบตัวคุณ",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/today" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: `${window.location.origin}/today`,
          },
        });
        if (error) throw error;
        toast.success(t.appName + " 👋");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) navigate({ to: "/today" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error(result.error.message ?? t.error);
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/today" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-hero-gradient px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <PhumMark />
          <span className="text-lg font-semibold">{t.appName}</span>
        </Link>
        <Card className="border-border/70 shadow-soft">
          <CardContent className="pt-6">
            <h1 className="text-xl font-semibold">{mode === "signin" ? t.signIn : t.signUp}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t.appTagline}</p>

            <Button variant="outline" className="mt-5 w-full" onClick={google} type="button">
              {t.continueGoogle}
            </Button>

            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              <span>{t.email}</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <form className="space-y-4" onSubmit={submit}>
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">{t.displayName}</Label>
                  <Input
                    id="name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">{t.email}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">{t.password}</Label>
                <Input
                  id="password"
                  type="password"
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? t.loading : mode === "signin" ? t.signIn : t.signUp}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-muted-foreground">
              {mode === "signin" ? t.noAccount : t.haveAccount}{" "}
              <button
                type="button"
                className="font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              >
                {mode === "signin" ? t.signUp : t.signIn}
              </button>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
