# Realtime inbox + Local v2

## Realtime

1. Run migration `20260924190000_realtime_inbox_local_v2.sql`
2. In Supabase Dashboard → Database → Publications → `supabase_realtime`  
   ensure `job_messages`, `app_notifications`, `job_offers` are listed (migration tries to add them).
3. Chat in JobWorkspace already subscribes to `job_messages` INSERT.
4. New messages also create `app_notifications` for the other party → red pulse on Help Me menu.

## Local v2

- Open Now filter from `open_hours`
- Google Maps / Directions links
- User reviews (`place_reviews`)
- Promoted places (`is_promoted`)
- SQL `haversine_km` + `local_places_nearby` (no PostGIS required)

## Deploy

```bash
npx supabase db push
git push
```
