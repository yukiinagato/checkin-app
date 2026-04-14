import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Loader2, Upload, RefreshCcw, CheckCircle2, Users, ScanLine } from 'lucide-react';
import { useWebRTC } from '../hooks/useWebRTC';

export const PassportScanState = Object.freeze({
  PERMISSION_REQUEST: 'PERMISSION_REQUEST',
  TIPS: 'TIPS',
  SCANNING: 'SCANNING',
  FALLBACK_UPLOAD: 'FALLBACK_UPLOAD',
  PROCESSING: 'PROCESSING',
  VERIFYING: 'VERIFYING',
  GUEST_LIST: 'GUEST_LIST'
});

const emptyForm = {
  passportNumber: '',
  fullName: '',
  nationalityCode: '',
  birthDate: '',
  sex: ''
};

const normalizeValue = (value) => String(value || '').trim().toUpperCase();

const pickFirst = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');

const normalizeBirthDate = (value) => {
  const raw = normalizeValue(value).replace(/\s+/g, '');
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 6) return digits;
  if (digits.length === 8) {
    // YYYYMMDD -> YYMMDD
    if (/^(19|20)/.test(digits)) {
      return `${digits.slice(2, 4)}${digits.slice(4, 6)}${digits.slice(6, 8)}`;
    }
    // DDMMYYYY -> YYMMDD
    return `${digits.slice(6, 8)}${digits.slice(2, 4)}${digits.slice(0, 2)}`;
  }
  const dmy = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{2,4})$/);
  if (dmy) {
    const yy = dmy[3].slice(-2);
    return `${yy}${dmy[2]}${dmy[1]}`;
  }
  const ymd = raw.match(/^(\d{4})[./-](\d{2})[./-](\d{2})$/);
  if (ymd) {
    return `${ymd[1].slice(-2)}${ymd[2]}${ymd[3]}`;
  }
  return digits;
};

const MRZ_WEIGHTS = [7, 3, 1];
const OCR_AMBIGUITY_MAP = {
  '0': ['0', 'O', 'Q', 'D'],
  '1': ['1', 'I', 'L'],
  '2': ['2', 'Z'],
  '5': ['5', 'S'],
  '6': ['6', 'G'],
  '8': ['8', 'B'],
  O: ['O', '0', 'Q', 'D'],
  Q: ['Q', '0', 'O'],
  D: ['D', '0', 'O'],
  I: ['I', '1', 'L'],
  L: ['L', '1', 'I'],
  Z: ['Z', '2'],
  S: ['S', '5'],
  G: ['G', '6'],
  B: ['B', '8']
};

const getMrzValue = (ch) => {
  if (ch === '<') return 0;
  if (/[0-9]/.test(ch)) return Number(ch);
  if (/[A-Z]/.test(ch)) return ch.charCodeAt(0) - 55;
  return 0;
};

const getMrzCheckDigit = (input) => {
  const cleaned = normalizeValue(input).replace(/[^A-Z0-9<]/g, '<');
  const sum = cleaned.split('').reduce((acc, ch, idx) => acc + getMrzValue(ch) * MRZ_WEIGHTS[idx % 3], 0);
  return String(sum % 10);
};

const enumerateAmbiguousCandidates = (raw, limit = 120) => {
  const chars = normalizeValue(raw).split('');
  let acc = [''];
  for (const ch of chars) {
    const options = OCR_AMBIGUITY_MAP[ch] || [ch];
    const next = [];
    for (const prefix of acc) {
      for (const option of options) {
        next.push(prefix + option);
        if (next.length >= limit) break;
      }
      if (next.length >= limit) break;
    }
    acc = next;
    if (acc.length >= limit) break;
  }
  return [...new Set(acc)];
};

const resolveWithCheckDigit = (rawField, rawCheck) => {
  const field = normalizeValue(rawField).replace(/[^A-Z0-9<]/g, '<');
  const check = normalizeValue(rawCheck).replace(/[^0-9A-Z]/g, '').slice(0, 1);
  const checkCandidates = enumerateAmbiguousCandidates(check || '0', 12).filter((candidate) => /[0-9]/.test(candidate));
  const fieldCandidates = enumerateAmbiguousCandidates(field, 120);
  const valid = fieldCandidates.find((candidate) => checkCandidates.includes(getMrzCheckDigit(candidate)));
  if (valid) return { value: valid, valid: true };
  return { value: field, valid: false };
};

