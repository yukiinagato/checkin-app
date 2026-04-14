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
  birthDate: ''
};

const checkImageQuality = async (base64) => {
  const minLength = 30_000;
  await new Promise((resolve) => setTimeout(resolve, 60));
  return base64.length > minLength;
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

  const [scanState, setScanState] = useState(PassportScanState.PERMISSION_REQUEST);
  const [base64Image, setBase64Image] = useState('');
  const [detectedForm, setDetectedForm] = useState(emptyForm);
  const [guests, setGuests] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');

  const isVisible = isOpen;

  const resetFlow = () => {
    setScanState(PassportScanState.PERMISSION_REQUEST);
    setBase64Image('');
    setDetectedForm(emptyForm);
    setErrorMessage('');
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
    setScanState(PassportScanState.SCANNING);
    await startCamera();

    scanTimerRef.current = setInterval(async () => {
      const frame = captureFrame();
      if (!frame) return;

      const passed = await checkImageQuality(frame);
      if (!passed) return;

      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
      stopCamera();
      setBase64Image(frame);
      setScanState(PassportScanState.PROCESSING);
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
        setDetectedForm({
          passportNumber: ocr.passportNumber || '',
          fullName: ocr.fullName || '',
          nationalityCode: ocr.nationalityCode || '',
          birthDate: ocr.birthDate || ''
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
            <p className="text-xs text-slate-500">系統會每 500ms 自動檢測畫質，通過後將自動進入識別。</p>
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
