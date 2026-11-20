import {useEffect,useState} from 'react';
const texts={
 'zh-hans':{title:'选择您的订单',hint:'请根据姓名首字母和预订平台选择订单。完成身份登记后，系统会核对预订人的全名。',empty:'没有找到近期未完成登记的订单。请通过预订平台联系我们，或使用订单号查找。',loading:'正在查找订单…',error:'暂时无法查找订单，请稍后重试。',retry:'重试',platform:'平台',selected:'已选择订单',change:'重新选择'},
 'zh-hant':{title:'選擇您的訂單',hint:'請依姓名首字母與預訂平台選擇訂單。完成身分登記後，系統會核對預訂人的全名。',empty:'找不到近期尚未完成登記的訂單。請透過預訂平台聯絡我們，或使用訂單號查找。',loading:'正在查找訂單…',error:'暫時無法查找訂單，請稍後重試。',retry:'重試',platform:'平台',selected:'已選擇訂單',change:'重新選擇'},
 jp:{title:'ご予約を選択してください',hint:'お名前の頭文字と予約サイトを確認して選択してください。宿泊者情報の登録後、ご予約者の氏名（フルネーム）を照合します。',empty:'未登録の最近のご予約が見つかりません。予約サイトのメッセージでお問い合わせいただくか、予約番号で検索してください。',loading:'ご予約を検索中…',error:'検索できませんでした。再試行してください。',retry:'再試行',platform:'予約サイト',selected:'選択したご予約',change:'選び直す'},
 en:{title:'Select your booking',hint:'Choose by the initials and booking platform. After registration, we will match the booker’s full name with the guest information.',empty:'No recent incomplete bookings found. Contact us through your booking platform or search with your booking number.',loading:'Finding bookings…',error:'Unable to load bookings. Please retry.',retry:'Retry',platform:'Platform',selected:'Selected booking',change:'Choose again'},
 ko:{title:'예약을 선택해 주세요',hint:'이름의 첫 글자와 예약 플랫폼을 확인해 선택하세요. 숙박자 정보 등록 후 예약자의 전체 이름을 대조합니다.',empty:'최근 미등록 예약을 찾을 수 없습니다. 예약 플랫폼의 메시지 기능으로 연락하거나 예약 번호로 검색해 주세요.',loading:'예약 검색 중…',error:'예약을 불러올 수 없습니다. 다시 시도해 주세요.',retry:'다시 시도',platform:'예약 플랫폼',selected:'선택한 예약',change:'다시 선택'}
};
const confirmationTexts={
 'zh-hans':{name:'这些订单的姓名首字母和平台相同，请输入预订人的完整姓名。',dates:'完整姓名也对应多个订单，请填写入住和退房日期。',label:'预订人完整姓名',checkIn:'入住日期',checkOut:'退房日期',confirm:'确认订单',cancel:'返回订单列表',contact:'仍有多个订单符合。请通过预订平台消息联系管理员，或拨打 +81721707138 获得协助。'},
 'zh-hant':{name:'這些訂單的姓名首字母與平台相同，請輸入預訂人的完整姓名。',dates:'完整姓名也對應多筆訂單，請填寫入住與退房日期。',label:'預訂人完整姓名',checkIn:'入住日期',checkOut:'退房日期',confirm:'確認訂單',cancel:'返回訂單列表',contact:'仍有多筆訂單符合。請透過預訂平台訊息聯絡管理員，或撥打 +81721707138 取得協助。'},
 jp:{name:'頭文字と予約サイトが同じご予約があります。ご予約者のフルネームを入力してください。',dates:'同じフルネームのご予約が複数あります。チェックイン・チェックアウト日を入力してください。',label:'ご予約者のフルネーム',checkIn:'チェックイン日',checkOut:'チェックアウト日',confirm:'予約を確認',cancel:'予約一覧に戻る',contact:'複数の予約が一致しています。予約サイトのメッセージまたは +81721707138 で管理人にお問い合わせください。'},
 en:{name:'These bookings have the same initials and platform. Enter the booker’s full name.',dates:'More than one booking has this full name. Enter the check-in and check-out dates.',label:'Booker’s full name',checkIn:'Check-in date',checkOut:'Check-out date',confirm:'Confirm booking',cancel:'Back to bookings',contact:'Multiple bookings still match. Contact the manager through your booking platform, or call +81721707138 for assistance.'},
 ko:{name:'이름의 첫 글자와 플랫폼이 같은 예약이 있습니다. 예약자의 전체 이름을 입력하세요.',dates:'같은 전체 이름의 예약이 여러 개입니다. 체크인 및 체크아웃 날짜를 입력하세요.',label:'예약자의 전체 이름',checkIn:'체크인 날짜',checkOut:'체크아웃 날짜',confirm:'예약 확인',cancel:'예약 목록으로',contact:'일치하는 예약이 여전히 여러 개입니다. 예약 플랫폼의 메시지 기능으로 관리자에게 연락하거나 +81721707138 로 전화해 주세요.'}
};
export const SELECTION_STORAGE_KEY='checkin.selectedOrder';
export function readSelectedOrder(){try{return JSON.parse(sessionStorage.getItem(SELECTION_STORAGE_KEY)||'null');}catch{return null;}}
export default function ReservationChooser({lang,selected,onSelect}){
 const t=texts[lang]||texts.jp,c=confirmationTexts[lang]||confirmationTexts.jp;
 const [confirmation,setConfirmation]=useState(null),[bookerName,setBookerName]=useState(''),[checkInDate,setCheckInDate]=useState(''),[checkOutDate,setCheckOutDate]=useState('');
 const [candidates,setCandidates]=useState(null),[error,setError]=useState(false),[busy,setBusy]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(selected?.selectionOnly)return;
  const controller=new AbortController();setCandidates(null);setError(false);
  fetch('/api/checkin/reservation-candidates',{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{if(!controller.signal.aborted)setCandidates(data.candidates||[]);}).catch(()=>{if(!controller.signal.aborted)setError(true);});
  return()=>controller.abort();
 },[selected?.selectionOnly,attempt]);
 const choose=async (candidate,confirm=false)=>{
  setBusy(candidate.selectionToken);setError(false);
  try{
   const response=await fetch('/api/checkin/reservation-select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selectionToken:candidate.selectionToken,...confirm?{bookerName,checkInDate,checkOutDate}:{}})});
   if(!response.ok)throw new Error();const data=await response.json();
   if(data.needsConfirmation){setConfirmation({candidate,step:data.confirmation});return;}
   setConfirmation(null);
   sessionStorage.setItem(SELECTION_STORAGE_KEY,JSON.stringify(data.reservation));onSelect(data.reservation);
  }catch{setError(true);}finally{setBusy('');}
 };
 return <section className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3" aria-live="polite">
  <h3 className="font-bold text-slate-700">{selected?.selectionOnly?t.selected:t.title}</h3>
  {confirmation ? <div className="space-y-3"><p className="text-sm text-slate-700">{confirmation.step==='contact'?c.contact:confirmation.step==='stay_dates'?c.dates:c.name}</p>{confirmation.step!=='contact' && <><label className="block text-xs font-bold">{c.label}<input value={bookerName} onChange={e=>setBookerName(e.target.value)} autoComplete="name" className="block w-full mt-1 p-3 rounded-xl border border-slate-200" /></label>{confirmation.step==='stay_dates' && <div className="grid grid-cols-2 gap-2"><label className="text-xs">{c.checkIn}<input type="date" value={checkInDate} onChange={e=>setCheckInDate(e.target.value)} className="w-full p-2 border rounded-lg" /></label><label className="text-xs">{c.checkOut}<input type="date" value={checkOutDate} onChange={e=>setCheckOutDate(e.target.value)} className="w-full p-2 border rounded-lg" /></label></div>}{error&&<p className="text-xs text-amber-700">{t.error}</p>}<button type="button" disabled={Boolean(busy)||!bookerName.trim()||(confirmation.step==='stay_dates'&&(!checkInDate||!checkOutDate))} onClick={()=>choose(confirmation.candidate,true)} className="w-full p-3 rounded-xl bg-slate-900 text-white font-bold disabled:opacity-50">{c.confirm}</button></>}{confirmation.step==='contact'&&<a href="tel:+81721707138" className="block font-bold text-emerald-700">+81721707138</a>}<button type="button" onClick={()=>{setConfirmation(null);setError(false);setBookerName('');setCheckInDate('');setCheckOutDate('');}} className="text-xs underline">{c.cancel}</button></div> : selected?.selectionOnly?<><p className="text-sm font-bold">{selected.maskedName} · {t.platform}: {selected.platform}</p><button type="button" className="text-xs text-slate-600 underline" onClick={()=>{sessionStorage.removeItem(SELECTION_STORAGE_KEY);onSelect(null);setAttempt(v=>v+1);}}>{t.change}</button></>:<><p className="text-xs text-slate-600">{t.hint}</p>{error?<><p className="text-xs text-amber-700">{t.error}</p><button type="button" onClick={()=>setAttempt(v=>v+1)} className="text-sm underline">{t.retry}</button></>:candidates===null?<p className="text-xs text-slate-500">{t.loading}</p>:candidates.length===0?<p className="text-xs text-slate-600">{t.empty}</p>:<div className="space-y-2">{candidates.map(c=><button type="button" key={c.selectionToken} disabled={Boolean(busy)} onClick={()=>choose(c)} className="w-full p-4 text-left bg-white rounded-xl border border-slate-200 hover:border-emerald-400 disabled:opacity-60"><span className="font-bold">{c.maskedName}</span><span className="block text-xs text-slate-500 mt-1">{t.platform}: {c.platform}</span></button>)}</div>}</>}
 </section>;
}
