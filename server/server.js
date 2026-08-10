const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { CATEGORIES: NOTE_CATEGORIES, localParts, timestampFromFilename, classifyTranscripts, buildStoredEntries } = require('./notes-lib');

const projectDirectory = __dirname;
const uploadDirectory = process.env.VOICE_DATA_DIR || path.join(projectDirectory, 'data');
const port = Number(process.env.PORT) || 3000;
const uploadToken = process.env.UPLOAD_TOKEN || '';
const notesPath = path.join(uploadDirectory, 'notes.json');
const execFileAsync = promisify(execFile);
let transcriptionQueue = Promise.resolve();
// 記事的讀改寫要排隊，避免兩個請求同時覆寫 notes.json。
let notesQueue = Promise.resolve();

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers);
  response.end(body);
}

// 沒有設定 UPLOAD_TOKEN 時不檢查，讓本機直接 node server.js 的用法維持原樣。
function isAuthorized(request) {
  if (!uploadToken) return true;
  const provided = request.headers['x-auth-token'];
  if (typeof provided !== 'string') return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(uploadToken);
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

async function transcribeWithGemini(audioPath, filename) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('尚未設定 GEMINI_API_KEY');
  }

  const parsedPath = path.parse(audioPath);
  const temporaryMp3Path = path.join(parsedPath.dir, `${parsedPath.name}.transcription.mp3`);
  await execFileAsync('ffmpeg', ['-y', '-i', audioPath, '-vn', '-ac', '1', '-b:a', '32k', temporaryMp3Path]);

  let uploadedFile;
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    uploadedFile = await client.files.upload({
      file: temporaryMp3Path,
      config: { mimeType: 'audio/mp3', displayName: filename },
    });
    const result = await client.interactions.create({
      model: 'gemini-3.6-flash',
      input: [
        { type: 'text', text: '請逐字轉寫這段音訊。使用繁體中文；保留原本語意，不要摘要，不要加入標題或說明。聽不清楚的內容標記為［聽不清楚］。' },
        { type: 'audio', uri: uploadedFile.uri, mime_type: uploadedFile.mimeType },
      ],
    });
    const transcript = result.output_text?.trim();
    if (!transcript) {
      throw new Error('Gemini 已處理音檔，但沒有回傳逐字稿內容');
    }
    return transcript;
  } finally {
    await fs.rm(temporaryMp3Path, { force: true });
    if (uploadedFile) {
      const { GoogleGenAI } = await import('@google/genai');
      const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      await client.files.delete({ name: uploadedFile.name });
    }
  }
}

function transcriptFilenameFor(filename) {
  return `${path.parse(filename).name}.txt`;
}

function queueTranscription(audioPath, filename) {
  transcriptionQueue = transcriptionQueue.then(async () => {
    const transcriptFilename = transcriptFilenameFor(filename);
    const transcript = await transcribeWithGemini(audioPath, filename);
    await fs.writeFile(path.join(uploadDirectory, transcriptFilename), transcript, 'utf8');
    // 轉錄成功後不需要留原始音檔；失敗時保留，讓 /api/retry-transcription 還能重試。
    await fs.rm(audioPath, { force: true });
    console.log(`轉文字完成：${transcriptFilename}`);
    await organizeNow(transcriptFilename, transcript);
  }).catch(async (error) => {
    const errorFilename = `${path.parse(filename).name}.transcription-error.txt`;
    await fs.writeFile(path.join(uploadDirectory, errorFilename), error.message, 'utf8');
    console.error(`轉文字失敗：${filename}：${error.message}`);
  });
}

