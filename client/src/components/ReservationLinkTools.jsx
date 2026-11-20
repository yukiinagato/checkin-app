import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, QrCode, X, Download, ExternalLink } from 'lucide-react';
import { reservationUrl } from '../reservationLink.js';

export const CopyReservationLink = ({ url }) => {
  const [message, setMessage] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else {
        const input = document.createElement('textarea');
        input.value = url;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.append(input);
        input.select();
        try { if (!document.execCommand('copy')) throw new Error('copy failed'); }
        finally { input.remove(); }
      }
      setMessage('已复制');
    } catch { setMessage('复制失败，请选中链接复制'); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), 3000);
  };
  return <span className="inline-flex flex-col items-start gap-1">
    <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200"><Copy className="w-3.5 h-3.5" />复制链接</button>
    {message && <span role="status" className="text-xs text-emerald-700">{message}</span>}
  </span>;
};

export const ReservationLinkDialog = ({ reservation, onClose }) => {
  const ref = useRef(null);
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const url = reservationUrl(window.location.origin, reservation.reservation_code);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setImage('');
    QRCode.toDataURL(url, { width: 320, margin: 4, errorCorrectionLevel: 'M' })
      .then((data) => { if (!cancelled) setImage(data); })
      .catch(() => { if (!cancelled) setError('二维码生成失败，请复制链接。'); });
    return () => { cancelled = true; };
  }, [url]);
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="reservation-link-title" className="w-[calc(100%-2rem)] max-w-md rounded-3xl p-6 shadow-2xl backdrop:bg-slate-900/50">
    <div className="flex items-center justify-between gap-4">
      <h3 id="reservation-link-title" className="font-bold text-lg">入住链接与二维码</h3>
      <button type="button" onClick={onClose} aria-label="关闭二维码" className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
    </div>
    <p className="mt-2 text-sm text-slate-600">{reservation.guest_name} · {reservation.check_in_date} → {reservation.check_out_date}</p>
    {image ? <img src={image} alt="入住链接二维码" width="320" height="320" className="mx-auto my-3 max-w-full" /> : <p className="py-12 text-center text-slate-500">{error || '正在生成二维码…'}</p>}
    <label className="block text-xs text-slate-500 mb-1" htmlFor="reservation-link-url">入住链接</label>
    <input id="reservation-link-url" aria-label="入住链接" readOnly value={url} onFocus={(e) => e.target.select()} className="w-full p-3 border border-slate-200 rounded-xl text-xs select-all" />
    <div className="mt-4 flex flex-wrap items-start gap-2">
      <CopyReservationLink url={url} />
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-xs font-bold"><ExternalLink className="w-3.5 h-3.5" />打开链接</a>
      {image && <a href={image} download={`checkin-${reservation.reservation_code}.png`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-xs font-bold"><Download className="w-3.5 h-3.5" />下载二维码</a>}
    </div>
  </dialog>;
};

export const ReservationLinkActions = ({ reservation, onShowQr }) => {
  const url = reservationUrl(window.location.origin, reservation.reservation_code);
  return <div className="min-w-[230px] space-y-2">
    <a href={url} target="_blank" rel="noopener noreferrer" title={url} className="block max-w-[280px] truncate text-xs text-blue-700 underline">{url}</a>
    <div className="flex items-start gap-2">
      <CopyReservationLink url={url} />
      <button type="button" onClick={onShowQr} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200"><QrCode className="w-3.5 h-3.5" />二维码</button>
    </div>
  </div>;
};
