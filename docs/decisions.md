# 架構決策

這份文件放「為什麼這樣做」，跟 README 的操作步驟分開，方便回頭理解某個設計當初為什麼這樣選。

## 整理時機：從「排程整批重跑」改成「錄完立刻整理＋排程當安全網」

**原本**：一支排程腳本每天固定時間跑一次，把當天所有逐字稿整批重新分類、整批寫入 `notes.json`。

**問題**：當天錄的東西要等到排程時間才會出現在記事頁面，體感上像「壞了」。

**改法**：`server.js` 轉錄一完成就立刻分類單筆逐字稿並附加進 `notes.json`（`organizeNow`）；排程腳本（`organize.js`）改成只補「當天有逐字稿、但沒被即時整理進去的部分」（例如當下 Gemini 剛好出錯），用逐字稿的來源檔名判斷哪些已經處理過，不會覆蓋既有記事或使用者手動的勾選／編輯。只有明確加 `--force` 才會整天強制重新分類（這會蓋掉當天所有手動編輯，刻意保留這個選項但預設不用）。

分類邏輯（prompt、JSON schema、時區換算）獨立成 `notes-lib.js`，讓即時路徑（`server.js`）跟安全網路徑（`organize.js`）共用同一份規則，避免兩邊各寫一次、之後改 prompt 忘了改另一邊。

## 自架時的驗證：如果要用 Cloudflare Access 之類的邊緣驗證取代 basic auth

`server.js` 本身沒有登入機制，`/notes` 等網頁預設假設「能連到這個網址的人就是自己」。如果要暴露在公開網址上，需要在反向代理那層加驗證。這裡記錄兩個踩過的坑，供之後參考：

**上傳路徑必須排除在互動式登入之外**：iPhone/Apple Watch 是背景上傳，沒有人能操作登入頁面。所以 `/api/upload` 用的是 `X-Auth-Token` 比對 `UPLOAD_TOKEN`（server.js 自己檢查），而不是交給反向代理的登入機制。如果反向代理對整個網域套用同一個驗證規則又沒有把這條路徑排除，背景上傳會全部失敗——這是最容易漏掉、但漏了會直接弄壞核心功能的一步。

**Cloudflare Access 跟 TLS-ALPN-01 憑證驗證會衝突**：Cloudflare Access 是在 Cloudflare 邊緣擋，必須讓流量先經過 Cloudflare 代理（橘雲）。但如果你的 TLS 憑證是用 TLS-ALPN-01 驗證（例如 Caddy 預設），這個驗證需要 CA 直接連到源站的 443 port，橘雲代理下驗證會失敗（CA 連到的是 Cloudflare 邊緣，不是源站）。要同時用 Cloudflare Access，就要把憑證驗證方式換成 HTTP-01（Cloudflare 會把 `/.well-known/acme-challenge/` 正常轉發到源站），不然憑證會在下次續期時失效。
