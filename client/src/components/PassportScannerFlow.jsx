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
  passportModalTitle: 'Passport Photo Upload',
  passportModalClose: 'Close',
  passportModalIntro: 'Use your device camera to photograph the passport information page, or choose a clear image from your library. We will read it and fill the form automatically.',
  passportModalPick: 'Take or upload passport photo',
  passportModalProcessing: 'Saving photo and reading passport information...',
  passportModalConfirm: 'Apply to form',
  passportModalRetake: 'Retake',
  passportModalSavedHint: 'The photo is stored on the backend and is only visible in the admin console.',
  passportFileTooLarge: 'Image is too large. Please upload a passport photo under 12MB.',
  passportFileInvalid: 'Please choose an image file.'
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

  const resetFlow = useCallback(() => {
    setScanState(PassportScanState.PICK_IMAGE);
    setBase64Image('');
    setUploadedPhoto('');
    setDetectedForm(emptyForm);
    setErrorMessage('');
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

    try {
      const dataUrl = await fileToDataUrl(file);
      setBase64Image(dataUrl);
      const ocr = await uploadAndOcrPassport(dataUrl);
      setUploadedPhoto(ocr.passportPhoto || '');
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

        {scanState === PassportScanState.PROCESSING && (
          <div className="py-10 flex flex-col items-center gap-3 text-slate-600">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            <p className="text-sm font-medium">{copy.passportModalProcessing}</p>
          </div>
        )}

        {scanState === PassportScanState.VERIFYING && (
          <div className="space-y-3">
            {base64Image && (
              <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50">
                <img src={base64Image} alt="Passport preview" className="w-full max-h-64 object-contain bg-slate-100" />
              </div>
            )}
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
