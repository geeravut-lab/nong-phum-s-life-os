# Phase 6 — Life Legacy (B)

## Flows

1. **Death verification (deterministic)**
   - Open case → ≥2 confirmations (trigger) → `status=confirmed`
   - Auto-create public memorial + share token
   - **No AI** in this path

2. **Memorial** `/memorial/$token`
   - Tributes + digital wreaths (optional amount)

3. **AI Funeral Planner** `/legacy/after`
   - 3 packages (economy/standard/premium)
   - PromptPay QR + installments 1/12/24/36
   - Mark paid → admin follow-up

## Config

`platform_settings.funeral_promptpay_id` (fallback: `helpme_promptpay_id`)

```bash
npx supabase db push
```
