import { generateObject, generateText } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { persona } from "./ai-gateway.server";
import { providerCapabilities, resolveProvider, withProviderFallback } from "./ai-provider.server";
import { APP_TIME_ZONE, APP_UTC_OFFSET, todayInBangkok } from "./time";
import { dictFor, langName as langNameFor } from "./i18n.dict";

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
  "warranty",
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
    .describe(
      "True when this is money received: payslip, salary slip, transfer-in, sales invoice paid to the user",
    ),
  needsAction: z
    .boolean()
    .describe("True when the user must do something before a deadline (pay, renew, submit, book)"),
  isWarranty: z.boolean().describe("True when this is a product warranty / guarantee certificate"),
  warrantyUntil: z.string().nullable().describe("Warranty end date as YYYY-MM-DD or null"),
  // A statement, a ledger page or a note listing several payments is one
  // document but many money records. Filing it as a single total left the user
  // with one row of 4,820 where they had written down eleven, and no way to
  // check any of them later.
  lineItems: z
    .array(
      z.object({
        title: z.string().describe("What this single line is for, as written"),
        amount: z.number().describe("Amount of this one line in THB, always positive"),
        kind: z.enum(["expense", "income"]).describe("Money out or money in"),
        on: z.string().nullable().describe("The date of this line as YYYY-MM-DD, or null"),
        category: z.enum(CATEGORIES),
      }),
    )
    .max(60)
    .describe(
      "Every individual money line, when the document lists more than one - a bank statement, an expense ledger, a page of handwritten entries, a receipt with several payments. Leave it empty for a document with a single amount (one bill, one payslip, one receipt).",
    ),
});

export type DocAnalysis = z.infer<typeof DocSchema>;

export async function runDocumentAnalysis(input: {
  base64: string;
  mimeType: string;
  fileName: string;
  lang: "th" | "en";
}): Promise<DocAnalysis> {
  const langName = langNameFor(input.lang);
  const isImage = input.mimeType.startsWith("image/");

  if (!isImage && !providerCapabilities(await resolveProvider("document")).pdf) {
    throw new Error(dictFor(input.lang).docsPdfUnsupported);
  }

  const { object } = await withProviderFallback("document", (model) =>
    generateObject({
      model,
      schema: DocSchema,
      system: `${persona(input.lang)}\nYou are extracting structured data from a document a user uploaded. Answer all free text in ${langName}. Use null when a field is genuinely absent — never guess.`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Read this document (file name: ${input.fileName}) and extract its details.
If it is a warranty/guarantee card, set isWarranty=true, category=warranty, and warrantyUntil.
If there is any expiry, renew-by, or due date, put it in dueDate.
Never invent dates.
If the document LISTS SEVERAL amounts - a statement, a ledger, a page of entries, a receipt covering several payments - put every one of them in lineItems, one entry per line as written, each with its own date and whether it is money out or money in. Do not merge them and do not round. Keep 'amount' as the document's own total for reference. For a document with a single amount, leave lineItems empty.`,
            },
            isImage
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
    }),
  );

  return object;
}

