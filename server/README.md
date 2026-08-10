# Murmur Server

Node.js 後端，沒有用任何 web framework。負責：

- 收音檔（網頁錄音或 iPhone 上傳）、存進 `data/`
- 呼叫 Gemini 轉成逐字稿
- 把逐字稿分類成代辦／花費／提醒／靈感／學習筆記／日記，寫進 `data/notes.json`
- 提供 `/notes` 網頁：分類頁籤、換日期、新增、行內編輯、代辦打勾、刪除、花費加總

## 前置需求

- **Node.js 20+**（跟 Docker image 用的版本一致，沒特別測過更舊的版本）
- **ffmpeg**（`server.js` 轉檔時會呼叫命令列的 `ffmpeg`，本機直接跑 `node server.js` 必須先自己裝好；用 Docker 的話不用管，image 裡已經裝了）
- macOS／Linux 都能跑；兩個 `.command` 檔（雙擊啟動、雙擊設定金鑰）是 macOS 專用的小工具，Linux 上直接用下面的 `node server.js` 就好

```bash
node --version   # 20.x 以上
ffmpeg -version  # 沒有的話先裝
```

macOS：

```bash
brew install node ffmpeg
```

Debian/Ubuntu：

```bash
sudo apt install nodejs ffmpeg
```

## 本機執行

```bash
cp .env.example .env
# 編輯 .env，填入 GEMINI_API_KEY；本機測試 UPLOAD_TOKEN 可留空
npm install
node server.js
```

開啟 http://localhost:3000，瀏覽器會要求麥克風權限。錄音存進 `./data`。

## 環境變數

| 變數 | 用途 | 本機測試 |
|---|---|---|
| `GEMINI_API_KEY` | 轉錄與分類都靠它 | 必填 |
| `UPLOAD_TOKEN` | `/api/upload` 的 `X-Auth-Token` 驗證密鑰，正式部署（有對外網址）必填 | 可留空即跳過驗證 |
| `VOICE_DATA_DIR` | 音檔／`notes.json` 存放位置 | 預設 `./data` |
| `NOTES_TZ` | `organize.js` 用哪個時區換算「今天是哪一天」 | 預設 `Asia/Taipei` |

## 用 Docker 部署

```bash
docker compose up -d --build
```

`docker-compose.yml` 預設把 3000 port 直接對外開（`ports: "3000:3000"`），開發／區網測試可以直接用。要放到公開網址上正式使用，建議拿掉這個 `ports` 設定，改成放在你自己的反向代理（Caddy／nginx／Cloudflare Tunnel 皆可）後面，並用 HTTPS。**網頁介面本身沒有帳號密碼機制**，暴露在公開網址上前，務必在反向代理那層加一層驗證（basic auth、Cloudflare Access、VPN 都可以），否則任何拿到網址的人都能讀到你的記事內容。

`/api/upload` 這條路徑是給 iPhone 背景上傳用的，設計上不能要求互動式登入（背景執行時沒有人能操作登入畫面），所以驗證方式是 `X-Auth-Token` header 比對 `UPLOAD_TOKEN`——如果你在反向代理加了整站驗證，記得把這條路徑排除掉，不然背景上傳會失敗。

## 記事整理（notes-lib.js / organize.js）

分類邏輯共用同一份 `notes-lib.js`（prompt、JSON schema、時區換算），`server.js` 跟 `organize.js` 都讀這一份，避免規則寫兩次。用 Gemini 的 `response_format` 強制輸出符合 schema 的 JSON，不是靠 prompt 拜託模型自己守規矩。

**轉錄一完成就立刻分類、寫進 `notes.json`**（`server.js` 的 `organizeNow`），不用等排程。`organize.js` 是安全網，用來補「當天有逐字稿、但因為某種原因（例如當下 Gemini 剛好出錯）還沒被即時整理進去」的部分：

```bash
node organize.js              # 補「昨天」
node organize.js 2026-08-08   # 補指定日期
node organize.js --force      # 整天強制重新分類（會蓋掉當天的勾選與手動編輯，謹慎使用）
```

判斷「補過了沒」是看每一則逐字稿的來源檔名，不是看整天有沒有跑過——已經整理過的記事不會被重跑或覆蓋。

**這個 repo 本身不會自動排程 `organize.js`**，需要自己用 cron（Linux/VPS）或 launchd（macOS）設定，例如每天固定時間跑一次：

```bash
# crontab -e，範例：每天 03:00 跑一次（時間依你的伺服器時區調整）
0 3 * * * cd /path/to/murmur/server && /usr/bin/node organize.js >> organize.log 2>&1

# 用 Docker 部署的話改成：
0 3 * * * docker exec murmur-server node organize.js >> organize.log 2>&1
```

## 目錄結構

```
server.js       主程式：HTTP server、上傳、轉錄佇列、即時整理、notes API
organize.js     排程用的補漏腳本
notes-lib.js    分類 prompt / JSON schema / 時區換算（server.js 與 organize.js 共用）
index.html/js   錄音頁
notes.html/js   記事庫頁
```

### `data/` 裡有什麼

```text
data/
├── 2026-08-08T09-12-03Z.m4a    尚待轉錄的音檔（轉錄成功後會自動刪除）
├── 2026-08-08T09-12-03Z.txt    逐字稿（永久保留）
├── *.transcription-error.txt  轉錄失敗的紀錄（成功後會自動清掉）
└── notes.json                 整理後的記事資料，唯一的「最終結果」
```

- `data/` 本身不會被 Git 追蹤（`.gitignore` 已排除），也**不會自動備份**——`notes.json` 是所有記事的唯一來源，值得自己另外備份（cron 同步到別處、雲端硬碟都可以）。
- 原始音檔轉錄成功後會被刪除，只留逐字稿；轉錄失敗則音檔會保留，方便之後重試或手動處理。

## 已知限制

- 設計上是單人自架用，`/notes` 沒有內建登入機制（見上面「用 Docker 部署」的驗證建議）。
- 轉錄與分類都需要呼叫 Gemini API，需要網路連線，也會計入你自己的 API 配額／費用。
- 轉錄佇列一次只處理一筆（`server.js` 的 `transcriptionQueue`），個人用量沒問題，但不是為高併發設計的。
- iPhone 背景上傳需要手機能連到伺服器網址（本機測試是同一區網，正式使用需要對外網址）。
- Apple Watch 錄音走 WatchConnectivity，只能用實體配對裝置測試，模擬器測不出真實的背景傳輸行為。
