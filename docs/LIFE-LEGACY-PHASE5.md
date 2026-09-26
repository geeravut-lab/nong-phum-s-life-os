# Phase 5 — Life Legacy (A)

ผู้ใช้กรอกตอนยังมีชีวิต — **ไม่ใช่พินัยกรรมตาม ป.พ.พ.**

## Route

`/legacy` — hub + tabs

## Tables

- `legacy_profiles` — consent, organ/body donation
- `legacy_contacts` — trusted people + verifiers
- `legacy_assets` — inventory / liabilities
- `legacy_wishes` — wishes, vault notes, will_ref, messages, life story
- `legacy_checklist` — after-life tasks (+ `legacy_seed_checklist` RPC)

## AI

`legacyAssist` — extract draft assets/wishes/checklist from free text (+ optional Money/Family context)

## Phase 6 (ยังไม่ทำ)

Death multi-confirmation, Memorial, Digital Wreath, AI Funeral Planner + payment

```bash
npx supabase db push
```
