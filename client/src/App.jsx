import { useState, useEffect } from 'react';
import {
  Wifi,
  MapPin,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Info,
  BellRing,
  Languages,
  UserCheck,
  Baby,
  AlertTriangle,
  Wrench,
  Flame,
  Trash2,
  Camera,
  Users,
  UserPlus,
  Lock,
  Loader2,
  Search,
  Home} from 'lucide-react';
import AdminPage from './AdminPage';

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
const API_URL = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';
const STEP_STORAGE_KEY = 'checkin.steps';
const DEFAULT_LANG = 'jp';

const DB = {
  async getAllRecords(adminToken) {
    const res = await fetch(`${API_URL}/records`, {
      headers: {
        'x-admin-session': adminToken
      }
    });
    if (!res.ok) throw new Error('Failed to fetch records');
    return await res.json();
  },

  async validateAdminToken(adminToken) {
    const res = await fetch(`${API_URL}/admin/session`, {
      headers: {
        'x-admin-session': adminToken
      }
    });
    return res.ok;
  },

  async getPasskeyStatus() {
    const res = await fetch(`${API_URL}/admin/passkeys/status`);
    if (!res.ok) throw new Error('Failed to fetch passkey status');
    return await res.json();
  },

  async getPasskeyRegisterOptions(bootstrapToken) {
    const res = await fetch(`${API_URL}/admin/passkeys/register/options`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': bootstrapToken
      },
      body: JSON.stringify({ bootstrapToken })
    });
    if (!res.ok) throw new Error('Failed to get register options');
    return await res.json();
  },

  async verifyPasskeyRegistration(payload) {
    const res = await fetch(`${API_URL}/admin/passkeys/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to verify passkey registration');
    return await res.json();
  },

  async getPasskeyAuthOptions() {
    const res = await fetch(`${API_URL}/admin/passkeys/auth/options`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to get auth options');
    return await res.json();
  },

  async verifyPasskeyAuth(payload) {
    const res = await fetch(`${API_URL}/admin/passkeys/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to verify passkey auth');
    return await res.json();
  },

  async logoutAdmin(adminToken) {
    const res = await fetch(`${API_URL}/admin/logout`, {
      method: 'POST',
      headers: {
        'x-admin-session': adminToken
      }
    });
    return res.ok;
  },

  async getSteps(lang) {
    const res = await fetch(`${API_URL}/steps?lang=${encodeURIComponent(lang)}`);
    if (!res.ok) throw new Error('Failed to fetch steps');
    return await res.json();
  },

  async updateSteps(adminToken, lang, steps) {
    const res = await fetch(`${API_URL}/admin/steps?lang=${encodeURIComponent(lang)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-session': adminToken
      },
      body: JSON.stringify({ steps })
    });
    if (!res.ok) throw new Error('Failed to save steps');
    return await res.json();
  },

  async insertRecord(record) {
    try {
      const res = await fetch(`${API_URL}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, error: payload.error || 'Server Error' };
      }
      return payload;
    } catch (error) {
      console.error("Submission Error:", error);
      return { success: false, error: "Connection Failed" };
    }
  },


  async setGuestDeleted(adminToken, recordId, guestId, deleted) {
    const res = await fetch(`${API_URL}/records/${encodeURIComponent(recordId)}/guests/${encodeURIComponent(guestId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-session': adminToken
      },
      body: JSON.stringify({ deleted })
    });
    if (!res.ok) throw new Error('Failed to update guest deletion state');
    return await res.json();
  },

  exportCSV(records) {
    if (!records.length) return;
    const rows = [];
    rows.push(['Date', 'Group ID', 'Name', 'Type', 'Resident?', 'Nationality', 'Passport No', 'Address', 'Phone', 'Passport Image URL']);
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
          guest.phone || '-',
          guest.passportPhoto || 'N/A'
        ]);
      });
    });
    const csvContent = rows.map(e => e.join(",")).join("\n");
    const encodedUri = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `hotel_guests_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(encodedUri);
  }
};