const ActionSchema = z.object({
  reply: z.string().describe("Nong Phum's reply to the user"),
  // A list, because people ask for more than one thing in a breath: "note the
  // coffee, 60 baht, and remind me to pay the water bill on the 5th" is two
  // records. This used to be a single action, so the second request was
  // silently dropped while the reply cheerfully confirmed both.
  actions: z
    .array(
      z.object({
        type: z.enum([
          "create_reminder",
          "update_reminder",
          "delete_reminder",
          "add_expense",
          "update_expense",
          "delete_expense",
          "add_income",
          "update_income",
          "delete_income",
          "family_assign_task",
          "family_add_event",
          "family_add_routine",
          "search_documents",
          "daily_brief",
          "list_benefits",
          "none",
        ]),
        // Which existing row to change or remove. It must be an id copied from
        // the lists in the prompt - the model has no way to invent one that
        // resolves, and the row policy refuses another person's id anyway.
        targetId: z
          .string()
          .nullable()
          .describe(
            "The id of the row to update or delete, copied exactly from REMINDERS / EXPENSES / INCOMES. Null for anything else.",
          ),
        /** Reminders only: 'done' closes it, 'open' reopens it. */
        status: z.enum(["open", "done"]).nullable(),
        /**
         * The family member an action is about - who a task goes to, whose
         * routine is being tracked. An id copied from FAMILY.members.
         */
        memberId: z.string().nullable(),
        /** family_add_routine: how often it is expected, and the slack allowed. */
        everyDays: z.number().int().nullable(),
        graceDays: z.number().int().nullable(),
        title: z.string().nullable(),
        dueAt: z
          .string()
          .nullable()
          .describe(
            `ISO 8601 datetime for reminders, always with the ${APP_UTC_OFFSET} offset, e.g. 2026-09-15T09:00:00${APP_UTC_OFFSET}`,
          ),
        priority: z.enum(["high", "normal", "low"]).nullable(),
        recurrence: z.enum(["none", "monthly", "yearly"]).nullable(),
        amount: z.number().nullable(),
        category: z.enum(CATEGORIES).nullable(),
        spentOn: z.string().nullable().describe("YYYY-MM-DD for expenses"),
        receivedOn: z.string().nullable().describe("YYYY-MM-DD for income"),
        // Time of day is separate from the date and separately optional,
        // because people give one without the other: "ate at 5.15" has no date,
        // "I paid it yesterday" has no clock. The app fills whichever is
        // missing with the current one rather than guessing midnight.
        atTime: z
          .string()
          .nullable()
          .describe(
            "HH:mm, 24-hour, ONLY when the user states a time of day for an expense or income. Null when they did not.",
          ),
        query: z.string().nullable().describe("Search text for documents"),
      }),
    )
    .max(4)
    .describe(
      "Every action Nong Phum takes for this message, in the order they were asked for. Empty, or a single 'none', when only chatting.",
    ),
});

export type PhumAction = z.infer<typeof ActionSchema>["actions"][number];

type Db = SupabaseClient<Database>;