const parseMrzFromText = (text) => {
  if (!text) return null;
  const lines = text
    .split('\n')
    .map((line) => normalizeValue(line).replace(/\s+/g, ''))
    .filter(Boolean);

  const nameLine = lines.find((line) => line.includes('<<') && line.includes('P<')) || '';
  const numberLine = lines.find((line) => line.includes('<<') && /[0-9]/.test(line)) || '';
  if (!numberLine) return null;

  const compact = numberLine.replace(/[^A-Z0-9<]/g, '');
  const match = compact.match(/([A-Z0-9<]{9})([0-9A-Z])<<([0-9A-Z]{6})([0-9A-Z])([MFX<])/);
  if (!match) return null;

  const [, rawPassport, rawPassportCheck, rawBirthDate, rawBirthCheck, rawSex] = match;
  const passport = resolveWithCheckDigit(rawPassport, rawPassportCheck);
  const birthDate = resolveWithCheckDigit(rawBirthDate, rawBirthCheck);
  const normalizedName = nameLine ? nameLine.split('<<').slice(1).join(' ').replace(/</g, ' ').replace(/\s+/g, ' ').trim() : '';
  const issuingState = (nameLine.match(/^P<([A-Z<]{1,3})/)?.[1] || '').replace(/</g, '');

  return {
    passportNumber: passport.value.replace(/</g, ''),
    birthDate: birthDate.value.replace(/</g, ''),
    sex: rawSex === '<' ? '' : rawSex,
    nationalityCode: issuingState,
    fullName: normalizedName,
    checksumValid: passport.valid && birthDate.valid
  };
};

const buildObservation = (ocrRaw) => {
  const viz = ocrRaw?.viz || {};
  const mrz = ocrRaw?.mrz || {};
  const parsedMrz = parseMrzFromText(ocrRaw?.text);
  return {
    isPassport: Boolean(ocrRaw?.isPassport || parsedMrz?.checksumValid),
    fullName: normalizeValue(pickFirst(ocrRaw?.fullName, viz?.fullName, viz?.name)),
    birthDate: normalizeBirthDate(pickFirst(ocrRaw?.birthDate, viz?.birthDate, viz?.dateOfBirth, mrz?.birthDate, parsedMrz?.birthDate)),
    nationalityCode: normalizeValue(pickFirst(ocrRaw?.nationalityCode, viz?.nationalityCode, mrz?.nationalityCode, parsedMrz?.nationalityCode)),
    sex: normalizeValue(pickFirst(ocrRaw?.sex, viz?.sex, mrz?.sex, parsedMrz?.sex)),
    passportNumber: normalizeValue(pickFirst(ocrRaw?.passportNumber, viz?.passportNumber, mrz?.passportNumber, parsedMrz?.passportNumber)),
    mrzPassportNumber: normalizeValue(pickFirst(ocrRaw?.mrzPassportNumber, mrz?.passportNumber, parsedMrz?.passportNumber)),
    mrzBirthDate: normalizeBirthDate(pickFirst(ocrRaw?.mrzBirthDate, mrz?.birthDate, parsedMrz?.birthDate)),
    mrzNationality: normalizeValue(pickFirst(ocrRaw?.mrzNationality, mrz?.nationalityCode, parsedMrz?.nationalityCode)),
    mrzSex: normalizeValue(pickFirst(ocrRaw?.mrzSex, mrz?.sex, parsedMrz?.sex)),
    mrzFullName: normalizeValue(pickFirst(ocrRaw?.mrzFullName, mrz?.fullName, mrz?.name, parsedMrz?.fullName)),
    confidence: Number(ocrRaw?.confidence ?? 0.65),
    checksumValid: Boolean(parsedMrz?.checksumValid)
  };
};

const updateWeightedVote = (bucket, key, weight) => {
  if (!key) return;
  bucket.set(key, (bucket.get(key) || 0) + weight);
};

const getTopVote = (bucket) => {
  let topKey = '';
  let topScore = 0;
  let total = 0;
  bucket.forEach((score, key) => {
    total += score;
    if (score > topScore) {
      topScore = score;
      topKey = key;
    }
  });
  return {
    value: topKey,
    score: topScore,
    ratio: total > 0 ? topScore / total : 0
  };
};

