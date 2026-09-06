import { generateText } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persona, requireGateway } from "./ai-gateway.server";

const MODEL = "google/gemini-3.7-flash";


/** Pull the first JSON object out of a model reply and parse it with the schema. */
function parseJsonOutput<T>(schema: z.ZodType<T>, text: string): T {
  const cleaned = text.replace(/```json/gi, "```").split("```").join("\n");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("AI did not return JSON");
  const raw = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
  return schema.parse(nullifyUndefined(raw));
}

/** Models sometimes omit optional keys; turn every missing/undefined value into null. */
function nullifyUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(nullifyUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, nullifyUndefined(v)]),
    );
  }
  return value === undefined ? null : value;
}

const JSON_ONLY = "Reply with ONE JSON object only — no markdown fence, no commentary.";

const CATEGORIES = [
  "bill",
  "insurance",
  "vehicle",
  "home",
  "health",
  "education",
  "finance",
  "government",
  "food",
  "transport",
  "shopping",
  "family",
  "other",
] as const;

const DocSchema = z.object({
  title: z.string().describe("Short title for the document"),
  category: z.enum(CATEGORIES),
  summary: z.string().describe("2-4 sentence summary in the requested language"),
  docDate: z.string().nullable().describe("Document date as YYYY-MM-DD or null"),
  dueDate: z.string().nullable().describe("Due/expiry date as YYYY-MM-DD or null"),
  amount: z.number().nullable().describe("Total amount in THB or null"),
  counterparty: z.string().nullable().describe("Company / person / agency involved"),
  keyFacts: z.array(z.string()).max(6).describe("Short bullet facts"),
  suggestedReminderTitle: z.string().nullable(),
  isExpense: z.boolean().describe("True when this looks like a bill or receipt with a paid amount"),
  isIncome: z
    .boolean()
    .describe("True when this is money received: payslip, salary slip, transfer-in, sales invoice paid to the user"),
  needsAction: z
    .boolean()
    .describe("True when the user must do something before a deadline (pay, renew, submit, book)"),
});


export type DocAnalysis = z.infer<typeof DocSchema>;

export async function runDocumentAnalysis(input: {
  base64: string;
  mimeType: string;
  fileName: string;
  lang: "th" | "en";
}): Promise<DocAnalysis> {
  const gateway = requireGateway();
  const langName = input.lang === "en" ? "English" : "Thai";

  const result = await generateText({
    model: gateway(MODEL),
    system: `${persona(input.lang)}\nYou are extracting structured data from a document a user uploaded. Answer all free text in ${langName}. Use null when a field is genuinely absent — never guess.
${JSON_ONLY}
Shape: {"title":string,"category":one of ${CATEGORIES.join("|")},"summary":string,"docDate":string|null,"dueDate":string|null,"amount":number|null,"counterparty":string|null,"keyFacts":string[],"suggestedReminderTitle":string|null,"isExpense":boolean,"isIncome":boolean,"needsAction":boolean}`,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Read this document (file name: ${input.fileName}) and extract its details.`,
          },
          input.mimeType.startsWith("image/")
            ? { type: "image" as const, image: input.base64, mediaType: input.mimeType }
            : {
                type: "file" as const,
                data: input.base64,
                mediaType: input.mimeType,
                filename: input.fileName,
              },
        ],
      },
    ],
  });

  return parseJsonOutput(DocSchema, result.text);
}

const ActionSchema = z.object({
  reply: z.string().describe("Nong Phum's reply to the user"),
  action: z
    .object({
      type: z.enum([
        "create_reminder",
        "add_expense",
        "add_income",
        "search_documents",
        "daily_brief",
        "list_benefits",
        "none",
      ]),
      title: z.string().nullable(),
      dueAt: z.string().nullable().describe("ISO datetime for reminders"),
      priority: z.enum(["high", "normal", "low"]).nullable(),
      recurrence: z.enum(["none", "monthly", "yearly"]).nullable(),
      amount: z.number().nullable(),
      category: z.enum(CATEGORIES).nullable(),
      spentOn: z.string().nullable().describe("YYYY-MM-DD for expenses"),
      receivedOn: z.string().nullable().describe("YYYY-MM-DD for income"),
      query: z.string().nullable().describe("Search text for documents"),
    })
    .describe("The single action Nong Phum takes; use type 'none' when only chatting"),
});

export type PhumAction = z.infer<typeof ActionSchema>["action"];

type Db = SupabaseClient<any, "public", any>;

