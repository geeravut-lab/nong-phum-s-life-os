import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Feather,
  FileText,
  HandHelping,
  ListTodo,
  MapPinned,
  MessageCircleHeart,
  Scale,
  Search,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
} from "lucide-react";
import { PhumMark } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useAuthUser } from "@/hooks/useAuthUser";

export const Route = createFileRoute("/")({
  head: () => ({ meta: routeMeta("index") }),
  component: Landing,
});

function Landing() {
  const { t, lang, setLang } = useI18n();
  const { user } = useAuthUser();

  // Every module a signed-in user gets, in the order the app itself lists
  // them. The page used to show six cards built out of in-app labels and form
  // placeholders, which both read oddly and stopped at the features that
  // existed when it was written - seven modules had been added since.
  const features = [
    { icon: MessageCircleHeart, title: t.lpChat, text: t.lpChatText },
    { icon: FileText, title: t.lpDocs, text: t.lpDocsText },
    { icon: ListTodo, title: t.lpTasks, text: t.lpTasksText },
    { icon: CalendarDays, title: t.lpAgenda, text: t.lpAgendaText },
    { icon: Wallet, title: t.lpMoney, text: t.lpMoneyText },
    { icon: Search, title: t.lpSearch, text: t.lpSearchText },
    { icon: Users, title: t.lpFamily, text: t.lpFamilyText },
    { icon: HandHelping, title: t.lpHelpMe, text: t.lpHelpMeText },
    { icon: ShieldCheck, title: t.lpBenefits, text: t.lpBenefitsText },
    { icon: Scale, title: t.lpDecide, text: t.lpDecideText },
    { icon: MapPinned, title: t.lpLocal, text: t.lpLocalText },
    { icon: Feather, title: t.lpLegacy, text: t.lpLegacyText },
    { icon: Bell, title: t.lpInbox, text: t.lpInboxText },
  ];

  const flows = [t.lpFlow1, t.lpFlow2, t.lpFlow3, t.lpFlow4];
  const prices = [t.lpPriceFree, t.lpPricePayg, t.lpPricePremium, t.lpPriceFamily];
  const start = user ? t.openApp : t.heroCta;

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
              <Button size="lg">{start}</Button>
            </Link>
            <a href="#features">
              <Button size="lg" variant="outline">
                {t.heroCta2}
              </Button>
            </a>
          </div>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Smartphone className="size-3.5" />
            {t.lpInstall}
          </p>
        </section>

        <section id="features" className="mt-14">
          <h2 className="text-center text-xl font-semibold tracking-tight md:text-2xl">
            {t.features}
          </h2>
          <p className="mt-1.5 text-center text-sm text-muted-foreground">{t.lpFeaturesSub}</p>
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

        {/* The point of the whole thing: the modules are not separate apps. */}
        <section className="mt-14 rounded-3xl border border-border bg-card p-6 shadow-soft md:p-8">
          <h2 className="text-xl font-semibold tracking-tight">{t.lpConnectTitle}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{t.lpConnectSub}</p>
          <ul className="mt-5 space-y-3">
            {flows.map((f) => (
              <li key={f} className="flex gap-3 text-sm">
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
            <h2 className="text-lg font-semibold tracking-tight">{t.lpPrivacyTitle}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t.lpPrivacyText}</p>
          </section>
          <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
            <h2 className="text-lg font-semibold tracking-tight">{t.lpPriceTitle}</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              {prices.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        </div>

        <section className="mt-14 rounded-3xl border border-border bg-card p-8 text-center shadow-soft">
          <h2 className="text-xl font-semibold tracking-tight">{t.heroCta}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t.lpPrivacyText}</p>
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