const createEmptyAccumulator = () => ({
  attempts: 0,
  votes: {
    fullName: new Map(),
    birthDate: new Map(),
    nationalityCode: new Map(),
    sex: new Map(),
    passportNumber: new Map(),
    mrzPassportNumber: new Map(),
    mrzBirthDate: new Map(),
    mrzNationality: new Map(),
    mrzSex: new Map(),
    mrzFullName: new Map()
  }
});

const checkImageQuality = async (base64, recognizeFrame, accumulatorRef) => {
  const ocrRaw = await recognizeFrame(base64);
  const observation = buildObservation(ocrRaw || {});
  if (!observation.isPassport) {
    return { passed: false, reason: 'NOT_PASSPORT' };
  }

  const acc = accumulatorRef.current;
  acc.attempts += 1;

  const baseWeight = Math.min(Math.max(observation.confidence || 0.65, 0.25), 0.99);
  const mrzBonus = observation.mrzPassportNumber && observation.mrzBirthDate ? 0.18 : 0;
  const checksumBonus = observation.checksumValid ? 0.2 : 0;
  const weight = baseWeight + mrzBonus + checksumBonus;

  Object.keys(acc.votes).forEach((field) => {
    updateWeightedVote(acc.votes[field], observation[field], weight);
  });

  const consensus = {
    fullName: getTopVote(acc.votes.fullName),
    birthDate: getTopVote(acc.votes.birthDate),
    nationalityCode: getTopVote(acc.votes.nationalityCode),
    sex: getTopVote(acc.votes.sex),
    passportNumber: getTopVote(acc.votes.passportNumber),
    mrzPassportNumber: getTopVote(acc.votes.mrzPassportNumber),
    mrzBirthDate: getTopVote(acc.votes.mrzBirthDate),
    mrzNationality: getTopVote(acc.votes.mrzNationality),
    mrzSex: getTopVote(acc.votes.mrzSex),
    mrzFullName: getTopVote(acc.votes.mrzFullName)
  };

  const hasCoreFields = Boolean(
    consensus.fullName.value &&
    consensus.birthDate.value &&
    consensus.nationalityCode.value &&
    consensus.sex.value &&
    consensus.passportNumber.value
  );
  const hasMrzFields = Boolean(
    consensus.mrzPassportNumber.value &&
    consensus.mrzBirthDate.value &&
    consensus.mrzNationality.value &&
    consensus.mrzSex.value
  );
  const crossValidated = Boolean(
    hasCoreFields &&
    hasMrzFields &&
    consensus.passportNumber.value === consensus.mrzPassportNumber.value &&
    consensus.birthDate.value === consensus.mrzBirthDate.value &&
    consensus.nationalityCode.value === consensus.mrzNationality.value &&
    consensus.sex.value === consensus.mrzSex.value &&
    (!consensus.mrzFullName.value || consensus.fullName.value === consensus.mrzFullName.value)
  );

  const reliability = (
    consensus.fullName.ratio * 0.18 +
    consensus.birthDate.ratio * 0.2 +
    consensus.nationalityCode.ratio * 0.16 +
    consensus.sex.ratio * 0.12 +
    consensus.passportNumber.ratio * 0.22 +
    consensus.mrzPassportNumber.ratio * 0.12
  );

  const passed = acc.attempts >= 3 && crossValidated && reliability >= 0.82 && observation.checksumValid;

  return {
    passed,
    attempts: acc.attempts,
    reliability,
    reason: passed ? '' : 'LOW_CONFIDENCE_OR_MISMATCH',
    data: {
      fullName: consensus.fullName.value,
      birthDate: consensus.birthDate.value,
      nationalityCode: consensus.nationalityCode.value,
      sex: consensus.sex.value,
      passportNumber: consensus.passportNumber.value
    }
  };
};

