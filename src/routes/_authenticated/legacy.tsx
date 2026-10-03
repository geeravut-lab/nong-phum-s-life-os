import { DateInput } from "@/components/ui/datetime-input";
import { errorText } from "@/lib/errors";
import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  CheckSquare,
  FileText,
  Heart,
  Landmark,
  Loader2,
  Lock,
  MessageSquareHeart,
  Pencil,
  Plus,
  ScrollText,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useI18n } from "@/lib/i18n";
import { getMyWill, saveMyWill, type WillRecord } from "@/lib/legacy-will.functions";
import { legacyAssist } from "@/lib/legacy.functions";
import { applyLegacyImports, suggestLegacyFromLifeOs } from "@/lib/docs-legacy.functions";
import { createVerifierInvite, ensureMyPlanCode } from "@/lib/death.functions";
import {
  ASSET_KINDS,
  labelAssetKind,
  labelWishSection,
  type AssetKind,
  type WishSection,
} from "@/lib/legacy.shared";

export const Route = createFileRoute("/_authenticated/legacy")({
  head: () => ({ meta: routeMeta("legacy") }),
  component: LegacyPage,
});

type Tab =
  | "hub"
  | "wishes"
  | "contacts"
  | "assets"
  | "vault"
  | "will"
  | "checklist"
  | "messages"
  | "story"
  | "social"
  | "ai";

