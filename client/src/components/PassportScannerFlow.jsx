import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, RefreshCcw, Upload } from 'lucide-react';

export const PassportScanState = Object.freeze({
  PICK_IMAGE: 'PICK_IMAGE',
  PROCESSING: 'PROCESSING',
  VERIFYING: 'VERIFYING'
});

const emptyForm = {
  passportNumber: '',
  fullName: '',
  nationalityCode: '',
  birthDate: '',
  sex: ''
};

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const defaultLabels = {
  passportReviewHint: 'Some details could not be verified. Check the fields against your passport before applying them.',
  passportModalTitle: 'Passport Photo Upload',
  passportModalClose: 'Close',
  passportModalIntro: 'Use your device camera to photograph the passport information page, or choose a clear image from your library. We will read it and fill the form automatically.',
  passportModalPick: 'Take or upload passport photo',
  passportModalProcessing: 'Saving photo and reading passport information...',
  passportModalConfirm: 'Apply to form',
  passportModalRetake: 'Retake',
  passportModalSavedHint: 'The photo is stored on the backend and is only visible in the admin console.',
  passportFileTooLarge: 'Image is too large. Please upload a passport photo under 12MB.',
  passportFileInvalid: 'Please choose an image file.',
  ocrStageUploading: 'Uploading photo...',
  ocrStageUploaded: 'Photo saved',
  ocrStageLoading: 'Starting recognition engine...',
  ocrStageCompressed: 'Image prepared for recognition',
  ocrStageRecognizing: 'Reading passport ({pass}/{totalPasses})...',
  ocrStageMatched: 'Passport data found, finishing up...'
};

// 每個階段對應的粗略完成度；識別階段依嘗試次數細分。
const STAGE_PROGRESS = {
  uploading: 0.08,
  uploaded: 0.2,
  loading: 0.3,
  compressed: 0.4,
  recognizing: 0.5,
  matched: 0.95
};

const formatStageLabel = (copy, event) => {
  if (!event?.stage) return copy.passportModalProcessing;
  const key = `ocrStage${event.stage.charAt(0).toUpperCase()}${event.stage.slice(1)}`;
  const template = copy[key];
  if (!template) return copy.passportModalProcessing;
  return template
    .replace('{pass}', String(event.pass ?? 1))
    .replace('{totalPasses}', String(event.totalPasses ?? 1));
};

const stageProgressValue = (event) => {
  const base = STAGE_PROGRESS[event?.stage];
  if (base === undefined) return null;
  if (event.stage !== 'recognizing') return base;
  // 識別佔 0.5→0.9 這段，依當前是第幾次嘗試往前推進。
  const total = Math.max(1, Number(event.totalPasses) || 1);
  const current = Math.max(1, Number(event.pass) || 1);
  return base + (0.4 * ((current - 1) / total));
};

const pickFirst = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result?.toString() || '');
  reader.onerror = () => reject(new Error('PASSPORT_IMAGE_READ_FAILED'));
  reader.readAsDataURL(file);
});

