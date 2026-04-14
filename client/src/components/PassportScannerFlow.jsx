import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, RotateCcw, Upload, UserPlus2, Users2 } from 'lucide-react';
import { useWebRTC } from '../hooks/useWebRTC';

export const ScannerState = Object.freeze({
  PERMISSION_REQUEST: 'PERMISSION_REQUEST',
  TIPS: 'TIPS',
  SCANNING: 'SCANNING',
  FALLBACK_UPLOAD: 'FALLBACK_UPLOAD',
  PROCESSING: 'PROCESSING',
  VERIFYING: 'VERIFYING',
  GUEST_LIST: 'GUEST_LIST'
});

const createEmptyPassport = () => ({
  passportNumber: '',
  surname: '',
  givenName: '',
  nationality: '',
  dateOfBirth: '',
  expiryDate: ''
});

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const checkImageQuality = async (base64) => {
  await sleep(100);
  if (!base64) return { passed: false, reason: 'empty_frame' };
  const randomGate = Math.random() > 0.55;
  return randomGate ? { passed: true } : { passed: false, reason: 'blur_or_glare' };
};

const uploadAndOcrPassport = async (base64) => {
  await sleep(1200);

  return {
    imageBase64: base64,
    fields: {
      passportNumber: 'E12345678',
      surname: 'WANG',
      givenName: 'XIAOMING',
      nationality: 'CHN',
      dateOfBirth: '1992-02-14',
      expiryDate: '2032-02-14'
    }
  };
};

const FieldInput = ({ label, value, onChange }) => (
  <label className="space-y-1">
    <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</span>
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
    />
  </label>
);