function LegacyPage() {
  const { t, lang } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const runAssist = useServerFn(legacyAssist);
  const runGetWill = useServerFn(getMyWill);
  const runSaveWill = useServerFn(saveMyWill);
  const willQ = useQuery({
    queryKey: ["legacy-will"],
    queryFn: async () => ((await runGetWill()) as { will: WillRecord }).will,
  });
  const [will, setWill] = useState<WillRecord | null>(null);
  const w = will ?? willQ.data ?? null;
  const setW = (patch: Partial<WillRecord>) =>
    setWill({ ...(w ?? ({} as WillRecord)), ...patch } as WillRecord);

  const saveWill = async () => {
    if (!w) return;
    setBusy(true);
    try {
      await runSaveWill({
        data: {
          hasWill: w.hasWill,
          willKind: w.willKind,
          madeOn: w.madeOn || null,
          locationHint: w.locationHint,
          executorName: w.executorName,
          executorContact: w.executorContact,
          lawyerName: w.lawyerName,
          lawyerContact: w.lawyerContact,
          notes: w.notes,
        },
      });
      toast.success(t.saved);
      void qc.invalidateQueries({ queryKey: ["legacy-will"] });
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const runSuggest = useServerFn(suggestLegacyFromLifeOs);
  const runApplyImport = useServerFn(applyLegacyImports);
  const [importKeys, setImportKeys] = useState<Set<string>>(new Set());
  const [importCandidates, setImportCandidates] = useState<
    Array<{
      key: string;
      source: string;
      target: string;
      title: string;
      detail: string;
      payload: Record<string, unknown>;
    }>
  >([]);

  const runInvite = useServerFn(createVerifierInvite);
  const runPlanCode = useServerFn(ensureMyPlanCode);
  const [planCodeInfo, setPlanCodeInfo] = useState<{
    planCode: string;
    inviteBaseUrl: string;
  } | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("hub");
  const [busy, setBusy] = useState(false);

  const profileQ = useQuery({
    queryKey: ["legacy-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legacy_profiles")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const contactsQ = useQuery({
    queryKey: ["legacy-contacts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legacy_contacts")
        .select(
          "id,user_id,full_name,relation,phone,email,priority,is_verifier,personal_message,invite_status,linked_user_id,invite_token,created_at",
        )
        .eq("user_id", user!.id)
        .order("priority", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const assetsQ = useQuery({
    queryKey: ["legacy-assets", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legacy_assets")
        .select("*")
        .eq("user_id", user!.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const wishesQ = useQuery({
    queryKey: ["legacy-wishes", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legacy_wishes")
        .select("*")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const checklistQ = useQuery({
    queryKey: ["legacy-checklist", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legacy_checklist")
        .select("*")
        .eq("user_id", user!.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const counts = useMemo(
    () => ({
      contacts: contactsQ.data?.length ?? 0,
      assets: assetsQ.data?.length ?? 0,
      wishes: wishesQ.data?.length ?? 0,
      checklist: checklistQ.data?.length ?? 0,
      checklistDone: checklistQ.data?.filter((c) => c.is_done).length ?? 0,
    }),
    [contactsQ.data, assetsQ.data, wishesQ.data, checklistQ.data],
  );

  const ensureProfile = async () => {
    if (!user || profileQ.data) return;
    await supabase.from("legacy_profiles").upsert({ user_id: user.id });
    void qc.invalidateQueries({ queryKey: ["legacy-profile"] });
  };

  const saveConsent = async () => {
    if (!user) return;
    setBusy(true);
    await ensureProfile();
    const { error } = await supabase.from("legacy_profiles").upsert({
      user_id: user.id,
      consent_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(t.legacyConsentSaved);
      void qc.invalidateQueries({ queryKey: ["legacy-profile"] });
    }
  };

  /**
   * Editing a row means filling the form above it.
   *
   * The alternative is a second copy of every field inside each list item, and
   * a contact has seven of them. The form that knows how to write a contact is
   * already on the page, so an edit loads the row into it and the same button
   * saves; `editing` is which row each list is currently editing, so the button
   * knows whether to insert or update and the list knows which row to mark.
   */
  const [editing, setEditing] = useState<{
    contact: string | null;
    asset: string | null;
    wish: string | null;
  }>({ contact: null, asset: null, wish: null });

  const jumpToForm = (anchor: string) => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /**
   * An UPDATE nobody is allowed to make comes back as a success with no rows
   * touched, so the row count is the only proof it happened. Every row here is
   * the user's own, but a silent no-op once cost a release, so it is checked.
   */
  const updateRow = async (
    table: "legacy_contacts" | "legacy_assets" | "legacy_wishes",
    id: string,
    patch: Record<string, unknown>,
  ): Promise<boolean> => {
    const { data, error } = await supabase
      .from(table)
      .update(patch as never)
      .eq("id", id)
      .select("id");
    if (error) {
      toast.error(error.message);
      return false;
    }
    if (!data || data.length === 0) {
      toast.error(t.legacyEditGone);
      return false;
    }
    return true;
  };

  // --- Contact form ---
  const emptyContact = {
    full_name: "",
    relation: "",
    phone: "",
    email: "",
    priority: "1",
    is_verifier: false,
    personal_message: "",
  };
  const [cForm, setCForm] = useState(emptyContact);
  const addContact = async () => {
    if (!user || !cForm.full_name.trim()) return;
    setBusy(true);
    const row = {
      full_name: cForm.full_name.trim(),
      relation: cForm.relation.trim(),
      phone: cForm.phone.trim() || null,
      email: cForm.email.trim() || null,
      priority: Number(cForm.priority) || 1,
      is_verifier: cForm.is_verifier,
      personal_message: cForm.personal_message.trim(),
    };
    let ok: boolean;
    if (editing.contact) {
      ok = await updateRow("legacy_contacts", editing.contact, row);
    } else {
      const { error } = await supabase.from("legacy_contacts").insert({ user_id: user.id, ...row });
      if (error) toast.error(error.message);
      ok = !error;
    }
    setBusy(false);
    if (ok) {
      toast.success(t.legacySaved);
      setCForm(emptyContact);
      setEditing((e) => ({ ...e, contact: null }));
      void qc.invalidateQueries({ queryKey: ["legacy-contacts"] });
    }
  };
  const editContact = (c: {
    id: string;
    full_name: string | null;
    relation: string | null;
    phone: string | null;
    email: string | null;
    priority: number | null;
    is_verifier: boolean | null;
    personal_message: string | null;
  }) => {
    setCForm({
      full_name: c.full_name ?? "",
      relation: c.relation ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      priority: String(c.priority ?? 1),
      is_verifier: !!c.is_verifier,
      personal_message: c.personal_message ?? "",
    });
    setEditing((e) => ({ ...e, contact: c.id }));
    jumpToForm("legacy-contact-form");
  };

  // --- Asset form ---
  const emptyAsset = {
    kind: "bank" as AssetKind,
    title: "",
    details: "",
    is_liability: false,
    location_hint: "",
    beneficiary_hint: "",
  };
  const [aForm, setAForm] = useState(emptyAsset);
  const addAsset = async () => {
    if (!user || !aForm.title.trim()) return;
    setBusy(true);
    const row = {
      kind: aForm.kind,
      title: aForm.title.trim(),
      details: aForm.details.trim(),
      is_liability: aForm.is_liability,
      location_hint: aForm.location_hint.trim() || null,
      beneficiary_hint: aForm.beneficiary_hint.trim() || null,
    };
    let ok: boolean;
    if (editing.asset) {
      ok = await updateRow("legacy_assets", editing.asset, row);
    } else {
      const { error } = await supabase.from("legacy_assets").insert({ user_id: user.id, ...row });
      if (error) toast.error(error.message);
      ok = !error;
    }
    setBusy(false);
    if (ok) {
      toast.success(t.legacySaved);
      setAForm(emptyAsset);
      setEditing((e) => ({ ...e, asset: null }));
      void qc.invalidateQueries({ queryKey: ["legacy-assets"] });
    }
  };
  const editAsset = (a: {
    id: string;
    kind: string;
    title: string | null;
    details: string | null;
    is_liability: boolean | null;
    location_hint: string | null;
    beneficiary_hint: string | null;
  }) => {
    setAForm({
      kind: a.kind as AssetKind,
      title: a.title ?? "",
      details: a.details ?? "",
      is_liability: !!a.is_liability,
      location_hint: a.location_hint ?? "",
      beneficiary_hint: a.beneficiary_hint ?? "",
    });
    setEditing((e) => ({ ...e, asset: a.id }));
    jumpToForm("legacy-asset-form");
  };

  // --- Wish form ---
  const [wForm, setWForm] = useState({
    section: "final_wishes" as WishSection,
    title: "",
    body: "",
  });
  const addWish = async (sectionOverride?: WishSection) => {
    if (!user || !wForm.body.trim()) return;
    setBusy(true);
    const section = sectionOverride ?? wForm.section;
    const row = { section, title: wForm.title.trim(), body: wForm.body.trim() };
    let ok: boolean;
    if (editing.wish) {
      ok = await updateRow("legacy_wishes", editing.wish, row);
    } else {
      const { error } = await supabase.from("legacy_wishes").insert({ user_id: user.id, ...row });
      if (error) toast.error(error.message);
      ok = !error;
    }
    setBusy(false);
    if (ok) {
      toast.success(t.legacySaved);
      setWForm({ section: wForm.section, title: "", body: "" });
      setEditing((e) => ({ ...e, wish: null }));
      void qc.invalidateQueries({ queryKey: ["legacy-wishes"] });
    }
  };
  const editWish = (w: {
    id: string;
    section: string;
    title: string | null;
    body: string | null;
  }) => {
    setWForm({
      section: w.section as WishSection,
      title: w.title ?? "",
      body: w.body ?? "",
    });
    setEditing((e) => ({ ...e, wish: w.id }));
    jumpToForm("legacy-wish-form");
  };

  /** Leaving an edit without saving it - the form goes back to being an "add". */
  const cancelEdit = (which: "contact" | "asset" | "wish") => {
    setEditing((e) => ({ ...e, [which]: null }));
    if (which === "contact") setCForm(emptyContact);
    if (which === "asset") setAForm(emptyAsset);
    if (which === "wish") setWForm((f) => ({ section: f.section, title: "", body: "" }));
  };

  const delRow = async (table: string, id: string) => {
    setBusy(true);
    const { error } = await supabase
      .from(table as "legacy_contacts")
      .delete()
      .eq("id", id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      void qc.invalidateQueries();
      toast.success(t.legacyDeleted);
    }
  };

  const seedChecklist = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.rpc("legacy_seed_checklist", {
      p_user_id: user.id,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(t.legacyChecklistSeeded);
      void qc.invalidateQueries({ queryKey: ["legacy-checklist"] });
    }
  };

  const toggleCheck = async (id: string, done: boolean) => {
    const { error } = await supabase
      .from("legacy_checklist")
      .update({ is_done: !done })
      .eq("id", id);
    if (error) toast.error(error.message);
    else void qc.invalidateQueries({ queryKey: ["legacy-checklist"] });
  };

  // --- AI ---
  type LegacyAiResult = {
    summary: string;
    assets: Array<{
      kind: AssetKind;
      title: string;
      details: string;
      is_liability: boolean;
      beneficiary_hint: string | null;
    }>;
    wishes: Array<{ section: WishSection; title: string; body: string }>;
    checklist: string[];
    followUpQuestions: string[];
  };
  const [aiMsg, setAiMsg] = useState("");
  const [aiResult, setAiResult] = useState<LegacyAiResult | null>(null);

  const runAi = async () => {
    if (aiMsg.trim().length < 3) return;
    setBusy(true);
    try {
      const hintParts: string[] = [];
      const { data: expenses } = await supabase
        .from("expenses")
        .select("category,amount,note")
        .limit(5);
      if (expenses?.length) {
        hintParts.push("Recent expenses: " + JSON.stringify(expenses));
      }
      const { data: fam } = await supabase
        .from("family_members")
        .select("display_name,member_role")
        .limit(10);
      if (fam?.length) hintParts.push("Family: " + JSON.stringify(fam));
      const result = await runAssist({
        data: {
          message: aiMsg.trim(),
          lang: lang === "en" ? "en" : "th",
          contextHint: hintParts.join("\n").slice(0, 2800),
        },
      });
      setAiResult(result as LegacyAiResult);
      toast.success(t.legacyAiDone);
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const applyAi = async () => {
    if (!user || !aiResult) return;
    setBusy(true);
    try {
      if (aiResult.assets.length) {
        await supabase.from("legacy_assets").insert(
          aiResult.assets.map((a) => ({
            user_id: user.id,
            kind: a.kind,
            title: a.title,
            details: a.details,
            is_liability: a.is_liability,
            beneficiary_hint: a.beneficiary_hint,
          })),
        );
      }
      if (aiResult.wishes.length) {
        await supabase.from("legacy_wishes").insert(
          aiResult.wishes.map((w) => ({
            user_id: user.id,
            section: w.section,
            title: w.title,
            body: w.body,
          })),
        );
      }
      for (const title of aiResult.checklist) {
        await supabase.from("legacy_checklist").insert({
          user_id: user.id,
          title,
          sort_order: 50,
        });
      }
      toast.success(t.legacyAiApplied);
      void qc.invalidateQueries({ queryKey: ["legacy-assets"] });
      void qc.invalidateQueries({ queryKey: ["legacy-wishes"] });
      void qc.invalidateQueries({ queryKey: ["legacy-checklist"] });
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const saveSocial = async (
    field: "organ_donation" | "body_donation" | "social_intent",
    value: string,
  ) => {
    if (!user) return;
    await ensureProfile();
    const payload: {
      user_id: string;
      organ_donation?: string;
      body_donation?: string;
      social_intent?: string;
    } = { user_id: user.id };
    payload[field] = value;
    const { error } = await supabase.from("legacy_profiles").upsert(payload);
    if (error) toast.error(error.message);
    else {
      toast.success(t.legacySaved);
      void qc.invalidateQueries({ queryKey: ["legacy-profile"] });
    }
  };

  const tabs: { id: Tab; label: string; icon: typeof Heart; count?: number }[] = [
    { id: "hub", label: t.legacyHub, icon: Heart },
    { id: "wishes", label: t.legacyWishes, icon: ScrollText },
    { id: "contacts", label: t.legacyContacts, icon: Users, count: counts.contacts },
    { id: "assets", label: t.legacyAssets, icon: Landmark, count: counts.assets },
    { id: "vault", label: t.legacyVault, icon: Lock },
    { id: "will", label: t.legacyWill, icon: FileText },
    { id: "checklist", label: t.legacyChecklist, icon: CheckSquare, count: counts.checklist },
    { id: "messages", label: t.legacyMessages, icon: MessageSquareHeart },
    { id: "story", label: t.legacyStory, icon: BookOpen },
    { id: "social", label: t.legacySocial, icon: Heart },
    { id: "ai", label: t.legacyAi, icon: Sparkles },
  ];

  const wishesOf = (section: WishSection) =>
    (wishesQ.data ?? []).filter((w) => w.section === section);

  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t.legacyTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.legacySub}</p>
        <p className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          {t.legacyLegalNote}
        </p>
      </header>

      {!profileQ.data?.consent_at && (
        <section className="mb-4 space-y-2 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-sm">{t.legacyConsentText}</p>
          <Button disabled={busy} onClick={saveConsent}>
            {t.legacyConsentBtn}
          </Button>
        </section>
      )}

      <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === tb.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            <tb.icon className="size-3.5" />
            {tb.label}
            {tb.count != null && tb.count > 0 ? (
              <Badge variant="secondary" className="ml-0.5 text-[10px]">
                {tb.count}
              </Badge>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "hub" && (
        <div className="mb-4 space-y-2 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-sm font-medium">{t.planCodeTitle}</p>
          <p className="text-xs text-muted-foreground">{t.planCodeHint}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await runPlanCode();
                  setPlanCodeInfo(res);
                } catch (e) {
                  toast.error(errorText(e, t));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t.planCodeShow}
            </Button>
            {planCodeInfo && (
              <>
                <span className="font-mono text-lg font-semibold tracking-widest">
                  {planCodeInfo.planCode}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(planCodeInfo.planCode);
                    toast.success(t.planCodeCopied);
                  }}
                >
                  {t.planCodeCopy}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "hub" && (
        <section className="mb-4 space-y-2 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-sm font-medium">{t.r3ImportTitle}</p>
          <p className="text-xs text-muted-foreground">{t.r3ImportSub}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = (await runSuggest()) as {
                  candidates?: Array<{
                    key: string;
                    source: string;
                    target: string;
                    title: string;
                    detail: string;
                    payload: Record<string, string | number | boolean | null | undefined>;
                  }>;
                };
                setImportCandidates(res.candidates ?? []);
                setImportKeys(new Set());
                if (!(res.candidates ?? []).length) toast.message(t.r3ImportEmpty);
              } catch (e) {
                toast.error(errorText(e, t));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t.r3ImportScan}
          </Button>
          {importCandidates.length > 0 && (
            <>
              <ul className="max-h-64 space-y-2 overflow-auto">
                {importCandidates.map((c) => (
                  <li
                    key={c.key}
                    className="flex items-start gap-2 rounded-lg border border-border p-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={importKeys.has(c.key)}
                      onChange={(e) => {
                        setImportKeys((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.add(c.key);
                          else n.delete(c.key);
                          return n;
                        });
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{c.title}</p>
                      <p className="text-xs text-muted-foreground">{c.detail}</p>
                      <Badge variant="outline" className="mt-1">
                        {c.source === "money"
                          ? t.r3SrcMoney
                          : c.source === "family"
                            ? t.r3SrcFamily
                            : c.source === "benefits"
                              ? t.r3SrcBenefits
                              : t.r3SrcDocs}
                        {" → "}
                        {c.target}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                disabled={busy || importKeys.size === 0}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const items = importCandidates
                      .filter((c) => importKeys.has(c.key))
                      .map((c) => ({
                        target: c.target as "asset" | "contact" | "wish" | "checklist",
                        payload: c.payload,
                      }));
                    const res = await runApplyImport({ data: { items } });
                    toast.success(`${t.r3ImportApplied}: ${res.applied}`);
                    setImportCandidates([]);
                    setImportKeys(new Set());
                    void qc.invalidateQueries({ queryKey: ["legacy-assets"] });
                    void qc.invalidateQueries({ queryKey: ["legacy-contacts"] });
                    void qc.invalidateQueries({ queryKey: ["legacy-wishes"] });
                    void qc.invalidateQueries({ queryKey: ["legacy-checklist"] });
                  } catch (e) {
                    toast.error(errorText(e, t));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t.r3ImportApply} ({importKeys.size})
              </Button>
            </>
          )}
        </section>
      )}

      {tab === "hub" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { id: "wishes" as Tab, title: t.legacyWishes, desc: t.legacyWishesDesc },
            { id: "contacts" as Tab, title: t.legacyContacts, desc: t.legacyContactsDesc },
            { id: "assets" as Tab, title: t.legacyAssets, desc: t.legacyAssetsDesc },
            { id: "vault" as Tab, title: t.legacyVault, desc: t.legacyVaultDesc },
            { id: "will" as Tab, title: t.legacyWill, desc: t.legacyWillDesc },
            { id: "checklist" as Tab, title: t.legacyChecklist, desc: t.legacyChecklistDesc },
            { id: "messages" as Tab, title: t.legacyMessages, desc: t.legacyMessagesDesc },
            { id: "story" as Tab, title: t.legacyStory, desc: t.legacyStoryDesc },
            { id: "ai" as Tab, title: t.legacyAi, desc: t.legacyAiDesc },
          ].map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => setTab(card.id)}
              className="rounded-2xl border border-border bg-card p-4 text-left shadow-soft transition hover:border-primary/40"
            >
              <p className="font-medium">{card.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.desc}</p>
            </button>
          ))}
          <Link
            to="/legacy/after"
            className="block rounded-2xl border border-dashed border-border p-4 transition hover:border-primary/50 hover:bg-accent/30 sm:col-span-2"
          >
            <p className="text-sm font-medium">{t.legacyPhase6Title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.legacyPhase6Desc}</p>
            <p className="mt-2 text-xs font-medium text-primary">{t.legacyOpenPhase6} →</p>
          </Link>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {t.legacyDocsHint}{" "}
            <Link to="/docs" className="text-primary underline">
              {t.navDocs}
            </Link>
          </p>
        </div>
      )}

      {tab === "contacts" && (
        <section className="space-y-4">
          {inviteUrl && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs break-all">
              <p className="mb-1 font-medium">{t.invLastLink}</p>
              <a
                href={inviteUrl}
                className="text-primary underline"
                target="_blank"
                rel="noreferrer"
              >
                {inviteUrl}
              </a>
              <div className="mt-2">
                <CopyButton value={inviteUrl} label={t.copy} />
              </div>
            </div>
          )}

          <div
            id="legacy-contact-form"
            className="space-y-2 rounded-2xl border border-border bg-card p-4"
          >
            {editing.contact ? (
              <p className="rounded-lg border border-primary/40 bg-primary/5 px-2 py-1 text-xs text-primary">
                {t.legacyEditing}
              </p>
            ) : null}
            <Label>{t.legacyContactName}</Label>
            <Input
              value={cForm.full_name}
              onChange={(e) => setCForm((f) => ({ ...f, full_name: e.target.value }))}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder={t.legacyContactRelation}
                value={cForm.relation}
                onChange={(e) => setCForm((f) => ({ ...f, relation: e.target.value }))}
              />
              <Input
                placeholder={t.legacyContactPhone}
                value={cForm.phone}
                onChange={(e) => setCForm((f) => ({ ...f, phone: e.target.value }))}
              />
              <Input
                placeholder="Email"
                value={cForm.email}
                onChange={(e) => setCForm((f) => ({ ...f, email: e.target.value }))}
              />
              <Input
                type="number"
                min={1}
                max={20}
                placeholder={t.legacyContactPriority}
                value={cForm.priority}
                onChange={(e) => setCForm((f) => ({ ...f, priority: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={cForm.is_verifier}
                onChange={(e) => setCForm((f) => ({ ...f, is_verifier: e.target.checked }))}
              />
              {t.legacyContactVerifier}
            </label>
            <Textarea
              rows={2}
              placeholder={t.legacyContactMessage}
              value={cForm.personal_message}
              onChange={(e) => setCForm((f) => ({ ...f, personal_message: e.target.value }))}
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={addContact}>
                {editing.contact ? (
                  <Check className="mr-1 size-4" />
                ) : (
                  <Plus className="mr-1 size-4" />
                )}
                {editing.contact ? t.legacySaveEdit : t.legacyAdd}
              </Button>
              {editing.contact ? (
                <Button variant="outline" disabled={busy} onClick={() => cancelEdit("contact")}>
                  {t.cancel}
                </Button>
              ) : null}
            </div>
          </div>
          <ul className="space-y-2">
            {(contactsQ.data ?? []).map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-2 rounded-xl border border-border p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    #{c.priority} {c.full_name}
                    {c.is_verifier ? (
                      <Badge className="ml-2" variant="secondary">
                        {t.legacyContactVerifier}
                      </Badge>
                    ) : null}
                    {(c as { invite_status?: string }).invite_status === "accepted" ? (
                      <Badge className="ml-1" variant="default">
                        {t.invLinked}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.relation}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </p>
                  {c.personal_message ? (
                    <p className="mt-1 text-xs italic">{c.personal_message}</p>
                  ) : null}
                  {c.is_verifier && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const res = await runInvite({ data: { contactId: c.id } });
                          setInviteUrl(res.url);
                          toast.success(t.invLinkCreated);
                          void qc.invalidateQueries({ queryKey: ["legacy-contacts"] });
                        } catch (e) {
                          toast.error(errorText(e, t));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {t.invCreateLink}
                    </Button>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t.legacyEdit}
                    title={t.legacyEdit}
                    onClick={() => editContact(c)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <ConfirmDelete
                    title={c.full_name ?? ""}
                    onConfirm={() => delRow("legacy_contacts", c.id)}
                  >
                    <Trash2 className="size-4" />
                  </ConfirmDelete>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "assets" && (
        <section className="space-y-4">
          <div
            id="legacy-asset-form"
            className="space-y-2 rounded-2xl border border-border bg-card p-4"
          >
            {editing.asset ? (
              <p className="rounded-lg border border-primary/40 bg-primary/5 px-2 py-1 text-xs text-primary">
                {t.legacyEditing}
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>{t.legacyAssetKind}</Label>
                <Select
                  value={aForm.kind}
                  onValueChange={(v) => setAForm((f) => ({ ...f, kind: v as AssetKind }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {labelAssetKind(t as unknown as Record<string, unknown>, k)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t.legacyAssetTitle}</Label>
                <Input
                  className="mt-1"
                  value={aForm.title}
                  onChange={(e) => setAForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
            </div>
            <Textarea
              rows={2}
              placeholder={t.legacyAssetDetails}
              value={aForm.details}
              onChange={(e) => setAForm((f) => ({ ...f, details: e.target.value }))}
            />
            <Input
              placeholder={t.legacyAssetLocation}
              value={aForm.location_hint}
              onChange={(e) => setAForm((f) => ({ ...f, location_hint: e.target.value }))}
            />
            <Input
              placeholder={t.legacyAssetBeneficiary}
              value={aForm.beneficiary_hint}
              onChange={(e) => setAForm((f) => ({ ...f, beneficiary_hint: e.target.value }))}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={aForm.is_liability}
                onChange={(e) => setAForm((f) => ({ ...f, is_liability: e.target.checked }))}
              />
              {t.legacyAssetLiability}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={addAsset}>
                {editing.asset ? (
                  <Check className="mr-1 size-4" />
                ) : (
                  <Plus className="mr-1 size-4" />
                )}
                {editing.asset ? t.legacySaveEdit : t.legacyAdd}
              </Button>
              {editing.asset ? (
                <Button variant="outline" disabled={busy} onClick={() => cancelEdit("asset")}>
                  {t.cancel}
                </Button>
              ) : null}
            </div>
          </div>
          <ul className="space-y-2">
            {(assetsQ.data ?? []).map((a) => (
              <li
                key={a.id}
                className="flex justify-between gap-2 rounded-xl border border-border p-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {a.title}{" "}
                    <Badge variant="outline">
                      {labelAssetKind(t as unknown as Record<string, unknown>, a.kind)}
                    </Badge>
                    {a.is_liability ? (
                      <Badge variant="destructive" className="ml-1">
                        {t.legacyAssetLiability}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{a.details}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t.legacyEdit}
                    title={t.legacyEdit}
                    onClick={() => editAsset(a)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <ConfirmDelete
                    title={a.title ?? ""}
                    onConfirm={() => delRow("legacy_assets", a.id)}
                  >
                    <Trash2 className="size-4" />
                  </ConfirmDelete>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(tab === "wishes" ||
        tab === "vault" ||
        tab === "will" ||
        tab === "messages" ||
        tab === "story") && (
        <section className="space-y-4">
          <div
            id="legacy-wish-form"
            className="space-y-2 rounded-2xl border border-border bg-card p-4"
          >
            {editing.wish ? (
              <p className="rounded-lg border border-primary/40 bg-primary/5 px-2 py-1 text-xs text-primary">
                {t.legacyEditing}
              </p>
            ) : null}
            <Label>{t.legacyWishSection}</Label>
            <Select
              value={
                tab === "vault"
                  ? "vault_note"
                  : tab === "will"
                    ? "will_ref"
                    : tab === "messages"
                      ? "legacy_message"
                      : tab === "story"
                        ? "life_story"
                        : wForm.section
              }
              onValueChange={(v) => setWForm((f) => ({ ...f, section: v as WishSection }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(tab === "wishes"
                  ? (["final_wishes", "funeral_pref"] as WishSection[])
                  : tab === "vault"
                    ? (["vault_note"] as WishSection[])
                    : tab === "will"
                      ? (["will_ref"] as WishSection[])
                      : tab === "messages"
                        ? (["legacy_message"] as WishSection[])
                        : (["life_story"] as WishSection[])
                ).map((s) => (
                  <SelectItem key={s} value={s}>
                    {labelWishSection(t as unknown as Record<string, unknown>, s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tab === "will" && <p className="text-xs text-muted-foreground">{t.legacyWillHint}</p>}
            {tab === "vault" && (
              <p className="text-xs text-muted-foreground">{t.legacyVaultHint}</p>
            )}
            <Input
              placeholder={t.legacyWishTitle}
              value={wForm.title}
              onChange={(e) => setWForm((f) => ({ ...f, title: e.target.value }))}
            />
            <Textarea
              rows={4}
              placeholder={t.legacyWishBody}
              value={wForm.body}
              onChange={(e) => setWForm((f) => ({ ...f, body: e.target.value }))}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => {
                  const section: WishSection =
                    tab === "vault"
                      ? "vault_note"
                      : tab === "will"
                        ? "will_ref"
                        : tab === "messages"
                          ? "legacy_message"
                          : tab === "story"
                            ? "life_story"
                            : wForm.section;
                  void addWish(section);
                }}
              >
                {editing.wish ? (
                  <Check className="mr-1 size-4" />
                ) : (
                  <Plus className="mr-1 size-4" />
                )}
                {editing.wish ? t.legacySaveEdit : t.legacyAdd}
              </Button>
              {editing.wish ? (
                <Button variant="outline" disabled={busy} onClick={() => cancelEdit("wish")}>
                  {t.cancel}
                </Button>
              ) : null}
            </div>
          </div>
          <ul className="space-y-2">
            {wishesOf(
              tab === "vault"
                ? "vault_note"
                : tab === "will"
                  ? "will_ref"
                  : tab === "messages"
                    ? "legacy_message"
                    : tab === "story"
                      ? "life_story"
                      : wForm.section === "funeral_pref"
                        ? "funeral_pref"
                        : "final_wishes",
            )
              .concat(
                tab === "wishes"
                  ? wishesOf("funeral_pref").filter(
                      (w) => w.section === "funeral_pref" && wForm.section !== "funeral_pref",
                    )
                  : [],
              )
              .filter((w, i, arr) => arr.findIndex((x) => x.id === w.id) === i)
              .map((w) => (
                <li key={w.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <div>
                      <Badge variant="outline">
                        {labelWishSection(t as unknown as Record<string, unknown>, w.section)}
                      </Badge>
                      {w.title ? <p className="mt-1 font-medium">{w.title}</p> : null}
                      <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{w.body}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t.legacyEdit}
                        title={t.legacyEdit}
                        onClick={() => editWish(w)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <ConfirmDelete
                        title={w.title || w.body?.slice(0, 60) || ""}
                        onConfirm={() => delRow("legacy_wishes", w.id)}
                      >
                        <Trash2 className="size-4" />
                      </ConfirmDelete>
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      )}

      {tab === "checklist" && (
        <section className="space-y-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={seedChecklist}>
            {t.legacyChecklistSeed}
          </Button>
          <p className="text-xs text-muted-foreground">
            {counts.checklistDone}/{counts.checklist} {t.legacyChecklistProgress}
          </p>
          <ul className="space-y-2">
            {(checklistQ.data ?? []).map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={c.is_done}
                  onChange={() => toggleCheck(c.id, c.is_done)}
                />
                <div className="flex-1">
                  <p className={c.is_done ? "line-through text-muted-foreground" : "font-medium"}>
                    {c.title}
                  </p>
                  {c.notes ? <p className="text-xs text-muted-foreground">{c.notes}</p> : null}
                </div>
                <ConfirmDelete
                  title={c.title ?? ""}
                  onConfirm={() => delRow("legacy_checklist", c.id)}
                >
                  <Trash2 className="size-4" />
                </ConfirmDelete>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "social" && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div>
            <Label>{t.legacyOrgan}</Label>
            <Select
              value={profileQ.data?.organ_donation ?? "undecided"}
              onValueChange={(v) => saveSocial("organ_donation", v)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">{t.legacyYes}</SelectItem>
                <SelectItem value="no">{t.legacyNo}</SelectItem>
                <SelectItem value="undecided">{t.legacyUndecided}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t.legacyBody}</Label>
            <Select
              value={profileQ.data?.body_donation ?? "undecided"}
              onValueChange={(v) => saveSocial("body_donation", v)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">{t.legacyYes}</SelectItem>
                <SelectItem value="no">{t.legacyNo}</SelectItem>
                <SelectItem value="undecided">{t.legacyUndecided}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t.legacySocialIntent}</Label>
            <Textarea
              className="mt-1"
              rows={3}
              defaultValue={profileQ.data?.social_intent ?? ""}
              onBlur={(e) => {
                if (e.target.value !== (profileQ.data?.social_intent ?? "")) {
                  void saveSocial("social_intent", e.target.value);
                }
              }}
            />
          </div>
        </section>
      )}

      {tab === "ai" && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          {/* One line was not enough: the tab was described as "tell it in plain
              language" without saying what came out the other side, so people
              opened it and closed it again. */}
          <p className="text-sm text-muted-foreground">{t.legacyAiDesc}</p>
          <ul className="space-y-1 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <li>{t.legacyAiHow1}</li>
            <li>{t.legacyAiHow2}</li>
            <li>{t.legacyAiHow3}</li>
          </ul>
          <Textarea
            rows={4}
            value={aiMsg}
            onChange={(e) => setAiMsg(e.target.value)}
            placeholder={t.legacyAiPlaceholder}
          />
          <Button disabled={busy || aiMsg.trim().length < 3} onClick={runAi}>
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 size-4" />
            )}
            {t.legacyAiRun}
          </Button>
          {aiResult && (
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{aiResult.summary}</p>
              {aiResult.assets.length > 0 && (
                <p className="text-xs">Assets: {aiResult.assets.map((a) => a.title).join(", ")}</p>
              )}
              {aiResult.wishes.length > 0 && (
                <p className="text-xs">
                  Wishes: {aiResult.wishes.map((w) => w.title || w.section).join(", ")}
                </p>
              )}
              {aiResult.followUpQuestions.length > 0 && (
                <ul className="list-disc pl-4 text-xs text-muted-foreground">
                  {aiResult.followUpQuestions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              )}
              <Button size="sm" disabled={busy} onClick={applyAi}>
                {t.legacyAiApply}
              </Button>
            </div>
          )}
        </section>
      )}
      {/* 6. Will & estate - location of the real document, never the will itself.
          It sat outside every tab test, so the same form appeared under all
          eleven tabs; it belongs where someone would look for it, which is the
          overview and the will tab. */}
      {(tab === "hub" || tab === "will") && (
        <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <h2 className="text-sm font-semibold">{t.willTitle}</h2>
          <p className="mt-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            {t.willDisclaimer}
          </p>
          <p className="mt-1 mb-3 text-xs text-muted-foreground">{t.willPrivate}</p>

          <label className="mb-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!w?.hasWill}
              onChange={(e) => setW({ hasWill: e.target.checked })}
            />
            {t.willHas}
          </label>

          <div className="space-y-2">
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={w?.willKind ?? "other"}
              onChange={(e) => setW({ willKind: e.target.value as WillRecord["willKind"] })}
              aria-label={t.willKind}
            >
              <option value="handwritten">{t.willKindHandwritten}</option>
              <option value="amphoe">{t.willKindAmphoe}</option>
              <option value="lawyer">{t.willKindLawyer}</option>
              <option value="other">{t.willKindOther}</option>
            </select>
            {/* Every other field here labels itself with a placeholder, which a
              date input cannot show - so this one needs a real label or it is
              just an empty box. */}
            <div className="space-y-1.5">
              <Label htmlFor="will-made-on">{t.willMadeOn}</Label>
              <DateInput
                id="will-made-on"
                value={w?.madeOn ?? ""}
                onChange={(e) => setW({ madeOn: e.target.value })}
              />
            </div>
            <Textarea
              placeholder={t.willLocation}
              value={w?.locationHint ?? ""}
              onChange={(e) => setW({ locationHint: e.target.value })}
            />
            <div className="flex gap-2">
              <Input
                placeholder={t.willExecutor}
                value={w?.executorName ?? ""}
                onChange={(e) => setW({ executorName: e.target.value })}
              />
              <Input
                placeholder={t.willExecutorContact}
                value={w?.executorContact ?? ""}
                onChange={(e) => setW({ executorContact: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Input
                placeholder={t.willLawyer}
                value={w?.lawyerName ?? ""}
                onChange={(e) => setW({ lawyerName: e.target.value })}
              />
              <Input
                placeholder={t.willLawyerContact}
                value={w?.lawyerContact ?? ""}
                onChange={(e) => setW({ lawyerContact: e.target.value })}
              />
            </div>
            <Textarea
              placeholder={t.willNotes}
              value={w?.notes ?? ""}
              onChange={(e) => setW({ notes: e.target.value })}
            />
            <Button size="sm" disabled={busy} onClick={() => void saveWill()}>
              {t.save}
            </Button>
          </div>
        </section>
      )}
    </AppShell>
  );
}
