const recordButton = document.querySelector('#recordButton');
const status = document.querySelector('#status');
const timer = document.querySelector('#timer');
const indicator = document.querySelector('#indicator');

const uploadTokenMeta = document.querySelector('meta[name="upload-token"]')?.content ?? '';
const uploadToken = uploadTokenMeta === '__UPLOAD_TOKEN__' ? '' : uploadTokenMeta;

let recorder;
let chunks = [];
let recordingStartedAt;
let timerId;
let latestRecording;

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function updateTimer() {
  timer.textContent = formatTime(Date.now() - recordingStartedAt);
}

async function startRecording() {
  if (!window.isSecureContext) {
    throw new Error('INSECURE_CONTEXT');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('UNSUPPORTED_BROWSER');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  recorder = new MediaRecorder(stream);

  recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
  recorder.addEventListener('stop', async () => {
    latestRecording = new Blob(chunks, { type: recorder.mimeType });
    stream.getTracks().forEach((track) => track.stop());
    await uploadRecording();
  });

  recorder.start();
  recordingStartedAt = Date.now();
  timerId = window.setInterval(updateTimer, 250);
  indicator.classList.add('active');
  recordButton.classList.add('recording');
  recordButton.textContent = '停止錄音';
  status.textContent = '錄音中';
}

function stopRecording() {
  recorder.stop();
  window.clearInterval(timerId);
  indicator.classList.remove('active');
  recordButton.classList.remove('recording');
  recordButton.textContent = '開始錄音';
}

recordButton.addEventListener('click', async () => {
  try {
    if (recorder?.state === 'recording') stopRecording();
    else await startRecording();
  } catch (error) {
    const messages = {
      NotAllowedError: '麥克風權限被拒絕。請在瀏覽器網址列的網站設定中，將「麥克風」改為允許後重新整理。',
      NotFoundError: '找不到可用的麥克風。請確認麥克風已連接，且沒有被其他程式占用。',
      NotReadableError: '麥克風目前正被其他程式使用。請關閉其他錄音或通話程式後再試。',
      INSECURE_CONTEXT: '目前不是安全連線。請從 http://localhost:3000 開啟頁面。',
      UNSUPPORTED_BROWSER: '目前瀏覽器不支援錄音。請改用 Safari、Chrome 或 Edge 開啟。',
    };
    status.textContent = messages[error.name] || messages[error.message] || '無法使用麥克風，請確認瀏覽器權限。';
  }
});

if (window.location.protocol === 'file:') {
  status.textContent = '請從 http://localhost:3000 開啟，才能使用上傳功能。';
  recordButton.disabled = true;
}

if (navigator.permissions?.query) {
  navigator.permissions.query({ name: 'microphone' }).then((permission) => {
    if (permission.state === 'denied') {
      status.textContent = '麥克風權限目前被拒絕。請到瀏覽器網站設定中改為允許，再重新整理。';
    }
  }).catch(() => {});
}

async function uploadRecording() {
  if (!latestRecording) return;
  recordButton.disabled = true;
  status.textContent = '錄音完成，正在自動上傳並轉成文字…';

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': latestRecording.type || 'audio/webm',
        ...(uploadToken ? { 'X-Auth-Token': uploadToken } : {}),
      },
      body: latestRecording,
    });
    if (!response.ok) throw new Error('Upload failed');
    const { filename, transcriptFilename } = await response.json();
    status.textContent = transcriptFilename
      ? `已上傳並完成轉文字：${transcriptFilename}`
      : `音檔已上傳：${filename}。已排入背景轉文字。`;
  } catch (error) {
    status.textContent = '上傳失敗。請從 http://localhost:3000 開啟頁面，並確認接收服務仍在執行。';
  } finally {
    recordButton.disabled = false;
  }
}