export default function PassportScannerFlow({ onNextStep }) {
  const { videoRef, startCamera, stopCamera, captureFrame, cameraError } = useWebRTC();
  const fileInputRef = useRef(null);
  const scanTimerRef = useRef(null);

  const [scannerState, setScannerState] = useState(ScannerState.PERMISSION_REQUEST);
  const [imageBase64, setImageBase64] = useState('');
  const [processingError, setProcessingError] = useState('');
  const [verifyingForm, setVerifyingForm] = useState(createEmptyPassport());
  const [guests, setGuests] = useState([]);

  const isScanning = scannerState === ScannerState.SCANNING;

  const resetScanTimer = useCallback(() => {
    if (scanTimerRef.current) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }, []);

  const transitionToFallback = useCallback(() => {
    resetScanTimer();
    stopCamera();
    setScannerState(ScannerState.FALLBACK_UPLOAD);
  }, [resetScanTimer, stopCamera]);

  const startPermissionFlow = useCallback(async () => {
    const result = await startCamera();
    if (result.ok) {
      setProcessingError('');
      setScannerState(ScannerState.TIPS);
      return;
    }

    transitionToFallback();
  }, [startCamera, transitionToFallback]);

  const handleFileSelected = useCallback(async (event) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    try {
      const base64 = await fileToBase64(selectedFile);
      setImageBase64(base64);
      setScannerState(ScannerState.PROCESSING);
    } catch (error) {
      setProcessingError(error?.message || '圖片讀取失敗，請重試。');
    } finally {
      event.target.value = '';
    }
  }, []);

  const triggerFallbackPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  useEffect(() => {
    if (!isScanning) {
      resetScanTimer();
      stopCamera();
      return undefined;
    }

    scanTimerRef.current = window.setInterval(async () => {
      const frameBase64 = captureFrame();
      if (!frameBase64) return;

      const quality = await checkImageQuality(frameBase64);
      if (!quality.passed) return;

      resetScanTimer();
      stopCamera();
      setImageBase64(frameBase64);
      setScannerState(ScannerState.PROCESSING);
    }, 500);

    return () => {
      resetScanTimer();
      stopCamera();
    };
  }, [isScanning, captureFrame, resetScanTimer, stopCamera]);

  useEffect(() => {
    if (scannerState !== ScannerState.PROCESSING) return;

    let cancelled = false;

    const processPassport = async () => {
      try {
        setProcessingError('');
        const result = await uploadAndOcrPassport(imageBase64);
        if (cancelled) return;

        setImageBase64(result.imageBase64);
        setVerifyingForm(result.fields);
        setScannerState(ScannerState.VERIFYING);
      } catch (error) {
        if (cancelled) return;
        setProcessingError(error?.message || 'OCR 識別失敗，請重新嘗試。');
        setScannerState(ScannerState.FALLBACK_UPLOAD);
      }
    };

    processPassport();

    return () => {
      cancelled = true;
    };
  }, [imageBase64, scannerState]);

  const statusHint = useMemo(() => {
    if (cameraError?.message) return `相機狀態：${cameraError.message}`;
    if (processingError) return processingError;
    return '支援即時掃描與手動上傳雙模式';
  }, [cameraError?.message, processingError]);

  const addCurrentGuest = () => {
    setGuests((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        ...verifyingForm,
        imageBase64
      }
    ]);
    setScannerState(ScannerState.GUEST_LIST);
  };

  const restartCapture = async () => {
    setProcessingError('');
    const startResult = await startCamera();
    if (startResult.ok) {
      setScannerState(ScannerState.SCANNING);
      return;
    }

    setScannerState(ScannerState.FALLBACK_UPLOAD);
  };

  return (
    <section className="mx-auto w-full max-w-md rounded-3xl bg-white p-4 shadow-xl shadow-slate-200/70 md:p-6">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />

      <div className="mb-4 rounded-2xl bg-slate-900 px-4 py-3 text-xs text-slate-100">{statusHint}</div>

      {scannerState === ScannerState.PERMISSION_REQUEST && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">允許相機存取</h2>
          <p className="text-sm leading-relaxed text-slate-600">我們需要使用您的相機來掃描護照資訊，請在接下來的彈窗中允許相機權限。</p>
          <button onClick={startPermissionFlow} className="w-full rounded-2xl bg-emerald-600 px-4 py-3 font-semibold text-white shadow-lg shadow-emerald-100 transition hover:bg-emerald-700">
            去授權並開啟相機
          </button>
          <button onClick={transitionToFallback} className="w-full rounded-2xl border border-slate-200 px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-50">
            無法開啟？點擊手動上傳
          </button>
        </div>
      )}

      {scannerState === ScannerState.TIPS && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">拍攝技巧</h2>
          <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
            請確保光線充足，避免反光，並將護照底部的兩行機讀碼（{'<<<<'}）對準取景框。
          </div>
          <button onClick={() => setScannerState(ScannerState.SCANNING)} className="w-full rounded-2xl bg-slate-900 px-4 py-3 font-semibold text-white transition hover:bg-slate-700">
            我知道了，開始掃描
          </button>
        </div>
      )}

      {scannerState === ScannerState.SCANNING && (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-3xl bg-black">
            <video ref={videoRef} playsInline muted className="aspect-[3/4] w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 bg-black/45" />
            <div className="absolute left-1/2 top-1/2 aspect-[1.42/1] w-[85%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 border-white/90 bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
              <div className="absolute left-3 right-3 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
            </div>
            <button onClick={transitionToFallback} className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-xl bg-white/90 px-3 py-2 text-xs font-semibold text-slate-800 shadow">
              <Upload className="h-4 w-4" /> 手動拍照/上傳
            </button>
          </div>
          <p className="text-center text-xs text-slate-500">系統每 500ms 會自動抽幀檢測畫質，通過即進入識別。</p>
        </div>
      )}

      {scannerState === ScannerState.FALLBACK_UPLOAD && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">手動上傳護照</h2>
          <p className="text-sm text-slate-600">請拍攝或上傳護照資訊頁。</p>
          <button
            onClick={triggerFallbackPicker}
            className="group flex w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-slate-600 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
          >
            <div className="rounded-full bg-white p-3 shadow">
              <Camera className="h-7 w-7" />
            </div>
            <span className="font-semibold">點擊拍照 / 選擇圖片</span>
            <span className="text-xs text-slate-500 group-hover:text-emerald-600">支援手機相機直接拍攝</span>
          </button>
          <button onClick={restartCapture} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            返回即時掃描
          </button>
        </div>
      )}

      {scannerState === ScannerState.PROCESSING && (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl bg-slate-50">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-sm text-slate-700">正在識別護照資訊，請稍候...</p>
        </div>
      )}

      {scannerState === ScannerState.VERIFYING && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">人工確認</h2>
          <div className="grid grid-cols-1 gap-3 rounded-2xl bg-slate-50 p-4">
            <FieldInput label="Passport Number" value={verifyingForm.passportNumber} onChange={(value) => setVerifyingForm((prev) => ({ ...prev, passportNumber: value }))} />
            <FieldInput label="Surname" value={verifyingForm.surname} onChange={(value) => setVerifyingForm((prev) => ({ ...prev, surname: value }))} />
            <FieldInput label="Given Name" value={verifyingForm.givenName} onChange={(value) => setVerifyingForm((prev) => ({ ...prev, givenName: value }))} />
            <FieldInput label="Nationality" value={verifyingForm.nationality} onChange={(value) => setVerifyingForm((prev) => ({ ...prev, nationality: value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={addCurrentGuest} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> 確認無誤
            </button>
            <button onClick={transitionToFallback} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <RotateCcw className="h-4 w-4" /> 重新拍攝/上傳
            </button>
          </div>
        </div>
      )}

      {scannerState === ScannerState.GUEST_LIST && (
        <div className="space-y-4">
          <h2 className="inline-flex items-center gap-2 text-xl font-bold text-slate-900">
            <Users2 className="h-5 w-5 text-emerald-600" /> 人員列表
          </h2>

          <div className="space-y-3">
            {guests.map((guest) => (
              <article key={guest.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-bold text-slate-800">{guest.surname} {guest.givenName}</p>
                <p className="mt-1 text-xs text-slate-500">護照號：{guest.passportNumber} · 國籍：{guest.nationality}</p>
              </article>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={restartCapture} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <UserPlus2 className="h-4 w-4" /> 繼續添加
            </button>
            <button
              onClick={() => onNextStep?.(guests)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
            >
              下一步
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
