// 逐字稿分類與時間換算的共用邏輯。
// server.js（上傳完立刻整理）跟 organize.js（凌晨排程補漏）都用這一份，
// 避免兩邊各寫一次分類規則，之後改 prompt 只要改這裡。

const { randomUUID } = require('node:crypto');

const timeZone = process.env.NOTES_TZ || 'Asia/Taipei';
const model = process.env.ORGANIZE_MODEL || 'gemini-3.6-flash';

const CATEGORIES = ['todo', 'expense', 'idea', 'reminder', 'learn', 'diary', 'misc'];

const PROMPT = `你是一個個人記事整理助理。以下是使用者用語音記下的逐字稿，每則以「【編號 N】」開頭。

請把內容拆解成一則則獨立的記事，並分類。規則：

- 一則逐字稿可能包含多件事（例如「午餐花了120，另外記得回信給設計師」要拆成兩則）。
- text 用簡潔的書面語重寫，不要照抄口語贅字，但不要改變原意，也不要加入原文沒有的資訊。
- sourceIndex 填該則記事來自哪一個【編號】。
- 分類定義：
  - todo：有具體動作要做的事。若提到期限，用 due 欄位記錄（例如「8/9 前」）。
  - expense：花費紀錄。金額填 amount（純數字，不含貨幣符號）。
  - reminder：有明確時間點要記住的事（繳費、生日、約會），非本人待辦動作。
  - idea：想法、點子、發想。
  - learn：學到的知識、技術重點、值得記住的資訊。
  - diary：心情、感受、當天回顧。
  - misc：以上都不符合，或語意不清無法判斷。不要為了分類而勉強塞進其他類別。
- 沒有實質內容的（例如測試、雜訊、空白）直接略過，不要產生記事。`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORIES },
          text: { type: 'string' },
          amount: { type: 'number' },
          due: { type: 'string' },
          sourceIndex: { type: 'integer' },
        },
        required: ['category', 'text', 'sourceIndex'],
      },
    },
  },
  required: ['entries'],
};

// 檔名裡的時間戳是 UTC（new Date().toISOString() 產生的），
// 但使用者是用當地時間在想「哪一天」，所以一律換算成 timeZone 再分組。
function localParts(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function timestampFromFilename(filename) {
  const match = filename.match(/^voice-note-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/);
  if (!match) return null;
  const [, day, hour, minute, second, ms] = match;
  const parsed = new Date(`${day}T${hour}:${minute}:${second}.${ms}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function classifyTranscripts(transcripts) {
  const { GoogleGenAI } = await import('@google/genai');
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const body = transcripts
    .map((t, index) => `【編號 ${index}】（${t.time}）\n${t.text}`)
    .join('\n\n');

  const result = await client.interactions.create({
    model,
    input: [{ type: 'text', text: `${PROMPT}\n\n---\n\n${body}` }],
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: RESPONSE_SCHEMA,
    },
  });

  const raw = result.output_text?.trim();
  if (!raw) throw new Error('Gemini 沒有回傳內容');
  return JSON.parse(raw).entries ?? [];
}

// 把 Gemini 的分類結果轉成 notes.json 裡實際儲存的記事格式。
function buildStoredEntries(transcripts, classified) {
  return classified
    .filter((entry) => CATEGORIES.includes(entry.category) && entry.text?.trim())
    .map((entry) => {
      const source = transcripts[entry.sourceIndex] ?? transcripts[0];
      return {
        id: randomUUID(),
        cat: entry.category,
        time: source.time,
        text: entry.text.trim(),
        ...(entry.category === 'expense' && typeof entry.amount === 'number' ? { amount: entry.amount } : {}),
        ...(entry.due ? { due: entry.due } : {}),
        ...(entry.category === 'todo' ? { done: false } : {}),
        source: source.filename,
      };
    });
}

module.exports = {
  timeZone,
  CATEGORIES,
  localParts,
  timestampFromFilename,
  classifyTranscripts,
  buildStoredEntries,
};