const fileToBase64 = (file) => {
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

const createStepId = () => `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const LANG_OPTIONS = [
  { value: 'jp', label: '日本語' },
  { value: 'en', label: 'English' },
  { value: 'zh-hans', label: '简体中文' },
  { value: 'zh-hant', label: '繁體中文' },
  { value: 'ko', label: '한국어' }
];

const translations = {
  'zh-hans': {
    next: "下一步", prev: "上一步", finish: "确认并获取房号", agree: "我已详读并同意遵守上述所有守则",
    zipLookup: "查询", zipPlaceholder: "7位邮编", zipLoading: "查询中...", regFormAddr: "日本住址", regFormZip: "邮政编码",
    roomNo: "您的房号", wifi: "Wi-Fi 密码", copy: "复制", breakfast: "早餐时间", breakfastLoc: "2楼西餐厅",
    service: "紧急协助", serviceDetail: "优先拨打紧急电话，再前往别栋联系管理人", welcomeTitle: "欢迎入住！", welcomeSub: "请开始您的愉快旅程",
    footer: "您的安全与舒适是我们的最高宗旨。", guideTitle: "入住导览", changeLang: "语言", manualLink: "说明书 PDF",
    regResident: "日本居民", regTourist: "访日游客", regFormName: "姓名", regFormAge: "年龄", regFormOcc: "职业", regFormPhone: "电话号码",
    regFormNation: "国籍", regFormPass: "护照号码", regPassportUpload: "拍摄/上传护照照片", regMinorAlert: "未成年人需填监护人信息",
    addGuest: "增加人员", guestLabel: "住客", infantLabel: "婴儿人数 (2岁以下)", countAdults: "住客人数 (成人/未成年)",
    selectCountry: "选择国家/地区",
    customStepEmpty: "此步骤暂无内容。",
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
    regResident: "日本居民", regTourist: "訪日遊客", regFormName: "姓名", regFormAge: "年齡", regFormOcc: "職業", regFormPhone: "電話號碼",
    regFormNation: "國籍", regFormPass: "護照號碼", regPassportUpload: "拍攝/上傳護照照片", regMinorAlert: "未成年人需填監護人資訊",
    addGuest: "增加人員", guestLabel: "住客", infantLabel: "嬰兒人數 (2歲以下)", countAdults: "住客人數 (成人/未成年)",
    selectCountry: "選擇國家/地區",
    customStepEmpty: "此步驟目前沒有內容。",
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
    next: "Next", prev: "Back", finish: "Confirm & Get Room No.", agree: "I have read and agree to all rules above.",
    zipLookup: "Lookup", zipPlaceholder: "7-digit ZIP", zipLoading: "Searching...", regFormAddr: "Japanese address", regFormZip: "Postal code",
    roomNo: "Your Room No.", wifi: "Wi-Fi Password", copy: "Copy", breakfast: "Breakfast Time", breakfastLoc: "2F Restaurant",
    service: "Emergency Support", serviceDetail: "Call emergency first, then contact the manager in another building.", welcomeTitle: "Welcome!", welcomeSub: "Start your journey",
    footer: "Your safety and comfort are our top priority.", guideTitle: "Check-in Guide", changeLang: "Language", manualLink: "Manual PDF",
    regResident: "Japan Resident", regTourist: "Visitor", regFormName: "Name", regFormAge: "Age", regFormOcc: "Occupation", regFormPhone: "Phone Number",
    regFormNation: "Nationality", regFormPass: "Passport No.", regPassportUpload: "Upload passport photo", regMinorAlert: "Minors need guardian info",
    addGuest: "Add Guest", guestLabel: "Guest", infantLabel: "Infants (under 2)", countAdults: "Guest Count (adult/minor)",
    selectCountry: "Select country/region",
    customStepEmpty: "No content for this step yet.",
    steps: [
      { id: 'welcome', title: "Welcome", subtitle: "Welcome" },
      { id: 'count', title: "Guest Count", subtitle: "Guest Count" },
      { id: 'registration', title: "Registration", subtitle: "Osaka Regulation" },
      { id: 'emergency', title: "Emergency", subtitle: "Safety First" },
      { id: 'child', title: "Child Safety", subtitle: "Child Protection" },
      { id: 'outdoor', title: "Outdoor Warning", subtitle: "Outdoor Safety" },
      { id: 'water', title: "Hot Water System", subtitle: "EcoCute" },
      { id: 'trash', title: "Waste Guide", subtitle: "Waste Management" },
      { id: 'laundry', title: "Laundry", subtitle: "Laundry Guide" },
      { id: 'rules', title: "Etiquette", subtitle: "Etiquette" }
    ]
  },
  'jp': {
    next: "次へ", prev: "戻る", finish: "確認して部屋番号を取得", agree: "上記の規則を読み同意しました",
    zipLookup: "検索", zipPlaceholder: "郵便番号", zipLoading: "検索中...", regFormAddr: "日本の住所", regFormZip: "郵便番号",
    roomNo: "あなたの部屋番号", wifi: "Wi-Fi パスワード", copy: "コピー", breakfast: "朝食時間", breakfastLoc: "2階レストラン",
    service: "緊急連絡", serviceDetail: "先に緊急電話、次に管理人へ連絡。", welcomeTitle: "ようこそ！", welcomeSub: "旅を始めましょう",
    footer: "安全と快適さが最優先です。", guideTitle: "チェックイン案内", changeLang: "言語", manualLink: "マニュアル PDF",
    regResident: "日本在住", regTourist: "訪日観光客", regFormName: "氏名", regFormAge: "年齢", regFormOcc: "職業", regFormPhone: "電話番号",
    regFormNation: "国籍", regFormPass: "パスポート番号", regPassportUpload: "パスポート写真をアップロード", regMinorAlert: "未成年は保護者情報が必要",
    addGuest: "追加", guestLabel: "ゲスト", infantLabel: "乳児 (2歳未満)", countAdults: "人数 (成人/未成年)",
    selectCountry: "国/地域を選択",
    customStepEmpty: "このステップにはまだ内容がありません。",
    steps: [
      { id: 'welcome', title: "ようこそ", subtitle: "Welcome" },
      { id: 'count', title: "人数", subtitle: "Guest Count" },
      { id: 'registration', title: "登録", subtitle: "Osaka Regulation" },
      { id: 'emergency', title: "緊急", subtitle: "Safety First" },
      { id: 'child', title: "子どもの安全", subtitle: "Child Protection" },
      { id: 'outdoor', title: "屋外注意", subtitle: "Outdoor Safety" },
      { id: 'water', title: "給湯システム", subtitle: "EcoCute" },
      { id: 'trash', title: "ゴミ分別", subtitle: "Waste Management" },
      { id: 'laundry', title: "洗濯", subtitle: "Laundry Guide" },
      { id: 'rules', title: "マナー", subtitle: "Etiquette" }
    ]
  },
  'ko': {
    next: "다음", prev: "뒤로", finish: "확인 후 객실 번호 받기", agree: "위 규칙을 읽고 동의합니다",
    zipLookup: "조회", zipPlaceholder: "7자리 우편번호", zipLoading: "조회 중...", regFormAddr: "일본 주소", regFormZip: "우편번호",
    roomNo: "객실 번호", wifi: "와이파이 비밀번호", copy: "복사", breakfast: "조식 시간", breakfastLoc: "2층 레스토랑",
    service: "긴급 지원", serviceDetail: "긴급 전화 후 관리자에게 연락.", welcomeTitle: "환영합니다!", welcomeSub: "여행을 시작하세요",
    footer: "안전과 편안함이 최우선입니다.", guideTitle: "체크인 안내", changeLang: "언어", manualLink: "매뉴얼 PDF",
    regResident: "일본 거주자", regTourist: "방문객", regFormName: "이름", regFormAge: "나이", regFormOcc: "직업", regFormPhone: "전화번호",
    regFormNation: "국적", regFormPass: "여권 번호", regPassportUpload: "여권 사진 업로드", regMinorAlert: "미성년자는 보호자 정보 필요",
    addGuest: "인원 추가", guestLabel: "게스트", infantLabel: "영아 (2세 이하)", countAdults: "인원 수 (성인/미성년)",
    selectCountry: "국가/지역 선택",
    customStepEmpty: "이 단계에는 아직 내용이 없습니다.",
    steps: [
      { id: 'welcome', title: "환영", subtitle: "Welcome" },
      { id: 'count', title: "인원 수", subtitle: "Guest Count" },
      { id: 'registration', title: "등록", subtitle: "Osaka Regulation" },
      { id: 'emergency', title: "긴급", subtitle: "Safety First" },
      { id: 'child', title: "아동 안전", subtitle: "Child Protection" },
      { id: 'outdoor', title: "야외 경고", subtitle: "Outdoor Safety" },
      { id: 'water', title: "온수 시스템", subtitle: "EcoCute" },
      { id: 'trash', title: "쓰레기 분리", subtitle: "Waste Management" },
      { id: 'laundry', title: "세탁", subtitle: "Laundry Guide" },
      { id: 'rules', title: "에티켓", subtitle: "Etiquette" }
    ]
  }
};

const buildDefaultSteps = (lang) => {
  const base = translations[lang]?.steps || translations[DEFAULT_LANG].steps;
  return base.map(step => ({
    ...step,
    enabled: true,
    type: 'builtin',
    content: ''
  }));
};

const normalizeSteps = (steps, fallback) => {
  if (!Array.isArray(steps)) return fallback;
  return steps.map((step) => ({
    id: step.id || createStepId(),
    title: step.title || '',
    subtitle: step.subtitle || '',
    enabled: step.enabled !== false,
    type: step.type === 'custom' ? 'custom' : 'builtin',
    content: step.content || ''
  }));
};

const BUILTIN_STEP_FALLBACKS = {
  'zh-hans': {
    welcome: '<p>尊贵的客人，欢迎您选择入住。为确保您充分享受这里的宁静与便利，并保障所有住客安全，请逐页阅读本指南。</p>',
    emergency: '<p><strong>紧急电话：</strong>火警/急救 119，警察 110。</p><p>请优先拨打紧急电话，在确保自身安全后再联系管理方。</p><p>日本电压为 100V，请避免同时开启多个大功率电器以防跳闸。</p>',
    child: '<p><strong>儿童安全提醒</strong></p><ul><li>窗边、楼梯等区域请勿让儿童单独停留。</li><li>浴室地面湿滑，请看护儿童防止跌倒。</li><li>滚筒洗衣机存在窒息风险，平时请保持舱门关闭。</li></ul>',
    outdoor: '<p><strong>户外安全提醒</strong></p><ul><li>夜间出入请注意周边道路与边界区域。</li><li>车库及坡道附近地面高低差较大，请慢行。</li></ul>',
    water: '<p><strong>热水系统（EcoCute）说明</strong></p><ul><li>多人连续使用后热水可能暂时不足，请等待系统加热。</li><li>如无热水，可尝试重置设备或联系管理方。</li></ul>',
    trash: '<p><strong>垃圾分类</strong></p><ul><li>可燃垃圾：厨余、纸屑、塑料袋、PET 瓶及瓶盖等。</li><li>资源垃圾：瓶/罐按分类放入容器，满后请打包放置到指定位置。</li></ul>',
    laundry: '<p><strong>Iris Ohyama 洗烘一体机快速步骤</strong></p><ol><li>放入衣物并关门</li><li>加入洗涤剂</li><li>选择洗濯/乾燥模式</li><li>按下开始（スタート）</li></ol>',
    rules: '<p><strong>邻里礼仪与管理规则</strong></p><ul><li>管理人可能因巡查进入公用空间，进入前会先打招呼。</li><li>22:00 后请保持室内外安静，避免影响邻居。</li><li>请爱护房屋设施，并在规定时间完成退房。</li></ul>'
  },
  'zh-hant': {
    welcome: '<p>尊貴的客人，歡迎您選擇入住。為確保您享受寧靜與便利，並保障所有住客安全，請逐頁閱讀本指南。</p>',
    emergency: '<p><strong>緊急電話：</strong>火警/急救 119，警察 110。</p><p>請先撥打緊急電話，確保安全後再聯絡管理方。</p><p>日本電壓為 100V，請避免同時使用多個高功率電器。</p>',
    child: '<p><strong>兒童安全提醒</strong></p><ul><li>請勿讓兒童獨自在窗邊或樓梯附近活動。</li><li>浴室地面濕滑，請加強看護。</li><li>滾筒洗衣機有窒息風險，請保持艙門關閉。</li></ul>',
    outdoor: '<p><strong>戶外安全提醒</strong></p><ul><li>夜間請注意周邊道路與邊界區域。</li><li>車庫與坡道有高低差，請慢行。</li></ul>',
    water: '<p><strong>熱水系統（EcoCute）說明</strong></p><ul><li>多人連續使用後熱水可能暫時不足，請稍候加熱。</li><li>如仍無熱水，請嘗試重置或聯絡管理方。</li></ul>',
    trash: '<p><strong>垃圾分類</strong></p><ul><li>可燃垃圾：廚餘、紙屑、塑膠袋、PET 瓶與瓶蓋等。</li><li>資源垃圾：瓶/罐分類投入，裝滿後移至指定處。</li></ul>',
    laundry: '<p><strong>Iris Ohyama 洗烘一體機快速步驟</strong></p><ol><li>放入衣物並關門</li><li>加入洗劑</li><li>選擇洗濯/乾燥模式</li><li>按下開始（スタート）</li></ol>',
    rules: '<p><strong>鄰里禮儀與管理規範</strong></p><ul><li>管理人巡查時可能進入公用空間，會先告知。</li><li>22:00 後請保持安靜。</li><li>請愛護屋內設備並按時退房。</li></ul>'
  },
  en: {
    welcome: '<p>Welcome! To ensure a safe and comfortable stay for everyone, please review each step carefully.</p>',
    emergency: '<p><strong>Emergency numbers:</strong> Fire/Ambulance 119, Police 110.</p><p>Call emergency services first, then contact management.</p><p>Japan uses 100V power. Avoid running multiple high-power appliances at once.</p>',
    child: '<p><strong>Child safety</strong></p><ul><li>Do not leave children unattended near windows or stairs.</li><li>Bathroom floors can be slippery.</li><li>Keep washer door closed to avoid suffocation risk.</li></ul>',
    outdoor: '<p><strong>Outdoor safety</strong></p><ul><li>Be careful around slopes and boundaries, especially at night.</li><li>Watch your step around the garage area.</li></ul>',
    water: '<p><strong>Hot-water system (EcoCute)</strong></p><ul><li>Hot water may run low after consecutive use.</li><li>If no hot water, allow time for reheating or contact management.</li></ul>',
    trash: '<p><strong>Waste separation</strong></p><ul><li>Burnable: food waste, paper, plastic bags, PET bottles/caps.</li><li>Recyclables: sort bottles/cans and place them in designated bins.</li></ul>',
    laundry: '<p><strong>Laundry quick guide</strong></p><ol><li>Load clothes and close the door</li><li>Add detergent</li><li>Select wash/dry mode</li><li>Press Start</li></ol>',
    rules: '<p><strong>House rules</strong></p><ul><li>Management may enter common areas during inspection after notification.</li><li>Please keep quiet after 22:00.</li><li>Respect neighbors and take care of the facilities.</li></ul>'
  },
  jp: {
    welcome: '<p>ようこそ。安全で快適なご滞在のため、各ステップの案内をご確認ください。</p>',
    emergency: '<p><strong>緊急連絡先：</strong>火災・救急 119、警察 110。</p><p>緊急時は先に通報し、その後管理者へ連絡してください。</p>',
    child: '<p><strong>お子様の安全について</strong></p><ul><li>窓辺・階段付近にお子様を一人で近づけないでください。</li><li>浴室の床は滑りやすいためご注意ください。</li></ul>',
    outdoor: '<p><strong>屋外の注意事項</strong></p><ul><li>夜間は境界・坂道付近の安全にご注意ください。</li><li>ガレージ周辺では足元にご注意ください。</li></ul>',
    water: '<p><strong>給湯システム（エコキュート）</strong></p><ul><li>連続使用後はお湯が不足する場合があります。</li><li>復旧しない場合は管理者へご連絡ください。</li></ul>',
    trash: '<p><strong>ゴミ分別</strong></p><ul><li>可燃：生ごみ、紙くず、袋、PET ボトル・キャップ等。</li><li>資源：びん・缶を分別して指定場所へ。</li></ul>',
    laundry: '<p><strong>洗濯機クイックガイド</strong></p><ol><li>衣類を入れてドアを閉める</li><li>洗剤を入れる</li><li>洗濯/乾燥モードを選ぶ</li><li>スタートを押す</li></ol>',
    rules: '<p><strong>滞在ルール</strong></p><ul><li>管理者が巡回で共用部に入る場合があります（事前案内あり）。</li><li>22:00以降は静かにお過ごしください。</li><li>設備を丁寧にご利用ください。</li></ul>'
  },
  ko: {
    welcome: '<p>환영합니다. 안전하고 편안한 숙박을 위해 각 단계 안내를 확인해 주세요.</p>',
    emergency: '<p><strong>긴급 연락처:</strong> 화재/구급 119, 경찰 110.</p><p>긴급 시 먼저 신고한 뒤 관리자에게 연락해 주세요.</p>',
    child: '<p><strong>어린이 안전</strong></p><ul><li>창가·계단 주변에 아이를 혼자 두지 마세요.</li><li>욕실 바닥은 미끄러울 수 있습니다.</li></ul>',
    outdoor: '<p><strong>야외 안전</strong></p><ul><li>특히 야간에는 경계·경사 구역을 주의해 주세요.</li><li>차고 주변 이동 시 발밑을 확인해 주세요.</li></ul>',
    water: '<p><strong>온수 시스템(EcoCute)</strong></p><ul><li>연속 사용 시 온수가 일시적으로 부족할 수 있습니다.</li><li>복구되지 않으면 관리자에게 연락해 주세요.</li></ul>',
    trash: '<p><strong>쓰레기 분리배출</strong></p><ul><li>가연성: 음식물, 종이, 비닐, PET 병/캡 등.</li><li>재활용: 병/캔을 분리해 지정 장소에 배출.</li></ul>',
    laundry: '<p><strong>세탁기 빠른 사용법</strong></p><ol><li>빨래를 넣고 문을 닫기</li><li>세제 넣기</li><li>세탁/건조 모드 선택</li><li>시작 버튼 누르기</li></ol>',
    rules: '<p><strong>숙박 규칙</strong></p><ul><li>관리자가 점검을 위해 공용공간에 출입할 수 있습니다.</li><li>22:00 이후에는 정숙 부탁드립니다.</li><li>시설을 소중히 이용해 주세요.</li></ul>'
  }
};

const getBuiltinStepFallback = (lang, stepId) => {
  const dict = BUILTIN_STEP_FALLBACKS[lang] || BUILTIN_STEP_FALLBACKS[DEFAULT_LANG] || {};
  return dict[stepId] || '';
};

const loadSteps = (lang) => {
  try {
    const raw = localStorage.getItem(`${STEP_STORAGE_KEY}.${lang}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeSteps(parsed, buildDefaultSteps(lang));
  } catch (error) {
    console.warn('無法讀取步驟設定:', error);
    return null;
  }
};