async function loadContext(supabase: Db, userId: string) {
  const [reminders, expenses, incomes, documents, benefitProfile, myBenefits] = await Promise.all([
    supabase
      .from("reminders")
      .select("title, due_at, priority, status")
      .eq("user_id", userId)
      .eq("status", "open")
      .order("due_at", { ascending: true })
      .limit(15),
    supabase
      .from("expenses")
      .select("title, amount, category, spent_on")
      .eq("user_id", userId)
      .order("spent_on", { ascending: false })
      .limit(15),
    supabase
      .from("incomes")
      .select("title, amount, category, received_on")
      .eq("user_id", userId)
      .order("received_on", { ascending: false })
      .limit(15),
    supabase
      .from("documents")
      .select("title, category, summary, due_date, amount, counterparty")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("benefit_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("user_benefits")
      .select("status, benefits(title, title_en)")
      .eq("user_id", userId),
  ]);

  return {
    reminders: reminders.data ?? [],
    expenses: expenses.data ?? [],
    incomes: incomes.data ?? [],
    documents: documents.data ?? [],
    benefitProfile: benefitProfile.data ?? null,
    myBenefits: myBenefits.data ?? [],
  };
}


export async function runChatRouter(
  input: {
    message: string;
    lang: "th" | "en";
    focus?: "tasks" | "expenses" | "incomes" | null | undefined;
  },
  supabase: Db,
  userId: string,
) {
  const gateway = requireGateway();
  const ctx = await loadContext(supabase, userId);
  const langName = input.lang === "en" ? "English" : "Thai";
  const today = new Date().toISOString().slice(0, 10);

  const history = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(20);

  const focusLine =
    input.focus === "tasks"
      ? "The user is on the To-do page: strongly prefer create_reminder."
      : input.focus === "expenses"
        ? "The user is on the Expenses page: strongly prefer add_expense."
        : input.focus === "incomes"
          ? "The user is on the Income page: strongly prefer add_income."
          : "";

  const result = await generateText({
    model: gateway(MODEL),
    system: `${persona(input.lang)}
Today is ${today}. Reply in ${langName}.
You route the user's request to exactly one action in their Life OS:
- create_reminder: the user wants to remember, do, or be reminded of something (fill title, dueAt, priority, recurrence)
- add_expense: the user reports spending money (fill title, amount, category, spentOn)
- add_income: the user reports receiving money — salary, transfer in, sale, bonus, refund (fill title, amount, category, receivedOn)
- search_documents: the user asks about something in their stored documents
- list_benefits: the user asks about their government benefits / welfare rights ("สิทธิของฉัน", "ได้สิทธิอะไรบ้าง", "เบี้ยผู้สูงอายุ", benefits, welfare). The app then shows interactive benefit cards with status buttons under your reply — so keep the reply short and point at the cards.
- daily_brief: the user asks what's going on today / what's coming up
- none: casual conversation or a question you can answer from the context below
${focusLine}

Answer questions using ONLY this data about the user; if it isn't there, say you don't have it yet.
REMINDERS: ${JSON.stringify(ctx.reminders)}
EXPENSES: ${JSON.stringify(ctx.expenses)}
INCOMES: ${JSON.stringify(ctx.incomes)}
DOCUMENTS: ${JSON.stringify(ctx.documents)}
BENEFIT PROFILE: ${JSON.stringify(ctx.benefitProfile)}
BENEFIT STATUSES: ${JSON.stringify(ctx.myBenefits)}

The app saves create_reminder, add_expense and add_income automatically as soon as you return them — never ask the user to confirm and never ask them to add it themselves. Instead confirm in past tense what you just saved (title, amount, date) and mention they can edit it on the matching page. If a date is missing, use today. If an amount is missing for money actions, do NOT use that action type.
${JSON_ONLY}
Shape: {"reply":string,"action":{"type":"create_reminder|add_expense|add_income|search_documents|daily_brief|list_benefits|none","title":string|null,"dueAt":string|null,"priority":"high|normal|low"|null,"recurrence":"none|monthly|yearly"|null,"amount":number|null,"category":one of ${CATEGORIES.join("|")}|null,"spentOn":string|null,"receivedOn":string|null,"query":string|null}}`,

    messages: [
      ...(history.data ?? []).map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content as string,
      })),
      { role: "user" as const, content: input.message },
    ],
  });

  return parseJsonOutput(ActionSchema, result.text);
}

export async function runDailyBrief(lang: "th" | "en", supabase: Db, userId: string) {
  const gateway = requireGateway();
  const ctx = await loadContext(supabase, userId);
  const langName = lang === "en" ? "English" : "Thai";
  const today = new Date().toISOString().slice(0, 10);

  const result = await generateText({
    model: gateway(MODEL),
    system: `${persona(lang)}
Today is ${today}. Write the user's daily brief in ${langName}.
Format: one warm opening line, then a short numbered list (max 5) of the things that matter today — overdue or upcoming reminders, documents expiring soon, unusual spending. End with one practical suggestion.
Use markdown. Keep it under 140 words. Never invent items that are not in the data.`,
    prompt: `REMINDERS: ${JSON.stringify(ctx.reminders)}
EXPENSES: ${JSON.stringify(ctx.expenses)}
INCOMES: ${JSON.stringify(ctx.incomes)}
DOCUMENTS: ${JSON.stringify(ctx.documents)}`,
  });

  return { text: await result.text };
}
