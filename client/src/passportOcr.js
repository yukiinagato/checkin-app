const PASSPORT_KEYWORDS = ['passport', 'pasport', 'passeport', '旅券', '护照', '護照'];
const DOC_HINTS = ['nationality', 'surname', 'given', 'sex', 'date of birth', 'issuing'];
const TESSERACT_CDN_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

const MRZ_CHAR_SCORES = Object.freeze({
  '<': 0
});

const normalizeText = (value = '') => value.toUpperCase().replace(/\s+/g, ' ').trim();

const mrzCharValue = (char) => {
  if (MRZ_CHAR_SCORES[char] !== undefined) return MRZ_CHAR_SCORES[char];
  if (/[0-9]/.test(char)) return Number(char);
  if (/[A-Z]/.test(char)) return char.charCodeAt(0) - 55;
  return 0;
};

const computeMrzCheckDigit = (value = '') => {
  const weights = [7, 3, 1];
  const sum = value
    .split('')
    .reduce((acc, char, index) => acc + (mrzCharValue(char) * weights[index % 3]), 0);
  return String(sum % 10);
};

const normalizeMrzLines = (rawText = '') => rawText
  .toUpperCase()
  .split(/\r?\n/)
  .map((line) => line.replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, ''))
  .filter((line) => line.length >= 30);

const extractMrzPassportNumber = (rawText = '') => {
  const lines = normalizeMrzLines(rawText);

  for (let index = 0; index < lines.length - 1; index += 1) {
    const line1 = lines[index];
    const line2 = lines[index + 1];

    if (!line1.startsWith('P<') || line2.length < 10) {
      continue;
    }

    const passportNumberField = line2.slice(0, 9);
    const checkDigit = line2[9];

    if (!/[0-9]/.test(checkDigit)) {
      continue;
    }

    if (computeMrzCheckDigit(passportNumberField) !== checkDigit) {
      continue;
    }

    const normalizedPassportNumber = passportNumberField.replace(/</g, '');
    if (normalizedPassportNumber.length >= 6 && normalizedPassportNumber.length <= 9) {
      return normalizedPassportNumber;
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
  const fromMrz = extractMrzPassportNumber(rawText);
  if (fromMrz) return fromMrz;

  const fromLabel = extractLabeledPassportNumber(rawText);
  if (fromLabel) return fromLabel;

  return '';
};

export const isLikelyPassportDocument = (rawText = '') => {
  const normalized = normalizeText(rawText).toLowerCase();
  const hasPassportKeyword = PASSPORT_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hintMatches = DOC_HINTS.filter((hint) => normalized.includes(hint)).length;
  const upperRaw = rawText.toUpperCase();
  const mrzLines = upperRaw
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, ''))
    .filter((line) => line.length >= 25);
  const hasMrzPrefix = mrzLines.some((line) => line.startsWith('P<'));
  const hasMrzLineShape = mrzLines.some((line) => (line.match(/</g) || []).length >= 8 && /\d/.test(line));
  const hasMrz = hasMrzPrefix || hasMrzLineShape;

  const hasPassportNumberLikePattern = /\b[A-Z][0-9]{7,8}\b/.test(upperRaw);
  const hasDocumentHints = hintMatches >= 1 && hasPassportNumberLikePattern;

  return hasPassportKeyword || hasMrz || hintMatches >= 2 || hasDocumentHints;
};

const canvasFromImage = async (file, transform = 'none', crop = null) => {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');

  if (crop) {
    canvas.width = crop.width;
    canvas.height = crop.height;
  } else {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (crop) {
    ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  } else {
    ctx.drawImage(bitmap, 0, 0);
  }

  if (transform === 'grayscale') {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const v = avg > 150 ? 255 : 0;
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

const createTesseractWorker = async () => {
  const Tesseract = await loadTesseractFromCDN();
  return Tesseract.createWorker('eng');
};

const detectTextWithTesseract = async (worker, canvas, mrzMode = false) => {
  await worker.setParameters(
    mrzMode
      ? {
          tessedit_pageseg_mode: '6',
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'
        }
      : {
          tessedit_pageseg_mode: '3'
        }
  );
  const { data } = await worker.recognize(canvas);
  return data?.text || '';
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
  const attempts = [
    { transform: 'none', crop: 'mrz', mrzMode: true },
    { transform: 'grayscale', crop: 'mrz', mrzMode: true },
    { transform: 'none', crop: 'full', mrzMode: false },
    { transform: 'grayscale', crop: 'full', mrzMode: false }
  ];

  if (typeof window === 'undefined') {
    return { success: false, isPassport: false, passportNumber: '', text: '', attempts: 0, unsupported: true };
  }

  const useTextDetector = typeof window.TextDetector === 'function';
  let worker = null;

  console.debug('[PassportOCR] local-ocr-start', {
    name: file?.name,
    type: file?.type,
    size: file?.size,
    engine: useTextDetector ? 'text-detector' : 'tesseract'
  });

  try {
    if (!useTextDetector) {
      worker = await createTesseractWorker();
    }

    let bestText = '';

    const bitmap = await createImageBitmap(file);
    const mrzHeight = Math.max(120, Math.floor(bitmap.height * 0.35));
    const mrzCrop = { x: 0, y: bitmap.height - mrzHeight, width: bitmap.width, height: mrzHeight };

    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const crop = attempt.crop === 'mrz' ? mrzCrop : null;
      const canvas = await canvasFromImage(file, attempt.transform, crop);
      const text = useTextDetector
        ? await detectTextWithTextDetector(canvas)
        : await detectTextWithTesseract(worker, canvas, attempt.mrzMode);

      bestText = text || bestText;
      const isPassport = isLikelyPassportDocument(text);
      const passportNumber = extractPassportNumberFromText(text);

      console.debug('[PassportOCR] attempt-finished', {
        attempt: index + 1,
        transform: attempt.transform,
        crop: attempt.crop,
        textLength: text?.length || 0,
        isPassport,
        passportNumber
      });

      if (isPassport && passportNumber) {
        return { success: true, isPassport: true, passportNumber, text, attempts: index + 1 };
      }
    }

    return {
      success: false,
      isPassport: isLikelyPassportDocument(bestText),
      passportNumber: extractPassportNumberFromText(bestText),
      text: bestText,
      attempts: attempts.length
    };
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
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
};