const saveSteps = (lang, steps) => {
  localStorage.setItem(`${STEP_STORAGE_KEY}.${lang}`, JSON.stringify(steps));
};

const StepContent = ({ content, fallback }) => {
  const html = (content || fallback || '').trim();
  if (!html) {
    return <p className="text-sm text-slate-500">暂无内容</p>;
  }
  return (
    <div
      className="step-content space-y-4 text-sm text-slate-600"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

// ----------------------------------------------------------------------
// 主程序入口
// ----------------------------------------------------------------------
const App = () => {
  const getViewFromPath = () => window.location.pathname.startsWith('/admin') ? 'admin' : 'guest';
  const [view, setView] = useState(getViewFromPath);
  const [loading, setLoading] = useState(false);
  const [adminToken, setAdminToken] = useState('');

  useEffect(() => {
    const handleRouteChange = () => {
      setView(getViewFromPath());
    };
    window.addEventListener('popstate', handleRouteChange);
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
    };
  }, []);

  const navigateTo = (path) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setView(getViewFromPath());
  };

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

  if (view === 'admin') {
    return (
      <AdminPage
        adminToken={adminToken}
        onAdminTokenChange={setAdminToken}
        onExitAdmin={() => navigateTo('/')}
        db={DB}
        defaultLang={DEFAULT_LANG}
        translations={translations}
        buildDefaultSteps={buildDefaultSteps}
        loadSteps={loadSteps}
        saveSteps={saveSteps}
        normalizeSteps={normalizeSteps}
        createStepId={createStepId}
        StepContent={StepContent}
        langOptions={LANG_OPTIONS}
      />
    );
  }

  return (
    <GuestFlow
      onSubmit={handleGuestSubmit}
      onAdminRequest={() => navigateTo('/admin')}
      isSubmitting={loading}
    />
  );
};

