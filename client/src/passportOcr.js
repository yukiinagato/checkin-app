const PASSPORT_KEYWORDS = ['passport', 'pasport', 'passeport', '旅券', '护照', '護照'];
const DOC_HINTS = ['nationality', 'surname', 'given', 'sex', 'date of birth', 'issuing'];
const TESSERACT_CDN_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

const normalizeText = (value = '') => value.toUpperCase().replace(/\s+/g, ' ').trim();

const extractMrzPassportNumber = (rawText = '') => {
  const lines = rawText
    .toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ''))
    .filter(Boolean);

  for (const line of lines) {
    if (!line.includes('<<')) continue;
    const cleaned = line.replace(/[^A-Z0-9<]/g, '');
    const match = cleaned.match(/[A-Z0-9<]{8,9}[0-9]/);
    if (!match) continue;
    const candidate = match[0].replace(/</g, '');
    if (candidate.length >= 6 && candidate.length <= 10) {
      return candidate;
    }
  }

  return '';
};

const extractLabeledPassportNumber = (rawText = '') => {
  const normalized = rawText.toUpperCase().replace(/\s+/g, ' ');
  const labeledMatch = normalized.match(/PASSPORT\s*(NO|NUMBER)?\s*[:：]?\s*([A-Z0-9]{6,10})/);
  return labeledMatch?.[2] || '';
};

export const extractPassportNumberFromText = (rawText = '') => {
  const fromLabel = extractLabeledPassportNumber(rawText);
  if (fromLabel) return fromLabel;
  return extractMrzPassportNumber(rawText);
};

export const isLikelyPassportDocument = (rawText = '') => {
  const normalized = normalizeText(rawText).toLowerCase();
  const hasPassportKeyword = PASSPORT_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hintMatches = DOC_HINTS.filter((hint) => normalized.includes(hint)).length;
  const hasMrz = /[A-Z0-9<]{20,}/.test(rawText.toUpperCase()) && rawText.includes('<<');

  return hasPassportKeyword || hasMrz || hintMatches >= 2;
};

const canvasFromImage = async (file, transform = 'none') => {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);

  if (transform === 'grayscale') {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const v = avg > 155 ? 255 : 0;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  return canvas;
};

const loadTesseractFromCDN = () => {
  if (typeof window === 'undefined') {
    throw new Error('TESSERACT_WINDOW_UNAVAILABLE');
  }

  if (window.Tesseract?.createWorker) {
    return Promise.resolve(window.Tesseract);
  }

  if (window.__tesseractScriptPromise) {
    return window.__tesseractScriptPromise;
  }

  window.__tesseractScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TESSERACT_CDN_SRC;
    script.async = true;
    script.onload = () => {
      if (window.Tesseract?.createWorker) {
        resolve(window.Tesseract);
      } else {
        reject(new Error('TESSERACT_INIT_FAILED'));
      }
    };
    script.onerror = () => reject(new Error('TESSERACT_CDN_LOAD_FAILED'));
    document.head.appendChild(script);
  });

  return window.__tesseractScriptPromise;
};

const detectTextWithTextDetector = async (canvas) => {
  const detector = new window.TextDetector();
  const blocks = await detector.detect(canvas);
  return blocks.map((block) => block.rawValue || '').join('\n');
};

const detectTextWithTesseract = async (canvas) => {
  const Tesseract = await loadTesseractFromCDN();
  const worker = await Tesseract.createWorker('eng');
  try {
    const { data } = await worker.recognize(canvas);
    return data?.text || '';
  } finally {
    await worker.terminate();
  }
};

const detectTextLocally = async (canvas) => {
  const hasTextDetector = typeof window !== 'undefined' && typeof window.TextDetector === 'function';

  if (hasTextDetector) {
    console.debug('[PassportOCR] detect-engine:text-detector');
    return detectTextWithTextDetector(canvas);
  }

  console.debug('[PassportOCR] detect-engine:tesseract-cdn-fallback');
  return detectTextWithTesseract(canvas);
};

export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
};

export const runLocalPassportOCR = async (file) => {
  const transforms = ['none', 'grayscale', 'none'];
  let bestText = '';

  if (typeof window === 'undefined') {
    return {
      success: false,
      isPassport: false,
      passportNumber: '',
      text: '',
      attempts: 0,
      unsupported: true
    };
  }

  console.debug('[PassportOCR] local-ocr-start', {
    name: file?.name,
    type: file?.type,
    size: file?.size,
    transforms
  });

  try {
    for (let attempt = 0; attempt < transforms.length; attempt += 1) {
      const canvas = await canvasFromImage(file, transforms[attempt]);
      const text = await detectTextLocally(canvas);
      bestText = text || bestText;
      const isPassport = isLikelyPassportDocument(text);
      const passportNumber = extractPassportNumberFromText(text);
      console.debug('[PassportOCR] attempt-finished', {
        attempt: attempt + 1,
        transform: transforms[attempt],
        textLength: text?.length || 0,
        isPassport,
        passportNumber
      });
      if (isPassport && passportNumber) {
        return { success: true, isPassport: true, passportNumber, text, attempts: attempt + 1 };
      }
      if (!isPassport && attempt === transforms.length - 1) {
        return { success: false, isPassport: false, passportNumber: '', text, attempts: transforms.length };
      }
    }
  } catch (error) {
    console.warn('[PassportOCR] local-ocr-unavailable', error);
    return {
      success: false,
      isPassport: false,
      passportNumber: '',
      text: '',
      attempts: 0,
      unsupported: true,
      reason: error?.message || 'UNKNOWN_OCR_ERROR'
    };
  }

  return {
    success: false,
    isPassport: isLikelyPassportDocument(bestText),
    passportNumber: extractPassportNumberFromText(bestText),
    text: bestText,
    attempts: transforms.length
  };
};
