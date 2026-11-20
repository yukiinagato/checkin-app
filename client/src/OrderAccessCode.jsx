import { useEffect, useState } from 'react';
const copy = {
  jp: {title:'このご予約の鍵ボックス暗証番号',period:'有効期間（日本時間）',loading:'暗証番号を確認しています…',retry:'再試行',error:'暗証番号を取得できません。予約サイトのメッセージでお問い合わせください。',order:'ご予約との照合が必要です。予約サイトのメッセージでお問い合わせください。',expired:'このご予約の有効期間は終了しました。',location:'設置場所：エントランスの左側の壁'},
  en: {title:'Key box code for your booking',period:'Valid period (Japan time)',loading:'Getting your code…',retry:'Retry',error:'Unable to get your code. Please contact us through your booking platform.',order:'Your registration needs to be matched to a booking. Please contact us through your booking platform.',expired:'The validity period for this booking has ended.',location:'Location: on the wall to the left of the entrance'},
  'zh-hans': {title:'本订单钥匙盒密码',period:'有效期限（日本时间）',loading:'正在获取密码…',retry:'重试',error:'暂时无法获取密码，请通过预订平台消息联系我们。',order:'需要匹配您的订单，请通过预订平台消息联系我们。',expired:'本订单密码有效期限已结束。',location:'位置：入口左侧墙面'},
  'zh-hant': {title:'本訂單鑰匙盒密碼',period:'有效期限（日本時間）',loading:'正在取得密碼…',retry:'重試',error:'暫時無法取得密碼，請透過預訂平台訊息聯絡我們。',order:'需要配對您的訂單，請透過預訂平台訊息聯絡我們。',expired:'本訂單密碼有效期限已結束。',location:'位置：入口左側牆面'},
  ko: {title:'예약별 열쇠 보관함 비밀번호',period:'유효 기간 (일본 시간)',loading:'비밀번호를 가져오는 중…',retry:'다시 시도',error:'비밀번호를 가져올 수 없습니다. 예약 플랫폼의 메시지 기능으로 연락해 주세요.',order:'등록 정보와 예약 확인이 필요합니다. 예약 플랫폼의 메시지 기능으로 연락해 주세요.',expired:'이 예약의 비밀번호 유효 기간이 종료되었습니다.',location:'위치: 입구 왼쪽 벽'}
};
const verificationCopy = {
 'zh-hans': {name:'登记信息尚未匹配预订人的全名。请补充或核对身份信息。',confirm:'去重后的登记人数已达到预订人数，但未匹配预订人的全名。请通过预订平台消息联系管理员，确认订单信息；也可拨打电话获得协助。',phone:'拨打电话获得协助'},
 'zh-hant': {name:'登記資料尚未匹配預訂人的全名。請補充或核對身分資料。',confirm:'去重後的登記人數已達預訂人數，但未匹配預訂人的全名。請透過預訂平台訊息聯絡管理員確認訂單資料；也可致電取得協助。',phone:'致電取得協助'},
 jp: {name:'登録情報にご予約者のフルネームが確認できません。宿泊者情報を追加・確認してください。',confirm:'重複を除いた登録人数は予約人数に達していますが、ご予約者のフルネームが一致しません。予約サイトのメッセージで管理人に予約内容をご確認いただくか、電話でお問い合わせください。',phone:'電話で問い合わせる'},
 en: {name:'The guest information has not matched the booker’s full name. Please add or check the guest information.',confirm:'The number of unique registered guests meets the booking count, but the booker’s full name has not matched. Contact the manager through your booking platform to confirm the booking details, or call for assistance.',phone:'Call for assistance'},
 ko: {name:'등록 정보에서 예약자의 전체 이름이 일치하지 않습니다. 숙박자 정보를 추가하거나 확인해 주세요.',confirm:'중복을 제외한 등록 인원이 예약 인원에 도달했지만 예약자의 전체 이름이 일치하지 않습니다. 예약 플랫폼의 메시지 기능으로 관리자에게 예약 정보를 확인하거나 전화로 도움을 요청해 주세요.',phone:'전화로 도움 요청'}
};
export const ACCESS_RECEIPT_KEY = 'checkin.accessReceipt';
export function readAccessReceipt() { try {return JSON.parse(localStorage.getItem(ACCESS_RECEIPT_KEY) || 'null');} catch {return null;} }
export default function OrderAccessCode({lang,receipt,reservationCode}) {
  const t=copy[lang] || copy.jp;
  const v=verificationCopy[lang] || verificationCopy.jp;
  const [result,setResult]=useState(null), [attempt,setAttempt]=useState(0);
  const matched=receipt && (!reservationCode || receipt.reservationCode===reservationCode);
  useEffect(()=>{
    const controller=new AbortController();let timer;
    setResult(null);
    if(!matched) {setResult({status:'reservation_required'});return()=>controller.abort();}
    const load=async(round=0)=>{
      try {
        const response=await fetch('/api/checkin/access-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recordId:receipt.recordId,receiptToken:receipt.receiptToken}),signal:controller.signal});
        const data=await response.json();
        if(!response.ok) throw new Error('Access unavailable');
        if(controller.signal.aborted)return;
        if(data.status==='pending' && round<4) {timer=setTimeout(()=>load(round+1),15000);return;}
        setResult(data);
      } catch {if(!controller.signal.aborted)setResult({status:'unavailable'});}
    };
    load();return()=>{controller.abort();clearTimeout(timer);};
  },[matched,receipt?.recordId,receipt?.receiptToken,attempt]);
  const format=ms=>new Intl.DateTimeFormat({jp:'ja-JP',en:'en-GB','zh-hans':'zh-CN','zh-hant':'zh-TW',ko:'ko-KR'}[lang] || 'ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ms));
  const ready=result?.status==='ready' && /^\d{6}$/.test(result.passcode);
  return <section className="w-full max-w-sm mb-6 rounded-2xl bg-white border border-emerald-200 p-6 text-left" aria-live="polite">
    <h2 className="font-bold text-lg">{t.title}</h2>
    {ready ? <><p className="font-mono text-4xl tracking-widest font-bold text-emerald-700 my-4">{result.passcode}</p><p className="font-bold text-sm">{t.period}</p><p className="text-sm mt-1">{format(result.startDate)}<br/>→ {format(result.endDate)}</p><p className="text-sm mt-3 text-slate-600">{t.location}</p></> : <><p className="text-sm mt-3">{!result ? t.loading : result.status==='reservation_required' ? t.order : result.status==='expired' ? t.expired : result.status==='order_confirmation_required' ? v.confirm : result.status==='name_verification_required' ? v.name : t.error}</p>{result?.status==='order_confirmation_required' && <a href="tel:+81721707138" className="block mt-3 text-emerald-700 font-bold">{v.phone}: +81 721-70-7138</a>}{result && !['reservation_required','expired','order_confirmation_required','name_verification_required'].includes(result.status) && <button type="button" onClick={()=>setAttempt(v=>v+1)} className="mt-3 text-emerald-700 font-bold">{t.retry}</button>}</>}
  </section>;
}
