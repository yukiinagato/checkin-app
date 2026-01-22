import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, 
  Wifi, 
  Clock, 
  VolumeX, 
  CigaretteOff, 
  MapPin, 
  ChevronRight, 
  ChevronLeft, 
  CheckCircle2,
  Info,
  BellRing,
  Coffee,
  Languages,
  UserCheck,
  Waves,
  Baby,
  AlertTriangle,
  PhoneCall,
  Zap,
  BookOpen,
  Wrench,
  Flame,
  Wind,
  Trash2,
  Container,
  ExternalLink,
  Camera,
  Users,
  UserPlus,
  Trash,
  Map,
  Globe,
  Lock,
  LayoutDashboard,
  FileSpreadsheet,
  FolderOpen,
  Settings,
  LogOut,
  Save,
  Cloud,
  Database,
  Download,
  Image as ImageIcon,
  Loader2,
  Server,
  Search
} from 'lucide-react';

// ----------------------------------------------------------------------
// 國家/地區數據 (支持多語言)
// ----------------------------------------------------------------------
const COUNTRY_DATA = [
  { code: 'CN', names: { 'zh-hans': '中国', 'zh-hant': '中國', 'en': 'China', 'jp': '中国', 'ko': '중국' } },
  { code: 'TW', names: { 'zh-hans': '中国台湾', 'zh-hant': '台灣', 'en': 'Taiwan', 'jp': '台湾', 'ko': '대만' } },
  { code: 'HK', names: { 'zh-hans': '中国香港', 'zh-hant': '香港', 'en': 'Hong Kong', 'jp': '香港', 'ko': '홍콩' } },
  { code: 'MO', names: { 'zh-hans': '中国澳门', 'zh-hant': '澳門', 'en': 'Macau', 'jp': 'マカオ', 'ko': '마카오' } },
  { code: 'US', names: { 'zh-hans': '美国', 'zh-hant': '美國', 'en': 'USA', 'jp': 'アメリカ', 'ko': '미국' } },
  { code: 'GB', names: { 'zh-hans': '英国', 'zh-hant': '英國', 'en': 'UK', 'jp': 'イギリス', 'ko': '영국' } },
  { code: 'KR', names: { 'zh-hans': '韩国', 'zh-hant': '韓國', 'en': 'South Korea', 'jp': '韓国', 'ko': '대한민국' } },
  { code: 'SG', names: { 'zh-hans': '新加坡', 'zh-hant': '新加坡', 'en': 'Singapore', 'jp': 'シンガポール', 'ko': '싱가포르' } },
  { code: 'MY', names: { 'zh-hans': '马来西亚', 'zh-hant': '馬來西亞', 'en': 'Malaysia', 'jp': 'マレーシア', 'ko': '말레이시아' } },
  { code: 'TH', names: { 'zh-hans': '泰国', 'zh-hant': '泰國', 'en': 'Thailand', 'jp': 'タイ', 'ko': '태국' } },
  { code: 'VN', names: { 'zh-hans': '越南', 'zh-hant': '越南', 'en': 'Vietnam', 'jp': 'ベトナム', 'ko': '베트남' } },
  { code: 'PH', names: { 'zh-hans': '菲律宾', 'zh-hant': '菲律賓', 'en': 'Philippines', 'jp': 'フィリピン', 'ko': '필리핀' } },
  { code: 'ID', names: { 'zh-hans': '印度尼西亚', 'zh-hant': '印尼', 'en': 'Indonesia', 'jp': 'インドネシア', 'ko': '인도네시아' } },
  { code: 'AU', names: { 'zh-hans': '澳大利亚', 'zh-hant': '澳大利亞', 'en': 'Australia', 'jp': 'オーストラリア', 'ko': '호주' } },
  { code: 'CA', names: { 'zh-hans': '加拿大', 'zh-hant': '加拿大', 'en': 'Canada', 'jp': 'カナダ', 'ko': '캐나다' } },
  { code: 'FR', names: { 'zh-hans': '法国', 'zh-hant': '法國', 'en': 'France', 'jp': 'フランス', 'ko': '프랑스' } },
  { code: 'DE', names: { 'zh-hans': '德国', 'zh-hant': '德國', 'en': 'Germany', 'jp': 'ドイツ', 'ko': '독일' } },
  { code: 'IT', names: { 'zh-hans': '意大利', 'zh-hant': '義大利', 'en': 'Italy', 'jp': 'イタリア', 'ko': '이탈리아' } },
  { code: 'ES', names: { 'zh-hans': '西班牙', 'zh-hant': '西班牙', 'en': 'Spain', 'jp': 'スペイン', 'ko': '스페인' } },
  { code: 'OTHER', names: { 'zh-hans': '其他', 'zh-hant': '其他', 'en': 'Other', 'jp': 'その他', 'ko': '기타' } },
];

// ----------------------------------------------------------------------
// 後端 API 服務
// ----------------------------------------------------------------------
const API_URL = 'http://localhost:3001/api';

