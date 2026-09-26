import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Loader2, Scale, Sparkles, Archive } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useI18n } from "@/lib/i18n";
import { analyzeDecision } from "@/lib/decision.functions";
import { DECISION_TEMPLATES, scoreOption, type DecisionBoard } from "@/lib/decision.shared";

export const Route = createFileRoute("/_authenticated/decide")({
  head: () => ({ meta: routeMeta("decide") }),
  component: DecidePage,
});

type SavedDecision = {
  id: string;
  question: string;
  status: string;
  recommendation: string | null;
  board: DecisionBoard | Record<string, unknown>;
  context: Record<string, string>;
  template: string | null;
  chosen_option_id: string | null;
  outcome: string | null;
  created_at: string;
};

function DecidePage() {
  const { t, lang } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const runAnalyze = useServerFn(analyzeDecision);

  const [expandedJournalId, setExpandedJournalId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [template, setTemplate] = useState<string | null>(null);
  const [context, setContext] = useState<Record<string, string>>({});
  const [board, setBoard] = useState<DecisionBoard | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const journal = useQuery({
    queryKey: ["decisions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("decisions")
        .select(
          "id, question, status, recommendation, board, context, template, chosen_option_id, outcome, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as unknown as SavedDecision[];
    },
  });

  const ranked = useMemo(() => {
    if (!board) return [];
    return [...board.options]
      .map((o) => ({ ...o, total: scoreOption(o, board.criteria) }))
      .sort((a, b) => b.total - a.total);
  }, [board]);

  const run = async (extraContext?: Record<string, string>) => {
    const q = question.trim();
    if (q.length < 3) return;
    setBusy(true);
    try {
      const merged = { ...context, ...extraContext };
      const result = await runAnalyze({
        data: {
          question: q,
          template,
          context: merged,
          lang: lang === "en" ? "en" : "th",
        },
      });
      setBoard(result);
      setContext(merged);

      const status = result.needsMoreInfo ? "draft" : "analyzed";
      if (activeId) {
        const { error } = await supabase
          .from("decisions")
          .update({
            question: q,
            template,
            context: merged,
            board: result,
            recommendation: result.recommendation.leaning,
            status,
          })
          .eq("id", activeId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("decisions")
          .insert({
            user_id: user!.id,
            question: q,
            template,
            context: merged,
            board: result,
            recommendation: result.recommendation.leaning,
            status,
          })
          .select("id")
          .single();
        if (error) throw error;
        setActiveId(data.id);
      }
      qc.invalidateQueries({ queryKey: ["decisions"] });
      toast.success(t.decideAnalyzed);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const answerFollowUps = async () => {
    if (!board?.followUpQuestions?.length) {
      await run();
      return;
    }
    await run(context);
  };

  const chooseOption = async (optionId: string) => {
    if (!activeId) return;
    const { error } = await supabase
      .from("decisions")
      .update({ chosen_option_id: optionId, status: "decided" })
      .eq("id", activeId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t.decideChose);
    qc.invalidateQueries({ queryKey: ["decisions"] });
  };

  const setOutcome = async (id: string, outcome: string) => {
    const { error } = await supabase
      .from("decisions")
      .update({ outcome, status: "archived" })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t.decideOutcomeSaved);
    qc.invalidateQueries({ queryKey: ["decisions"] });
  };

  const loadSaved = (d: SavedDecision) => {
    setActiveId(d.id);
    setQuestion(d.question);
    setTemplate(d.template);
    setContext((d.context as Record<string, string>) ?? {});
    setBoard(d.board as DecisionBoard);
  };

  const templateLabel = (id: string) => {
    const map: Record<string, string> = {
      buy_vehicle: t.decideTplVehicle,
      buy_rent_home: t.decideTplHome,
      job_change: t.decideTplJob,
      insurance: t.decideTplInsurance,
      phone: t.decideTplPhone,
      travel: t.decideTplTravel,
      study: t.decideTplStudy,
      business: t.decideTplBusiness,
      other: t.decideTplOther,
    };
    return map[id] ?? id;
  };

  return (
    <AppShell>
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Scale className="size-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">{t.decideTitle}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t.decideSub}</p>
      </header>

      {/* Wizard */}
      <section className="mb-8 space-y-4 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <p className="text-sm font-medium">{t.decidePrompt}</p>
        <Textarea
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t.decidePlaceholder}
          maxLength={500}
        />
        <div className="flex flex-wrap gap-2">
          {DECISION_TEMPLATES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTemplate(template === id ? null : id)}
              className={
                template === id
                  ? "rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground"
                  : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
              }
            >
              {templateLabel(id)}
            </button>
          ))}
        </div>
        <Button disabled={busy || question.trim().length < 3} onClick={() => run()}>
          {busy ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {t.decideAnalyzing}
            </>
          ) : (
            <>
              <Sparkles className="mr-2 size-4" />
              {t.decideAnalyze}
            </>
          )}
        </Button>
      </section>

      {/* Follow-up interview */}
      {board?.needsMoreInfo && (board.followUpQuestions?.length ?? 0) > 0 && (
        <section className="mb-8 space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold">{t.decideNeedMore}</h2>
          {board.followUpQuestions.map((fq) => (
            <div key={fq.id}>
              <label className="text-sm font-medium">{fq.question}</label>
              {fq.hint && <p className="text-xs text-muted-foreground">{fq.hint}</p>}
              <Input
                className="mt-1"
                value={context[fq.id] ?? ""}
                onChange={(e) => setContext((c) => ({ ...c, [fq.id]: e.target.value }))}
                placeholder={t.decideAnswerPlaceholder}
              />
            </div>
          ))}
          <Button disabled={busy} onClick={answerFollowUps}>
            {t.decideReanalyze}
          </Button>
        </section>
      )}

      {/* Board */}
      {board && board.options?.length > 0 && (
        <section className="mb-8 space-y-6">
          {/* Recommendation */}
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{t.decideRecommendation}</Badge>
              <Badge variant="secondary">
                {t.decideConfidence}: {board.recommendation.confidence}%
              </Badge>
            </div>
            <p className="mt-2 font-medium">{board.recommendation.leaning}</p>
            <p className="mt-1 text-sm text-muted-foreground">{board.recommendation.reasoning}</p>
            {(board.recommendation.uncertainties?.length ?? 0) > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                {board.recommendation.uncertainties.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Comparison matrix */}
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 font-medium">{t.decideCriterion}</th>
                  {board.options.map((o) => (
                    <th key={o.id} className="p-3 font-medium">
                      {o.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board.criteria.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="p-3">
                      {c.label} <span className="text-xs text-muted-foreground">×{c.weight}</span>
                    </td>
                    {board.options.map((o) => {
                      const s = o.scores[c.id] ?? 0;
                      return (
                        <td key={o.id} className="p-3">
                          {"★".repeat(s)}
                          {"☆".repeat(Math.max(0, 5 - s))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t border-border bg-muted/30 font-medium">
                  <td className="p-3">{t.decideTotalScore}</td>
                  {board.options.map((o) => {
                    const total = ranked.find((r) => r.id === o.id)?.total ?? 0;
                    return (
                      <td key={o.id} className="p-3">
                        {total}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Option cards */}
          <div className="grid gap-4 md:grid-cols-2">
            {ranked.map((o) => (
              <article
                key={o.id}
                className="rounded-2xl border border-border bg-card p-4 shadow-soft"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{o.label}</h3>
                  <Badge variant="outline">{o.total}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{o.summary}</p>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <p className="font-medium text-emerald-700 dark:text-emerald-400">
                      {t.decidePros}
                    </p>
                    <ul className="list-inside list-disc">
                      {o.pros.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-rose-700 dark:text-rose-400">{t.decideCons}</p>
                    <ul className="list-inside list-disc">
                      {o.cons.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                {(o.risks?.length ?? 0) > 0 && (
                  <div className="mt-2 text-xs">
                    <p className="font-medium">{t.decideRisks}</p>
                    <ul className="list-inside list-disc text-muted-foreground">
                      {o.risks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <Button
                  className="mt-3"
                  size="sm"
                  variant="secondary"
                  onClick={() => chooseOption(o.id)}
                >
                  {t.decideChooseThis}
                </Button>
              </article>
            ))}
          </div>

          {/* Facts vs judgment */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border p-3 text-sm">
              <p className="font-medium">{t.decideFacts}</p>
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                {(board.factsVsJudgment?.facts ?? []).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-border p-3 text-sm">
              <p className="font-medium">{t.decideJudgments}</p>
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                {(board.factsVsJudgment?.judgments ?? []).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* Journal */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Archive className="size-4" />
          {t.decideJournal}
        </h2>
        {journal.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !(journal.data ?? []).length ? (
          <p className="text-sm text-muted-foreground">{t.decideJournalEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {(journal.data ?? []).map((d) => {
              const open = expandedJournalId === d.id;
              return (
                <li
                  key={d.id}
                  className="rounded-xl border border-border bg-card px-3 py-2 text-sm"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <div className="min-w-0 sm:flex-1">
                      <span className="font-medium">{d.question}</span>
                      {!open && d.recommendation && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {d.recommendation}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                      <Badge variant="outline">{d.status}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (open) {
                            setExpandedJournalId(null);
                            setBoard(null);
                            setActiveId(null);
                          } else {
                            setExpandedJournalId(d.id);
                            loadSaved(d);
                          }
                        }}
                      >
                        {open ? t.r6CollapseDetail : t.r6ViewDetail}
                      </Button>
                      {!d.outcome && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setOutcome(d.id, "good")}
                          >
                            👍
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setOutcome(d.id, "ok")}>
                            👌
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setOutcome(d.id, "bad")}>
                            👎
                          </Button>
                        </>
                      )}
                      {d.outcome && <Badge variant="secondary">{d.outcome}</Badge>}
                    </div>
                  </div>
                  {open && (
                    <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                      {d.recommendation && (
                        <p>
                          <span className="font-medium text-foreground">
                            {t.decideRecommendation}:{" "}
                          </span>
                          {d.recommendation}
                        </p>
                      )}
                      {/* template optional */}
                      <p className="text-[10px]">{new Date(d.created_at).toLocaleString()}</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-1"
                        onClick={() => setExpandedJournalId(null)}
                      >
                        {t.r6CollapseDetail}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
