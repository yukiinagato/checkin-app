import React, { useState, useEffect, useRef } from 'react';
import { 
  Wifi, 
  Clock, 
  MapPin, 
  ChevronRight, 
  ChevronLeft, 
  CheckCircle2,
  Info,
  BellRing,
  Coffee,
  Languages,
  UserCheck,
  Baby,
  AlertTriangle,
  Wrench,
  Flame,
  Wind,
  Trash2,
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
  Bold,
  Italic,
  Underline,
  Link2,
  List,
  ListOrdered,
  ImagePlus,
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
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const STEP_STORAGE_KEY = 'checkin.steps';
const DEFAULT_LANG = 'zh-hans';

const DB = {
  async getAllRecords() {
    const res = await fetch(`${API_URL}/records`);
    if (!res.ok) throw new Error('Failed to fetch records');
    return await res.json();
  },

  async getSteps(lang) {
    const res = await fetch(`${API_URL}/steps?lang=${encodeURIComponent(lang)}`);
    if (!res.ok) throw new Error('Failed to fetch steps');
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
  { value: 'zh-hans', label: '简体中文' },
  { value: 'zh-hant', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'jp', label: '日本語' },
  { value: 'ko', label: '한국어' }
];

const translations = {
  'zh-hans': {
    next: "下一步", prev: "上一步", finish: "确认并获取房号", agree: "我已详读并同意遵守上述所有守则",
    zipLookup: "查询", zipPlaceholder: "7位邮编", zipLoading: "查询中...", regFormAddr: "日本住址", regFormZip: "邮政编码",
    roomNo: "您的房号", wifi: "Wi-Fi 密码", copy: "复制", breakfast: "早餐时间", breakfastLoc: "2楼西餐厅",
    service: "紧急协助", serviceDetail: "优先拨打紧急电话，再前往别栋联系管理人", welcomeTitle: "欢迎入住！", welcomeSub: "请开始您的愉快旅程",
    footer: "您的安全与舒适是我们的最高宗旨。", guideTitle: "入住导览", changeLang: "语言", manualLink: "说明书 PDF",
    regResident: "有日本住址", regTourist: "无日本住址", regFormName: "姓名", regFormAge: "年龄", regFormOcc: "职业",
    regFormNation: "国籍", regFormPass: "护照号码", regPassportUpload: "拍摄/上传护照照片", regMinorAlert: "未成年人需填监护人信息",
    regAddressRule: "依据大阪府特区民宿规定，有日本住址者无需登记护照信息；无住址需填写护照号码并上传照片。",
    addGuest: "增加人员", guestLabel: "住客", infantLabel: "婴儿人数 (2岁以下)", countAdults: "住客人数 (成人/未成年)",
    selectCountry: "选择国家/地区",
    customerUploadName: "客户姓名",
    customerUploadPhone: "联系电话",
    customerUploadEmail: "邮箱",
    customerUploadId: "证件号码",
    customerUploadDocs: "上传客户资料",
    customerUploadHint: "支持图片或 PDF 文件",
    customerUploadNoteLabel: "备注",
    customerUploadRemove: "移除",
    customStepEmpty: "此步骤暂无内容。",
    steps: [
      { id: 'welcome', title: "欢迎入住", subtitle: "Welcome" },
      { id: 'count', title: "入住人数", subtitle: "Guest Count" },
      { id: 'customerUpload', title: "客户资料上传", subtitle: "Customer Upload" },
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
    regResident: "有日本住址", regTourist: "無日本住址", regFormName: "姓名", regFormAge: "年齡", regFormOcc: "職業",
    regFormNation: "國籍", regFormPass: "護照號碼", regPassportUpload: "拍攝/上傳護照照片", regMinorAlert: "未成年人需填監護人資訊",
    regAddressRule: "依大阪府特區民宿規定，有日本住址者免填護照資訊；無住址需填寫護照號碼並上傳照片。",
    addGuest: "增加人員", guestLabel: "住客", infantLabel: "嬰兒人數 (2歲以下)", countAdults: "住客人數 (成人/未成年)",
    selectCountry: "選擇國家/地區",
    customerUploadName: "客戶姓名",
    customerUploadPhone: "聯絡電話",
    customerUploadEmail: "電子郵件",
    customerUploadId: "證件號碼",
    customerUploadDocs: "上傳客戶資料",
    customerUploadHint: "支援圖片或 PDF 檔",
    customerUploadNoteLabel: "備註",
    customerUploadRemove: "移除",
    customStepEmpty: "此步驟目前沒有內容。",
    steps: [
      { id: 'welcome', title: "歡迎入住", subtitle: "Welcome" },
      { id: 'count', title: "入住人數", subtitle: "Guest Count" },
      { id: 'customerUpload', title: "客戶資料上傳", subtitle: "Customer Upload" },
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
    regResident: "Has Japan address", regTourist: "No Japan address", regFormName: "Name", regFormAge: "Age", regFormOcc: "Occupation",
    regFormNation: "Nationality", regFormPass: "Passport No.", regPassportUpload: "Upload passport photo", regMinorAlert: "Minors need guardian info",
    regAddressRule: "Per Osaka special zone lodging rules, guests with a Japan address do not need passport details; others must provide passport number and photo.",
    addGuest: "Add Guest", guestLabel: "Guest", infantLabel: "Infants (under 2)", countAdults: "Guest Count (adult/minor)",
    selectCountry: "Select country/region",
    customerUploadName: "Customer name",
    customerUploadPhone: "Phone",
    customerUploadEmail: "Email",
    customerUploadId: "ID/Passport no.",
    customerUploadDocs: "Upload customer documents",
    customerUploadHint: "Images or PDF supported",
    customerUploadNoteLabel: "Notes",
    customerUploadRemove: "Remove",
    customStepEmpty: "No content for this step yet.",
    steps: [
      { id: 'welcome', title: "Welcome", subtitle: "Welcome" },
      { id: 'count', title: "Guest Count", subtitle: "Guest Count" },
      { id: 'customerUpload', title: "Customer Upload", subtitle: "Customer Upload" },
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
    zipLookup: "検索", zipPlaceholder: "7桁郵便番号", zipLoading: "検索中...", regFormAddr: "日本の住所", regFormZip: "郵便番号",
    roomNo: "あなたの部屋番号", wifi: "Wi-Fi パスワード", copy: "コピー", breakfast: "朝食時間", breakfastLoc: "2階レストラン",
    service: "緊急連絡", serviceDetail: "先に緊急電話、次に管理人へ連絡。", welcomeTitle: "ようこそ！", welcomeSub: "旅を始めましょう",
    footer: "安全と快適さが最優先です。", guideTitle: "チェックイン案内", changeLang: "言語", manualLink: "マニュアル PDF",
    regResident: "日本の住所あり", regTourist: "日本の住所なし", regFormName: "氏名", regFormAge: "年齢", regFormOcc: "職業",
    regFormNation: "国籍", regFormPass: "パスポート番号", regPassportUpload: "パスポート写真をアップロード", regMinorAlert: "未成年は保護者情報が必要",
    regAddressRule: "大阪府特区民宿の規定により、日本の住所がある場合はパスポート情報不要です。住所がない場合は番号と写真が必要です。",
    addGuest: "追加", guestLabel: "ゲスト", infantLabel: "乳児 (2歳未満)", countAdults: "人数 (成人/未成年)",
    selectCountry: "国/地域を選択",
    customerUploadName: "氏名",
    customerUploadPhone: "電話番号",
    customerUploadEmail: "メール",
    customerUploadId: "身分証番号",
    customerUploadDocs: "資料をアップロード",
    customerUploadHint: "画像または PDF を対応",
    customerUploadNoteLabel: "備考",
    customerUploadRemove: "削除",
    customStepEmpty: "このステップにはまだ内容がありません。",
    steps: [
      { id: 'welcome', title: "ようこそ", subtitle: "Welcome" },
      { id: 'count', title: "人数", subtitle: "Guest Count" },
      { id: 'customerUpload', title: "お客様資料アップロード", subtitle: "Customer Upload" },
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
    regResident: "일본 주소 있음", regTourist: "일본 주소 없음", regFormName: "이름", regFormAge: "나이", regFormOcc: "직업",
    regFormNation: "국적", regFormPass: "여권 번호", regPassportUpload: "여권 사진 업로드", regMinorAlert: "미성년자는 보호자 정보 필요",
    regAddressRule: "오사카 특구 민박 규정에 따라 일본 주소가 있으면 여권 정보가 필요 없습니다. 주소가 없으면 여권 번호와 사진이 필요합니다.",
    addGuest: "인원 추가", guestLabel: "게스트", infantLabel: "영아 (2세 이하)", countAdults: "인원 수 (성인/미성년)",
    selectCountry: "국가/지역 선택",
    customerUploadName: "고객 이름",
    customerUploadPhone: "연락처",
    customerUploadEmail: "이메일",
    customerUploadId: "신분증 번호",
    customerUploadDocs: "고객 자료 업로드",
    customerUploadHint: "이미지 또는 PDF 지원",
    customerUploadNoteLabel: "비고",
    customerUploadRemove: "삭제",
    customStepEmpty: "이 단계에는 아직 내용이 없습니다.",
    steps: [
      { id: 'welcome', title: "환영", subtitle: "Welcome" },
      { id: 'count', title: "인원 수", subtitle: "Guest Count" },
      { id: 'customerUpload', title: "고객 자료 업로드", subtitle: "Customer Upload" },
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

const getDefaultStepMap = (lang) => {
  const base = translations[lang]?.steps || translations[DEFAULT_LANG].steps;
  return base.reduce((acc, step) => {
    acc[step.id] = step;
    return acc;
  }, {});
};

const normalizeSteps = (steps, fallback, lang = DEFAULT_LANG) => {
  if (!Array.isArray(steps)) return fallback;
  const defaultsById = getDefaultStepMap(lang);
  const normalizedSteps = steps.map((step) => {
    const normalized = {
      id: step.id || createStepId(),
      title: step.title || '',
      subtitle: step.subtitle || '',
      enabled: step.enabled !== false,
      type: step.type === 'custom' ? 'custom' : 'builtin',
      content: step.content || ''
    };
    if (normalized.id === 'customerUpload') {
      const defaults = defaultsById.customerUpload;
      if (defaults) {
        normalized.title = defaults.title;
        normalized.subtitle = defaults.subtitle;
        normalized.type = 'builtin';
      }
    }
    return normalized;
  });
  const storedById = new Map();
  const customSteps = [];
  normalizedSteps.forEach((step) => {
    if (step.type === 'custom' || !defaultsById[step.id]) {
      customSteps.push(step);
    } else {
      storedById.set(step.id, step);
    }
  });
  const mergedDefaults = fallback.map((defaultStep) => {
    const stored = storedById.get(defaultStep.id);
    if (!stored) return defaultStep;
    const merged = { ...defaultStep, ...stored };
    if (defaultStep.id === 'customerUpload') {
      merged.title = defaultStep.title;
      merged.subtitle = defaultStep.subtitle;
      merged.type = 'builtin';
    }
    return merged;
  });
  return [...mergedDefaults, ...customSteps];
};

const loadSteps = (lang) => {
  try {
    const raw = localStorage.getItem(`${STEP_STORAGE_KEY}.${lang}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeSteps(parsed, buildDefaultSteps(lang), lang);
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

const RichTextEditor = ({ value, onChange, placeholder }) => {
  const editorRef = useRef(null);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== (value || '')) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const updateValue = () => {
    if (!editorRef.current) return;
    onChange(editorRef.current.innerHTML);
  };

  const runCommand = (command, commandValue) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, commandValue);
    updateValue();
  };

  const handleAddLink = () => {
    const url = window.prompt('请输入链接地址');
    if (!url) return;
    runCommand('createLink', url);
  };

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    fileToBase64(file).then((base64) => {
      if (!base64) return;
      runCommand('insertHTML', `<img src="${base64}" alt="Uploaded" />`);
    });
    event.target.value = '';
  };

  const toolbarButtonClass =
    'inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('bold')} className={toolbarButtonClass}>
          <Bold className="w-4 h-4" /> 粗体
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('italic')} className={toolbarButtonClass}>
          <Italic className="w-4 h-4" /> 斜体
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('underline')} className={toolbarButtonClass}>
          <Underline className="w-4 h-4" /> 下划线
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={handleAddLink} className={toolbarButtonClass}>
          <Link2 className="w-4 h-4" /> 超链接
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('insertUnorderedList')} className={toolbarButtonClass}>
          <List className="w-4 h-4" /> 无序列表
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('insertOrderedList')} className={toolbarButtonClass}>
          <ListOrdered className="w-4 h-4" /> 有序列表
        </button>
        <label className={`${toolbarButtonClass} cursor-pointer`}>
          <ImagePlus className="w-4 h-4" /> 上传图片
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </label>
      </div>
      <div
        ref={editorRef}
        className="rich-text-editor min-h-[140px] w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={updateValue}
      />
    </div>
  );
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
  const [stepLang, setStepLang] = useState(DEFAULT_LANG);
  const [editableSteps, setEditableSteps] = useState(() => buildDefaultSteps(DEFAULT_LANG));
  const [stepsSaved, setStepsSaved] = useState(false);

  useEffect(() => {
    DB.getAllRecords()
      .then(data => {
        setRecords(data);
        setServerStatus('online');
      })
      .catch(() => {
        setRecords([]);
        setServerStatus('offline');
      });
  }, []);

  useEffect(() => {
    let isActive = true;
    const stored = loadSteps(stepLang);
    if (stored) {
      setEditableSteps(stored);
      setStepsSaved(false);
      return () => {
        isActive = false;
      };
    }
    DB.getSteps(stepLang)
      .then((steps) => {
        if (!isActive) return;
        const normalized = normalizeSteps(steps, buildDefaultSteps(stepLang), stepLang);
        setEditableSteps(normalized);
        saveSteps(stepLang, normalized);
        setStepsSaved(false);
      })
      .catch(() => {
        if (!isActive) return;
        setEditableSteps(buildDefaultSteps(stepLang));
        setStepsSaved(false);
      });
    return () => {
      isActive = false;
    };
  }, [stepLang]);

  const totalGuests = records.reduce((acc, r) => acc + (r.guests?.length || 0), 0);
  const todayCount = records.filter(r => r.submittedAt.startsWith(new Date().toISOString().split('T')[0])).reduce((acc, r) => acc + (r.guests?.length || 0), 0);
  const stepLangText = translations[stepLang] || translations[DEFAULT_LANG];
  const defaultStepMap = getDefaultStepMap(stepLang);

  const updateStepField = (id, field, value) => {
    if (id === 'customerUpload' && (field === 'title' || field === 'subtitle')) {
      return;
    }
    setEditableSteps((prev) => prev.map((step) => step.id === id ? { ...step, [field]: value } : step));
    setStepsSaved(false);
  };

  const toggleStepEnabled = (id) => {
    setEditableSteps((prev) => prev.map((step) => step.id === id ? { ...step, enabled: !step.enabled } : step));
    setStepsSaved(false);
  };

  const addCustomStep = () => {
    setEditableSteps((prev) => [
      ...prev,
      { id: createStepId(), title: '新步骤', subtitle: 'Custom Step', type: 'custom', content: '', enabled: true }
    ]);
    setStepsSaved(false);
  };

  const removeCustomStep = (id) => {
    setEditableSteps((prev) => prev.filter((step) => step.id !== id));
    setStepsSaved(false);
  };

  const handleSaveSteps = () => {
    saveSteps(stepLang, editableSteps);
    setStepsSaved(true);
  };

  const handleResetSteps = () => {
    setEditableSteps(buildDefaultSteps(stepLang));
    setStepsSaved(false);
  };

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
      case 'steps':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-bold text-xl text-slate-800">入住步骤管理</h3>
                <p className="text-sm text-slate-500">编辑步骤标题与内容，可新增或移除自定义步骤。</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={stepLang}
                  onChange={(e) => setStepLang(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700"
                >
                  {LANG_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button onClick={addCustomStep} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold">新增步骤</button>
              </div>
            </div>

            <div className="space-y-4">
              {editableSteps.map((step, index) => {
                const isCustomerUploadStep = step.id === 'customerUpload';
                return (
                  <div key={step.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-slate-400 uppercase">Step {index + 1}</span>
                      <span className={`text-[10px] px-2 py-1 rounded-full ${step.type === 'custom' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                        {step.type === 'custom' ? 'Custom' : 'Built-in'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                        <input type="checkbox" checked={step.enabled !== false} onChange={() => toggleStepEnabled(step.id)} />
                        啟用
                      </label>
                      {step.type === 'custom' && (
                        <button onClick={() => removeCustomStep(step.id)} className="text-rose-500 text-xs font-bold">移除</button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">标题</label>
                      <input
                        type="text"
                        value={isCustomerUploadStep ? (defaultStepMap.customerUpload?.title || step.title) : step.title}
                        onChange={(e) => updateStepField(step.id, 'title', e.target.value)}
                        disabled={isCustomerUploadStep}
                        className={`w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm ${isCustomerUploadStep ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">副标题</label>
                      <input
                        type="text"
                        value={isCustomerUploadStep ? (defaultStepMap.customerUpload?.subtitle || step.subtitle) : step.subtitle}
                        onChange={(e) => updateStepField(step.id, 'subtitle', e.target.value)}
                        disabled={isCustomerUploadStep}
                        className={`w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm ${isCustomerUploadStep ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`}
                      />
                    </div>
                  </div>
                  {isCustomerUploadStep && (
                    <p className="text-xs text-slate-400">客户资料上传为固定步骤，仅允许编辑下方备注内容。</p>
                  )}
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">{isCustomerUploadStep ? '备注编辑' : '内容编辑'}</label>
                      <span className="text-[10px] text-slate-400">支持图片与常见文本样式</span>
                    </div>
                    <div className="mt-3">
                      <RichTextEditor
                        value={step.content}
                        onChange={(value) => updateStepField(step.id, 'content', value)}
                        placeholder="输入该步骤要展示的内容..."
                      />
                    </div>
                  </div>
                  <div className="step-content-surface">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-3">预览</p>
                    <StepContent content={step.content} fallback={stepLangText.customStepEmpty} />
                  </div>
                </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button onClick={handleSaveSteps} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold">保存设置</button>
              <button onClick={handleResetSteps} className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold">恢复默认</button>
              {stepsSaved && <span className="text-sm text-emerald-600 font-bold">已保存</span>}
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
            <button onClick={() => setTab('steps')} className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all font-bold text-sm ${tab === 'steps' ? 'bg-white text-slate-900 shadow-xl' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
              <LayoutDashboard className="w-5 h-5" /> 步驟管理
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
  const [customerUpload, setCustomerUpload] = useState({
    name: '',
    phone: '',
    email: '',
    idNumber: '',
    documents: []
  });

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

  const [stepsConfig, setStepsConfig] = useState([]);

  useEffect(() => {
    let isActive = true;
    if (!lang) return () => {};
    const storedSteps = loadSteps(lang);
    if (storedSteps) {
      setStepsConfig(storedSteps);
      return () => {
        isActive = false;
      };
    }
    DB.getSteps(lang)
      .then((steps) => {
        if (!isActive) return;
        const normalized = normalizeSteps(steps, buildDefaultSteps(lang), lang);
        setStepsConfig(normalized);
        saveSteps(lang, normalized);
      })
      .catch(() => {
        if (!isActive) return;
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

  const addGuest = () => setGuests((prev) => [...prev, createGuestTemplate('adult')]);
  const removeGuest = (id) => {
    setGuests((prev) => {
      const next = prev.filter((guest) => guest.id !== id);
      if (next.length === 0) {
        return [createGuestTemplate('adult')];
      }
      return next;
    });
  };
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
    const activeSteps = steps.length;
    if (currentStep < activeSteps - 1) { setCurrentStep(currentStep + 1); } 
    else {
      const requiresAgreement = steps.some((step) => step.id === 'rules');
      if (requiresAgreement && !hasAgreed) {
        return;
      }
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

  const progress = ((currentStep + 1) / steps.length) * 100;

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
              {(hasContent || stepConfig?.type === 'custom') && stepConfig.id !== 'customerUpload' && (
                <div className="step-content-surface">
                  <StepContent content={stepConfig.content} fallback={t.customStepEmpty} />
                </div>
              )}

              {stepConfig.id === 'count' && (
                <div className="space-y-4 py-4">
                  <div className="p-4 bg-slate-50 rounded-2xl flex items-center justify-between">
                    <div><p className="font-bold text-slate-800 text-sm">{t.countAdults}</p></div>
                    <div className="flex items-center gap-4">
                      <button onClick={() => removeGuest(guests[guests.length-1].id)} className="w-8 h-8 rounded-full border border-slate-300">-</button>
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
                        <button 
                          onClick={() => removeGuest(guest.id)} 
                          className="text-slate-300 hover:text-rose-500 transition-colors p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex bg-white p-1 rounded-xl border">
                        <button onClick={() => updateGuest(guest.id, 'isResident', true)} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${guest.isResident ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400'}`}>{t.regResident}</button>
                        <button onClick={() => updateGuest(guest.id, 'isResident', false)} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${!guest.isResident ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400'}`}>{t.regTourist}</button>
                      </div>
                      <p className="text-[10px] text-slate-400">{t.regAddressRule}</p>
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
              {stepConfig.id === 'customerUpload' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">{t.customerUploadName}</label>
                      <input
                        type="text"
                        value={customerUpload.name}
                        onChange={(e) => setCustomerUpload({ ...customerUpload, name: e.target.value })}
                        className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">{t.customerUploadPhone}</label>
                      <input
                        type="text"
                        value={customerUpload.phone}
                        onChange={(e) => setCustomerUpload({ ...customerUpload, phone: e.target.value })}
                        className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">{t.customerUploadEmail}</label>
                      <input
                        type="email"
                        value={customerUpload.email}
                        onChange={(e) => setCustomerUpload({ ...customerUpload, email: e.target.value })}
                        className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">{t.customerUploadId}</label>
                      <input
                        type="text"
                        value={customerUpload.idNumber}
                        onChange={(e) => setCustomerUpload({ ...customerUpload, idNumber: e.target.value })}
                        className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm"
                      />
                    </div>
                  </div>
                  <div className="relative p-4 border-2 border-dashed rounded-xl flex flex-col gap-2 items-center justify-center text-slate-400 bg-slate-50">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(event) => {
                        const files = Array.from(event.target.files || []);
                        if (!files.length) return;
                        Promise.all(files.map(fileToBase64)).then((encoded) => {
                          const newDocs = files.map((file, index) => ({
                            name: file.name,
                            data: encoded[index]
                          }));
                          setCustomerUpload((prev) => ({
                            ...prev,
                            documents: [...prev.documents, ...newDocs]
                          }));
                        });
                        event.target.value = '';
                      }}
                    />
                    <div className="flex items-center gap-2 text-sm font-bold">
                      <Cloud className="w-4 h-4" />
                      <span>{t.customerUploadDocs}</span>
                    </div>
                    <span className="text-xs">{t.customerUploadHint}</span>
                  </div>
                  {customerUpload.documents.length > 0 && (
                    <div className="space-y-2">
                      {customerUpload.documents.map((doc, index) => (
                        <div key={`${doc.name}-${index}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs">
                          <span className="font-medium text-slate-600">{doc.name}</span>
                          <button
                            type="button"
                            onClick={() => setCustomerUpload((prev) => ({
                              ...prev,
                              documents: prev.documents.filter((_, docIndex) => docIndex !== index)
                            }))}
                            className="text-rose-500 font-bold"
                          >
                            {t.customerUploadRemove}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-3">{t.customerUploadNoteLabel}</p>
                    <div className="step-content-surface">
                      <StepContent content={stepConfig.content} fallback={t.customStepEmpty} />
                    </div>
                  </div>
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
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .step-content-surface { padding: 1.25rem; border-radius: 1rem; background: #f8fafc; border: 1px solid #f1f5f9; }
        .step-content h1, .step-content h2, .step-content h3 { font-weight: 700; color: #0f172a; }
        .step-content p { line-height: 1.6; }
        .step-content ul { list-style: disc; padding-left: 1.25rem; }
        .step-content ol { list-style: decimal; padding-left: 1.25rem; }
        .step-content img { max-width: 100%; border-radius: 0.75rem; box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08); }
        .step-content a { color: #2563eb; text-decoration: underline; }
        .rich-text-editor:empty::before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
        }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
        .animate-shake { animation: shake 0.3s ease-in-out; }
      `}</style>
    </div>
  );
};

export default App;