async function readJsonBody(request) {
  const parts = [];
  for await (const part of request) parts.push(part);
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

async function readNotes() {
  try {
    return JSON.parse(await fs.readFile(notesPath, 'utf8'));
  } catch {
    return {};
  }
}

// 對某一天的記事做修改，回傳修改後的當日資料。整段排進 notesQueue 依序執行。
// create:true 時，當天還沒有任何 Gemini 整理結果也會建立一個空的當日資料（手動新增用）。
function updateNotes(date, mutate, { create = false } = {}) {
  const result = notesQueue.then(async () => {
    const notes = await readNotes();
    let day = notes[date];
    if (!day) {
      if (!create) throw new Error('找不到這一天的記事');
      day = { generatedAt: new Date().toISOString(), entries: [] };
      notes[date] = day;
    }
    mutate(day);
    await fs.writeFile(notesPath, JSON.stringify(notes, null, 2), 'utf8');
    return day;
  });
  notesQueue = result.catch(() => {});
  return result;
}

function currentTimeHHMM() {
  return localParts(new Date()).time;
}

// 轉錄一完成就立刻分類、寫進當天的 notes.json，不用等凌晨排程。
// 失敗不影響轉錄本身已經成功這件事——只是記錄下來，讓凌晨的 organize.js 補上。
async function organizeNow(filename, text) {
  if (!process.env.GEMINI_API_KEY) return;
  try {
    const timestamp = timestampFromFilename(filename);
    if (!timestamp) return;
    const { date, time } = localParts(timestamp);

    const transcript = { filename, time, text };
    const classified = await classifyTranscripts([transcript]);
    const entries = buildStoredEntries([transcript], classified);
    if (entries.length === 0) {
      console.log(`${filename} 沒有實質內容，Gemini 判斷略過，不產生記事`);
      return;
    }

    await updateNotes(date, (day) => {
      day.entries.push(...entries);
      day.entries.sort((a, b) => a.time.localeCompare(b.time));
    }, { create: true });

    console.log(`已即時整理進 ${date}：${entries.length} 筆`);
  } catch (error) {
    console.error(`即時整理失敗（${filename}）：${error.message}，今晚排程會補上`);
  }
}

function audioExtensionFor(request) {
  const requestedFilename = request.headers['x-voice-note-filename'];
  const requestedExtension = typeof requestedFilename === 'string'
    ? path.extname(requestedFilename).toLowerCase()
    : '';
  if (['.m4a', '.webm', '.mp3', '.wav'].includes(requestedExtension)) {
    return requestedExtension;
  }
  return request.headers['content-type']?.includes('audio/mp4') ? '.m4a' : '.webm';
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/api/retry-transcription') {
    if (!isAuthorized(request)) return send(response, 401, '未授權');
    const parts = [];
    for await (const part of request) parts.push(part);

    try {
      const { filename } = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (
        !filename
        || path.basename(filename) !== filename
        || !['.m4a', '.webm', '.mp3', '.wav'].includes(path.extname(filename).toLowerCase())
      ) {
        return send(response, 400, '音檔名稱無效');
      }

      const audioPath = path.join(uploadDirectory, filename);
      await fs.access(audioPath);
      const transcript = await transcribeWithGemini(audioPath, filename);
      const transcriptFilename = transcriptFilenameFor(filename);
      await fs.writeFile(path.join(uploadDirectory, transcriptFilename), transcript, 'utf8');
      await fs.rm(audioPath, { force: true });
      await fs.rm(path.join(uploadDirectory, `${path.parse(filename).name}.transcription-error.txt`), { force: true });
      await organizeNow(transcriptFilename, transcript);
      return send(response, 200, JSON.stringify({ filename, transcriptFilename }), { 'Content-Type': 'application/json' });
    } catch (error) {
      return send(response, 500, JSON.stringify({ transcriptionError: error.message }), { 'Content-Type': 'application/json' });
    }
  }

  if (request.method === 'POST' && request.url === '/api/upload') {
    if (!isAuthorized(request)) return send(response, 401, '未授權');
    const parts = [];
    for await (const part of request) parts.push(part);
    const audio = Buffer.concat(parts);

    if (!audio.length) return send(response, 400, '沒有收到音檔');
    if (audio.length > 100 * 1024 * 1024) return send(response, 413, '音檔過大');

    await fs.mkdir(uploadDirectory, { recursive: true });
    const extension = audioExtensionFor(request);
    const filename = `voice-note-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}${extension}`;
    const audioPath = path.join(uploadDirectory, filename);
    await fs.writeFile(audioPath, audio);
    queueTranscription(audioPath, filename);
    return send(response, 202, JSON.stringify({
      filename,
      transcriptionStatus: 'queued',
    }), { 'Content-Type': 'application/json' });
  }

  if (request.method === 'GET' && request.url === '/api/notes') {
    if (!isAuthorized(request)) return send(response, 401, '未授權');
    const notes = await readNotes();
    return send(response, 200, JSON.stringify(notes), { 'Content-Type': 'application/json' });
  }

  if (request.method === 'POST' && (request.url === '/api/notes/toggle' || request.url === '/api/notes/delete')) {
    if (!isAuthorized(request)) return send(response, 401, '未授權');
    const isDelete = request.url === '/api/notes/delete';

    try {
      const { date, id } = await readJsonBody(request);
      if (!date || !id) return send(response, 400, '缺少 date 或 id');

      const day = await updateNotes(date, (target) => {
        if (isDelete) {
          target.entries = target.entries.filter((entry) => entry.id !== id);
          return;
        }
        const entry = target.entries.find((item) => item.id === id);
        if (!entry) throw new Error('找不到這則記事');
        entry.done = !entry.done;
      });

      return send(response, 200, JSON.stringify(day), { 'Content-Type': 'application/json' });
    } catch (error) {
      return send(response, 400, JSON.stringify({ error: error.message }), { 'Content-Type': 'application/json' });
    }
  }

  if (request.method === 'POST' && request.url === '/api/notes/add') {
    if (!isAuthorized(request)) return send(response, 401, '未授權');

    try {
      const { date, cat, text, amount, due } = await readJsonBody(request);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(response, 400, 'date 格式錯誤');
      if (!NOTE_CATEGORIES.includes(cat)) return send(response, 400, '分類無效');
      const trimmedText = typeof text === 'string' ? text.trim() : '';
      if (!trimmedText) return send(response, 400, '內容不能為空');

      const entry = { id: randomUUID(), cat, time: currentTimeHHMM(), text: trimmedText };
      if (cat === 'expense' && typeof amount === 'number' && Number.isFinite(amount)) entry.amount = amount;
      if (cat === 'todo') {
        entry.done = false;
        if (typeof due === 'string' && due.trim()) entry.due = due.trim();
      }

      const day = await updateNotes(date, (target) => {
        target.entries.push(entry);
        target.entries.sort((a, b) => a.time.localeCompare(b.time));
      }, { create: true });

      return send(response, 200, JSON.stringify(day), { 'Content-Type': 'application/json' });
    } catch (error) {
      return send(response, 400, JSON.stringify({ error: error.message }), { 'Content-Type': 'application/json' });
    }
  }

  if (request.method === 'POST' && request.url === '/api/notes/edit') {
    if (!isAuthorized(request)) return send(response, 401, '未授權');

    try {
      const { date, id, text, amount, due } = await readJsonBody(request);
      if (!date || !id) return send(response, 400, '缺少 date 或 id');

      const day = await updateNotes(date, (target) => {
        const entry = target.entries.find((item) => item.id === id);
        if (!entry) throw new Error('找不到這則記事');

        if (text !== undefined) {
          const trimmed = String(text).trim();
          if (!trimmed) throw new Error('內容不能為空');
          entry.text = trimmed;
        }
        if (amount !== undefined) {
          if (amount === null) delete entry.amount;
          else if (typeof amount === 'number' && Number.isFinite(amount)) entry.amount = amount;
          else throw new Error('金額格式錯誤');
        }
        if (due !== undefined) {
          const trimmed = due === null ? '' : String(due).trim();
          if (trimmed) entry.due = trimmed;
          else delete entry.due;
        }
      });

      return send(response, 200, JSON.stringify(day), { 'Content-Type': 'application/json' });
    } catch (error) {
      return send(response, 400, JSON.stringify({ error: error.message }), { 'Content-Type': 'application/json' });
    }
  }

  if (request.method !== 'GET') return send(response, 405, '不支援的方法');
  const requested = request.url === '/' ? '/index.html'
    : request.url === '/notes' ? '/notes.html'
    : request.url;
  const safePath = path.normalize(requested).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(projectDirectory, safePath);
  if (!filePath.startsWith(projectDirectory)) return send(response, 403, '禁止存取');

  try {
    const file = await fs.readFile(filePath);
    const contentType = contentTypes[path.extname(filePath)] || 'application/octet-stream';
    // 網頁需要金鑰才能呼叫 API。反向代理（Caddy）已用 basic auth 擋在前面，
    // 能讀到這個頁面的人本來就通過驗證了。
    if (path.extname(filePath) === '.html') {
      return send(response, 200, file.toString('utf8').replace('__UPLOAD_TOKEN__', uploadToken), { 'Content-Type': contentType });
    }
    return send(response, 200, file, { 'Content-Type': contentType });
  } catch {
    return send(response, 404, '找不到檔案');
  }
});

server.listen(port, () => {
  console.log(`語音記事測試服務已啟動：http://localhost:${port}`);
});
