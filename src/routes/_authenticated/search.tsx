import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Search as SearchIcon, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { formatDay } from "@/lib/format";
import { universalSearch, type SearchGroup } from "@/lib/search.functions";

export const Route = createFileRoute("/_authenticated/search")({
  head: () => ({ meta: routeMeta("search") }),
  component: SearchPage,
});

function SearchPage() {
  const { t, lang } = useI18n();
  const runSearch = useServerFn(universalSearch);
  const [draft, setDraft] = useState("");
  // Only the submitted term drives the query, so typing does not fire a
  // cross-table search on every keystroke.
  const [term, setTerm] = useState("");

  const q = useQuery({
    enabled: term.trim().length >= 2,
    queryKey: ["universal-search", term, lang],
    queryFn: async () => {
      const res = (await runSearch({
        data: { q: term.trim(), lang: lang === "en" ? "en" : "th" },
      })) as { groups: SearchGroup[]; total: number };
      return res;
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTerm(draft);
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-4 py-6">
        <header className="mb-4">
          <h1 className="text-xl font-semibold tracking-tight">{t.searchTitle}</h1>
          <p className="text-sm text-muted-foreground">{t.searchSub}</p>
        </header>

        <form onSubmit={submit} className="mb-5 flex gap-2">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchTitle}
          />
          <Button type="submit" disabled={draft.trim().length < 2}>
            {q.isFetching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <SearchIcon className="size-4" />
            )}
          </Button>
        </form>

        {term.trim().length < 2 ? (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t.searchHint}
          </p>
        ) : q.isLoading ? (
          <p className="text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto size-5 animate-spin" />
          </p>
        ) : q.isError ? (
          <p className="text-sm text-destructive">
            {q.error instanceof Error ? q.error.message : t.error}
          </p>
        ) : (q.data?.total ?? 0) === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t.searchEmpty}
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              {t.searchResultCount} {q.data?.total}
            </p>
            <div className="space-y-5">
              {(q.data?.groups ?? []).map((g) => (
                <section key={g.source}>
                  <h2 className="mb-2 text-sm font-semibold">{g.label}</h2>
                  <ul className="space-y-2">
                    {g.hits.map((h) => (
                      <li
                        key={`${h.source}-${h.id}`}
                        className="rounded-xl border border-border bg-card p-3 shadow-soft"
                      >
                        <Link to={h.href} className="block">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium">{h.title}</span>
                            {h.shared ? (
                              <Badge variant="outline" className="shrink-0 text-[10px]">
                                {t.searchSharedTag}
                              </Badge>
                            ) : null}
                          </div>
                          {h.detail ? (
                            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                              {h.detail}
                            </p>
                          ) : null}
                          {h.date ? (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {formatDay(new Date(h.date), lang)}
                            </p>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
