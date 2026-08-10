// 補漏排程：語音上傳後 server.js 會立刻分類整理，這支腳本是安全網，
// 凌晨 3 點跑一次，把「當天已經有逐字稿、但因為某種原因（例如當下 Gemini 剛好出錯）
// 還沒被整理進 notes.json」的部分補上。只補新的，已經整理過的記事完全不動。
// 用法：
//   node organize.js              補「昨天」（給凌晨 3 點的排程用）
//   node organize.js 2026-08-08   補指定日期
//   node organize.js --force      不管有沒有補過，該日期整個重新分類一次（會蓋掉當天的勾選與編輯）

const fs = require('node:fs/promises');
const path = require('node:path');
const { localParts, timestampFromFilename, classifyTranscripts, buildStoredEntries } = require('./notes-lib');

const dataDirectory = process.env.VOICE_DATA_DIR || path.join(__dirname, 'data');
const notesPath = path.join(dataDirectory, 'notes.json');

function targetDate() {
  const explicit = process.argv.slice(2).find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  if (explicit) return explicit;
  return localParts(new Date(Date.now() - 24 * 60 * 60 * 1000)).date;
}

async function readNotes() {
  try {
    return JSON.parse(await fs.readFile(notesPath, 'utf8'));
  } catch {
    return {};
  }
}

async function collectTranscripts(date) {
  const files = await fs.readdir(dataDirectory);
  const matched = [];

  for (const filename of files) {
    if (!filename.endsWith('.txt') || filename.endsWith('.transcription-error.txt')) continue;
    const timestamp = timestampFromFilename(filename);
    if (!timestamp) continue;
    const local = localParts(timestamp);
    if (local.date !== date) continue;
    const text = (await fs.readFile(path.join(dataDirectory, filename), 'utf8')).trim();
    if (text) matched.push({ filename, time: local.time, text });
  }

  return matched.sort((a, b) => a.time.localeCompare(b.time));
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error('尚未設定 GEMINI_API_KEY');

  const date = targetDate();
  const force = process.argv.includes('--force');
  const notes = await readNotes();
  const day = notes[date];

  const transcripts = await collectTranscripts(date);
  if (transcripts.length === 0) {
    console.log(`${date} 沒有逐字稿，略過`);
    return;
  }

  let toProcess = transcripts;
  let baseEntries = [];

  if (day && !force) {
    const alreadyOrganized = new Set(day.entries.map((entry) => entry.source));
    toProcess = transcripts.filter((t) => !alreadyOrganized.has(t.filename));
    baseEntries = day.entries;

    if (toProcess.length === 0) {
      console.log(`${date} 沒有新逐字稿需要補，略過`);
      return;
    }
  }

  const classified = await classifyTranscripts(toProcess);
  const newEntries = buildStoredEntries(toProcess, classified);
  const entries = [...baseEntries, ...newEntries].sort((a, b) => a.time.localeCompare(b.time));

  notes[date] = { generatedAt: new Date().toISOString(), entries };
  await fs.writeFile(notesPath, JSON.stringify(notes, null, 2), 'utf8');
  console.log(`${date} 補漏完成：處理 ${toProcess.length} 則逐字稿 → 新增 ${newEntries.length} 筆記事（當天共 ${entries.length} 筆）`);
}

main().catch((error) => {
  console.error(`整理失敗：${error.message}`);
  process.exitCode = 1;
});