const DB = {
  async getAllRecords() {
    try {
      const res = await fetch(`${API_URL}/records`);
      if (!res.ok) throw new Error('Failed to fetch records');
      return await res.json();
    } catch (error) {
      console.error("API Error:", error);
      return [];
    }
  },

  async insertRecord(record) {
    try {
      const res = await fetch(`${API_URL}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
      return await res.json();
    } catch (error) {
      console.error("Submission Error:", error);
      return { success: false, error: "Connection Failed" };
    }
  },

  exportCSV(records) {
    if (!records.length) return;
    const rows = [];
    rows.push(['Date', 'Group ID', 'Name', 'Type', 'Resident?', 'Nationality', 'Passport No', 'Address', 'Occupation', 'Passport Image URL']);
    records.forEach(group => {
      group.guests.forEach(guest => {
        rows.push([
          group.submittedAt.split('T')[0],
          group.id,
          guest.name,
          guest.type,
          guest.isResident ? 'Yes' : 'No',
          guest.nationality || '-',
          guest.passportNumber || '-',
          guest.address || '-',
          guest.occupation || '-',
          guest.passportPhoto || 'N/A'
        ]);
      });
    });
    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `hotel_guests_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
};

// ----------------------------------------------------------------------
// 主程序入口
// ----------------------------------------------------------------------
const App = () => {
  const [view, setView] = useState('guest'); 
  const [loading, setLoading] = useState(false);

  const handleGuestSubmit = async (guestData) => {
    setLoading(true);
    const result = await DB.insertRecord({ guests: guestData });
    setLoading(false);
    if (!result.success) {
      alert("提交失敗，請聯繫管理員 (Server Error)");
      return false;
    }
    return true;
  };

  if (view === 'login') return <AdminLogin onLogin={() => setView('admin')} onBack={() => setView('guest')} />;
  if (view === 'admin') return <AdminDashboard onLogout={() => setView('guest')} />;

  return (
    <GuestFlow 
      onSubmit={handleGuestSubmit} 
      onAdminRequest={() => setView('login')} 
      isSubmitting={loading}
    />
  );
};

// ----------------------------------------------------------------------
// 管理員登錄組件
// ----------------------------------------------------------------------
const AdminLogin = ({ onLogin, onBack }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleLogin = () => {
    if (pin === '8808') { 
      onLogin();
    } else {
      setError(true);
      setPin('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-white animate-in fade-in duration-500">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="mx-auto w-20 h-20 bg-slate-800 rounded-3xl flex items-center justify-center mb-6 shadow-2xl border border-slate-700">
          <Lock className="w-10 h-10 text-emerald-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-black tracking-tight">管理員入口</h2>
          <p className="text-slate-400 text-sm">請輸入安全密鑰以訪問後台</p>
        </div>
        <div className="space-y-4">
          <input 
            type="password" 
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(false); }}
            placeholder="PIN"
            maxLength={4}
            className="w-full p-5 bg-slate-800 border border-slate-700 rounded-2xl text-center text-4xl font-mono tracking-[1em] focus:border-emerald-500 outline-none transition-all placeholder:text-slate-700"
          />
          {error && <p className="text-rose-500 text-sm font-bold flex items-center justify-center gap-2 animate-shake"><AlertTriangle className="w-4 h-4" /> 密鑰錯誤</p>}
          <button onClick={handleLogin} className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 rounded-2xl font-bold transition-all shadow-lg">解鎖儀表盤</button>
          <button onClick={onBack} className="w-full py-4 text-slate-500 text-sm hover:text-white transition-colors">返回住客模式</button>
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// 管理後台組件
// ----------------------------------------------------------------------
const AdminDashboard = ({ onLogout }) => {
  const [tab, setTab] = useState('data');
  const [records, setRecords] = useState([]);
  const [serverStatus, setServerStatus] = useState('checking');

  useEffect(() => {
    DB.getAllRecords()
      .then(data => {
        setRecords(data);
        setServerStatus('online');
      })
      .catch(() => setServerStatus('offline'));
  }, []);

  const totalGuests = records.reduce((acc, r) => acc + (r.guests?.length || 0), 0);
  const todayCount = records.filter(r => r.submittedAt.startsWith(new Date().toISOString().split('T')[0])).reduce((acc, r) => acc + (r.guests?.length || 0), 0);

  const renderContent = () => {
    if (serverStatus === 'offline') {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 bg-rose-50 rounded-3xl border border-rose-100">
          <AlertTriangle className="w-12 h-12 text-rose-500" />
          <div>
            <h3 className="text-lg font-bold text-rose-700">無法連接本地服務器</h3>
            <p className="text-sm text-rose-500">請確認 <code>npm run server</code> 是否已運行在端口 3001</p>
          </div>
        </div>
      );
    }

    switch(tab) {
      case 'data':
        return (
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="font-bold text-lg text-slate-800">住客登記記錄</h3>
                <p className="text-xs text-slate-400">數據來源: 本地 SQLite</p>
              </div>
              <button onClick={() => DB.exportCSV(records)} className="flex items-center gap-2 text-xs font-bold bg-slate-900 text-white px-4 py-2.5 rounded-xl hover:bg-slate-700 transition-colors shadow-lg shadow-slate-200">
                <Download className="w-4 h-4" /> 導出 CSV 表格
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="p-4 pl-6">日期</th>
                    <th className="p-4">姓名</th>
                    <th className="p-4">類型</th>
                    <th className="p-4">身份</th>
                    <th className="p-4">護照/證件號</th>
                    <th className="p-4">國籍</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((group) => (
                    group.guests.map((guest, idx) => (
                      <tr key={`${group.id}-${idx}`} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-4 pl-6 text-slate-500 font-mono text-xs">{group.submittedAt.split('T')[0]}</td>
                        <td className="p-4 font-bold text-slate-900">{guest.name || '未填寫'}</td>
                        <td className="p-4">
                          <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${guest.type === 'infant' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                            {guest.type === 'infant' ? '嬰兒' : '成人'}
                          </span>
                        </td>
                        <td className="p-4">
                            {guest.isResident ? 
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100"><MapPin className="w-3 h-3"/> 居民</span> : 
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-100"><Globe className="w-3 h-3"/> 遊客</span>
                            }
                        </td>
                        <td className="p-4 font-mono text-slate-600 text-xs">{guest.passportNumber || '-'}</td>
                        <td className="p-4 text-slate-600">{guest.nationality || 'Japan'}</td>
                      </tr>
                    ))
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      case 'files':
        const dates = [...new Set(records.map(r => r.submittedAt.split('T')[0]))];
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
             <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-xl text-slate-800">護照歸檔</h3>
                  <p className="text-sm text-slate-500">文件存儲於本地 <code>/uploads</code> 文件夾</p>
                </div>
                <div className="flex gap-2 text-xs font-bold text-slate-500 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                  <Server className="w-4 h-4" />
                  <span>Local Server</span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                 {dates.map(date => {
                   const dayGuests = records.filter(r => r.submittedAt.startsWith(date)).flatMap(r => r.guests.filter(g => g.passportPhoto));
                   if (dayGuests.length === 0) return null;
                   return (
                     <div key={date} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm hover:shadow-lg transition-all group">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-10 h-10 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500 group-hover:scale-110 transition-transform">
                            <FolderOpen className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-800">{date}</p>
                            <p className="text-xs text-slate-400">{dayGuests.length} 張護照照片</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {dayGuests.map((g, i) => (
                            <a href={g.passportPhoto} target="_blank" rel="noopener noreferrer" key={i} className="aspect-[3/4] bg-slate-100 rounded-lg overflow-hidden relative border border-slate-100 block">
                               <img src={g.passportPhoto} alt={g.name} className="w-full h-full object-cover" />
                               <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                                 <ExternalLink className="w-4 h-4 text-white" />
                               </div>
                            </a>
                          ))}
                        </div>
                     </div>
                   );
                 })}
              </div>
          </div>
        );
      case 'settings':
        return (
          <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4">
             <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                <div className="flex items-center gap-4 mb-6">
                   <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white">
                     <Server className="w-6 h-6" />
                   </div>
                   <div>
                     <h3 className="font-bold text-xl text-slate-800">本地服務器狀態</h3>
                     <p className="text-sm text-slate-500">Node.js + SQLite</p>
                   </div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                     <span className="text-sm font-bold text-slate-700">連接狀態</span>
                     <span className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-2 ${serverStatus === 'online' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                        {serverStatus === 'online' ? '已連接 (Online)' : '斷開 (Offline)'}
                     </span>
                  </div>
                </div>
             </div>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row text-slate-900 font-sans">
      <div className="w-full md:w-72 bg-slate-900 text-white p-6 flex flex-col justify-between shrink-0 z-20">
        <div>
          <div className="flex items-center gap-4 mb-12 px-2">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center font-black text-xl">H</div>
            <h1 className="font-bold text-lg tracking-wide">Hotel Admin</h1>
          </div>
          <nav className="space-y-2">
            <button onClick={() => setTab('data')} className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all font-bold text-sm ${tab === 'data' ? 'bg-white text-slate-900 shadow-xl' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
              <FileSpreadsheet className="w-5 h-5" /> 住客數據
            </button>
            <button onClick={() => setTab('files')} className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all font-bold text-sm ${tab === 'files' ? 'bg-white text-slate-900 shadow-xl' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
              <FolderOpen className="w-5 h-5" /> 護照管理
            </button>
            <button onClick={() => setTab('settings')} className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all font-bold text-sm ${tab === 'settings' ? 'bg-white text-slate-900 shadow-xl' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
              <Settings className="w-5 h-5" /> 系統設置
            </button>
          </nav>
        </div>
        <button onClick={onLogout} className="flex items-center gap-3 p-4 text-rose-400 hover:text-rose-300 transition-colors text-sm font-bold bg-rose-500/10 rounded-2xl">
          <LogOut className="w-5 h-5" /> 退出登錄
        </button>
      </div>
      <div className="flex-1 p-6 md:p-10 overflow-y-auto h-screen relative">
          {renderContent()}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// 訪客端流程 (包含地址自動填寫與所有詳細內容)
// ----------------------------------------------------------------------
const GuestFlow = ({ onSubmit, onAdminRequest, isSubmitting }) => {
  const [lang, setLang] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [hasAgreed, setHasAgreed] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [guests, setGuests] = useState([]);
  const [infantCount, setInfantCount] = useState(0);
  const [isLookingUpZip, setIsLookingUpZip] = useState(null);

  useEffect(() => {
    if (guests.length === 0) {
      setGuests([{
        id: Math.random().toString(36).substr(2, 9),
        type: 'adult',
        isResident: true,
        name: '', age: '', occupation: '', address: '', postalCode: '', nationality: '', passportNumber: '', passportPhoto: null, guardianName: '', guardianPhone: ''
      }]);
    }
  }, []);

  const createGuestTemplate = (type = 'adult') => ({
    id: Math.random().toString(36).substr(2, 9),
    type,
    isResident: true,
    name: '', age: '', occupation: '', address: '', postalCode: '', nationality: '', passportNumber: '', passportPhoto: null, guardianName: '', guardianPhone: ''
  });

  const langConfig = {
    'zh-hans': { label: '简体中文', name: 'Simplified Chinese' },
    'zh-hant': { label: '繁體中文', name: 'Traditional Chinese' },
    'en': { label: 'English', name: 'English' },
    'jp': { label: '日本語', name: 'Japanese' },
    'ko': { label: '한국어', name: 'Korean' }
  };

  const translations = {
    'zh-hans': {
      next: "下一步", prev: "上一步", finish: "确认并获取房号", agree: "我已详读并同意遵守上述所有守则",
      zipLookup: "查询", zipPlaceholder: "7位邮编", zipLoading: "查询中...", regFormAddr: "日本住址", regFormZip: "邮政编码",
      roomNo: "您的房号", wifi: "Wi-Fi 密码", copy: "复制", breakfast: "早餐时间", breakfastLoc: "2楼西餐厅",
      service: "紧急协助", serviceDetail: "优先拨打紧急电话，再前往别栋联系管理人", welcomeTitle: "欢迎入住！", welcomeSub: "请开始您的愉快旅程",
      footer: "您的安全与舒适是我们的最高宗旨。", guideTitle: "入住导览", changeLang: "语言", manualLink: "说明书 PDF",
      regResident: "日本居民", regTourist: "访日游客", regFormName: "姓名", regFormAge: "年龄", regFormOcc: "职业",
      regFormNation: "国籍", regFormPass: "护照号码", regPassportUpload: "拍摄/上传护照照片", regMinorAlert: "未成年人需填监护人信息",
      addGuest: "增加人员", guestLabel: "住客", infantLabel: "婴儿人数 (2岁以下)", countAdults: "住客人数 (成人/未成年)",
      welcomeIntro: "尊贵的客人，欢迎您选择入住。为了确保您能充分享受这里的宁静与便利，并保障所有住客的安全，我们准备了这份详尽的向导。请务必逐页阅读并了解。",
      emergencyFire: "火警/急救", emergencyPolice: "警察", emergencyAdvice: "请优先拨打上述紧急电话。在确保自身安全后，前往别栋寻找管理人協助。", voltageNotice: "日本电压为 100V。请勿同时开启大功率电器，以免跳闸。",
      bathSafetyTitle: "浴缸溺水预防", bathSafetyDesc: "即使极浅的水也能导致溺水。严禁婴儿单独在浴室内。用完浴缸请务必立即放干存水。",
      laundrySafetyTitle: "洗衣机窒息风险", laundrySafetyDesc: "滚筒洗衣机空间封闭。请严防儿童爬入。平时请务必关紧舱门，防止发生窒息事故。",
      hillWarningTitle: "后山警告", hillWarningDesc: "地势湿滑且有毒虫，进入前必须联系管理人陪同。",
      garageWarningTitle: "车库上方平台", garageWarningDesc: "围栏较矮。请严防坠落，严禁在边缘嬉戏。",
      waterNoticeTitle: "特別注意：时间设定", waterNoticeDesc: "面板显示的时间被故意调快了12小时。这是为了让机器在白天气温较高时制热。请勿自行更改。",
      waterResetTitle: "报错消除方法", waterResetDesc: "在厨房面板上同时按住「時刻合わせ」与「▼」键5秒，听到「滴」声即可复位。",
      trashBurnableTitle: "可燃垃圾 (特别规定)", trashBurnableDesc: "包括厨余、纸屑、塑料袋，以及宝特瓶(PET)和瓶盖。",
      trashResourceTitle: "资源垃圾 (瓶/罐)", trashResourceDesc: "本区域不需要特别清洗，分类放入容器。装满后打包放在室内或拿到车库大垃圾桶。",
      laundryGuideTitle: "Iris Ohyama 快速上手", laundryStep1: "1. 放入衣物关门", laundryStep2: "2. 添加洗涤剂", laundryStep3: "3. 选择洗濯/乾燥", laundryStep4: "4. 按下スタート",
      rulesManager: "管理人（男性）会因巡视进入公用空间。进入前会大声询问招呼。", rulesNoise: "晚上 22:00 后请保持室内外静音，避免影响邻居。请在中午 12:00 前退房。",
      selectCountry: "选择国家/地区",
      steps: [
        { id: 'welcome', title: "欢迎入住", subtitle: "Welcome" },
        { id: 'count', title: "入住人数", subtitle: "Guest Count" },
        { id: 'registration', title: "住客信息登记", subtitle: "Osaka Regulation" },
        { id: 'emergency', title: "安全与紧急应对", subtitle: "Safety First" },
        { id: 'child', title: "婴儿与儿童安全", subtitle: "Child Protection" },
        { id: 'outdoor', title: "户外边界警告", subtitle: "Outdoor Safety" },
        { id: 'water', title: "空气能热水器 (EcoCute)", subtitle: "Hot Water System" },
        { id: 'trash', title: "垃圾分类指南", subtitle: "Waste Management" },
        { id: 'laundry', title: "洗烘一体机使用", subtitle: "Laundry Guide" },
        { id: 'rules', title: "邻里礼仪与管理", subtitle: "Etiquette" }
      ]
    },
    'zh-hant': {
      next: "下一步", prev: "上一步", finish: "確認並獲取房號", agree: "我已詳讀並同意遵守上述所有守則",
      zipLookup: "地址查詢", zipPlaceholder: "7位郵遞區號", zipLoading: "查詢中...", regFormAddr: "日本住址", regFormZip: "郵遞區號",
      roomNo: "您的房號", wifi: "Wi-Fi 密碼", copy: "複製", breakfast: "早餐時間", breakfastLoc: "2樓西餐廳",
      service: "緊急協助", serviceDetail: "優先撥打緊急電話，再前往別棟聯繫管理人", welcomeTitle: "入住愉快！", welcomeSub: "請開始您的愉快旅程",
      footer: "您的安全與舒適是我們的最高宗旨。", guideTitle: "入住導覽", changeLang: "語言", manualLink: "說明書 PDF",
      regResident: "日本居民", regTourist: "訪日遊客", regFormName: "姓名", regFormAge: "年齡", regFormOcc: "職業",
      regFormNation: "國籍", regFormPass: "護照號碼", regPassportUpload: "拍攝/上傳護照照片", regMinorAlert: "未成年人需填監護人資訊",
      addGuest: "增加人員", guestLabel: "住客", infantLabel: "嬰兒人數 (2歲以下)", countAdults: "住客人數 (成人/未成年)",
      welcomeIntro: "尊貴的客人，歡迎您選擇入住。為了確保您能充分享受這裡的寧靜與便利，並保障所有住客的安全，我們準備了這份詳盡的向導。請務必逐頁閱讀並了解。",
      emergencyFire: "火警/急救", emergencyPolice: "警察", emergencyAdvice: "請優先撥打上述緊急電話。在確保自身安全後，前往別棟尋找管理人協助。", voltageNotice: "日本電壓為 100V。請勿同時開啟大功率電器，以免跳閘。",
      bathSafetyTitle: "浴缸溺水預防", bathSafetyDesc: "即使極淺的水也能導致溺水。嚴禁嬰兒單獨在浴室內。用完浴缸請務必立即放乾存水。",
      laundrySafetyTitle: "洗衣機窒息風險", laundrySafetyDesc: "滾筒洗衣機空間封閉。請嚴防兒童爬入。平時請務必關緊艙門，防止發生窒息事故。",
      hillWarningTitle: "後山警告", hillWarningDesc: "地勢濕滑且有毒蟲，進入前必須聯繫管理人陪同。",
      garageWarningTitle: "車庫上方平台", garageWarningDesc: "圍欄較矮。請嚴防墜落，嚴禁在邊緣嬉戲。",
      waterNoticeTitle: "特別注意：時間設定", waterNoticeDesc: "面板顯示的時間被故意調快了12小時。這是為了讓機器在白天氣溫較高時制熱。請勿自行更改。",
      waterResetTitle: "報錯消除方法", waterResetDesc: "在廚房面板上同時按住「時刻合わせ」與「▼」鍵5秒，聽到「滴」聲即可復位。",
      trashBurnableTitle: "可燃垃圾 (特別規定)", trashBurnableDesc: "包括廚餘、紙屑、塑料袋，以及寶特瓶(PET)和瓶蓋。",
      trashResourceTitle: "資源垃圾 (瓶/罐)", trashResourceDesc: "本區域不需要特別清洗，分類放入容器。裝滿後打包放在室內或拿到車庫大垃圾桶。",
      laundryGuideTitle: "Iris Ohyama 快速上手", laundryStep1: "1. 放入衣物關門", laundryStep2: "2. 添加洗滌劑", laundryStep3: "3. 選擇洗濯/乾燥", laundryStep4: "4. 按下スタート",
      rulesManager: "管理人（男性）會因巡視進入公用空間。進入前會大聲詢問招呼。", rulesNoise: "晚上 22:00 後請保持室內外靜音，避免影響鄰居。請在中午 12:00 前退房。",
      selectCountry: "選擇國家/地區",
      steps: [
        { id: 'welcome', title: "歡迎入住", subtitle: "Welcome" },
        { id: 'count', title: "入住人數", subtitle: "Guest Count" },
        { id: 'registration', title: "住客資訊登記", subtitle: "Osaka Regulation" },
        { id: 'emergency', title: "安全與緊急應對", subtitle: "Safety First" },
        { id: 'child', title: "嬰兒與兒童安全", subtitle: "Child Protection" },
        { id: 'outdoor', title: "戶外邊界警告", subtitle: "Outdoor Safety" },
        { id: 'water', title: "空氣能熱水器 (EcoCute)", subtitle: "Hot Water System" },
        { id: 'trash', title: "垃圾分類指南", subtitle: "Waste Management" },
        { id: 'laundry', title: "洗烘一體機使用", subtitle: "Laundry Guide" },
        { id: 'rules', title: "鄰里禮儀與管理", subtitle: "Etiquette" }
      ]
    },
    'en': {
      next: "Next", prev: "Back", finish: "Finish & Get Info", agree: "I have read and agree to all rules",
      zipLookup: "Lookup", zipPlaceholder: "7 digits", zipLoading: "Searching...", regFormAddr: "Address (Japan)", regFormZip: "Postal Code",
      roomNo: "Room No.", wifi: "Wi-Fi Password", copy: "Copy", breakfast: "Breakfast", breakfastLoc: "2F Restaurant",
      service: "Support", serviceDetail: "Call 119/110 first, then contact manager.", welcomeTitle: "Welcome!", welcomeSub: "Enjoy your stay",
      footer: "Your safety is our priority.", guideTitle: "Check-in Guide", changeLang: "Language", manualLink: "Manual PDF",
      regResident: "Resident", regTourist: "Tourist", regFormName: "Name", regFormAge: "Age", regFormOcc: "Occupation",
      regFormNation: "Nationality", regFormPass: "Passport No.", regPassportUpload: "Upload Passport", regMinorAlert: "Guardian info required for minors",
      addGuest: "Add Person", guestLabel: "Guest", infantLabel: "Infants (Under 2)", countAdults: "Guests (Adults/Minors)",
      welcomeIntro: "Dear guest, welcome. To ensure you enjoy the tranquility and convenience while staying safe, we have prepared this guide. Please read carefully.",
      emergencyFire: "Fire/Ambulance", emergencyPolice: "Police", emergencyAdvice: "Please call the numbers above for emergencies first. Then contact the manager.", voltageNotice: "Voltage is 100V. Do not use multiple high-power devices at once to avoid tripping breakers.",
      bathSafetyTitle: "Drowning Prevention", bathSafetyDesc: "Even shallow water can cause drowning. Never leave infants alone in the bathroom. Drain the tub after use.",
      laundrySafetyTitle: "Suffocation Risk", laundrySafetyDesc: "Drum washers are enclosed spaces. Prevent children from climbing inside. Keep the door closed when not in use.",
      hillWarningTitle: "Mountain Warning", hillWarningDesc: "The terrain is slippery and has toxic insects. Contact manager before entering.",
      garageWarningTitle: "Garage Platform", garageWarningDesc: "The fence is low. Please prevent falls and avoid playing near the edge.",
      waterNoticeTitle: "Time Setting", waterNoticeDesc: "The panel time is set 12 hours ahead on purpose for higher efficiency. Please do not change it.",
      waterResetTitle: "Resetting Errors", waterResetDesc: "Hold '時刻合わせ' and '▼' for 5 seconds on the kitchen panel until you hear a beep.",
      trashBurnableTitle: "Burnable Waste", trashBurnableDesc: "Includes food waste, paper, plastic bags, PET bottles, and caps.",
      trashResourceTitle: "Resources (Glass/Cans)", trashResourceDesc: "No need to wash, just sort into containers. Place full bags in the garage bin.",
      laundryGuideTitle: "Laundry Quick Start", laundryStep1: "1. Load clothes and close door", laundryStep2: "2. Add detergent", laundryStep3: "3. Select Wash/Dry", laundryStep4: "4. Press Start",
      rulesManager: "The manager (male) may enter common areas for inspection after announcing.", rulesNoise: "Keep noise down after 22:00. Check out before 12:00 PM.",
      selectCountry: "Select Country/Region",
      steps: [
        { id: 'welcome', title: "Welcome", subtitle: "Intro" },
        { id: 'count', title: "Guest Count", subtitle: "People" },
        { id: 'registration', title: "Registration", subtitle: "Legal" },
        { id: 'emergency', title: "Safety", subtitle: "Emergency" },
        { id: 'child', title: "Child Safety", subtitle: "Protection" },
        { id: 'outdoor', title: "Outdoor Warnings", subtitle: "Boundaries" },
        { id: 'water', title: "Hot Water System", subtitle: "EcoCute" },
        { id: 'trash', title: "Waste Management", subtitle: "Sorting" },
        { id: 'laundry', title: "Laundry Guide", subtitle: "Usage" },
        { id: 'rules', title: "Rules & Management", subtitle: "Etiquette" }
      ]
    },
    'jp': {
      next: "次へ", prev: "戻る", finish: "完了して情報取得", agree: "全ての事項を読み、同意します",
      zipLookup: "住所検索", zipPlaceholder: "7桁", zipLoading: "検索中...", regFormAddr: "国内住所", regFormZip: "郵便番号",
      roomNo: "お部屋番号", wifi: "Wi-Fi パスワード", copy: "コピー", breakfast: "朝食時間", breakfastLoc: "2階 レストラン",
      service: "緊急連絡", serviceDetail: "119/110の後に、管理人に連絡してください。", welcomeTitle: "ようこそ！", welcomeSub: "快適な滞在を",
      footer: "お客様の安全が第一です。", guideTitle: "宿泊ガイド", changeLang: "言語", manualLink: "説明書 PDF",
      regResident: "国内居住", regTourist: "訪日観光客", regFormName: "氏名", regFormAge: "年齢", regFormOcc: "職業",
      regFormNation: "国籍", regFormPass: "パスポート番号", regPassportUpload: "パスポートを撮影/アップロード", regMinorAlert: "未成年者は保護者情報が必要です",
      addGuest: "人数追加", guestLabel: "宿泊者", infantLabel: "乳幼児 (2歳以下)", countAdults: "宿泊人数 (大人/子供)",
      welcomeIntro: "お客様、ようこそ。静寂と利便性を享受し、安全を確保するために、このガイドを用意しました。必ずお読みください。",
      emergencyFire: "火災/救急", emergencyPolice: "警察", emergencyAdvice: "まず上記の番号に電話してください。その上で管理人に連絡してください。", voltageNotice: "電圧は100Vです。ブレーカーが落ちないよう、高出力家電の同時使用はお控えください。",
      bathSafetyTitle: "浴槽での溺水防止", bathSafetyDesc: "浅い水でも溺れる危険があります。乳幼児を浴室に一人にしないでください。使用後は必ず排水してください。",
      laundrySafetyTitle: "洗濯機の窒息事故防止", laundrySafetyDesc: "ドラム式洗濯機は密閉空間です。お子様が中に入らないようにしてください。使用しない時はドアを閉めてください。",
      hillWarningTitle: "裏山への立入禁止", hillWarningDesc: "滑りやすく、毒虫がいるため、立ち入る際は事前に管理人に連絡してください。",
      garageWarningTitle: "車庫上のベランダ", garageWarningDesc: "柵が低いため、転落に十分注意してください。端で遊ばないでください。",
      waterNoticeTitle: "重要：時刻設定について", waterNoticeDesc: "パネルの時刻は、制熱効率を高めるためにあえて12時間進めて設定されています。変更しないでください。",
      waterResetTitle: "エラー解除方法", waterResetDesc: "キッチンパネルの「時刻合わせ」と「▼」ボタンを同時に5秒間長押しし、「ピッ」と鳴ればリセット完了です。",
      trashBurnableTitle: "燃えるゴミ (特別規定)", trashBurnableDesc: "生ゴミ、紙屑、プラスチック袋、ペットボトルとキャップを含みます。",
      trashResourceTitle: "資源ゴミ (ビン/カン)", trashResourceDesc: "洗浄不要です。容器に分別してください。袋がいっぱいになったら車庫の大型ゴミ箱へ。",
      laundryGuideTitle: "洗濯乾燥機 使い方", laundryStep1: "1. 衣類を入れてドアを閉める", laundryStep2: "2. 洗剤を入れる", laundryStep3: "3. 洗濯/乾燥を選択", laundryStep4: "4. スタートを押す",
      rulesManager: "管理人（男性）が巡回のため共用スペースに入ることがあります（入室前に声掛けします）。", rulesNoise: "22:00以降はお静かにお願いします。チェックアウトは12:00までです。",
      selectCountry: "国・地域を選択",
      steps: [
        { id: 'welcome', title: "ようこそ", subtitle: "Intro" },
        { id: 'count', title: "人数選択", subtitle: "People" },
        { id: 'registration', title: "名簿登録", subtitle: "Legal" },
        { id: 'emergency', title: "安全・緊急", subtitle: "Emergency" },
        { id: 'child', title: "子供の安全", subtitle: "Protection" },
        { id: 'outdoor', title: "屋外制限", subtitle: "Boundaries" },
        { id: 'water', title: "給湯器 (エコキュート)", subtitle: "EcoCute" },
        { id: 'trash', title: "ゴミ分別", subtitle: "Trash" },
        { id: 'laundry', title: "洗濯機ガイド", subtitle: "Laundry" },
        { id: 'rules', title: "マナーと管理", subtitle: "Rules" }
      ]
    },
    'ko': {
      next: "다음", prev: "이전", finish: "완료 및 정보 확인", agree: "모든 사항을 확인하였으며 동의합니다",
      zipLookup: "주소검색", zipPlaceholder: "7자리", zipLoading: "검색중...", regFormAddr: "일본 내 주소", regFormZip: "우편번호",
      roomNo: "객실 번호", wifi: "비밀번호", copy: "복사", breakfast: "조식 시간", breakfastLoc: "2층 레스토랑",
      service: "긴급 지원", serviceDetail: "119/110에 먼저 전화한 후 관리자에게 문의하세요.", welcomeTitle: "환영합니다!", welcomeSub: "편안한 숙박 되세요",
      footer: "안전이 최우선입니다.", guideTitle: "이용 가이드", changeLang: "언어", manualLink: "설명서 PDF",
      regResident: "일본 거주", regTourist: "외국인 관광객", regFormName: "성함", regFormAge: "나이", regFormOcc: "직업",
      regFormNation: "국적", regFormPass: "여권 번호", regPassportUpload: "여권 사진 촬영/업로드", regMinorAlert: "미성년자는 보호자 정보가 필요합니다",
      addGuest: "인원 추가", guestLabel: "투숙객", infantLabel: "영유아 (2세 미만)", countAdults: "숙박 인원 (성인/청소년)",
      welcomeIntro: "고객님, 환영합니다. 평온하고 편리한 숙박과 안전을 위해 이 가이드를 준비했습니다. 내용을 반드시 숙지해 주시기 바랍니다.",
      emergencyFire: "화재/구급", emergencyPolice: "경찰", emergencyAdvice: "비상시 위 번호로 먼저 전화하세요. 그 후 관리자에게 도움을 요청하세요.", voltageNotice: "전압은 100V입니다. 차단기가 내려가지 않도록 고전력 가전의 동시 사용을 자제해 주세요.",
      bathSafetyTitle: "익사 사고 예방", bathSafetyDesc: "낮은 수심에서도 익사 위험이 있습니다. 영유아를 욕실에 혼자 두지 마세요. 사용 후에는 반드시 배수해 주세요.",
      laundrySafetyTitle: "세탁기 질식 위험", laundrySafetyDesc: "드럼 세탁기는 밀폐된 공간입니다. 어린이가 들어가지 않도록 주의하세요. 사용하지 않을 때는 문을 닫아두세요.",
      hillWarningTitle: "뒷산 출입 주의", hillWarningDesc: "미끄럽고 독충이 있을 수 있으므로 출입 전 반드시 관리자에게 문의하세요.",
      garageWarningTitle: "차고 위 테라스", garageWarningDesc: "난간이 낮으므로 추락 사고에 주의하세요. 가장자리에서 장난치지 마세요.",
      waterNoticeTitle: "중요: 시간 설정", waterNoticeDesc: "온수기 패널의 시간은 열 효율을 위해 일부러 12시간 빠르게 설정되어 있습니다. 설정을 변경하지 마세요.",
      waterResetTitle: "에러 해제 방법", waterResetDesc: "주방 패널의 「時刻合わせ」와 「▼」 버튼을 동시에 5초간 누르면 '띠' 소리와 함께 리셋됩니다.",
      trashBurnableTitle: "타는 쓰레기 (가연성)", trashBurnableDesc: "음식물 쓰레기, 종이, 비닐, 페트병 및 캡을 포함합니다.",
      trashResourceTitle: "재활용 쓰레기 (병/캔)", trashResourceDesc: "세척할 필요는 없습니다. 분리수거함에 넣어주세요. 가득 차면 차고의 대형 쓰레기통으로 옮겨주세요.",
      laundryGuideTitle: "세탁기 퀵 가이드", laundryStep1: "1. 세탁물을 넣고 문을 닫는다", laundryStep2: "2. 세제를 넣는다", laundryStep3: "3. 세탁/건조 선택", laundryStep4: "4. 시작 버튼을 누른다",
      rulesManager: "관리자(남성)가 시설 점검을 위해 공용 공간에 들어올 수 있습니다(입장 전 안내함).", rulesNoise: "22:00 이후에는 소음에 주의해 주세요. 체크아웃은 12:00까지입니다.",
      selectCountry: "국가/지역 선택",
      steps: [
        { id: 'welcome', title: "환영합니다", subtitle: "Welcome" },
        { id: 'count', title: "인원 선택", subtitle: "People" },
        { id: 'registration', title: "정보 등록", subtitle: "Legal" },
        { id: 'emergency', title: "안전 및 긴급", subtitle: "Emergency" },
        { id: 'child', title: "어린이 안전", subtitle: "Protection" },
        { id: 'outdoor', title: "실외 주의사항", subtitle: "Boundaries" },
        { id: 'water', title: "온수 시스템 (에코큐트)", subtitle: "EcoCute" },
        { id: 'trash', title: "쓰레기 분리배출", subtitle: "Trash" },
        { id: 'laundry', title: "세탁기 사용법", subtitle: "Laundry" },
        { id: 'rules', title: "에티켓 및 관리", subtitle: "Rules" }
      ]
    }
  };

  const addGuest = () => setGuests([...guests, createGuestTemplate('adult')]);
  const removeGuest = (id) => setGuests(guests.filter(g => g.id !== id));
  const updateGuest = (id, field, value) => setGuests(guests.map(g => g.id === id ? { ...g, [field]: value } : g));

  const lookupZipCode = async (guestId, zip) => {
    if (!zip || zip.length < 7) return;
    setIsLookingUpZip(guestId);
    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const item = data.results[0];
        const fullAddress = `${item.address1}${item.address2}${item.address3}`;
        updateGuest(guestId, 'address', fullAddress);
      }
    } catch (err) { console.error("Postal Lookup Error", err); }
    finally { setIsLookingUpZip(null); }
  };

  const isRegValid = () => {
    return guests.every(g => {
      const basic = g.name && g.age;
      const minorCheck = parseInt(g.age) < 18 ? (g.guardianName && g.guardianPhone) : true;
      if (g.isResident) return basic && g.occupation && g.address && minorCheck;
      return basic && g.nationality && g.passportNumber && g.passportPhoto && minorCheck;
    });
  };

  const handleNext = async () => {
    const t = translations[lang] || translations['en'];
    if (currentStep < t.steps.length - 1) { setCurrentStep(currentStep + 1); } 
    else if (hasAgreed) {
      const finalData = [
        ...guests,
        ...Array.from({length: infantCount}).map((_, i) => ({ type: 'infant', id: `infant-${i}`, name: `Infant ${i+1}`, age: '0-2', isResident: true }))
      ];
      const success = await onSubmit(finalData);
      if (success) setIsCompleted(true);
    }
  };

  if (!lang) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 animate-in fade-in">
        <div className="w-full max-w-sm space-y-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-sm mb-4 border border-slate-100">
            <Languages className="w-8 h-8 text-slate-900" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Choose Language / 選擇語言</h1>
          <div className="grid grid-cols-1 gap-3">
            {Object.entries(langConfig).map(([key, value]) => (
              <button key={key} onClick={() => setLang(key)} className="group flex items-center justify-between p-4 bg-white hover:bg-slate-900 rounded-2xl border border-slate-100 shadow-sm transition-all duration-300">
                <p className="font-bold text-slate-900 group-hover:text-white">{value.label}</p>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-white" />
              </button>
            ))}
          </div>
          <button onClick={onAdminRequest} className="absolute bottom-6 right-6 p-2 text-slate-300 hover:text-slate-500"><Lock className="w-4 h-4" /></button>
        </div>
      </div>
    );
  }

  const t = translations[lang] || translations['en'];
  const stepConfig = t.steps[currentStep];

  if (isCompleted) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
        <CheckCircle2 className="w-16 h-16 text-emerald-500 mb-6 mx-auto" />
        <h1 className="text-3xl font-bold mb-2">{t.welcomeTitle}</h1>
        <p className="text-slate-500 mb-6">{t.welcomeSub}</p>
        <div className="bg-slate-900 text-white p-8 rounded-[2rem] shadow-xl w-full max-w-sm">
           <p className="text-xs uppercase font-bold opacity-50 mb-1">{t.roomNo}</p>
           <p className="text-5xl font-black tracking-tighter">8808</p>
        </div>
        <div className="mt-8 p-6 bg-white rounded-2xl border border-slate-100 max-w-sm w-full space-y-4 text-left">
           <div className="flex items-center gap-3"><Wifi className="w-5 h-5 text-blue-500"/><p className="text-sm"><b>Wi-Fi:</b> Welcome2026</p></div>
           <div className="flex items-center gap-3"><Coffee className="w-5 h-5 text-amber-500"/><p className="text-sm"><b>{t.breakfast}:</b> 07:00-10:30 ({t.breakfastLoc})</p></div>
        </div>
      </div>
    );
  }

  const progress = ((currentStep + 1) / t.steps.length) * 100;

  const getStepIcon = (id) => {
    switch(id) {
      case 'welcome': return <BellRing className="w-12 h-12 text-amber-600 animate-pulse" />;
      case 'count': return <Users className="w-12 h-12 text-blue-600" />;
      case 'registration': return <UserCheck className="w-12 h-12 text-blue-600" />;
      case 'emergency': return <AlertTriangle className="w-12 h-12 text-rose-500" />;
      case 'child': return <Baby className="w-12 h-12 text-sky-500" />;
      case 'outdoor': return <MapPin className="w-12 h-12 text-teal-500" />;
      case 'water': return <Flame className="w-12 h-12 text-orange-500" />;
      case 'trash': return <Trash2 className="w-12 h-12 text-emerald-500" />;
      case 'laundry': return <Wrench className="w-12 h-12 text-blue-500" />;
      case 'rules': return <UserCheck className="w-12 h-12 text-slate-600" />;
      default: return <Info className="w-12 h-12 text-slate-400" />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <button onClick={() => setLang(null)} className="fixed top-6 right-6 z-50 flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-full shadow-sm text-xs font-bold"><Languages className="w-4 h-4" /> {t.changeLang}</button>
      
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <div className="flex justify-between items-end mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{t.guideTitle}</span>
            <span className="text-xs font-bold text-slate-900">{currentStep + 1} / {t.steps.length}</span>
          </div>
          <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-slate-900 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="bg-white rounded-[2rem] shadow-2xl border border-slate-100 p-8 md:p-10 flex flex-col min-h-[580px]">
          <div className="flex-1 flex flex-col items-center text-center">
            <div className="mb-6 p-4 bg-slate-50 rounded-2xl">{getStepIcon(stepConfig.id)}</div>
            <h2 className="text-2xl font-bold text-slate-900 mb-1 leading-tight">{stepConfig.title}</h2>
            <p className="text-sm font-medium text-slate-400 mb-8 uppercase tracking-wide">{stepConfig.subtitle}</p>
            
            <div className="w-full text-left">
              {stepConfig.id === 'welcome' && <p className="text-gray-600 leading-relaxed text-sm bg-gray-50 p-6 rounded-2xl border italic">{t.welcomeIntro}</p>}

              {stepConfig.id === 'count' && (
                <div className="space-y-4 py-4">
                  <div className="p-4 bg-slate-50 rounded-2xl flex items-center justify-between">
                    <div><p className="font-bold text-slate-800 text-sm">{t.countAdults}</p></div>
                    <div className="flex items-center gap-4">
                      <button onClick={() => guests.length > 1 && removeGuest(guests[guests.length-1].id)} className="w-8 h-8 rounded-full border border-slate-300">-</button>
                      <span className="font-bold">{guests.length}</span>
                      <button onClick={addGuest} className="w-8 h-8 rounded-full border border-slate-300">+</button>
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-2xl flex items-center justify-between">
                    <div><p className="font-bold text-slate-800 text-sm">{t.infantLabel}</p></div>
                    <div className="flex items-center gap-4">
                      <button onClick={() => infantCount > 0 && setInfantCount(infantCount - 1)} className="w-8 h-8 rounded-full border border-slate-300">-</button>
                      <span className="font-bold">{infantCount}</span>
                      <button onClick={() => setInfantCount(infantCount + 1)} className="w-8 h-8 rounded-full border border-slate-300">+</button>
                    </div>
                  </div>
                </div>
              )}

              {stepConfig.id === 'registration' && (
                <div className="space-y-6 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {guests.map((guest, idx) => (
                    <div key={guest.id} className="p-5 bg-slate-50/50 rounded-2xl border border-slate-100 space-y-4 shadow-sm relative">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase text-slate-400">{t.guestLabel} {idx + 1}</span>
                        {guests.length > 1 && (
                          <button 
                            onClick={() => removeGuest(guest.id)} 
                            className="text-slate-300 hover:text-rose-500 transition-colors p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="flex bg-white p-1 rounded-xl border">
                        <button onClick={() => updateGuest(guest.id, 'isResident', true)} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${guest.isResident ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400'}`}>{t.regResident}</button>
                        <button onClick={() => updateGuest(guest.id, 'isResident', false)} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${!guest.isResident ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400'}`}>{t.regTourist}</button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormName}</label>
                          <input type="text" value={guest.name} onChange={(e) => updateGuest(guest.id, 'name', e.target.value)} className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm shadow-sm outline-none" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormAge}</label>
                          <input type="number" value={guest.age} onChange={(e) => updateGuest(guest.id, 'age', e.target.value)} className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm shadow-sm outline-none" />
                        </div>
                        <div>
                          <label className={`text-[10px] font-bold ml-1 uppercase ${parseInt(guest.age) < 18 ? 'text-slate-300' : 'text-slate-400'}`}>{t.regFormOcc}</label>
                          <input 
                            type="text" 
                            value={guest.occupation} 
                            disabled={parseInt(guest.age) < 18}
                            onChange={(e) => updateGuest(guest.id, 'occupation', e.target.value)} 
                            className={`w-full p-3 border border-slate-100 rounded-xl text-sm shadow-sm outline-none transition-colors ${parseInt(guest.age) < 18 ? 'bg-slate-100/50 text-slate-300 cursor-not-allowed' : 'bg-white text-slate-900'}`} 
                          />
                        </div>
                        {guest.isResident ? (
                          <div className="col-span-2 space-y-3">
                            <div>
                               <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormZip}</label>
                               <div className="flex gap-2">
                                 <input type="text" placeholder={t.zipPlaceholder} value={guest.postalCode} onChange={(e) => updateGuest(guest.id, 'postalCode', e.target.value.replace(/\D/g,''))} className="flex-1 p-3 bg-white border border-slate-100 rounded-xl text-sm font-mono" maxLength={7} />
                                 <button onClick={() => lookupZipCode(guest.id, guest.postalCode)} disabled={guest.postalCode.length < 7 || isLookingUpZip === guest.id} className="px-4 bg-slate-900 text-white rounded-xl text-xs font-bold disabled:bg-slate-200 flex items-center gap-2">
                                   {isLookingUpZip === guest.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} {isLookingUpZip === guest.id ? t.zipLoading : t.zipLookup}
                                 </button>
                               </div>
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormAddr}</label>
                              <input type="text" value={guest.address} onChange={(e) => updateGuest(guest.id, 'address', e.target.value)} className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm" placeholder="Osaka-fu, Naniwa-ku..." />
                            </div>
                          </div>
                        ) : (
                          <div className="col-span-2 grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormNation}</label>
                              <select 
                                value={guest.nationality} 
                                onChange={(e) => updateGuest(guest.id, 'nationality', e.target.value)}
                                className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm shadow-sm outline-none appearance-none cursor-pointer"
                              >
                                <option value="">-- {t.selectCountry} --</option>
                                {COUNTRY_DATA.map(c => (
                                  <option key={c.code} value={c.code}>{c.names[lang] || c.names['en']}</option>
                                ))}
                              </select>
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormPass}</label>
                              <input type="text" value={guest.passportNumber} onChange={(e) => updateGuest(guest.id, 'passportNumber', e.target.value)} className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm" />
                            </div>
                            <div className="col-span-2 relative">
                                <input type="file" accept="image/*" className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer" onChange={(e) => fileToBase64(e.target.files[0]).then(base64 => updateGuest(guest.id, 'passportPhoto', base64))} />
                                <div className={`p-4 border-2 border-dashed rounded-xl flex items-center justify-center gap-2 ${guest.passportPhoto ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-white border-slate-100 text-slate-300'}`}>
                                  <Camera className="w-4 h-4" /> <span className="text-[10px] font-bold uppercase">{guest.passportPhoto ? 'Uploaded' : t.regPassportUpload}</span>
                                </div>
                            </div>
                          </div>
                        )}
                        {guest.age && parseInt(guest.age) < 18 && (
                          <div className="col-span-2 bg-rose-50 p-4 rounded-xl border border-rose-100 space-y-3">
                             <p className="text-[10px] font-bold text-rose-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {t.regMinorAlert}</p>
                             <div className="grid grid-cols-2 gap-2">
                                <input type="text" placeholder={t.regFormName} value={guest.guardianName} onChange={(e) => updateGuest(guest.id, 'guardianName', e.target.value)} className="w-full p-2 bg-white rounded-lg text-xs outline-none" />
                                <input type="text" placeholder="Phone" value={guest.guardianPhone} onChange={(e) => updateGuest(guest.id, 'guardianPhone', e.target.value)} className="w-full p-2 bg-white rounded-lg text-xs outline-none" />
                             </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <button onClick={addGuest} className="w-full py-4 border-2 border-dashed border-slate-200 rounded-2xl flex items-center justify-center gap-2 text-slate-400 hover:text-slate-900 transition-all focus:ring-1 focus:ring-slate-900 outline-none"><UserPlus className="w-5 h-5" /> <span className="text-xs font-bold uppercase">{t.addGuest}</span></button>
                </div>
              )}

              {stepConfig.id === 'emergency' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-rose-600 text-white p-5 rounded-3xl shadow-lg flex flex-col items-center"><p className="text-[10px] font-black uppercase mb-1">{t.emergencyFire}</p><p className="text-4xl font-black">119</p></div>
                    <div className="bg-slate-800 text-white p-5 rounded-3xl shadow-lg flex flex-col items-center"><p className="text-[10px] font-black uppercase mb-1">{t.emergencyPolice}</p><p className="text-4xl font-black">110</p></div>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-2xl border text-xs text-gray-600 space-y-2">
                    <div className="flex gap-2"><ShieldCheck className="w-4 h-4 text-slate-400 shrink-0" /><p>{t.emergencyAdvice}</p></div>
                    <div className="flex gap-2"><Zap className="w-4 h-4 text-slate-400 shrink-0" /><p>{t.voltageNotice}</p></div>
                  </div>
                </div>
              )}

              {stepConfig.id === 'child' && (
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 flex items-start gap-4 transition-all hover:bg-blue-50">
                    <Waves className="w-6 h-6 text-blue-400 mt-1 shrink-0" />
                    <div><p className="font-bold text-sm text-blue-900 mb-1">{t.bathSafetyTitle}</p><p className="text-xs text-blue-700 leading-relaxed">{t.bathSafetyDesc}</p></div>
                  </div>
                  <div className="p-4 bg-orange-50/50 rounded-2xl border border-orange-100 flex items-start gap-4 transition-all hover:bg-orange-50">
                    <VolumeX className="w-6 h-6 text-orange-400 mt-1 shrink-0" />
                    <div><p className="font-bold text-sm text-orange-900 mb-1">{t.laundrySafetyTitle}</p><p className="text-xs text-orange-700 leading-relaxed">{t.laundrySafetyDesc}</p></div>
                  </div>
                </div>
              )}

              {stepConfig.id === 'outdoor' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl transition-all hover:bg-slate-100"><MapPin className="w-5 h-5 text-slate-400 shrink-0" /><div><p className="font-bold text-sm">{t.hillWarningTitle}</p><p className="text-xs text-gray-500">{t.hillWarningDesc}</p></div></div>
                  <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl transition-all hover:bg-slate-100"><AlertTriangle className="w-5 h-5 text-slate-400 shrink-0" /><div><p className="font-bold text-sm">{t.garageWarningTitle}</p><p className="text-xs text-gray-500">{t.garageWarningDesc}</p></div></div>
                </div>
              )}

              {stepConfig.id === 'water' && (
                <div className="space-y-4">
                  <div className="p-4 bg-amber-50/50 border border-amber-200 rounded-2xl space-y-2">
                    <div className="flex items-center gap-2 text-amber-900 font-bold text-sm"><Clock className="w-4 h-4" /> {t.waterNoticeTitle}</div>
                    <p className="text-xs text-amber-800 leading-relaxed italic">{t.waterNoticeDesc}</p>
                  </div>
                  <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl"><Wrench className="w-5 h-5 text-slate-400 shrink-0" /><div><p className="font-bold text-sm">{t.waterResetTitle}</p><p className="text-xs text-gray-500">{t.waterResetDesc}</p></div></div>
                </div>
              )}

              {stepConfig.id === 'trash' && (
                <div className="space-y-4">
                   <div className="flex items-center gap-4 p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                    <Trash2 className="w-6 h-6 text-emerald-600 shrink-0" />
                    <div><p className="font-bold text-sm text-emerald-900">{t.trashBurnableTitle}</p><p className="text-xs text-emerald-700">{t.trashBurnableDesc}</p></div>
                  </div>
                  <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl"><Container className="w-6 h-6 text-slate-400 shrink-0" /><div><p className="font-bold text-sm">{t.trashResourceTitle}</p><p className="text-xs text-gray-500">{t.trashResourceDesc}</p></div></div>
                </div>
              )}

              {stepConfig.id === 'laundry' && (
                <div className="space-y-4">
                  <div className="bg-gray-50 p-4 rounded-2xl space-y-3">
                    <p className="font-bold text-xs uppercase text-slate-400 tracking-widest">{t.laundryGuideTitle}</p>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="bg-white p-3 rounded-xl border text-xs font-bold">{t.laundryStep1}</div>
                      <div className="bg-white p-3 rounded-xl border text-xs font-bold">{t.laundryStep2}</div>
                      <div className="bg-white p-3 rounded-xl border text-xs font-bold">{t.laundryStep3}</div>
                      <div className="bg-white p-3 rounded-xl border text-xs font-bold">{t.laundryStep4}</div>
                    </div>
                  </div>
                </div>
              )}

              {stepConfig.id === 'rules' && (
                <div className="space-y-6">
                  <div className="p-4 bg-gray-50 rounded-2xl space-y-3 text-xs text-gray-600">
                    <div className="flex gap-3"><UserCheck className="w-5 h-5 text-slate-400 shrink-0" /><p>{t.rulesManager}</p></div>
                    <div className="flex gap-3"><VolumeX className="w-5 h-5 text-slate-400 shrink-0" /><p>{t.rulesNoise}</p></div>
                  </div>
                  <label className="flex items-center gap-4 p-6 bg-emerald-50 rounded-2xl border border-emerald-100 cursor-pointer shadow-sm group transition-all hover:bg-emerald-100">
                    <input type="checkbox" className="w-6 h-6 rounded text-emerald-600 transition-transform group-hover:scale-110" checked={hasAgreed} onChange={(e) => setHasAgreed(e.target.checked)} />
                    <span className="text-emerald-900 font-bold text-sm">{t.agree}</span>
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="mt-8 flex gap-4">
            {currentStep > 0 && <button onClick={() => setCurrentStep(currentStep - 1)} className="p-4 rounded-2xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"><ChevronLeft className="w-6 h-6" /></button>}
            <button 
              onClick={handleNext} 
              disabled={(stepConfig.id === 'registration' && !isRegValid()) || (stepConfig.id === 'rules' && !hasAgreed) || isSubmitting} 
              className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-bold transition-all ${((stepConfig.id === 'registration' && !isRegValid()) || (stepConfig.id === 'rules' && !hasAgreed)) ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-slate-900 text-white shadow-lg hover:bg-slate-800'}`}
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (currentStep === t.steps.length - 1 ? t.finish : t.next)}
              {!isSubmitting && <ChevronRight className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
        .animate-shake { animation: shake 0.3s ease-in-out; }
      `}</style>
    </div>
  );
};

export default App;