// ----------------------------------------------------------------------
// 訪客端流程
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
        name: '', age: '', phone: '', address: '', postalCode: '', nationality: '', passportNumber: '', passportPhoto: null, guardianName: '', guardianPhone: ''
      }]);
    }
  }, []);

  const createGuestTemplate = (type = 'adult') => ({
    id: Math.random().toString(36).substr(2, 9),
    type,
    isResident: true,
    name: '', age: '', phone: '', address: '', postalCode: '', nationality: '', passportNumber: '', passportPhoto: null, guardianName: '', guardianPhone: ''
  });

  const [stepsConfig, setStepsConfig] = useState([]);

  useEffect(() => {
    let isActive = true;
    if (!lang) return () => { };

    DB.getSteps(lang)
      .then((steps) => {
        if (!isActive) return;
        const normalized = normalizeSteps(steps, buildDefaultSteps(lang));
        setStepsConfig(normalized);
        saveSteps(lang, normalized);
      })
      .catch(() => {
        if (!isActive) return;
        const storedSteps = loadSteps(lang);
        if (storedSteps) {
          setStepsConfig(storedSteps);
          return;
        }
        setStepsConfig(buildDefaultSteps(lang));
      });

    return () => {
      isActive = false;
    };
  }, [lang]);

  useEffect(() => {
    const active = stepsConfig.filter(step => step.enabled !== false);
    if (active.length && currentStep >= active.length) {
      setCurrentStep(0);
    }
  }, [stepsConfig, currentStep]);

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
      if (g.isResident) return basic && g.phone && g.address && minorCheck;
      return basic && g.nationality && g.passportNumber && g.passportPhoto && minorCheck;
    });
  };

  const handleNext = async () => {
    const activeSteps = steps.length;
    if (currentStep < activeSteps - 1) { setCurrentStep(currentStep + 1); }
    else {
      const requiresAgreement = steps.some((step) => step.id === 'rules');
      if (requiresAgreement && !hasAgreed) {
        return;
      }
      const infantGuests = Array.from({ length: infantCount }).map((_, i) => ({
        id: `infant-${i + 1}`,
        type: 'infant',
        name: `Infant ${i + 1}`,
        age: '0-2',
        isResident: true,
        phone: '-',
        address: '-',
        postalCode: '-',
        nationality: '-',
        passportNumber: '-',
        passportPhoto: null,
        guardianName: '-',
        guardianPhone: '-'
      }));
      const finalData = [...guests, ...infantGuests];
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
            {LANG_OPTIONS.map((option) => (
              <button key={option.value} onClick={() => setLang(option.value)} className="group flex items-center justify-between p-4 bg-white hover:bg-slate-900 rounded-2xl border border-slate-100 shadow-sm transition-all duration-300">
                <p className="font-bold text-slate-900 group-hover:text-white">{option.label}</p>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-white" />
              </button>
            ))}
          </div>
          <button onClick={onAdminRequest} className="absolute bottom-6 right-6 p-2 text-slate-300 hover:text-slate-500"><Lock className="w-4 h-4" /></button>
        </div>
      </div>
    );
  }

  const t = translations[lang || DEFAULT_LANG];
  const activeSteps = stepsConfig.length
    ? stepsConfig.filter(step => step.enabled !== false)
    : buildDefaultSteps(lang || DEFAULT_LANG);
  const steps = activeSteps.length ? activeSteps : buildDefaultSteps(lang || DEFAULT_LANG);
  const stepConfig = steps[currentStep];
  const hasContent = Boolean(stepConfig?.content?.trim());
  const builtinFallbackContent = stepConfig?.type === 'builtin' ? getBuiltinStepFallback(lang, stepConfig?.id) : '';

  if (isCompleted) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
        <CheckCircle2 className="w-16 h-16 text-emerald-500 mb-6 mx-auto" />
        <h1 className="text-3xl font-bold mb-2">{t.welcomeTitle}</h1>
        <p className="text-slate-500 mb-6">{t.welcomeSub}</p>
        <div className="bg-slate-900 text-white p-8 rounded-[2rem] shadow-xl w-full max-w-sm">
          <div className="flex items-center gap-3">
            <Wifi className="w-7 h-7 text-white-500" />
            <p className="text-md text-left">
              <b>Wi-Fi SSID:</b> Hotel Wifi <br></br>
              <b>Password:</b> password
            </p>
          </div>

          {/* <p className="text-xs uppercase font-bold opacity-50 mb-1">{t.roomNo}</p> */}
          {/* <p className="text-5xl font-black tracking-tighter">🎉</p> */}
        </div>
        <div className="mt-8 p-6 bg-white rounded-2xl border border-slate-100 max-w-sm w-full space-y-4 text-left">
          <div className="flex items-center gap-3"><Home className="w-5 h-5 text-blue-500" />
            <p className="text-sm"><b>AC control</b><br>
            </br> <a className='text-xs' href='https://homeassistant.kawachinagano.ox.gy:8123/' target='_blank'>https://homeassistant.kawachinagano.ox.gy:8123/</a>
            </p>
          </div>
          <img src="./ha-login-image.png"></img>
          {/* <div className="flex items-center gap-3"><Coffee className="w-5 h-5 text-amber-500"/><p className="text-sm"><b>{t.breakfast}:</b> 07:00-10:30 ({t.breakfastLoc})</p></div> */}
        </div>
      </div>
    );
  }

  const progress = ((currentStep + 1) / steps.length) * 100;

  const getStepIcon = (id) => {
    switch (id) {
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
            <span className="text-xs font-bold text-slate-900">{currentStep + 1} / {steps.length}</span>
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
              {(hasContent || stepConfig?.type === 'custom' || builtinFallbackContent) && (
                <div className="step-content-surface">
                  <StepContent content={stepConfig.content || builtinFallbackContent} fallback={t.customStepEmpty} />
                </div>
              )}

              {stepConfig.id === 'count' && (
                <div className="space-y-4 py-4">
                  <div className="p-4 bg-slate-50 rounded-2xl flex items-center justify-between">
                    <div><p className="font-bold text-slate-800 text-sm">{t.countAdults}</p></div>
                    <div className="flex items-center gap-4">
                      <button onClick={() => guests.length > 1 && removeGuest(guests[guests.length - 1].id)} className="w-8 h-8 rounded-full border border-slate-300">-</button>
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
                          <label className={`text-[10px] font-bold ml-1 uppercase ${parseInt(guest.age) < 18 ? 'text-slate-300' : 'text-slate-400'}`}>{t.regFormPhone}</label>
                          <input
                            type="text"
                            value={parseInt(guest.age) < 16 ? "000-0000-0000" : guest.phone}
                            disabled={parseInt(guest.age) < 16}
                            onChange={(e) => updateGuest(guest.id, 'phone', e.target.value)}
                            className={`w-full p-3 border border-slate-100 rounded-xl text-sm shadow-sm outline-none transition-colors ${parseInt(guest.age) < 16 ? 'bg-slate-100/50 text-slate-300 cursor-not-allowed' : 'bg-white text-slate-900'}`}
                          />
                        </div>
                        {guest.isResident ? (
                          <div className="col-span-2 space-y-3">
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormZip}</label>
                              <div className="flex gap-3">
                                <input type="text" placeholder={t.zipPlaceholder} value={guest.postalCode} onChange={(e) => updateGuest(guest.id, 'postalCode', e.target.value.replace(/\D/g, ''))} className="flex-1 p-3 bg-white border border-slate-100 rounded-xl text-sm font-mono" maxLength={7} />
                                <button onClick={() => lookupZipCode(guest.id, guest.postalCode)} disabled={guest.postalCode.length < 7 || isLookingUpZip === guest.id} className="flex-1 px-4 bg-slate-900 text-white rounded-xl text-xs font-bold disabled:bg-slate-200 flex items-center gap-2">
                                  {isLookingUpZip === guest.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} {isLookingUpZip === guest.id ? t.zipLoading : t.zipLookup}
                                </button>
                              </div>
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormAddr}</label>
                              <input type="text" value={guest.address} onChange={(e) => updateGuest(guest.id, 'address', e.target.value)} className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm" placeholder="大阪府大阪市…" />
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
                              <input type="file" accept="image/*" className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer" onChange={(e) => fileToBase64(e.target.files?.[0]).then(base64 => updateGuest(guest.id, 'passportPhoto', base64))} />
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
              {stepConfig.id === 'rules' && (
                <div className="space-y-6">
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
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (currentStep === steps.length - 1 ? t.finish : t.next)}
              {!isSubmitting && <ChevronRight className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
