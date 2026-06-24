import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/build/pdf.worker.mjs';

const els = {
  status: document.getElementById('status'),
  pdfInput: document.getElementById('pdfInput'),
  viewerWrap: document.getElementById('viewerWrap'),
  emptyState: document.getElementById('emptyState'),
  canvas: document.getElementById('pdfCanvas'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  pageInput: document.getElementById('pageInput'),
  pageCount: document.getElementById('pageCount'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  fitBtn: document.getElementById('fitBtn'),
  scrollSpeed: document.getElementById('scrollSpeed'),
  scrollSpeedText: document.getElementById('scrollSpeedText'),
  cameraBtn: document.getElementById('cameraBtn'),
  recordBtn: document.getElementById('recordBtn'),
  cameraPanel: document.getElementById('cameraPanel'),
  cameraPreview: document.getElementById('cameraPreview'),
  cameraLabel: document.getElementById('cameraLabel'),
  recordingDot: document.getElementById('recordingDot'),
  togglePreviewBtn: document.getElementById('togglePreviewBtn'),
  resultPanel: document.getElementById('resultPanel'),
  playback: document.getElementById('playback'),
  downloadLink: document.getElementById('downloadLink'),
  openVideoBtn: document.getElementById('openVideoBtn'),
  closeResultBtn: document.getElementById('closeResultBtn'),
};

const state = {
  pdfDoc: null,
  pageNum: 1,
  pageRendering: false,
  pendingPageNum: null,
  scale: 1.25,
  fileName: 'score',
  stream: null,
  recorder: null,
  chunks: [],
  lastBlobUrl: null,
  lastVideoUrl: null,
  scrollRAF: null,
  lastScrollTime: null,
};

function setStatus(message) {
  els.status.textContent = message;
}

function enablePdfControls(enabled) {
  [els.prevBtn, els.nextBtn, els.pageInput, els.zoomOutBtn, els.zoomInBtn, els.fitBtn].forEach((el) => {
    el.disabled = !enabled;
  });
}

function getSafeFileStem(name) {
  return name.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9가-힣_-]+/g, '_').slice(0, 60) || 'score';
}

async function loadPdf(file) {
  if (!file) return;
  state.fileName = getSafeFileStem(file.name);
  setStatus('PDF 불러오는 중...');

  const arrayBuffer = await file.arrayBuffer();
  state.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  state.pageNum = 1;
  state.scale = 1.25;

  els.pageCount.textContent = state.pdfDoc.numPages;
  els.pageInput.max = state.pdfDoc.numPages;
  els.pageInput.value = '1';
  els.emptyState.hidden = true;
  els.canvas.style.display = 'block';
  enablePdfControls(true);
  await renderPage(1);
  setStatus(`${file.name} · ${state.pdfDoc.numPages}페이지`);
}

async function renderPage(num) {
  if (!state.pdfDoc) return;

  state.pageRendering = true;
  const page = await state.pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: state.scale });
  const context = els.canvas.getContext('2d', { alpha: false });

  const outputScale = Math.max(window.devicePixelRatio || 1, 1);
  els.canvas.width = Math.floor(viewport.width * outputScale);
  els.canvas.height = Math.floor(viewport.height * outputScale);
  els.canvas.style.width = `${Math.floor(viewport.width)}px`;
  els.canvas.style.height = `${Math.floor(viewport.height)}px`;

  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
  await page.render({ canvasContext: context, viewport, transform }).promise;

  state.pageRendering = false;
  els.pageInput.value = String(num);
  els.prevBtn.disabled = num <= 1;
  els.nextBtn.disabled = num >= state.pdfDoc.numPages;

  if (state.pendingPageNum !== null) {
    const pending = state.pendingPageNum;
    state.pendingPageNum = null;
    queueRenderPage(pending);
  }
}

function queueRenderPage(num) {
  const target = Math.min(Math.max(num, 1), state.pdfDoc.numPages);
  if (state.pageRendering) {
    state.pendingPageNum = target;
  } else {
    state.pageNum = target;
    renderPage(target);
  }
}

function changePage(delta) {
  if (!state.pdfDoc) return;
  queueRenderPage(state.pageNum + delta);
  els.viewerWrap.scrollTop = 0;
}

function changeZoom(delta) {
  if (!state.pdfDoc) return;
  state.scale = Math.min(Math.max(state.scale + delta, 0.45), 4);
  queueRenderPage(state.pageNum);
}

async function fitWidth() {
  if (!state.pdfDoc) return;
  const page = await state.pdfDoc.getPage(state.pageNum);
  const baseViewport = page.getViewport({ scale: 1 });
  const availableWidth = els.viewerWrap.clientWidth - 32;
  state.scale = Math.min(Math.max(availableWidth / baseViewport.width, 0.45), 4);
  queueRenderPage(state.pageNum);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('이 브라우저는 카메라 접근을 지원하지 않습니다. 최신 Safari/Chrome/Edge에서 다시 시도하세요.');
    return;
  }

  try {
    setStatus('카메라 권한 요청 중...');
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    els.cameraPreview.srcObject = state.stream;
    els.cameraBtn.textContent = '카메라 끄기';
    els.recordBtn.disabled = false;
    els.cameraLabel.textContent = '카메라 준비됨';
    setStatus('카메라 준비 완료');
  } catch (error) {
    console.error(error);
    setStatus('카메라 권한 실패');
    alert(`카메라/마이크를 열 수 없습니다.\n\n${error.message}`);
  }
}

