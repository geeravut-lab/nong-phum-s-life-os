import { generateText, Output } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persona, requireGateway } from "./ai-gateway.server";

const MODEL = "google/gemini-3.7-flash";

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
    system: `${persona(input.lang)}\nYou are extracting structured data from a document a user uploaded. Answer all free text in ${langName}. Use null when a field is genuinely absent — never guess.`,
    output: Output.object({ schema: DocSchema }),
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

  return await result.output;
}

const ActionSchema = z.object({
  reply: z.string().describe("Nong Phum's reply to the user"),
  action: z
    .object({
      type: z.enum(["create_reminder", "add_expense", "search_documents", "daily_brief", "none"]),
      title: z.string().nullable(),
      dueAt: z.string().nullable().describe("ISO datetime for reminders"),
      priority: z.enum(["high", "normal", "low"]).nullable(),
      amount: z.number().nullable(),
      category: z.enum(CATEGORIES).nullable(),
      spentOn: z.string().nullable().describe("YYYY-MM-DD"),
      query: z.string().nullable().describe("Search text for documents"),
    })
    .describe("The single action Nong Phum proposes; use type 'none' when only chatting"),
});

export type PhumAction = z.infer<typeof ActionSchema>["action"];

type Db = SupabaseClient<any, "public", any>;

async function loadContext(supabase: Db, userId: string) {
  const [reminders, expenses, documents] = await Promise.all([
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
      .from("documents")
      .select("title, category, summary, due_date, amount, counterparty")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return {
    reminders: reminders.data ?? [],
    expenses: expenses.data ?? [],
    documents: documents.data ?? [],
  };
}

export async function runChatRouter(
  input: { message: string; lang: "th" | "en" },
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

  const result = await generateText({
    model: gateway(MODEL),
    system: `${persona(input.lang)}
Today is ${today}. Reply in ${langName}.
You route the user's request to exactly one action in their Life OS:
- create_reminder: the user wants to remember or be reminded of something
- add_expense: the user reports spending money
- search_documents: the user asks about something in their stored documents
- daily_brief: the user asks what's going on today / what's coming up
- none: casual conversation or a question you can answer from the context below

Answer questions using ONLY this data about the user; if it isn't there, say you don't have it yet.
REMINDERS: ${JSON.stringify(ctx.reminders)}
EXPENSES: ${JSON.stringify(ctx.expenses)}
DOCUMENTS: ${JSON.stringify(ctx.documents)}

When you propose create_reminder or add_expense, fill the fields and tell the user you'll save it once they confirm.`,
    output: Output.object({ schema: ActionSchema }),
    messages: [
      ...(history.data ?? []).map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content as string,
      })),
      { role: "user" as const, content: input.message },
    ],
  });

  return await result.output;
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
DOCUMENTS: ${JSON.stringify(ctx.documents)}`,
  });

  return { text: await result.text };
}