export default function PassportScannerFlow({ isOpen, onClose, uploadAndOcrPassport, onApply, labels = defaultLabels }) {
  const copy = { ...defaultLabels, ...labels };
  const fileInputRef = useRef(null);
  const [scanState, setScanState] = useState(PassportScanState.PICK_IMAGE);
  const [base64Image, setBase64Image] = useState('');
  const [uploadedPhoto, setUploadedPhoto] = useState('');
  const [detectedForm, setDetectedForm] = useState(emptyForm);
  const [errorMessage, setErrorMessage] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [progressEvent, setProgressEvent] = useState(null);

  const resetFlow = useCallback(() => {
    setScanState(PassportScanState.PICK_IMAGE);
    setBase64Image('');
    setUploadedPhoto('');
    setDetectedForm(emptyForm);
    setNeedsReview(false);
    setErrorMessage('');
    setProgressEvent(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetFlow();
    }
  }, [isOpen, resetFlow]);

  const handleFilePick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setErrorMessage('');

    if (file.type && !file.type.startsWith('image/')) {
      setErrorMessage(copy.passportFileInvalid);
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setErrorMessage(copy.passportFileTooLarge);
      return;
    }

    setScanState(PassportScanState.PROCESSING);
    setProgressEvent({ stage: 'uploading' });

    try {
      const dataUrl = await fileToDataUrl(file);
      setBase64Image(dataUrl);
      const ocr = await uploadAndOcrPassport(dataUrl, { strict: true }, setProgressEvent);
      setUploadedPhoto(ocr.passportPhoto || '');
      setNeedsReview(Boolean(ocr.needsReview));
      setDetectedForm({
        passportNumber: pickFirst(ocr.passportNumber, ocr.mrzPassportNumber) || '',
        fullName: ocr.fullName || '',
        nationalityCode: pickFirst(ocr.nationalityCode, ocr.mrzNationality) || '',
        birthDate: pickFirst(ocr.birthDate, ocr.mrzBirthDate) || '',
        sex: pickFirst(ocr.sex, ocr.mrzSex) || ''
      });
      setScanState(PassportScanState.VERIFYING);
    } catch (error) {
      setErrorMessage(error?.message || copy.ocrFailed || 'OCR failed. Please try again.');
      setScanState(PassportScanState.PICK_IMAGE);
    } finally {
      setProgressEvent(null);
    }
  };

  const handleConfirm = () => {
    onApply?.({
      ...detectedForm,
      image: uploadedPhoto || base64Image
    });
    onClose?.();
  };

  const handleClose = () => {
    onClose?.();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-xl max-h-[92vh] bg-white rounded-t-3xl sm:rounded-3xl p-5 overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{copy.passportModalTitle}</h3>
          <button onClick={handleClose} className="text-sm text-slate-500 font-semibold">{copy.passportModalClose}</button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />

        {scanState === PassportScanState.PICK_IMAGE && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm text-slate-700">
              {copy.passportModalIntro}
            </div>
            <button
              onClick={handleFilePick}
              className="w-full p-8 border-2 border-dashed border-slate-300 rounded-2xl text-slate-600 hover:border-slate-500 transition-colors"
            >
              <div className="flex flex-col items-center gap-3">
                <Camera className="w-8 h-8" />
                <span className="text-sm font-semibold">{copy.passportModalPick}</span>
              </div>
            </button>
            {errorMessage && <p className="text-xs text-rose-600">{errorMessage}</p>}
          </div>
        )}

        {scanState === PassportScanState.PROCESSING && (() => {
          const ratio = stageProgressValue(progressEvent);
          const percent = ratio === null ? null : Math.round(ratio * 100);
          return (
            <div className="py-10 flex flex-col items-center gap-4 text-slate-600">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
              <p className="text-sm font-medium text-center px-4" aria-live="polite">
                {formatStageLabel(copy, progressEvent)}
              </p>
              <div
                className="w-full max-w-xs h-1.5 rounded-full bg-slate-200 overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                {...(percent === null ? {} : { 'aria-valuenow': percent })}
              >
                <div
                  className="h-full bg-emerald-600 transition-[width] duration-500 ease-out"
                  style={{ width: `${percent === null ? 5 : percent}%` }}
                />
              </div>
            </div>
          );
        })()}

        {scanState === PassportScanState.VERIFYING && (
          <div className="space-y-3">
            {base64Image && (
              <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50">
                <img src={base64Image} alt="Passport preview" className="w-full max-h-64 object-contain bg-slate-100" />
              </div>
            )}
            {needsReview && <p role="status" className="p-3 rounded-xl bg-amber-50 text-amber-800 text-sm">{copy.passportReviewHint}</p>}
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
              <button onClick={handleConfirm} className="py-3 rounded-xl bg-emerald-600 text-white font-semibold flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4" />{copy.passportModalConfirm}</button>
              <button onClick={handleFilePick} className="py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold flex items-center justify-center gap-2"><RefreshCcw className="w-4 h-4" />{copy.passportModalRetake}</button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Upload className="w-3.5 h-3.5" />
          <span>{copy.passportModalSavedHint}</span>
        </div>
      </div>
    </div>
  );
}
