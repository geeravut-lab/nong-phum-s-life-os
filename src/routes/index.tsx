import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText, ListTodo, MessageCircleHeart, Sparkles, Users, Wallet } from "lucide-react";
import { PhumMark } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useAuthUser } from "@/hooks/useAuthUser";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "น้องภูมิ — ผู้ช่วย Life OS ดูแลเอกสาร เตือนความจำ ค่าใช้จ่าย" },
      {
        name: "description",
        content:
          "น้องภูมิคือผู้ช่วยส่วนตัวที่อ่านเอกสารให้ สร้างเตือนความจำ จัดหมวดค่าใช้จ่าย แชร์กับครอบครัว และสรุปเรื่องสำคัญให้ทุกเช้า",
      },
      { property: "og:title", content: "น้องภูมิ — ผู้ช่วย Life OS ส่วนตัวของคุณ" },
      {
        property: "og:description",
        content: "เอกสาร เตือนความจำ ค่าใช้จ่าย และครอบครัว รวมไว้ในที่เดียว พร้อมสรุปทุกเช้า",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { t, lang, setLang } = useI18n();
  const { user } = useAuthUser();

  const features = [
    { icon: FileText, title: t.docsTitle, text: t.docsSub },
    { icon: ListTodo, title: t.tasksTitle, text: t.tasksSub },
    { icon: Wallet, title: t.moneyTitle, text: t.moneySub },
    { icon: Users, title: t.familyTitle, text: t.familySub },
    { icon: MessageCircleHeart, title: t.chatTitle, text: t.chatPlaceholder },
    { icon: Sparkles, title: t.briefFromPhum, text: t.todayNone },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          <PhumMark />
          <span className="font-semibold tracking-tight">{t.appName}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLang(lang === "th" ? "en" : "th")}
            aria-label={t.language}
          >
            {lang === "th" ? "EN" : "ไทย"}
          </Button>
          <Link to={user ? "/today" : "/auth"}>
            <Button size="sm">{user ? t.openApp : t.signIn}</Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-20">
        <section className="rounded-3xl bg-primary/10 px-6 py-14 text-center md:py-20">
          <p className="text-sm font-medium text-primary">{t.appTagline}</p>
          <h1 className="mx-auto mt-3 max-w-2xl text-3xl font-bold leading-snug tracking-tight md:text-5xl">
            {t.heroTitle}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground md:text-base">
            {t.heroSub}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link to={user ? "/today" : "/auth"}>
              <Button size="lg">{user ? t.openApp : t.heroCta}</Button>
            </Link>
            <a href="#features">
              <Button size="lg" variant="outline">
                {t.heroCta2}
              </Button>
            </a>
          </div>
        </section>

        <section id="features" className="mt-14">
          <h2 className="text-center text-xl font-semibold tracking-tight md:text-2xl">
            {t.features}
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <article
                key={f.title}
                className="rounded-2xl border border-border bg-card p-5 shadow-soft"
              >
                <f.icon className="size-6 text-primary" />
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-3xl border border-border bg-card p-8 text-center shadow-soft">
          <h2 className="text-xl font-semibold tracking-tight">{t.heroCta}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t.privacyText}</p>
          <Link to={user ? "/today" : "/auth"} className="mt-5 inline-block">
            <Button size="lg">{user ? t.openApp : t.signUp}</Button>
          </Link>
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} {t.appName}
      </footer>
    </div>
  );
}
