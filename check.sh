#!/usr/bin/env bash
# فحص صياغة الـ JS داخل project-dashboard.html (خطوة 2 في سير العمل بملف CLAUDE.md)
set -euo pipefail

cd "$(dirname "$0")"
FILE=site/project-dashboard.html

# أول <script> بلا src هو كتلة الكود الرئيسية
START=$(grep -n '^<script>$' "$FILE" | head -1 | cut -d: -f1)
END=$(grep -n '^</script>$' "$FILE" | tail -1 | cut -d: -f1)

if [ -z "$START" ] || [ -z "$END" ]; then
  echo "تعذّر تحديد كتلة <script> الرئيسية" >&2
  exit 1
fi

TMP=$(mktemp /tmp/adaa-XXXXXX.js)
trap 'rm -f "$TMP"' EXIT
sed -n "$((START + 1)),$((END - 1))p" "$FILE" > "$TMP"

node --check "$TMP"
echo "JS OK — $(wc -l < "$TMP") سطر"
