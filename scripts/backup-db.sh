#!/usr/bin/env bash
# Full data backup of the Supabase project without pg_dump or Docker:
# every public table as CSV (via PostgREST), auth users as JSON (admin API),
# and the storage object listing. Output goes to backups/<timestamp>/, which
# is git-ignored — the dump contains e-mails and personal data.
#
# Usage (Git Bash, from the repo root):  bash scripts/backup-db.sh
# Schema is not dumped: it lives in supabase/migrations/ already.
set -euo pipefail
cd "$(dirname "$0")/.."

# .env.local was saved with a UTF-8 BOM, which makes bash choke on line 1.
set -a; . <(sed '1s/^\xEF\xBB\xBF//' ./.env.local | tr -d '\r'); set +a
: "${SUPABASE_URL:?SUPABASE_URL missing in .env.local}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing in .env.local}"

out="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"

auth=(-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "User-Agent: phum-backup")

tables=(profiles user_roles documents reminders expenses incomes chat_messages
        families family_members helper_profiles jobs job_offers job_reviews
        benefit_profiles user_benefits benefits platform_settings
        ai_settings ai_events aivora_links)

echo "→ $out"
for t in "${tables[@]}"; do
  curl -sf "${auth[@]}" -H "Accept: text/csv" "$SUPABASE_URL/rest/v1/$t?select=*&limit=100000" -o "$out/$t.csv"
  # grep -c counts a final line that lacks a trailing newline; wc -l does not.
  rows=$(( $(grep -c "" "$out/$t.csv") - 1 )); [ "$rows" -lt 0 ] && rows=0
  printf "  %-18s %4d rows\n" "$t" "$rows"
done

curl -sf "${auth[@]}" "$SUPABASE_URL/auth/v1/admin/users?per_page=1000" -o "$out/auth_users.json"
printf "  %-18s %4d rows\n" "auth.users" "$(grep -o '"id":"[0-9a-f-]\{36\}"' "$out/auth_users.json" | sort -u | wc -l)"

# Storage: the object list (names + metadata). Files themselves are not
# downloaded here; grab them from Dashboard → Storage if you want copies.
curl -sf "${auth[@]}" -H "Content-Type: application/json" -X POST \
  -d '{"prefix":"","limit":1000}' "$SUPABASE_URL/storage/v1/object/list/documents" -o "$out/storage_documents_top.json"
{
  for d in $(grep -o '"name":"[^"]*"' "$out/storage_documents_top.json" | cut -d'"' -f4); do
    curl -sf "${auth[@]}" -H "Content-Type: application/json" -X POST \
      -d "{\"prefix\":\"$d\",\"limit\":1000}" "$SUPABASE_URL/storage/v1/object/list/documents" \
      | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | sed "s|^|$d/|"
  done
} > "$out/storage_documents_files.txt"
printf "  %-18s %4d files\n" "storage" "$(grep -c . "$out/storage_documents_files.txt" || true)"

echo "done. verify with:  grep -c '' $out/*.csv   (each number = rows + 1 header; a bare 1 = empty table)"