export default function PassportScannerFlow({ isOpen, onClose, uploadAndOcrPassport, onApply }) {
  const {
    videoRef,
    canvasRef,
    isSupported,
    isStarting,
    startCamera,
    stopCamera,
    captureFrame
  } = useWebRTC();

  const fileInputRef = useRef(null);
  const scanTimerRef = useRef(null);
  const scanningStartedAtRef = useRef(0);
  const lastRequestAtRef = useRef(0);
  const requestIntervalMsRef = useRef(3000);
  const overlapAttemptsRef = useRef(0);
  const pendingRequestsRef = useRef(0);
  const pausedByBackpressureRef = useRef(false);
  const hasCompletedRef = useRef(false);

  const [scanState, setScanState] = useState(PassportScanState.PERMISSION_REQUEST);
  const [base64Image, setBase64Image] = useState('');
  const [detectedForm, setDetectedForm] = useState(emptyForm);
  const [guests, setGuests] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [scanHint, setScanHint] = useState('正在持续检测，请保持护照稳定。');
  const accumulatorRef = useRef(createEmptyAccumulator());
  const recognizedDuringScanRef = useRef(null);

  const isVisible = isOpen;

  const resetFlow = () => {
    setScanState(PassportScanState.PERMISSION_REQUEST);
    setBase64Image('');
    setDetectedForm(emptyForm);
    setErrorMessage('');
    setScanHint('正在持续检测，请保持护照稳定。');
    accumulatorRef.current = createEmptyAccumulator();
    recognizedDuringScanRef.current = null;
    scanningStartedAtRef.current = 0;
    lastRequestAtRef.current = 0;
    requestIntervalMsRef.current = 3000;
    overlapAttemptsRef.current = 0;
    pendingRequestsRef.current = 0;
    pausedByBackpressureRef.current = false;
    hasCompletedRef.current = false;
  };

  useEffect(() => {
    if (!isVisible) {
      stopCamera();
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }
      resetFlow();
    }
  }, [isVisible, stopCamera]);

  useEffect(() => {
    if (scanState !== PassportScanState.SCANNING && scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }

    if (scanState !== PassportScanState.SCANNING) {
      stopCamera();
    }
  }, [scanState, stopCamera]);

  const canRestartScan = useMemo(() => isSupported, [isSupported]);

  const handleRequestPermission = async () => {
    setErrorMessage('');
    try {
      await startCamera();
      setScanState(PassportScanState.TIPS);
    } catch (error) {
      setErrorMessage('相機開啟失敗，已自動切換為手動上傳。');
      setScanState(PassportScanState.FALLBACK_UPLOAD);
    }
  };

  const startScanningLoop = async () => {
    setErrorMessage('');
    setScanHint('已开启取景，先稳定画面 5 秒后开始识别。');
    accumulatorRef.current = createEmptyAccumulator();
    recognizedDuringScanRef.current = null;
    scanningStartedAtRef.current = Date.now();
    lastRequestAtRef.current = 0;
    requestIntervalMsRef.current = 3000;
    overlapAttemptsRef.current = 0;
    pendingRequestsRef.current = 0;
    pausedByBackpressureRef.current = false;
    hasCompletedRef.current = false;
    setScanState(PassportScanState.SCANNING);
    await startCamera();

    scanTimerRef.current = setInterval(async () => {
      if (hasCompletedRef.current) return;

      const frame = captureFrame();
      if (!frame) return;

      const now = Date.now();
      const warmupElapsed = now - scanningStartedAtRef.current;
      if (warmupElapsed < 5000) {
        const leftSeconds = Math.ceil((5000 - warmupElapsed) / 1000);
        setScanHint(`正在稳定取景，约 ${leftSeconds} 秒后开始OCR识别。`);
        return;
      }

      if (pausedByBackpressureRef.current) {
        if (pendingRequestsRef.current === 0) {
          pausedByBackpressureRef.current = false;
          overlapAttemptsRef.current = 0;
          requestIntervalMsRef.current = 12000;
          setScanHint('积压已清空，恢复低频识别。');
        } else {
          setScanHint(`后端繁忙：仍有 ${pendingRequestsRef.current} 个请求处理中，已暂停新请求。`);
          return;
        }
      }

      const intervalMs = requestIntervalMsRef.current;
      if (lastRequestAtRef.current && now - lastRequestAtRef.current < intervalMs) return;

      if (pendingRequestsRef.current > 0) {
        overlapAttemptsRef.current += 1;
        if (overlapAttemptsRef.current >= 3) {
          requestIntervalMsRef.current = 12000;
          setScanHint(`检测到请求堆积（${pendingRequestsRef.current}个未返回），已降频到每12秒一次。`);
        }
      }

      if (pendingRequestsRef.current >= 6) {
        pausedByBackpressureRef.current = true;
        setScanHint('未完成OCR请求累计达到6个，已暂停发送新请求，等待后端返回。');
        return;
      }

      lastRequestAtRef.current = now;
      pendingRequestsRef.current += 1;

      checkImageQuality(
        frame,
        (imageBase64) => uploadAndOcrPassport(imageBase64, { strict: false }),
        accumulatorRef
      )
        .then((result) => {
          if (!result.passed || hasCompletedRef.current) {
            const attemptText = result.attempts ? `（第 ${result.attempts} 次识别）` : '';
            setScanHint(`持续识别中${attemptText}：需匹配姓名/出生日期/国籍/性别与MRZ机读码。`);
            return;
          }

          hasCompletedRef.current = true;
          recognizedDuringScanRef.current = result.data;
          clearInterval(scanTimerRef.current);
          scanTimerRef.current = null;
          stopCamera();
          setBase64Image(frame);
          setScanState(PassportScanState.PROCESSING);
        })
        .catch(() => {
          setScanHint('识别中，正在自动重试...');
        })
        .finally(() => {
          pendingRequestsRef.current = Math.max(0, pendingRequestsRef.current - 1);
          if (pausedByBackpressureRef.current && pendingRequestsRef.current === 0) {
            pausedByBackpressureRef.current = false;
            overlapAttemptsRef.current = 0;
            requestIntervalMsRef.current = 12000;
            setScanHint('后端积压已清空，恢复低频识别。');
          }
        });
    }, 500);
  };

  const handleFilePick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setBase64Image(reader.result?.toString() || '');
      setScanState(PassportScanState.PROCESSING);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const run = async () => {
      if (scanState !== PassportScanState.PROCESSING || !base64Image) return;

      try {
        const ocr = await uploadAndOcrPassport(base64Image);
        const merged = {
          passportNumber: pickFirst(recognizedDuringScanRef.current?.passportNumber, ocr.passportNumber),
          fullName: pickFirst(recognizedDuringScanRef.current?.fullName, ocr.fullName),
          nationalityCode: pickFirst(recognizedDuringScanRef.current?.nationalityCode, ocr.nationalityCode),
          birthDate: pickFirst(recognizedDuringScanRef.current?.birthDate, ocr.birthDate),
          sex: pickFirst(recognizedDuringScanRef.current?.sex, ocr.sex)
        };
        setDetectedForm({
          passportNumber: merged.passportNumber || '',
          fullName: merged.fullName || '',
          nationalityCode: merged.nationalityCode || '',
          birthDate: merged.birthDate || '',
          sex: merged.sex || ''
        });
        setScanState(PassportScanState.VERIFYING);
      } catch (error) {
        setErrorMessage(error?.message || '識別失敗，請改用手動上傳重試。');
        setScanState(PassportScanState.FALLBACK_UPLOAD);
      }
    };

    run();
  }, [scanState, base64Image, uploadAndOcrPassport]);

  const handleConfirm = () => {
    const guest = {
      ...detectedForm,
      image: base64Image,
      id: crypto.randomUUID()
    };
    setGuests((prev) => [...prev, guest]);
    onApply?.(guest);
    setScanState(PassportScanState.GUEST_LIST);
  };

  const handleClose = () => {
    stopCamera();
    onClose?.();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-xl h-[92vh] sm:h-[90vh] bg-white rounded-t-3xl sm:rounded-3xl p-5 overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">護照掃描與上傳</h3>
          <button onClick={handleClose} className="text-sm text-slate-500 font-semibold">關閉</button>
        </div>

        {scanState === PassportScanState.PERMISSION_REQUEST && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">我們需要使用您的相機來掃描護照資訊，請在接下來的彈窗中允許相機權限。</p>
            <button onClick={handleRequestPermission} className="w-full py-3 rounded-xl bg-slate-900 text-white font-semibold flex items-center justify-center gap-2">
              <Camera className="w-4 h-4" /> 去授權並開啟相機
            </button>
            <button onClick={() => setScanState(PassportScanState.FALLBACK_UPLOAD)} className="w-full py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold">
              無法開啟？點擊手動上傳
            </button>
            {errorMessage && <p className="text-xs text-amber-600">{errorMessage}</p>}
          </div>
        )}

        {scanState === PassportScanState.TIPS && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <p className="text-sm text-slate-700">請確保光線充足，避免反光，並將護照底部的兩行機讀碼（{'<<<<'}）對準取景框。</p>
            </div>
            <button
              disabled={isStarting}
              onClick={startScanningLoop}
              className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold flex items-center justify-center gap-2 disabled:bg-emerald-300"
            >
              {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />} 我知道了，開始掃描
            </button>
          </div>
        )}

        {scanState === PassportScanState.SCANNING && (
          <div className="space-y-3">
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-[3/4]">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <div className="absolute inset-0 bg-slate-950/35" />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[78%] aspect-[1.42/1] border-2 border-white rounded-xl overflow-hidden shadow-[0_0_0_2000px_rgba(2,6,23,0.45)]">
                <div className="absolute inset-x-0 top-0 h-[2px] bg-emerald-300 animate-scan-line" />
              </div>
              <button
                onClick={() => setScanState(PassportScanState.FALLBACK_UPLOAD)}
                className="absolute right-3 bottom-3 px-3 py-2 rounded-lg bg-white/90 text-slate-700 text-xs font-semibold"
              >
                手動拍照/上傳
              </button>
            </div>
            <p className="text-xs text-slate-500">{scanHint}</p>
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}

        {scanState === PassportScanState.FALLBACK_UPLOAD && (
          <div className="space-y-4">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            <button onClick={handleFilePick} className="w-full p-8 border-2 border-dashed border-slate-300 rounded-2xl text-slate-500 hover:border-slate-500 transition-colors">
              <div className="flex flex-col items-center gap-3">
                <Upload className="w-8 h-8" />
                <span className="text-sm font-semibold">請拍攝或上傳護照資訊頁</span>
              </div>
            </button>
            {canRestartScan && (
              <button onClick={() => setScanState(PassportScanState.PERMISSION_REQUEST)} className="w-full py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold">
                返回即時掃描
              </button>
            )}
            {errorMessage && <p className="text-xs text-rose-600">{errorMessage}</p>}
          </div>
        )}

        {scanState === PassportScanState.PROCESSING && (
          <div className="py-10 flex flex-col items-center gap-3 text-slate-600">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            <p className="text-sm font-medium">正在識別護照資訊，請稍候...</p>
          </div>
        )}

        {scanState === PassportScanState.VERIFYING && (
          <div className="space-y-3">
            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
              <label className="text-xs text-slate-500 block">護照號</label>
              <input value={detectedForm.passportNumber} onChange={(e) => setDetectedForm((prev) => ({ ...prev, passportNumber: e.target.value }))} className="w-full p-3 rounded-xl border border-slate-200 text-sm" />
              <label className="text-xs text-slate-500 block">姓名</label>
              <input value={detectedForm.fullName} onChange={(e) => setDetectedForm((prev) => ({ ...prev, fullName: e.target.value }))} className="w-full p-3 rounded-xl border border-slate-200 text-sm" />
              <label className="text-xs text-slate-500 block">國籍</label>
              <input value={detectedForm.nationalityCode} onChange={(e) => setDetectedForm((prev) => ({ ...prev, nationalityCode: e.target.value }))} className="w-full p-3 rounded-xl border border-slate-200 text-sm" />
              <label className="text-xs text-slate-500 block">出生日期</label>
              <input value={detectedForm.birthDate} onChange={(e) => setDetectedForm((prev) => ({ ...prev, birthDate: e.target.value }))} className="w-full p-3 rounded-xl border border-slate-200 text-sm" />
              <label className="text-xs text-slate-500 block">性別</label>
              <input value={detectedForm.sex} onChange={(e) => setDetectedForm((prev) => ({ ...prev, sex: e.target.value }))} className="w-full p-3 rounded-xl border border-slate-200 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={handleConfirm} className="py-3 rounded-xl bg-emerald-600 text-white font-semibold flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4" />確認無誤</button>
              <button onClick={() => setScanState(PassportScanState.FALLBACK_UPLOAD)} className="py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold flex items-center justify-center gap-2"><RefreshCcw className="w-4 h-4" />重新拍攝/上傳</button>
            </div>
          </div>
        )}

        {scanState === PassportScanState.GUEST_LIST && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-700">
              <Users className="w-5 h-5" />
              <h4 className="font-semibold">已成功識別人員</h4>
            </div>
            <div className="space-y-2">
              {guests.map((guest) => (
                <div key={guest.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm space-y-1">
                  <p className="font-semibold text-slate-900">{guest.fullName || '未命名旅客'}</p>
                  <p className="text-slate-500">護照號：{guest.passportNumber || '-'}</p>
                  <p className="text-slate-500">國籍：{guest.nationalityCode || '-'}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setScanState(PassportScanState.PERMISSION_REQUEST)} className="py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold">繼續添加其他人</button>
              <button onClick={handleClose} className="py-3 rounded-xl bg-slate-900 text-white font-semibold">下一步</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