async function loadContext(supabase: Db, userId: string) {
  const [reminders, expenses, incomes, documents, benefitProfile, myBenefits] = await Promise.all([
    supabase
      .from("reminders")
      .select("id, title, due_at, priority, status")
      .eq("user_id", userId)
      .eq("status", "open")
      .order("due_at", { ascending: true })
      .limit(15),
    supabase
      .from("expenses")
      .select("id, title, amount, category, spent_on, spent_at")
      .eq("user_id", userId)
      .order("spent_on", { ascending: false })
      .limit(15),
    supabase
      .from("incomes")
      .select("id, title, amount, category, received_on, received_at")
      .eq("user_id", userId)
      .order("received_on", { ascending: false })
      .limit(15),
    supabase
      .from("documents")
      .select("title, category, summary, due_date, amount, counterparty")
      .eq("user_id", userId)
      // pending/failed rows carry a file name and an error, not facts;
      // attachments (receipts on rows) were never read by the AI at all
      .eq("status", "ready")
      .eq("kind", "analyzed")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("benefit_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("user_benefits")
      .select("status, benefits(title, title_en)")
      .eq("user_id", userId),
  ]);

  // The family, and who is in it by name. Without this "มอบหมายให้พี่ต้น" has
  // nothing to resolve against: the model would have to invent a user id, and
  // the server function would rightly refuse it.
  const membership = await supabase
    .from("family_members")
    .select("family_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  const familyId = (membership.data?.family_id as string | undefined) ?? null;

  let family: { id: string; members: Array<{ id: string; name: string }> } | null = null;
  if (familyId) {
    // The same resolver the family page uses. Reading display_name alone gave
    // the model a list of ids with blank names, which is nothing to match
    // "มอบหมายให้ต้น" against - most accounts keep their name on the profile
    // or have only the one in their email.
    const { resolveMemberLabels } = await import("./family-labels.server");
    const labels = await resolveMemberLabels(familyId);
    family = {
      id: familyId,
      members: labels.map((m) => ({ id: m.userId, name: m.label })),
    };
  }

  return {
    reminders: reminders.data ?? [],
    expenses: expenses.data ?? [],
    incomes: incomes.data ?? [],
    documents: documents.data ?? [],
    benefitProfile: benefitProfile.data ?? null,
    myBenefits: myBenefits.data ?? [],
    family,
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
  const ctx = await loadContext(supabase, userId);
  const langName = langNameFor(input.lang);
  const today = todayInBangkok();

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

  const { object } = await withProviderFallback("chat", (model) =>
    generateObject({
      model,
      schema: ActionSchema,
      system: `${persona(input.lang)}
Today is ${today} (${APP_TIME_ZONE}, UTC${APP_UTC_OFFSET}). All dates and times are in that zone. Reply in ${langName}.
You route the user's request into their Life OS. One message can ask for
several things - return one action for each, in the order asked. Return an
empty list when the message needs no record kept:
- create_reminder: the user wants to remember, do, or be reminded of something (fill title, dueAt, priority, recurrence)
- update_reminder / delete_reminder: the user wants to change or remove a task that already exists. Put its id in targetId and fill ONLY the fields that change; leave the rest null and they stay as they are. Use update_reminder with status 'done' when they say a task is finished.
- update_expense / delete_expense / update_income / delete_income: the same, for a money row that already exists.
- family_assign_task: give a task to someone at home ("บอกให้ต้นไปจ่ายค่าน้ำวันศุกร์"). Fill title, dueAt, and memberId with that person's id from FAMILY.members. Leave memberId null when they did not say who.
- family_add_event: a shared appointment on the family calendar ("นัดหมอพ่อวันอังคารบ่ายสอง"). Fill title and dueAt.
- family_add_routine: track a habit of someone at home ("ช่วยดูให้หน่อยว่าแม่กินยาทุกวัน"). Fill title, memberId, everyDays (how often it should happen) and graceDays (how long before it counts as missed - use 1 or 2 unless they say).
These three need a family. If FAMILY is null the user is not in one: say so and suggest creating one on the ครอบครัว page instead of returning the action.
- add_expense: the user reports spending money (fill title, amount, category, spentOn)
- add_income: the user reports receiving money — salary, transfer in, sale, bonus, refund (fill title, amount, category, receivedOn)
- search_documents: the user asks about something in their stored documents
- list_benefits: the user asks about their government benefits / welfare rights ("สิทธิของฉัน", "ได้สิทธิอะไรบ้าง", "เบี้ยผู้สูงอายุ", benefits, welfare). The app then shows interactive benefit cards with status buttons under your reply — so keep the reply short and point at the cards.
- daily_brief: the user asks what's going on today / what's coming up
- none: casual conversation or a question you can answer from the context below
${focusLine}

To change or remove something, find it in the lists below by what the user called it and copy its id into targetId. Every row carries an id for exactly this. If more than one row could be meant, do NOT guess - return no action and ask which one.

When the user calls something off - "ไม่ต้องแล้ว", "ยกเลิก", "เลิกหาแล้ว", "ไม่เอาแล้ว", "หยุดเรื่องนี้", "drop it", "never mind" - that is delete_reminder (or delete_expense / delete_income) on the row they mean, not a spoken acknowledgement. Saying "รับทราบครับ" and leaving the row in the list means the same thing comes back at them tomorrow.

ANSWER ONLY WHAT WAS ASKED. The lists below are there so you can answer questions and find rows to change - they are not a list of things to bring up. Do not append progress reports, offers to help, or "I still have no information about X" about anything the user did not just mention. If they ask about buying a car, answer about buying a car and stop; an errand they mentioned days ago has no business in that reply. And when they say to stop discussing something, stop mentioning it at all - not even to confirm that you have stopped in every later answer.

Answer questions using ONLY this data about the user; if it isn't there, say you don't have it yet.
REMINDERS: ${JSON.stringify(ctx.reminders)}
EXPENSES: ${JSON.stringify(ctx.expenses)}
INCOMES: ${JSON.stringify(ctx.incomes)}
DOCUMENTS: ${JSON.stringify(ctx.documents)}
BENEFIT PROFILE: ${JSON.stringify(ctx.benefitProfile)}
BENEFIT STATUSES: ${JSON.stringify(ctx.myBenefits)}
FAMILY: ${JSON.stringify(ctx.family)}

The app saves create_reminder, add_expense and add_income automatically as soon as you return them — never ask the user to confirm and never ask them to add it themselves. Instead confirm in past tense what you just saved (title, amount, date) and mention they can edit it on the matching page. If a date is missing, use today. If an amount is missing for money actions, do NOT use that action type.
For add_expense and add_income: fill spentOn/receivedOn only when the user names a day, and atTime only when they name a clock time ("ตอนห้าโมงสิบห้า" is 17:15, "เมื่อเช้า 8 โมง" is 08:00). Leave either null when they did not say it - the app fills the missing half with today and with the current time, and a null is what tells it to.
Confirm ONLY what is in your actions list. If the user asked for something you did not return an action for, say plainly that you did not do that part rather than claiming you did — a reply that reports a reminder the app never saved is worse than one that admits the gap.`,
      messages: [
        ...(history.data ?? []).map((m) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content as string,
        })),
        { role: "user" as const, content: input.message },
      ],
    }),
  );

  return object;
}

export async function runDailyBrief(lang: "th" | "en", supabase: Db, userId: string) {
  const ctx = await loadContext(supabase, userId);
  const langName = langNameFor(lang);
  const today = todayInBangkok();

  const result = await withProviderFallback("chat", (model) =>
    generateText({
      model,
      system: `${persona(lang)}
Today is ${today} (${APP_TIME_ZONE}, UTC${APP_UTC_OFFSET}). Write the user's daily brief in ${langName}.
Format: one warm opening line, then a short numbered list (max 5) of the things that matter today — overdue or upcoming reminders, documents expiring soon, unusual spending. End with one practical suggestion.
Use markdown. Keep it under 140 words. Never invent items that are not in the data.`,
      prompt: `REMINDERS: ${JSON.stringify(ctx.reminders)}
EXPENSES: ${JSON.stringify(ctx.expenses)}
INCOMES: ${JSON.stringify(ctx.incomes)}
DOCUMENTS: ${JSON.stringify(ctx.documents)}`,
    }),
  );

  return { text: result.text };
}

/**
 * Speech-to-text for voice input (Phase 1.10).
 * Only Google supports inline audio on the chat models we use, so we force
 * the Google provider when it has a key. Anthropic/OpenAI would 400.
 * Returns plain text the caller can feed into runChatRouter.
 */
export async function transcribeAudio(input: {
  base64: string;
  mimeType: string;
  lang: "th" | "en";
}): Promise<{ text: string }> {
  const { apiKeyFor, modelForId, providerEnvKey, resolveModelId } =
    await import("./ai-provider.server");
  // Force Google — only provider with capabilities.audio === true
  if (!apiKeyFor("google")) {
    throw new Error(`Voice input requires Google (audio). Set ${providerEnvKey("google")}.`);
  }

  // Prefer a flash model that is known to accept audio; admin override for
  // "chat" is still respected if it is a Google model id.
  const modelId = await resolveModelId("google", "chat");
  const model = modelForId("google", modelId);

  const langHint =
    input.lang === "th"
      ? "The audio is likely Thai (or mixed Thai/English). Transcribe accurately in the spoken language."
      : "Transcribe accurately. Prefer English if mixed.";

  const result = await generateText({
    model,
    system: `You are a precise speech-to-text engine. Output ONLY the transcribed text, nothing else — no quotes, no preamble, no translation unless the speaker mixed languages. ${langHint}`,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "file",
            data: input.base64,
            mediaType: input.mimeType,
          },
          {
            type: "text",
            text: "Transcribe this audio recording to text.",
          },
        ],
      },
    ],
  });

  const text = (result.text ?? "").trim();
  if (!text) {
    throw new Error(
      input.lang === "th"
        ? "ถอดเสียงไม่ได้ ลองพูดใหม่อีกครั้ง"
        : "Could not transcribe. Please try again.",
    );
  }
  return { text };
}
