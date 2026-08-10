#!/bin/zsh
cd "$(dirname "$0")"

read -s "gemini_key?請貼上新的 Gemini API 金鑰，然後按 Enter："
echo

if [[ -z "$gemini_key" ]]; then
  echo "沒有輸入金鑰，未做任何變更。"
  read -k 1 "?按任意鍵結束。"
  exit 1
fi

umask 077
printf 'GEMINI_API_KEY=%s\n' "$gemini_key" > .env
echo "金鑰已安全寫入本機設定。接著請雙擊「啟動語音記事.command」。"
read -k 1 "?按任意鍵結束。"
