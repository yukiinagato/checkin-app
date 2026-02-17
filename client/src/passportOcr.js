const PASSPORT_KEYWORDS = ['passport', 'pasport', 'passeport', '旅券', '护照', '護照'];
const DOC_HINTS = ['nationality', 'surname', 'given', 'sex', 'date of birth', 'issuing'];

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

const detectTextLocally = async (canvas) => {
  if (typeof window === 'undefined' || typeof window.TextDetector !== 'function') {
    console.debug('[PassportOCR] TextDetector not available in this browser');
    throw new Error('TEXT_DETECTOR_UNAVAILABLE');
  }

  const detector = new window.TextDetector();
  const blocks = await detector.detect(canvas);
  return blocks.map((block) => block.rawValue || '').join('\n');
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

  if (typeof window === 'undefined' || typeof window.TextDetector !== 'function') {
    console.debug('[PassportOCR] local-ocr-unsupported');
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

  return {
    success: false,
    isPassport: isLikelyPassportDocument(bestText),
    passportNumber: extractPassportNumberFromText(bestText),
    text: bestText,
    attempts: transforms.length
  };
};