function stopCamera() {
  if (state.recorder?.state === 'recording') {
    state.recorder.stop();
  }
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  els.cameraPreview.srcObject = null;
  els.cameraBtn.textContent = '카메라 켜기';
  els.recordBtn.disabled = true;
  els.cameraLabel.textContent = '카메라 미리보기';
  els.recordingDot.classList.remove('is-live');
  setStatus('카메라 꺼짐');
}

function getSupportedMimeType() {
  if (!window.MediaRecorder) return '';
  const candidates = [
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function startRecording() {
  if (!state.stream) return;
  if (!window.MediaRecorder) {
    alert('이 브라우저는 MediaRecorder를 지원하지 않습니다. 최신 Safari/Chrome/Edge에서 시도하세요.');
    return;
  }

  state.chunks = [];
  const mimeType = getSupportedMimeType();
  const options = mimeType ? { mimeType } : undefined;
  state.recorder = new MediaRecorder(state.stream, options);

  state.recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.chunks.push(event.data);
    }
  };

  state.recorder.onstop = () => {
    const type = state.recorder.mimeType || mimeType || 'video/webm';
    const blob = new Blob(state.chunks, { type });
    const url = URL.createObjectURL(blob);
    state.lastVideoUrl = url;

    if (state.lastBlobUrl) URL.revokeObjectURL(state.lastBlobUrl);
    state.lastBlobUrl = url;

    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    els.playback.src = url;
    els.downloadLink.href = url;
    els.downloadLink.download = `${state.fileName || 'score'}_take_${timestamp}.${ext}`;
    els.resultPanel.hidden = false;

    els.recordBtn.textContent = '녹화 시작';
    els.recordBtn.classList.remove('is-recording');
    els.recordingDot.classList.remove('is-live');
    els.cameraLabel.textContent = '카메라 준비됨';
    setStatus('녹화 완료');
  };

  state.recorder.start(1000);
  els.recordBtn.textContent = '녹화 정지';
  els.recordBtn.classList.add('is-recording');
  els.recordingDot.classList.add('is-live');
  els.cameraLabel.textContent = '녹화 중';
  setStatus('녹화 중...');
}

function stopRecording() {
  if (state.recorder?.state === 'recording') {
    state.recorder.stop();
  }
}

function updateAutoScroll() {
  const speed = Number(els.scrollSpeed.value);
  els.scrollSpeedText.textContent = speed === 0 ? '꺼짐' : `${speed}px/s`;

  if (state.scrollRAF) {
    cancelAnimationFrame(state.scrollRAF);
    state.scrollRAF = null;
    state.lastScrollTime = null;
  }

  if (speed > 0) {
    const step = (time) => {
      if (!state.lastScrollTime) state.lastScrollTime = time;
      const deltaSeconds = (time - state.lastScrollTime) / 1000;
      state.lastScrollTime = time;
      els.viewerWrap.scrollTop += speed * deltaSeconds;
      state.scrollRAF = requestAnimationFrame(step);
    };
    state.scrollRAF = requestAnimationFrame(step);
  }
}

els.pdfInput.addEventListener('change', (event) => loadPdf(event.target.files[0]).catch((error) => {
  console.error(error);
  setStatus('PDF 불러오기 실패');
  alert(`PDF를 불러오지 못했습니다.\n\n${error.message}`);
}));

els.prevBtn.addEventListener('click', () => changePage(-1));
els.nextBtn.addEventListener('click', () => changePage(1));
els.zoomOutBtn.addEventListener('click', () => changeZoom(-0.15));
els.zoomInBtn.addEventListener('click', () => changeZoom(0.15));
els.fitBtn.addEventListener('click', fitWidth);

els.pageInput.addEventListener('change', () => {
  if (!state.pdfDoc) return;
  queueRenderPage(Number(els.pageInput.value));
  els.viewerWrap.scrollTop = 0;
});

els.cameraBtn.addEventListener('click', () => {
  if (state.stream) stopCamera();
  else startCamera();
});

els.recordBtn.addEventListener('click', () => {
  if (state.recorder?.state === 'recording') stopRecording();
  else startRecording();
});

els.togglePreviewBtn.addEventListener('click', () => {
  const collapsed = els.cameraPanel.classList.toggle('is-collapsed');
  els.togglePreviewBtn.textContent = collapsed ? '펼치기' : '접기';
});

els.closeResultBtn.addEventListener('click', () => {
  els.resultPanel.hidden = true;
});

els.openVideoBtn.addEventListener('click', () => {
  if (state.lastVideoUrl) window.open(state.lastVideoUrl, '_blank', 'noopener,noreferrer');
});

els.scrollSpeed.addEventListener('input', updateAutoScroll);

window.addEventListener('beforeunload', () => {
  stopCamera();
  if (state.lastBlobUrl) URL.revokeObjectURL(state.lastBlobUrl);
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
