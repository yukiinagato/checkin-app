import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import {
  Wifi,
  MapPin,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  CheckCircle2,
  Info,
  BellRing,
  Languages,
  UserCheck,
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
  Home,
  Menu,
  Calendar,
  Shield,
  Baby,
  Wind,
  Droplets,
  Monitor,
  Refrigerator,
  Sparkles,
  LayoutList,
  ArrowLeft,
  BookOpen,
  ClipboardList
} from 'lucide-react';
import AdminPage from './AdminPage';
import { isRegistrationValid, parsePassportBirthDateToAge } from './formValidation';
import PassportScannerFlow from './components/PassportScannerFlow';
import { DEFAULT_APP_SETTINGS, getCountryOptions, isOfficialIsoCountryCode } from './countryOptions';

// ----------------------------------------------------------------------
// 輔助函數與常量
// ----------------------------------------------------------------------
const createGuestTemplate = (type = 'adult') => ({
  id: Math.random().toString(36).substr(2, 9),
  type,
  isResident: true,
  name: '', age: '', phone: '', address: '', postalCode: '', nationality: '', nationalityDetected: '', passportNumber: '', passportPhoto: null, guardianName: '', guardianPhone: '',
  passportOcrStatus: 'idle',
  passportOcrMessage: '',
  isEditable: true
});

const resolveNationalityForForm = (ocrResult) => {
  const code = typeof ocrResult?.nationalityCode === 'string' ? ocrResult.nationalityCode.trim().toUpperCase() : '';
  const raw = typeof ocrResult?.nationalityRaw === 'string' ? ocrResult.nationalityRaw.trim().toUpperCase() : '';

  if (code && isOfficialIsoCountryCode(code)) {
    return { nationality: code, nationalityDetected: '' };
  }

  if (code) {
    return { nationality: 'OTHER', nationalityDetected: code };
  }

  if (raw) {
    return { nationality: 'OTHER', nationalityDetected: raw };
  }

  return { nationality: '', nationalityDetected: '' };
};

// ----------------------------------------------------------------------
// 後端 API 服務
// ----------------------------------------------------------------------
const API_URL = '/api';
const STEP_STORAGE_KEY = 'checkin.steps';
const COMPLETION_TEMPLATE_STORAGE_KEY = 'checkin.completionTemplate';
const ADMIN_TOKEN_STORAGE_KEY = 'checkin.adminSessionToken';
const DEFAULT_LANG = 'jp';
const CHECKIN_STORAGE_KEY = 'checkin.completed';
const GUEST_STORAGE_KEY = 'checkin.guests';
const PET_COUNT_STORAGE_KEY = 'checkin.petCount';
const CHECKIN_DATE_STORAGE_KEY = 'checkin.checkInDate';
const CHECKOUT_DATE_STORAGE_KEY = 'checkin.checkOutDate';
const SUBMISSION_ID_KEY = 'checkin.submissionId';
const FAILED_SUBMISSIONS_LOG_KEY = 'checkin.failedSubmissions';
const PENDING_RETRY_KEY = 'checkin.pendingRetry';

const DB = {
  async getAllRecords(adminToken) {
    const res = await fetch(`${API_URL}/records`, {
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    });
    if (!res.ok) throw new Error('Failed to fetch records');
    return await res.json();
  },

  async validateAdminToken(adminToken) {
    const res = await fetch(`${API_URL}/admin/session`, {
      headers: {
        Authorization: `Bearer ${adminToken}`
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
        Authorization: `Bearer ${bootstrapToken}`
      },
      body: JSON.stringify({})
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
        Authorization: `Bearer ${adminToken}`
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
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ steps })
    });
    if (!res.ok) throw new Error('Failed to save steps');
    return await res.json();
  },

  async getCompletionTemplate(lang) {
    const res = await fetch(`${API_URL}/completion-template?lang=${encodeURIComponent(lang)}`);
    if (!res.ok) throw new Error('Failed to fetch completion template');
    return await res.json();
  },

  async getTemplateBundle(lang) {
    const res = await fetch(`${API_URL}/template-bundle?lang=${encodeURIComponent(lang)}`);
    if (!res.ok) throw new Error('Failed to fetch template bundle');
    return await res.json();
  },

  async getAppSettings() {
    const res = await fetch(`${API_URL}/app-settings`);
    if (!res.ok) throw new Error('Failed to fetch app settings');
    return await res.json();
  },

  async updateCompletionTemplate(adminToken, lang, template) {
    const res = await fetch(`${API_URL}/admin/completion-template?lang=${encodeURIComponent(lang)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ template })
    });
    if (!res.ok) throw new Error('Failed to save completion template');
    return await res.json();
  },

  async updateAppSettings(adminToken, settings) {
    const res = await fetch(`${API_URL}/admin/app-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ settings })
    });
    if (!res.ok) throw new Error('Failed to save app settings');
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
      return { ...payload, httpStatus: res.status, ok: res.ok };
    } catch (error) {
      console.error("Submission Error:", error);
      return { success: false, error: "Connection Failed", networkError: true };
    }
  },

  async recognizePassport(imageData) {
    const res = await fetch(`${API_URL}/ocr/passport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageData })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.error || 'Passport OCR request failed');
    }
    return payload;
  },


  async setGuestDeleted(adminToken, recordId, guestId, deleted) {
    const res = await fetch(`${API_URL}/records/${encodeURIComponent(recordId)}/guests/${encodeURIComponent(guestId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ deleted })
    });
    if (!res.ok) throw new Error('Failed to update guest deletion state');
    return await res.json();
  },

  exportCSV(records) {
    if (!records.length) return;

    const CSV_INJECTION_PREFIXES = /^[=+\-@]/;

    const escapeCell = (value) => {
      let str = value == null ? '' : String(value);
      // 防止 CSV injection：以危險字元開頭時前置單引號
      if (CSV_INJECTION_PREFIXES.test(str)) str = `'${str}`;
      // 內容中的雙引號跳脫為 ""，再用雙引號包住整個欄位
      return `"${str.replace(/"/g, '""')}"`;
    };

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

    // BOM（﻿）確保 Excel 正確識別 UTF-8 編碼
    const BOM = '﻿';
    const csvContent = BOM + rows.map(row => row.map(escapeCell).join(',')).join('\n');
    const encodedUri = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `hotel_guests_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(encodedUri);
  }
};

const createStepId = () => `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const LANG_OPTIONS = [
  { value: 'jp', label: '日本語' },
  { value: 'en', label: 'English' },
  { value: 'zh-hans', label: '简体中文' },
  { value: 'zh-hant', label: '繁體中文' },
  { value: 'ko', label: '한국어' }
];

const GUIDE_GROUP_IDS   = ['safety', 'equipment'];
const GUIDE_STEP_IDS_SET = new Set(['safety', 'equipment', 'trash', 'rules']);

const getStepIcon = (id, size = 'w-6 h-6') => {
  const cls = `${size}`;
  switch (id) {
    case 'welcome':      return <BellRing className={cls} />;
    case 'count':        return <Users className={cls} />;
    case 'stayDuration': return <Calendar className={cls} />;
    case 'privacy':      return <Lock className={cls} />;
    case 'registration': return <UserCheck className={cls} />;
    case 'safety':       return <Shield className={cls} />;
    case 'emergency':    return <AlertTriangle className={cls} />;
    case 'child':        return <Baby className={cls} />;
    case 'outdoor':      return <MapPin className={cls} />;
    case 'equipment':    return <Wrench className={cls} />;
    case 'laundry':      return <Wrench className={cls} />;
    case 'water':        return <Flame className={cls} />;
    case 'ac':           return <Wind className={cls} />;
    case 'fridge':       return <Refrigerator className={cls} />;
    case 'projector':    return <Monitor className={cls} />;
    case 'waterPurifier': return <Droplets className={cls} />;
    case 'bidet':        return <Sparkles className={cls} />;
    case 'trash':        return <Trash2 className={cls} />;
    case 'rules':        return <UserCheck className={cls} />;
    default:             return <Info className={cls} />;
  }
};

const translations = {
  'zh-hans': {
    next: "下一条指南", prev: "返回选择菜单", finish: "确认并获取房号", agree: "我已详读并同意遵守上述所有守则",
    zipLookup: "查询", zipPlaceholder: "7位邮编", zipLoading: "查询中...", regFormAddr: "日本住址", regFormZip: "邮政编码",
    roomNo: "您的房号", wifi: "Wi-Fi 密码", copy: "复制", breakfast: "早餐时间", breakfastLoc: "2楼西餐厅",
    service: "紧急协助", serviceDetail: "优先拨打紧急电话，再前往别栋联系管理人", welcomeTitle: "欢迎入住！", welcomeSub: "请开始您的愉快旅程",
    footer: "您的安全与舒适是我们的最高宗旨。", guideTitle: "入住导览", changeLang: "语言", manualLink: "说明书 PDF",
    regResident: "日本居民", regTourist: "访日游客", startNewCheckin: "开始新登记", regFormName: "姓名", regFormAge: "年龄", regFormOcc: "职业", regFormPhone: "电话号码",
    regFormNation: "国籍", regFormPass: "护照号码", regPassportUpload: "拍摄/上传护照照片", regPassportUploaded: "护照照片已上传", regMinorAlert: "未成年人需填监护人信息",
    passportModalTitle: "护照拍摄与上传", passportModalClose: "关闭", passportModalIntro: "请使用系统相机拍摄护照信息页，或从相册选择清晰照片。上传后会自动识别并填入表单。", passportModalPick: "拍摄或上传护照照片", passportModalProcessing: "正在保存照片并识别护照信息，请稍候...", passportModalConfirm: "确认填入", passportModalRetake: "重新拍摄", passportModalSavedHint: "照片会保存到后端本地上传目录，仅管理后台可查看。", passportFileTooLarge: "图片过大，请上传 12MB 以内的护照照片。", passportFileInvalid: "请选择图片格式的护照照片。",
    ocrChecking: "正在本地识别证件...", ocrAutoFillSuccess: "已识别护照并自动填充护照号码。", ocrManualNeeded: "已检测到护照，但多次识别失败，请手动补充信息。", ocrInvalidDoc: "上传内容未通过证件校验，请上传护照照片或扫描件。", ocrFailed: "识别失败，请重试。", ocrUnsupported: "当前浏览器不支持本地OCR，已保留照片，请手动补充护照信息。",
    addGuest: "增加人员", guestLabel: "住客", petLabel: "宠物数量", countAdults: "住客人数 (成人/未成年)",
    checkIn: "入住日期", checkOut: "退房日期",
    selectCountry: "选择国家/地区", detectedNationHint: "已识别国籍",
    customStepEmpty: "此步骤暂无内容。",
    retryMsg: "网络不稳，正在自动重新提交，请稍候...",
    submitRetryMsg: "提交失败，数据已保存。请确认网络连接后点击按钮重试。",
    newCheckin: "新入住", viewHistory: "查看已登记的数据", backToHome: "返回首页",
    quickGuide: "快速指南", safetyGroup: "安全", equipmentGroup: "设备", viewGuide: "查阅指南",
    noContent: "此项目暂无内容。", registeredData: "已登记资料", backToDir: "返回目录", guestTypeAdult: "成人", guestTypeMinor: "未成年",
    viewStayGuide: "查看住宿指南",
    steps: [
      { id: 'welcome', title: "欢迎入住", subtitle: "Welcome" },
      { id: 'count', title: "入住人数", subtitle: "Guest Count" },
      { id: 'stayDuration', title: "入住时长", subtitle: "Stay Duration" },
      { id: 'privacy', title: "个人信息保护", subtitle: "Privacy Notice" },
      { id: 'registration', title: "住客信息登记", subtitle: "Osaka Regulation" },
      { id: 'safety', title: "安全", subtitle: "Safety" },
      { id: 'equipment', title: "设备使用", subtitle: "Equipment" },
      { id: 'trash', title: "垃圾分类指南", subtitle: "Waste Management" },
      { id: 'rules', title: "邻里礼仪与管理", subtitle: "Etiquette" }
    ]
  },
  'zh-hant': {
    next: "下一條指南", prev: "返回選擇菜單", finish: "確認並獲取房號", agree: "我已詳讀並同意遵守上述所有守則",
    zipLookup: "地址查詢", zipPlaceholder: "7位郵遞區號", zipLoading: "查詢中...", regFormAddr: "日本住址", regFormZip: "郵遞區號",
    roomNo: "您的房號", wifi: "Wi-Fi 密碼", copy: "複製", breakfast: "早餐時間", breakfastLoc: "2樓西餐廳",
    service: "緊急協助", serviceDetail: "優先撥打緊急電話，再前往別棟聯繫管理人", welcomeTitle: "入住愉快！", welcomeSub: "請開始您的愉快旅程",
    footer: "您的安全與舒適是我們的最高宗旨。", guideTitle: "入住導覽", changeLang: "語言", manualLink: "說明書 PDF",
    regResident: "日本居民", regTourist: "訪日遊客", startNewCheckin: "開始新登記", regFormName: "姓名", regFormAge: "年齡", regFormOcc: "職業", regFormPhone: "電話號碼",
    regFormNation: "國籍", regFormPass: "護照號碼", regPassportUpload: "拍攝/上傳護照照片", regPassportUploaded: "護照照片已上傳", regMinorAlert: "未成年人需填監護人資訊",
    passportModalTitle: "護照拍攝與上傳", passportModalClose: "關閉", passportModalIntro: "請使用系統相機拍攝護照資訊頁，或從相簿選擇清晰照片。上傳後會自動辨識並填入表單。", passportModalPick: "拍攝或上傳護照照片", passportModalProcessing: "正在保存照片並辨識護照資訊，請稍候...", passportModalConfirm: "確認填入", passportModalRetake: "重新拍攝", passportModalSavedHint: "照片會保存到後端本地上傳目錄，僅管理後台可查看。", passportFileTooLarge: "圖片過大，請上傳 12MB 以內的護照照片。", passportFileInvalid: "請選擇圖片格式的護照照片。",
    ocrChecking: "正在本地辨識證件...", ocrAutoFillSuccess: "已辨識護照並自動填入護照號碼。", ocrManualNeeded: "已檢測到護照，但多次辨識失敗，請手動補充資訊。", ocrInvalidDoc: "上傳內容未通過證件校驗，請上傳護照照片或掃描件。", ocrFailed: "辨識失敗，請重試。", ocrUnsupported: "目前瀏覽器不支援本地OCR，已保留照片，請手動補充護照資訊。",
    addGuest: "增加人員", guestLabel: "住客", petLabel: "寵物數量", countAdults: "住客人數 (成人/未成年)",
    checkIn: "入住日期", checkOut: "退房日期",
    selectCountry: "選擇國家/地區", detectedNationHint: "已辨識國籍",
    customStepEmpty: "此步驟目前沒有內容。",
    retryMsg: "網路不穩，正在自動重新提交，請稍候...",
    submitRetryMsg: "提交失敗，資料已儲存。請確認網路連線後點擊按鈕重試。",
    newCheckin: "新入住", viewHistory: "查看已登記的數據", backToHome: "返回首頁",
    quickGuide: "快速指南", safetyGroup: "安全", equipmentGroup: "設備", viewGuide: "查閱指南",
    noContent: "此項目目前沒有內容。", registeredData: "已登記資料", backToDir: "返回目錄", guestTypeAdult: "成人", guestTypeMinor: "未成年",
    viewStayGuide: "查看住宿指南",
    steps: [
      { id: 'welcome', title: "歡迎入住", subtitle: "Welcome" },
      { id: 'count', title: "入住人數", subtitle: "Guest Count" },
      { id: 'stayDuration', title: "入住時長", subtitle: "Stay Duration" },
      { id: 'privacy', title: "個人資訊保護", subtitle: "Privacy Notice" },
      { id: 'registration', title: "住客資訊登記", subtitle: "Osaka Regulation" },
      { id: 'safety', title: "安全", subtitle: "Safety" },
      { id: 'equipment', title: "設備使用", subtitle: "Equipment" },
      { id: 'trash', title: "垃圾分類指南", subtitle: "Waste Management" },
      { id: 'rules', title: "鄰里禮儀與管理", subtitle: "Etiquette" }
    ]
  },
  'en': {
    next: "Next Guide", prev: "Back to Menu", finish: "Confirm & Get Room No.", agree: "I have read and agree to all rules above.",
    zipLookup: "Lookup", zipPlaceholder: "7-digit ZIP", zipLoading: "Searching...", regFormAddr: "Japanese address", regFormZip: "Postal code",
    roomNo: "Your Room No.", wifi: "Wi-Fi Password", copy: "Copy", breakfast: "Breakfast Time", breakfastLoc: "2F Restaurant",
    service: "Emergency Support", serviceDetail: "Call emergency first, then contact the manager in another building.", welcomeTitle: "Welcome!", welcomeSub: "Start your journey",
    footer: "Your safety and comfort are our top priority.", guideTitle: "Check-in Guide", changeLang: "Language", manualLink: "Manual PDF",
    regResident: "Japan Resident", regTourist: "Visitor", startNewCheckin: "Start New Check-in", regFormName: "Name", regFormAge: "Age", regFormOcc: "Occupation", regFormPhone: "Phone Number",
    regFormNation: "Nationality", regFormPass: "Passport No.", regPassportUpload: "Upload passport photo", regPassportUploaded: "Passport photo uploaded", regMinorAlert: "Minors need guardian info",
    passportModalTitle: "Passport Photo Upload", passportModalClose: "Close", passportModalIntro: "Use your device camera to photograph the passport information page, or choose a clear image from your library. We will read it and fill the form automatically.", passportModalPick: "Take or upload passport photo", passportModalProcessing: "Saving photo and reading passport information...", passportModalConfirm: "Apply to form", passportModalRetake: "Retake", passportModalSavedHint: "The photo is stored on the backend and is only visible in the admin console.", passportFileTooLarge: "Image is too large. Please upload a passport photo under 12MB.", passportFileInvalid: "Please choose an image file.",
    ocrChecking: "Running local document OCR...", ocrAutoFillSuccess: "Passport detected and number auto-filled.", ocrManualNeeded: "Passport detected, but OCR failed multiple times. Please enter the remaining fields manually.", ocrInvalidDoc: "Upload rejected: this image does not look like a passport document.", ocrFailed: "OCR failed. Please try again.", ocrUnsupported: "This browser does not support local OCR. Photo is kept, please complete passport details manually.",
    addGuest: "Add Guest", guestLabel: "Guest", petLabel: "Number of Pets", countAdults: "Guest Count (adult/minor)",
    checkIn: "Check-in Date", checkOut: "Check-out Date",
    selectCountry: "Select country/region", detectedNationHint: "Detected nationality",
    customStepEmpty: "No content for this step yet.",
    retryMsg: "Network unstable — retrying your submission automatically...",
    submitRetryMsg: "Submission failed. Your data is saved — please check your connection and tap the button to try again.",
    newCheckin: "New Check-in", viewHistory: "View Registered Data", backToHome: "Back to Home",
    quickGuide: "Quick Guide", safetyGroup: "Safety", equipmentGroup: "Equipment", viewGuide: "View Guide",
    noContent: "No content available for this item yet.", registeredData: "Registered Data", backToDir: "Back to Directory", guestTypeAdult: "Adult", guestTypeMinor: "Minor",
    viewStayGuide: "View Stay Guide",
    steps: [
      { id: 'welcome', title: "Welcome", subtitle: "Welcome" },
      { id: 'count', title: "Guest Count", subtitle: "Guest Count" },
      { id: 'stayDuration', title: "Stay Duration", subtitle: "Stay Duration" },
      { id: 'privacy', title: "Privacy Notice", subtitle: "Personal Data" },
      { id: 'registration', title: "Registration", subtitle: "Osaka Regulation" },
      { id: 'safety', title: "Safety", subtitle: "Safety" },
      { id: 'equipment', title: "Equipment Guide", subtitle: "Equipment" },
      { id: 'trash', title: "Waste Guide", subtitle: "Waste Management" },
      { id: 'rules', title: "Etiquette", subtitle: "Etiquette" }
    ]
  },
  'jp': {
    next: "次のガイドへ", prev: "メニューに戻る", finish: "確認して部屋番号を取得", agree: "上記の規則を読み同意しました",
    zipLookup: "検索", zipPlaceholder: "郵便番号", zipLoading: "検索中...", regFormAddr: "日本の住所", regFormZip: "郵便番号",
    roomNo: "あなたの部屋番号", wifi: "Wi-Fi パスワード", copy: "コピー", breakfast: "朝食時間", breakfastLoc: "2階レストラン",
    service: "緊急連絡", serviceDetail: "先に緊急電話、次に管理人へ連絡。", welcomeTitle: "ようこそ！", welcomeSub: "旅を始めましょう",
    footer: "安全と快適さが最優先です。", guideTitle: "チェックイン案内", changeLang: "言語", manualLink: "マニュアル PDF",
    regResident: "日本在住", regTourist: "訪日観光客", startNewCheckin: "新しいチェックインを開始", regFormName: "氏名", regFormAge: "年齢", regFormOcc: "職業", regFormPhone: "電話番号",
    regFormNation: "国籍", regFormPass: "パスポート番号", regPassportUpload: "パスポート写真をアップロード", regPassportUploaded: "パスポート写真アップロード済み", regMinorAlert: "未成年は保護者情報が必要",
    passportModalTitle: "パスポート写真のアップロード", passportModalClose: "閉じる", passportModalIntro: "端末のカメラでパスポートの情報ページを撮影するか、鮮明な写真を選択してください。アップロード後、自動で読み取りフォームに入力します。", passportModalPick: "撮影または写真をアップロード", passportModalProcessing: "写真を保存し、パスポート情報を読み取っています...", passportModalConfirm: "フォームに反映", passportModalRetake: "撮り直す", passportModalSavedHint: "写真はバックエンドに保存され、管理画面でのみ確認できます。", passportFileTooLarge: "画像が大きすぎます。12MB以内の写真をアップロードしてください。", passportFileInvalid: "画像ファイルを選択してください。",
    ocrChecking: "ローカルで書類をOCR中...", ocrAutoFillSuccess: "パスポートを検出し、番号を自動入力しました。", ocrManualNeeded: "パスポートは検出されましたが、OCRが複数回失敗しました。残りは手入力してください。", ocrInvalidDoc: "アップロード不可：パスポート画像/スキャンではありません。", ocrFailed: "OCRに失敗しました。再試行してください。", ocrUnsupported: "このブラウザはローカルOCRに未対応です。画像は保持したので、パスポート情報を手入力してください。",
    addGuest: "追加", guestLabel: "ゲスト", petLabel: "ペットの数", countAdults: "人数 (成人/未成年)",
    checkIn: "チェックイン日", checkOut: "チェックアウト日",
    selectCountry: "国/地域を選択", detectedNationHint: "OCR検出の国籍",
    customStepEmpty: "このステップにはまだ内容がありません。",
    retryMsg: "通信が不安定です。自動的に再送信しています...",
    submitRetryMsg: "送信に失敗しました。データは保存されています。ネットワークを確認してボタンをタップして再試行してください。",
    newCheckin: "新しくチェックイン", viewHistory: "登録済みデータを確認", backToHome: "ホームに戻る",
    quickGuide: "クイックガイド", safetyGroup: "安全", equipmentGroup: "設備", viewGuide: "案内を見る",
    noContent: "このアイテムにはまだ内容がありません。", registeredData: "登録済みデータ", backToDir: "一覧に戻る", guestTypeAdult: "大人", guestTypeMinor: "未成年",
    viewStayGuide: "宿泊案内を見る",
    steps: [
      { id: 'welcome', title: "ようこそ", subtitle: "Welcome" },
      { id: 'count', title: "人数", subtitle: "Guest Count" },
      { id: 'stayDuration', title: "宿泊日数", subtitle: "Stay Duration" },
      { id: 'privacy', title: "個人情報について", subtitle: "Privacy Notice" },
      { id: 'registration', title: "登録", subtitle: "Osaka Regulation" },
      { id: 'safety', title: "安全", subtitle: "Safety" },
      { id: 'equipment', title: "設備の使い方", subtitle: "Equipment" },
      { id: 'trash', title: "ゴミ分別", subtitle: "Waste Management" },
      { id: 'rules', title: "マナー", subtitle: "Etiquette" }
    ]
  },
  'ko': {
    next: "다음 안내", prev: "메뉴로 돌아가기", finish: "확인 후 객실 번호 받기", agree: "위 규칙을 읽고 동의합니다",
    zipLookup: "조회", zipPlaceholder: "7자리 우편번호", zipLoading: "조회 중...", regFormAddr: "일본 주소", regFormZip: "우편번호",
    roomNo: "객실 번호", wifi: "와이파이 비밀번호", copy: "복사", breakfast: "조식 시간", breakfastLoc: "2층 레스토랑",
    service: "긴급 지원", serviceDetail: "긴급 전화 후 관리자에게 연락.", welcomeTitle: "환영합니다!", welcomeSub: "여행을 시작하세요",
    footer: "안전과 편안함이 최우선입니다.", guideTitle: "체크인 안내", changeLang: "언어", manualLink: "매뉴얼 PDF",
    regResident: "일본 거주자", regTourist: "방문객", startNewCheckin: "새 체크인 시작", regFormName: "이름", regFormAge: "나이", regFormOcc: "직업", regFormPhone: "전화번호",
    regFormNation: "국적", regFormPass: "여권 번호", regPassportUpload: "여권 사진 업로드", regPassportUploaded: "여권 사진 업로드 완료", regMinorAlert: "미성년자는 보호자 정보 필요",
    passportModalTitle: "여권 사진 업로드", passportModalClose: "닫기", passportModalIntro: "기기 카메라로 여권 정보면을 촬영하거나 선명한 사진을 선택해 주세요. 업로드 후 자동으로 인식해 양식에 입력합니다.", passportModalPick: "여권 사진 촬영 또는 업로드", passportModalProcessing: "사진을 저장하고 여권 정보를 인식하는 중입니다...", passportModalConfirm: "양식에 입력", passportModalRetake: "다시 촬영", passportModalSavedHint: "사진은 백엔드에 저장되며 관리자 화면에서만 확인할 수 있습니다.", passportFileTooLarge: "이미지가 너무 큽니다. 12MB 이하의 여권 사진을 업로드해 주세요.", passportFileInvalid: "이미지 파일을 선택해 주세요.",
    ocrChecking: "로컬 OCR로 문서를 분석하는 중...", ocrAutoFillSuccess: "여권을 인식해 여권번호를 자동 입력했습니다.", ocrManualNeeded: "여권은 감지했지만 OCR이 여러 번 실패했습니다. 남은 정보는 수동 입력해 주세요.", ocrInvalidDoc: "업로드 거절: 여권 사진/스캔으로 확인되지 않았습니다.", ocrFailed: "OCR 실패. 다시 시도해 주세요.", ocrUnsupported: "현재 브라우저는 로컬 OCR을 지원하지 않습니다. 사진은 보관되며 여권 정보를 수동 입력해 주세요.",
    addGuest: "인원 추가", guestLabel: "게스트", petLabel: "반려동물 수", countAdults: "인원 수 (성인/미성년)",
    checkIn: "체크인 날짜", checkOut: "체크아웃 날짜",
    selectCountry: "국가/지역 선택", detectedNationHint: "OCR 인식 국적",
    customStepEmpty: "이 단계에는 아직 내용이 없습니다.",
    retryMsg: "네트워크가 불안정합니다. 자동으로 재제출 중입니다...",
    submitRetryMsg: "제출에 실패했습니다. 데이터는 저장되어 있습니다. 네트워크를 확인하고 버튼을 눌러 다시 시도해 주세요.",
    newCheckin: "새로운 체크인", viewHistory: "등록 데이터 확인", backToHome: "홈으로 돌아가기",
    quickGuide: "빠른 안내", safetyGroup: "안전", equipmentGroup: "설비", viewGuide: "안내 보기",
    noContent: "이 항목에는 아직 내용이 없습니다.", registeredData: "등록된 데이터", backToDir: "목록으로 돌아가기", guestTypeAdult: "성인", guestTypeMinor: "미성년자",
    viewStayGuide: "숙박 안내 보기",
    steps: [
      { id: 'welcome', title: "환영", subtitle: "Welcome" },
      { id: 'count', title: "인원 수", subtitle: "Guest Count" },
      { id: 'stayDuration', title: "숙박 기간", subtitle: "Stay Duration" },
      { id: 'privacy', title: "개인정보 안내", subtitle: "Privacy Notice" },
      { id: 'registration', title: "등록", subtitle: "Osaka Regulation" },
      { id: 'safety', title: "안전", subtitle: "Safety" },
      { id: 'equipment', title: "설비 사용법", subtitle: "Equipment" },
      { id: 'trash', title: "쓰레기 분리", subtitle: "Waste Management" },
      { id: 'rules', title: "에티켓", subtitle: "Etiquette" }
    ]
  }
};

const normalizeChild = (c) => ({
  id: c.id || createStepId(),
  title: c.title || '',
  enabled: c.enabled !== false,
  content: c.content || ''
});

const buildDefaultSteps = (lang) => {
  const base = translations[lang]?.steps || translations[DEFAULT_LANG].steps;
  return base.map(step => {
    const category = GUIDE_STEP_IDS_SET.has(step.id) ? 'guide' : 'checkin';
    if (GUIDE_GROUP_IDS.includes(step.id)) {
      return { ...step, enabled: true, type: 'group', category, content: '', children: [] };
    }
    return { ...step, enabled: true, type: 'builtin', category, content: '' };
  });
};

const inferCategory = (step) => {
  if (step.category === 'checkin' || step.category === 'guide') return step.category;
  return GUIDE_STEP_IDS_SET.has(step.id) ? 'guide' : 'checkin';
};

const normalizeSteps = (steps, fallback) => {
  if (!Array.isArray(steps)) return fallback;
  return steps.map((step) => {
    const category = inferCategory(step);
    if (step.type === 'group') {
      return {
        id: step.id || createStepId(),
        title: step.title || '',
        subtitle: step.subtitle || '',
        enabled: step.enabled !== false,
        type: 'group',
        category,
        content: '',
        children: Array.isArray(step.children) ? step.children.map(normalizeChild) : []
      };
    }
    return {
      id: step.id || createStepId(),
      title: step.title || '',
      subtitle: step.subtitle || '',
      enabled: step.enabled !== false,
      type: step.type === 'custom' ? 'custom' : 'builtin',
      category,
      content: step.content || ''
    };
  });
};

const BUILTIN_STEP_FALLBACKS = {
  'zh-hans': {
    welcome: '<p>尊贵的客人，欢迎您选择入住。为确保您充分享受这里的宁静与便利，并保障所有住客安全，请逐页阅读本指南。</p>',
    privacy: '<p><strong>个人信息保护声明</strong></p><p>依据日本《住宅宿泊事业法》（2017年第65号）第8条及《旅馆业法施行规则》第4条，本设施须依法采集以下信息并建立住宿者名册。</p><p><strong>采集项目：</strong>姓名、住所（日本居民）、国籍、护照号码、护照照片</p><p><strong>使用目的：</strong>仅用于法定住宿者名册的记录与保管，不作其他任何用途。</p><p><strong>保存期限：</strong>依据《旅馆业法施行规则》第4条第1项，自退房日起保存 <strong>3年</strong>。</p><p><strong>管理责任人：</strong>本设施管理员</p><p><strong>第三方提供：</strong>除法令规定的行政机关（警察、行政厅等）依职权调取外，不向任何第三方提供。</p><p>依据《个人信息保护法》，您有权就本人信息的查阅、更正及删除向管理员提出申请。</p>',
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
    privacy: '<p><strong>個人資訊保護聲明</strong></p><p>依據日本《住宅宿泊事業法》（2017年第65號）第8條及《旅館業法施行規則》第4條規定，本設施須依法蒐集以下資訊並建立住宿者名冊。</p><p><strong>蒐集項目：</strong>姓名、住所（日本居民）、國籍、護照號碼、護照照片</p><p><strong>使用目的：</strong>僅用於法定住宿者名冊之記錄與保管，不作其他任何用途。</p><p><strong>保存期限：</strong>依據《旅館業法施行規則》第4條第1項，自退房日起保存 <strong>3年</strong>。</p><p><strong>管理負責人：</strong>本設施管理員</p><p><strong>第三方提供：</strong>除法令規定之行政機關（警察、行政廳等）依職權調取外，不向任何第三方提供。</p><p>依據《個人資訊保護法》，您有權就本人資訊之查閱、更正及刪除向管理員提出申請。</p>',
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
    privacy: '<p><strong>Privacy Notice — Personal Information</strong></p><p>Under Japan\'s Act on Accommodation Business Using Private Residences (Minpaku Act, 2017, Art. 8) and the Enforcement Regulations of the Inn Business Act (Art. 4), this accommodation is legally required to record your personal details in the guest register (宿泊者名簿).</p><p><strong>Information collected:</strong> Name, address (Japan residents), nationality, passport number, passport photograph</p><p><strong>Purpose of use:</strong> Legally mandated guest register only. Your information will not be used for any other purpose.</p><p><strong>Retention period:</strong> <strong>3 years</strong> from your checkout date, as required by Inn Business Act Enforcement Regulations Art. 4(1).</p><p><strong>Data controller:</strong> The property manager of this accommodation.</p><p><strong>Third-party disclosure:</strong> Your information will not be disclosed to any third party except where required by law (e.g., official requests from police or government authorities acting under statutory authority).</p><p>Under Japan\'s Act on the Protection of Personal Information (APPI), you have the right to request access, correction, or deletion of your personal data. Please contact the property manager.</p>',
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
    privacy: '<p><strong>個人情報の取り扱いについて</strong></p><p>本施設は、住宅宿泊事業法（平成29年法律第65号）第8条および旅館業法施行規則（昭和23年厚生省令第28号）第4条に基づき、宿泊者名簿への記録を目的として、以下の個人情報を収集いたします。</p><p><strong>収集する情報：</strong>氏名、住所（国内在住者）、国籍、旅券番号、旅券の写し（写真）</p><p><strong>利用目的：</strong>法令に基づく宿泊者名簿の記録・保管のみ。他の目的には一切使用いたしません。</p><p><strong>保存期間：</strong>旅館業法施行規則第4条第1項に基づき、チェックアウト日から <strong>3年間</strong></p><p><strong>管理責任者：</strong>本施設の管理者</p><p><strong>第三者提供：</strong>法令に基づく行政機関（警察・保健所等）による職権上の照会・調査を除き、第三者へは一切提供いたしません。</p><p>個人情報の保護に関する法律（個人情報保護法）に基づき、ご自身の情報に関する開示・訂正・利用停止・削除のご請求は、管理者までお申し出ください。</p>',
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
    privacy: '<p><strong>개인정보 처리 안내</strong></p><p>일본 「주택숙박사업법」(2017년 제65호) 제8조 및 「여관업법 시행규칙」(1948년 후생성령 제28호) 제4조에 따라, 본 숙박시설은 숙박자 명부(宿泊者名簿) 작성을 목적으로 아래의 개인정보를 수집합니다.</p><p><strong>수집 항목:</strong> 성명, 주소(일본 거주자), 국적, 여권번호, 여권 사진</p><p><strong>이용 목적:</strong> 법령에 따른 숙박자 명부 기록 및 보관 이외의 목적으로는 사용하지 않습니다.</p><p><strong>보유 기간:</strong> 「여관업법 시행규칙」 제4조 제1항에 따라, 퇴실일로부터 <strong>3년간</strong> 보관합니다.</p><p><strong>관리 책임자:</strong> 본 시설 관리자</p><p><strong>제3자 제공:</strong> 법령에 근거한 행정기관(경찰·보건소 등)의 공식 직권 요청을 제외하고는 제3자에게 일절 제공하지 않습니다.</p><p>「개인정보보호법」에 따라 본인의 정보에 대한 열람·정정·이용 정지·삭제를 요청하실 수 있습니다. 시설 관리자에게 문의해 주세요.</p>',
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

const buildDefaultCompletionTemplate = (lang) => ({
  title: translations[lang]?.welcomeTitle || translations[DEFAULT_LANG].welcomeTitle,
  subtitle: translations[lang]?.welcomeSub || translations[DEFAULT_LANG].welcomeSub,
  cardHtml: '<p><strong>Wi-Fi SSID:</strong> Hotel Wifi<br><strong>Password:</strong> password</p>',
  extraHtml: '<p><strong>AC control</strong><br><a href="https://homeassistant.kawachinagano.ox.gy:8123/" target="_blank" rel="noopener noreferrer">https://homeassistant.kawachinagano.ox.gy:8123/</a></p><img src="./ha-login-image.png" alt="HA Login" />'
});

const normalizeCompletionTemplate = (template, fallback) => ({
  title: template?.title || fallback.title,
  subtitle: template?.subtitle || fallback.subtitle,
  cardHtml: template?.cardHtml || fallback.cardHtml,
  extraHtml: template?.extraHtml || fallback.extraHtml
});

const loadCompletionTemplate = (lang) => {
  try {
    const raw = localStorage.getItem(`${COMPLETION_TEMPLATE_STORAGE_KEY}.${lang}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeCompletionTemplate(parsed, buildDefaultCompletionTemplate(lang));
  } catch (error) {
    console.warn('無法讀取完成頁設定:', error);
    return null;
  }
};

const saveCompletionTemplate = (lang, template) => {
  localStorage.setItem(`${COMPLETION_TEMPLATE_STORAGE_KEY}.${lang}`, JSON.stringify(template));
};

const sanitizeRichHtml = (html) => DOMPurify.sanitize(html || '', {
  ALLOWED_TAGS: ['p', 'b', 'strong', 'i', 'u', 'ul', 'ol', 'li', 'a', 'img', 'br', 'span'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt'],
  ALLOW_UNKNOWN_PROTOCOLS: false
});

const StepContent = ({ content, fallback }) => {
  const html = sanitizeRichHtml((content || fallback || '').trim());
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
  const [view, setView] = useState(getViewFromPath());
  const [loading, setLoading] = useState(false);
  const [retryMessage, setRetryMessage] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [hasPendingRetry, setHasPendingRetry] = useState(() => !!localStorage.getItem(PENDING_RETRY_KEY));
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '');

  const [lang, setLang] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [guests, setGuests] = useState([]);
  const [petCount, setPetCount] = useState(0);
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [hasAgreed, setHasAgreed] = useState(() => !!localStorage.getItem(PENDING_RETRY_KEY));
  const [hasHistory, setHasHistory] = useState(false);
  // 已完成登記的歷史資料（只讀顯示），與可編輯的表單 guests 分開
  const [savedRegistration, setSavedRegistration] = useState(null);

  const [appView, setAppView] = useState(() => !!localStorage.getItem(PENDING_RETRY_KEY) ? 'checkin' : 'landing');
  const [guideNavStack, setGuideNavStack] = useState([]);

  const [stepsConfig, setStepsConfig] = useState([]);
  const [completionTemplate, setCompletionTemplate] = useState(() => buildDefaultCompletionTemplate(DEFAULT_LANG));
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);

  const guidePush = (entry) => setGuideNavStack(s => [...s, entry]);
  const guidePop = () => setGuideNavStack(s => s.slice(0, -1));

  useEffect(() => {
    const hasPendingRetryFlag = !!localStorage.getItem(PENDING_RETRY_KEY);
    const hasRecord = localStorage.getItem(CHECKIN_STORAGE_KEY);
    const savedGuestsJSON = localStorage.getItem(GUEST_STORAGE_KEY);
    const savedPetCount = parseInt(localStorage.getItem(PET_COUNT_STORAGE_KEY) || '0', 10);
    const savedCheckIn = localStorage.getItem(CHECKIN_DATE_STORAGE_KEY) || '';
    const savedCheckOut = localStorage.getItem(CHECKOUT_DATE_STORAGE_KEY) || '';

    if (hasPendingRetryFlag) {
      // 待重試：恢復可編輯的表單資料
      if (savedGuestsJSON) {
        try { setGuests(JSON.parse(savedGuestsJSON).map(g => ({ ...g, isEditable: true }))); }
        catch (e) { setGuests([createGuestTemplate('adult')]); }
      }
      setPetCount(savedPetCount);
      setCheckInDate(savedCheckIn);
      setCheckOutDate(savedCheckOut);
    } else if (hasRecord) {
      // 已完成登記：保存歷史資料供查看，表單保持空白供新入住
      setHasHistory(true);
      if (savedGuestsJSON) {
        try {
          const savedGuests = JSON.parse(savedGuestsJSON);
          setSavedRegistration({ guests: savedGuests, petCount: savedPetCount, checkInDate: savedCheckIn, checkOutDate: savedCheckOut });
        } catch (e) { /* ignore */ }
      }
      setGuests([createGuestTemplate('adult')]);
    } else {
      setGuests([createGuestTemplate('adult')]);
    }
  }, []);

  const handleAdminTokenChange = (token) => {
    setAdminToken(token);
    if (token) { sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token); return; }
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  };

  useEffect(() => {
    const handleRouteChange = () => setView(getViewFromPath());
    window.addEventListener('popstate', handleRouteChange);
    return () => window.removeEventListener('popstate', handleRouteChange);
  }, []);

  const navigateTo = (path) => {
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setView(getViewFromPath());
  };

  useEffect(() => {
    let isActive = true;
    if (!lang) return () => {};
    DB.getTemplateBundle(lang).then((bundle) => {
      if (!isActive) return;
      const normalizedSteps = normalizeSteps(bundle?.steps?.data, buildDefaultSteps(lang));
      const normalizedCT = normalizeCompletionTemplate(bundle?.completionTemplate?.data, buildDefaultCompletionTemplate(lang));
      setAppSettings({ ...DEFAULT_APP_SETTINGS, ...(bundle?.appSettings || {}) });
      setStepsConfig(normalizedSteps);
      setCompletionTemplate(normalizedCT);
      saveSteps(lang, normalizedSteps);
      saveCompletionTemplate(lang, normalizedCT);
    }).catch(() => {
      if (!isActive) return;
      setAppSettings(DEFAULT_APP_SETTINGS);
      setStepsConfig(loadSteps(lang) || buildDefaultSteps(lang));
      setCompletionTemplate(loadCompletionTemplate(lang) || buildDefaultCompletionTemplate(lang));
    });
    return () => { isActive = false; };
  }, [lang]);

  const handleGuestSubmit = async (guestData) => {
    if (!Array.isArray(guestData) || guestData.length === 0) return true;
    setSubmitError('');
    let submissionId = localStorage.getItem(SUBMISSION_ID_KEY);
    if (!submissionId) {
      submissionId = crypto.randomUUID();
      localStorage.setItem(SUBMISSION_ID_KEY, submissionId);
    }
    setLoading(true);
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAYS = [1500, 3000];
    let result = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const t = translations[lang] || translations[DEFAULT_LANG];
        setRetryMessage(t.retryMsg || 'Network unstable — retrying...');
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
      }
      result = await DB.insertRecord({ submissionId, guests: guestData, petCount, checkIn: checkInDate, checkOut: checkOutDate });
      if (!result.networkError) break;
    }
    setRetryMessage('');
    setLoading(false);
    const t = translations[lang] || translations[DEFAULT_LANG];
    if (!result.ok) {
      try {
        const failLog = JSON.parse(localStorage.getItem(FAILED_SUBMISSIONS_LOG_KEY) || '[]');
        failLog.push({
          submissionId, timestamp: new Date().toISOString(),
          guests: guestData.map((g) => ({ ...g, passportPhoto: typeof g.passportPhoto === 'string' && g.passportPhoto.startsWith('data:image') ? '[base64_omitted]' : g.passportPhoto })),
          petCount, checkIn: checkInDate, checkOut: checkOutDate
        });
        localStorage.setItem(FAILED_SUBMISSIONS_LOG_KEY, JSON.stringify(failLog));
      } catch (e) { console.error('[Submission] 無法寫入失敗日誌:', e); }
      localStorage.setItem(PENDING_RETRY_KEY, 'true');
      setHasPendingRetry(true);
      setSubmitError(t.submitRetryMsg || 'Submission failed — please retry when your network is stable.');
      return false;
    }
    localStorage.removeItem(PENDING_RETRY_KEY);
    setHasPendingRetry(false);
    setSubmitError('');
    localStorage.setItem(CHECKIN_STORAGE_KEY, 'true');
    localStorage.setItem(PET_COUNT_STORAGE_KEY, petCount.toString());
    localStorage.setItem(CHECKIN_DATE_STORAGE_KEY, checkInDate);
    localStorage.setItem(CHECKOUT_DATE_STORAGE_KEY, checkOutDate);
    const guestsForStorage = guestData.map((g) => ({ ...g, passportPhoto: typeof g.passportPhoto === 'string' && g.passportPhoto.startsWith('data:image') ? '' : g.passportPhoto }));
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(guestsForStorage));
    setSavedRegistration({ guests: guestsForStorage, petCount, checkInDate, checkOutDate });
    setGuests([createGuestTemplate('adult')]);
    setHasHistory(true);
    return true;
  };

  // 開始新入住：重置表單，保留歷史記錄不清除
  const startNewCheckin = () => {
    setGuests([createGuestTemplate('adult')]);
    setCurrentStep(0);
    setIsCompleted(false);
    setPetCount(0);
    setCheckInDate('');
    setCheckOutDate('');
    setHasAgreed(false);
    setSubmitError('');
    localStorage.removeItem(SUBMISSION_ID_KEY);
    localStorage.removeItem(PENDING_RETRY_KEY);
    localStorage.removeItem(FAILED_SUBMISSIONS_LOG_KEY);
    setHasPendingRetry(false);
    setAppView('checkin');
  };

  const resetCheckinProcess = () => {
    setGuests([createGuestTemplate('adult')]);
    setCurrentStep(0);
    setIsCompleted(false);
    setPetCount(0);
    setCheckInDate('');
    setCheckOutDate('');
    setHasAgreed(false);
    localStorage.removeItem(CHECKIN_STORAGE_KEY);
    localStorage.removeItem(GUEST_STORAGE_KEY);
    localStorage.removeItem(PET_COUNT_STORAGE_KEY);
    localStorage.removeItem(CHECKIN_DATE_STORAGE_KEY);
    localStorage.removeItem(CHECKOUT_DATE_STORAGE_KEY);
    localStorage.removeItem(SUBMISSION_ID_KEY);
    localStorage.removeItem(PENDING_RETRY_KEY);
    localStorage.removeItem(FAILED_SUBMISSIONS_LOG_KEY);
    setHasPendingRetry(false);
    setSubmitError('');
    setHasHistory(false);
    setSavedRegistration(null);
    setAppView('landing');
    setGuideNavStack([]);
  };

  if (view === 'admin') {
    return (
      <AdminPage
        adminToken={adminToken}
        onAdminTokenChange={handleAdminTokenChange}
        onExitAdmin={() => { navigateTo('/'); setAppView('landing'); setGuideNavStack([]); }}
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
        buildDefaultCompletionTemplate={buildDefaultCompletionTemplate}
        loadCompletionTemplate={loadCompletionTemplate}
        saveCompletionTemplate={saveCompletionTemplate}
        normalizeCompletionTemplate={normalizeCompletionTemplate}
      />
    );
  }

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
          <button onClick={() => navigateTo('/admin')} className="absolute bottom-6 right-6 p-2 text-slate-300 hover:text-slate-500"><Lock className="w-4 h-4" /></button>
        </div>
      </div>
    );
  }

  if (appView === 'checkin') {
    return (
      <CheckinFlow
        onSubmit={handleGuestSubmit}
        isSubmitting={loading}
        retryMessage={retryMessage}
        submitError={submitError}
        hasPendingRetry={hasPendingRetry}
        lang={lang}
        setLang={setLang}
        currentStep={currentStep}
        setCurrentStep={setCurrentStep}
        isCompleted={isCompleted}
        setIsCompleted={setIsCompleted}
        guests={guests}
        setGuests={setGuests}
        petCount={petCount}
        setPetCount={setPetCount}
        checkInDate={checkInDate}
        setCheckInDate={setCheckInDate}
        checkOutDate={checkOutDate}
        setCheckOutDate={setCheckOutDate}
        hasAgreed={hasAgreed}
        setHasAgreed={setHasAgreed}
        hasHistory={hasHistory}
        onAdminRequest={() => navigateTo('/admin')}
        onGoHome={() => { setAppView('landing'); setIsCompleted(false); }}
        onViewGuide={() => { setAppView('guide'); setGuideNavStack([]); setIsCompleted(false); }}
        stepsConfig={stepsConfig}
        completionTemplate={completionTemplate}
        appSettings={appSettings}
      />
    );
  }

  if (appView === 'guide') {
    return (
      <GuideView
        lang={lang}
        setLang={setLang}
        guideNavStack={guideNavStack}
        guidePush={guidePush}
        guidePop={guidePop}
        stepsConfig={stepsConfig}
        savedRegistration={savedRegistration}
        hasHistory={hasHistory}
        onGoHome={() => { setAppView('landing'); setGuideNavStack([]); }}
        onAdminRequest={() => navigateTo('/admin')}
      />
    );
  }

  return (
    <HomeLanding
      lang={lang}
      setLang={setLang}
      hasHistory={hasHistory}
      stepsConfig={stepsConfig}
      hasPendingRetry={hasPendingRetry}
      onStartCheckin={startNewCheckin}
      onViewHistory={() => { setAppView('guide'); setGuideNavStack([]); }}
      onQuickNav={(stepId) => {
        const allSteps = stepsConfig.length ? stepsConfig : buildDefaultSteps(lang);
        const step = allSteps.find(s => s.id === stepId);
        const navEntry = step?.type === 'group'
          ? { type: 'group', groupId: stepId }
          : { type: 'solo', stepId };
        setAppView('guide');
        setGuideNavStack([{ type: '__home__' }, navEntry]);
      }}
      onAdminRequest={() => navigateTo('/admin')}
    />
  );
};

// ----------------------------------------------------------------------
// HomeLanding
// ----------------------------------------------------------------------
const HomeLanding = ({ lang, setLang, hasHistory, stepsConfig, hasPendingRetry, onStartCheckin, onViewHistory, onQuickNav, onAdminRequest }) => {
  const t = translations[lang] || translations[DEFAULT_LANG];
  const rawSteps = stepsConfig.length ? stepsConfig : buildDefaultSteps(lang || DEFAULT_LANG);
  const welcomeStep = rawSteps.find(s => s.id === 'welcome');
  const welcomeFallback = getBuiltinStepFallback(lang, 'welcome');

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-start p-6 animate-in fade-in">
      <div className="w-full max-w-sm space-y-6 pt-8">
        <div className="flex justify-between items-center">
          <button onClick={() => setLang(null)} className="flex items-center gap-2 text-slate-400 hover:text-slate-600 text-sm">
            <Languages className="w-4 h-4" />
            <span>{t.changeLang}</span>
          </button>
          <button onClick={onAdminRequest} className="p-2 text-slate-300 hover:text-slate-500">
            <Lock className="w-4 h-4" />
          </button>
        </div>
        {(welcomeStep?.content || welcomeFallback) && (
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <StepContent content={welcomeStep?.content || welcomeFallback} fallback="" />
          </div>
        )}
        <div className="space-y-3">
          <button onClick={onStartCheckin} className="w-full flex items-center justify-between p-5 bg-slate-900 text-white rounded-2xl shadow-lg hover:bg-slate-800 transition-all">
            <div className="flex items-center gap-3">
              <UserPlus className="w-6 h-6" />
              <span className="font-bold">{t.newCheckin}</span>
            </div>
            <ChevronRight className="w-5 h-5 opacity-60" />
          </button>
          {hasHistory && (
            <button onClick={onViewHistory} className="w-full flex items-center justify-between p-5 bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-sm hover:bg-slate-50 transition-all">
              <div className="flex items-center gap-3">
                <ClipboardList className="w-6 h-6 text-slate-500" />
                <span className="font-bold">{t.viewHistory}</span>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300" />
            </button>
          )}
        </div>
        {hasHistory && (() => {
          const guideSteps = rawSteps.filter(s => s.category === 'guide' && s.enabled !== false);
          if (!guideSteps.length) return null;
          return (
            <div className="space-y-3">
              <p className="text-xs font-bold text-slate-400 uppercase px-1">{t.quickGuide}</p>
              <div className="grid grid-cols-2 gap-3">
                {guideSteps.map(step => {
                  const colorCls = step.id === 'safety'
                    ? 'bg-red-50 text-red-700 border-red-100 hover:bg-red-100'
                    : step.id === 'equipment'
                      ? 'bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100'
                      : 'bg-white text-slate-700 border-slate-100 hover:bg-slate-50';
                  return (
                    <button key={step.id} onClick={() => onQuickNav(step.id)}
                      className={`flex flex-col items-center gap-2 p-4 rounded-2xl border ${colorCls} transition-all`}>
                      {getStepIcon(step.id, 'w-6 h-6')}
                      <span className="text-xs font-bold text-center">{step.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// CheckinFlow（登記表單，5 步驟）
// ----------------------------------------------------------------------
const CheckinFlow = ({
  onSubmit, isSubmitting, retryMessage, submitError, hasPendingRetry,
  lang, setLang,
  currentStep, setCurrentStep,
  isCompleted, setIsCompleted,
  guests, setGuests,
  petCount, setPetCount,
  checkInDate, setCheckInDate,
  checkOutDate, setCheckOutDate,
  hasAgreed, setHasAgreed,
  hasHistory,
  onAdminRequest,
  onGoHome,
  onViewGuide,
  stepsConfig, completionTemplate, appSettings
}) => {
  const [isLookingUpZip, setIsLookingUpZip] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scannerGuestId, setScannerGuestId] = useState(null);

  useEffect(() => {
    if (guests.length === 0) {
      setGuests([createGuestTemplate('adult')]);
    }
  }, [guests.length, setGuests]);

  const t = translations[lang || DEFAULT_LANG];
  const countryOptions = getCountryOptions(lang, appSettings.taiwanNamingMode);

  const rawSteps = stepsConfig.length ? stepsConfig : buildDefaultSteps(lang || DEFAULT_LANG);
  const steps = rawSteps.filter(s => s.category === 'checkin' && s.enabled !== false);

  useEffect(() => {
    if (steps.length && currentStep >= steps.length) setCurrentStep(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.length, currentStep, setCurrentStep]);

  useEffect(() => {
    if (hasPendingRetry && !hasHistory && steps.length > 0) {
      setCurrentStep(steps.length - 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPendingRetry, hasHistory, steps.length]);

  const addGuest = () => setGuests((prevGuests) => [...prevGuests, createGuestTemplate('adult')]);
  const removeGuest = (id) => setGuests((prevGuests) => prevGuests.filter((guest) => guest.id !== id));
  const updateGuest = (id, field, value) => setGuests((prevGuests) => prevGuests.map((guest) => (guest.id === id ? { ...guest, [field]: value } : guest)));
  const updateCheckInDate = (value) => setCheckInDate(value);
  const updateCheckOutDate = (value) => setCheckOutDate(value);
  const isRegValid = () => isRegistrationValid(guests);

  const uploadAndOcrPassport = async (base64Image, options = { strict: true }) => {
    const ocrResult = await DB.recognizePassport(base64Image);
    if (!ocrResult?.isPassport && !ocrResult?.unsupported && options?.strict !== false) {
      throw new Error(t.ocrInvalidDoc);
    }
    return {
      isPassport: Boolean(ocrResult?.isPassport),
      passportNumber: ocrResult.passportNumber || '',
      fullName: ocrResult.fullName || '',
      age: ocrResult.age,
      nationalityCode: ocrResult.nationalityCode || '',
      birthDate: ocrResult.birthDate || '',
      sex: ocrResult.sex || '',
      confidence: ocrResult.confidence,
      viz: ocrResult.viz,
      mrz: ocrResult.mrz,
      mrzPassportNumber: ocrResult.mrzPassportNumber,
      mrzBirthDate: ocrResult.mrzBirthDate,
      mrzNationality: ocrResult.mrzNationality,
      mrzSex: ocrResult.mrzSex,
      text: ocrResult.text || '',
      passportPhoto: ocrResult.passportPhoto || '',
      unsupported: Boolean(ocrResult.unsupported)
    };
  };

  const applyPassportScanResult = (guestId, payload) => {
    if (!guestId || !payload) return;

    updateGuest(guestId, 'passportPhoto', payload.image || null);
    updateGuest(guestId, 'passportNumber', payload.passportNumber || '');
    updateGuest(guestId, 'passportOcrStatus', 'processing');
    updateGuest(guestId, 'passportOcrMessage', t.ocrChecking);

    if (payload.fullName) {
      updateGuest(guestId, 'name', payload.fullName);
    }

    const normalizedAge = Number.isFinite(payload.age)
      ? String(payload.age)
      : parsePassportBirthDateToAge(payload.birthDate);

    if (normalizedAge) {
      updateGuest(guestId, 'age', normalizedAge);
    }

    if (payload.nationalityCode) {
      const resolvedNationality = resolveNationalityForForm({
        nationalityCode: payload.nationalityCode
      });
      updateGuest(guestId, 'nationality', resolvedNationality.nationality || '');
      updateGuest(guestId, 'nationalityDetected', resolvedNationality.nationalityDetected || '');
    }

    if (payload.passportNumber) {
      updateGuest(guestId, 'passportOcrStatus', 'success');
      updateGuest(guestId, 'passportOcrMessage', t.ocrAutoFillSuccess);
    } else {
      updateGuest(guestId, 'passportOcrStatus', 'manual-required');
      updateGuest(guestId, 'passportOcrMessage', t.ocrManualNeeded);
    }
  };

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

  const stepConfig = steps[currentStep];
  const hasContent = Boolean(stepConfig?.content?.trim());
  const builtinFallbackContent = stepConfig?.type === 'builtin' ? getBuiltinStepFallback(lang, stepConfig?.id) : '';

  const handleNext = async () => {
    const isLastStep = currentStep === steps.length - 1;
    const pendingGuests = guests.filter((guest) => guest.isEditable !== false);
    if (stepConfig?.id === 'registration') {
      const success = await onSubmit(pendingGuests);
      if (!success) return;
      if (isLastStep) { setIsCompleted(true); } else { setCurrentStep(currentStep + 1); }
      return;
    }
    if (!isLastStep) { setCurrentStep(currentStep + 1); return; }
    if (stepConfig?.id === 'rules' && !hasAgreed) return;
    setIsCompleted(true);
  };

  if (isCompleted) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
        <CheckCircle2 className="w-16 h-16 text-emerald-500 mb-6 mx-auto" />
        <h1 className="text-3xl font-bold mb-2">{completionTemplate.title}</h1>
        <p className="text-slate-500 mb-6">{completionTemplate.subtitle}</p>
        <div className="bg-slate-900 text-white p-8 rounded-[2rem] shadow-xl w-full max-w-sm">
          <div className="flex items-center gap-3">
            <Wifi className="w-7 h-7" />
            <div className="text-md text-left step-content text-white" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(completionTemplate.cardHtml) }} />
          </div>
        </div>
        <div className="mt-8 p-6 bg-white rounded-2xl border border-slate-100 max-w-sm w-full space-y-4 text-left">
          <div className="flex items-start gap-3">
            <Home className="w-5 h-5 text-blue-500 mt-1" />
            <div className="text-sm step-content" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(completionTemplate.extraHtml) }} />
          </div>
        </div>
        <div className="mt-6 w-full max-w-sm space-y-3">
          <button onClick={onViewGuide} className="w-full flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:bg-slate-50 transition-all">
            <div className="flex items-center gap-3">
              <BookOpen className="w-5 h-5 text-slate-500" />
              <span className="font-bold text-slate-900">{t.viewStayGuide}</span>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-300" />
          </button>
          <button onClick={onGoHome} className="w-full flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:bg-slate-50 transition-all">
            <div className="flex items-center gap-3">
              <Home className="w-5 h-5 text-slate-500" />
              <span className="font-bold text-slate-900">{t.backToHome}</span>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-300" />
          </button>
        </div>
      </div>
    );
  }

  if (!stepConfig) return null;

  const menuContent = (
    <div className="p-4 space-y-2 h-full overflow-y-auto overscroll-contain">
      <h3 className="text-sm font-bold px-4 text-slate-500">{t.guideTitle}</h3>
      {steps.map((step, index) => (
        <button
          key={step.id}
          onClick={() => { setCurrentStep(index); setIsMenuOpen(false); }}
          className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${currentStep === index ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
        >
          {getStepIcon(step.id)}
          <span className="text-sm font-semibold">{step.title}</span>
        </button>
      ))}
      <hr className="my-4" />
      <button onClick={() => setLang(null)} className="w-full flex items-center gap-3 p-3 rounded-lg text-slate-700 hover:bg-slate-100">
        <Languages className="w-6 h-6" />
        <span className="text-sm font-semibold">{t.changeLang}</span>
      </button>
      <button onClick={onGoHome} className="w-full flex items-center gap-3 p-3 rounded-lg text-slate-700 hover:bg-slate-100">
        <Home className="w-6 h-6" />
        <span className="text-sm font-semibold">{t.backToHome}</span>
      </button>
    </div>
  );

  return (
    <div className="h-screen bg-slate-50 flex">
      {/* Sidebar Menu for Desktop */}
      <div className="hidden md:block md:w-72 bg-white border-r border-slate-200 h-full overflow-y-auto">
        {menuContent}
      </div>

      {/* Mobile Menu (Overlay) */}
      {isMenuOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 md:hidden" onClick={() => setIsMenuOpen(false)}>
          <div className="w-72 bg-white h-full shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {menuContent}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar for mobile */}
        <div className="md:hidden p-4 flex justify-between items-center bg-white border-b border-slate-200">
          <button onClick={() => setIsMenuOpen(true)}>
            <Menu className="w-6 h-6 text-slate-800" />
          </button>
          <div className="text-center">
            <h2 className="text-md font-bold text-slate-900">{stepConfig?.title}</h2>
            <p className="text-xs text-slate-500">{currentStep + 1} / {steps.length}</p>
          </div>
          <button onClick={onAdminRequest} className="p-2 text-slate-400 hover:text-slate-600">
            <Lock className="w-4 h-4" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-3xl mx-auto bg-white p-6 md:p-10 rounded-2xl border border-slate-100 shadow-sm">
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
                      <button onClick={() => guests.length > 1 && removeGuest(guests[guests.length - 1].id)} disabled={hasHistory} className={`w-8 h-8 rounded-full border border-slate-300 ${hasHistory ? 'opacity-30 cursor-not-allowed' : ''}`}>-</button>
                      <span className="font-bold">{guests.length}</span>
                      <button onClick={addGuest} disabled={hasHistory} className={`w-8 h-8 rounded-full border border-slate-300 ${hasHistory ? 'opacity-30 cursor-not-allowed' : ''}`}>+</button>
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-2xl flex items-center justify-between">
                    <div><p className="font-bold text-slate-800 text-sm">{t.petLabel}</p></div>
                    <div className="flex items-center gap-4">
                      <button onClick={() => petCount > 0 && setPetCount(petCount - 1)} disabled={hasHistory} className={`w-8 h-8 rounded-full border border-slate-300 ${hasHistory ? 'opacity-30 cursor-not-allowed' : ''}`}>-</button>
                      <span className="font-bold">{petCount}</span>
                      <button onClick={() => setPetCount(petCount + 1)} disabled={hasHistory} className={`w-8 h-8 rounded-full border border-slate-300 ${hasHistory ? 'opacity-30 cursor-not-allowed' : ''}`}>+</button>
                    </div>
                  </div>
                </div>
              )}

              {stepConfig.id === 'stayDuration' && (
                <div className="space-y-4 py-4 animate-in fade-in slide-in-from-bottom-2">
                  <div className="grid grid-cols-1 gap-4">
                    <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-2 box-border">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-1 block">{t.checkIn}</label>
                      <input
                        type="date"
                        value={checkInDate}
                        onChange={(e) => updateCheckInDate(e.target.value)}
                        onInput={(e) => updateCheckInDate(e.currentTarget.value)}
                        readOnly={hasHistory}
                        className={`w-full p-3 bg-white border border-slate-100 rounded-xl text-sm shadow-sm outline-none focus:ring-2 focus:ring-slate-900 transition-all appearance-none ${hasHistory ? 'text-slate-400 cursor-default' : ''}`}
                      />
                    </div>
                    <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-2 box-border">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-1 block">{t.checkOut}</label>
                      <input
                        type="date"
                        value={checkOutDate}
                        onChange={(e) => updateCheckOutDate(e.target.value)}
                        onInput={(e) => updateCheckOutDate(e.currentTarget.value)}
                        readOnly={hasHistory}
                        className={`w-full p-3 bg-white border border-slate-100 rounded-xl text-sm shadow-sm outline-none focus:ring-2 focus:ring-slate-900 transition-all appearance-none ${hasHistory ? 'text-slate-400 cursor-default' : ''}`}
                      />
                    </div>
                  </div>
                </div>
              )}

              {stepConfig.id === 'registration' && (
                <div className="space-y-6 custom-scrollbar">
                  {guests.map((guest, idx) => (
                    <div key={guest.id} className="p-5 bg-slate-50/50 rounded-2xl border border-slate-100 space-y-4 shadow-sm relative">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase text-slate-400">{t.guestLabel} {idx + 1}</span>
                        {guests.length > 1 && guest.isEditable && (
                          <button
                            onClick={() => removeGuest(guest.id)}
                            className="text-slate-300 hover:text-rose-500 transition-colors p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="flex bg-white p-1 rounded-xl border">
                        <button disabled={!guest.isEditable} onClick={() => updateGuest(guest.id, 'isResident', true)} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${guest.isResident ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400'} disabled:opacity-70`}>{t.regResident}</button>
                        <button disabled={!guest.isEditable} onClick={() => updateGuest(guest.id, 'isResident', false)} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${!guest.isResident ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400'} disabled:opacity-70`}>{t.regTourist}</button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {guest.isResident ? (
                          <>
                            <div className="col-span-2">
                              <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormName}</label>
                              <input disabled={!guest.isEditable} type="text" value={guest.name} onChange={(e) => updateGuest(guest.id, 'name', e.target.value)} className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm shadow-sm outline-none disabled:bg-slate-100" />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormAge}</label>
                              <input disabled={!guest.isEditable} type="number" value={guest.age} onChange={(e) => updateGuest(guest.id, 'age', e.target.value)} className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm shadow-sm outline-none disabled:bg-slate-100" />
                            </div>
                            <div>
                              <label className={`text-[10px] font-bold ml-1 uppercase ${parseInt(guest.age) < 18 ? 'text-slate-300' : 'text-slate-400'}`}>{t.regFormPhone}</label>
                              <input
                                disabled={!guest.isEditable || parseInt(guest.age) < 16}
                                type="text"
                                value={parseInt(guest.age) < 16 ? "000-0000-0000" : guest.phone}
                                onChange={(e) => updateGuest(guest.id, 'phone', e.target.value)}
                                className={`w-full p-3 border border-slate-100 rounded-xl text-sm shadow-sm outline-none transition-colors ${parseInt(guest.age) < 16 ? 'bg-slate-100/50 text-slate-300 cursor-not-allowed' : 'bg-white text-slate-900'} disabled:bg-slate-100`}
                              />
                            </div>
                            <div className="col-span-2 space-y-3">
                              <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormZip}</label>
                                <div className="flex gap-3">
                                  <input disabled={!guest.isEditable} type="text" placeholder={t.zipPlaceholder} value={guest.postalCode} onChange={(e) => updateGuest(guest.id, 'postalCode', e.target.value.replace(/\D/g, ''))} className="flex-1 p-3 bg-white border border-slate-100 rounded-xl text-sm font-mono disabled:bg-slate-100" maxLength={7} />
                                  <button disabled={!guest.isEditable} onClick={() => lookupZipCode(guest.id, guest.postalCode)} className="flex-1 px-4 bg-slate-900 text-white rounded-xl text-xs font-bold disabled:bg-slate-200 flex items-center gap-2">
                                    {isLookingUpZip === guest.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} {isLookingUpZip === guest.id ? t.zipLoading : t.zipLookup}
                                  </button>
                                </div>
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormAddr}</label>
                                <input disabled={!guest.isEditable} type="text" value={guest.address} onChange={(e) => updateGuest(guest.id, 'address', e.target.value)} className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm disabled:bg-slate-100" placeholder="大阪府大阪市…" />
                              </div>
                            </div>
                          </>
                        ) : guest.passportPhoto ? (
                          <>
                            <div className="col-span-2 space-y-2">
                              <button
                                disabled={!guest.isEditable || guest.passportOcrStatus === 'processing'}
                                onClick={() => setScannerGuestId(guest.id)}
                                className="w-full p-4 border-2 border-dashed rounded-xl flex items-center justify-center gap-2 transition-colors bg-emerald-50 border-emerald-200 text-emerald-600 disabled:opacity-60"
                              >
                                {guest.passportOcrStatus === 'processing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                                <span className="text-[10px] font-bold uppercase">{t.regPassportUploaded}</span>
                              </button>
                              {guest.passportOcrMessage && (
                                <p className={`text-[11px] ${guest.passportOcrStatus === 'failed' ? 'text-rose-500' : guest.passportOcrStatus === 'manual-required' ? 'text-amber-600' : 'text-emerald-600'}`}>{guest.passportOcrMessage}</p>
                              )}
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormName}</label>
                              <input disabled={!guest.isEditable} type="text" value={guest.name} onChange={(e) => updateGuest(guest.id, 'name', e.target.value)} className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm shadow-sm outline-none disabled:bg-slate-100" />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormAge}</label>
                              <input disabled={!guest.isEditable} type="number" value={guest.age} onChange={(e) => updateGuest(guest.id, 'age', e.target.value)} className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm shadow-sm outline-none disabled:bg-slate-100" />
                            </div>
                            <div>
                              <label className={`text-[10px] font-bold ml-1 uppercase ${parseInt(guest.age) < 18 ? 'text-slate-300' : 'text-slate-400'}`}>{t.regFormPhone}</label>
                              <input
                                disabled={!guest.isEditable || parseInt(guest.age) < 16}
                                type="text"
                                value={parseInt(guest.age) < 16 ? "000-0000-0000" : guest.phone}
                                onChange={(e) => updateGuest(guest.id, 'phone', e.target.value)}
                                className={`w-full p-3 border border-slate-100 rounded-xl text-sm shadow-sm outline-none transition-colors ${parseInt(guest.age) < 16 ? 'bg-slate-100/50 text-slate-300 cursor-not-allowed' : 'bg-white text-slate-900'} disabled:bg-slate-100`}
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormNation}</label>
                              <select
                                disabled={!guest.isEditable}
                                value={guest.nationality}
                                onChange={(e) => {
                                  updateGuest(guest.id, 'nationality', e.target.value);
                                  updateGuest(guest.id, 'nationalityDetected', '');
                                }}
                                className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm shadow-sm outline-none appearance-none cursor-pointer disabled:bg-slate-100"
                              >
                                <option value="">-- {t.selectCountry} --</option>
                                {countryOptions.map((country) => (
                                  <option key={country.code} value={country.code}>{country.label}</option>
                                ))}
                              </select>
                              {guest.nationalityDetected && (
                                <p className="text-[11px] text-amber-600 mt-1">{t.detectedNationHint}: {guest.nationalityDetected}</p>
                              )}
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">{t.regFormPass}</label>
                              <input disabled={!guest.isEditable} type="text" value={guest.passportNumber} onChange={(e) => updateGuest(guest.id, 'passportNumber', e.target.value)} className="w-full p-3 bg-white border border-slate-100 rounded-xl text-sm disabled:bg-slate-100" />
                            </div>
                          </>
                        ) : (
                          <div className="col-span-2 space-y-2">
                            <button
                              disabled={!guest.isEditable || guest.passportOcrStatus === 'processing'}
                              onClick={() => setScannerGuestId(guest.id)}
                              className="w-full p-5 border-2 border-dashed rounded-xl flex items-center justify-center gap-2 transition-colors bg-white border-slate-200 text-slate-500 hover:border-slate-400 disabled:opacity-60"
                            >
                              {guest.passportOcrStatus === 'processing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                              <span className="text-[10px] font-bold uppercase">{t.regPassportUpload}</span>
                            </button>
                            {guest.passportOcrMessage && (
                              <p className={`text-[11px] ${guest.passportOcrStatus === 'failed' ? 'text-rose-500' : guest.passportOcrStatus === 'manual-required' ? 'text-amber-600' : 'text-emerald-600'}`}>{guest.passportOcrMessage}</p>
                            )}
                          </div>
                        )}
                        {guest.age && parseInt(guest.age) < 18 && (
                          <div className="col-span-2 bg-rose-50 p-4 rounded-xl border border-rose-100 space-y-3">
                            <p className="text-[10px] font-bold text-rose-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {t.regMinorAlert}</p>
                            <div className="grid grid-cols-2 gap-2">
                              <input disabled={!guest.isEditable} type="text" placeholder={t.regFormName} value={guest.guardianName} onChange={(e) => updateGuest(guest.id, 'guardianName', e.target.value)} className="w-full p-2 bg-white rounded-lg text-xs outline-none disabled:bg-slate-100" />
                              <input disabled={!guest.isEditable} type="text" placeholder="Phone" value={guest.guardianPhone} onChange={(e) => updateGuest(guest.id, 'guardianPhone', e.target.value)} className="w-full p-2 bg-white rounded-lg text-xs outline-none disabled:bg-slate-100" />
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
                  <label className="flex items-center gap-4 p-4 bg-emerald-50 rounded-2xl border border-emerald-100 cursor-pointer shadow-sm group transition-all hover:bg-emerald-100">
                    <input type="checkbox" className="w-6 h-6 rounded text-emerald-600 transition-transform group-hover:scale-110" checked={hasAgreed} onChange={(e) => setHasAgreed(e.target.checked)} />
                    <span className="text-emerald-900 font-bold text-sm">{t.agree}</span>
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Navigation buttons */}
        {retryMessage ? (
          <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 flex items-center gap-2">
            <Loader2 className="w-3 h-3 text-amber-500 animate-spin flex-shrink-0" />
            <span className="text-xs text-amber-700">{retryMessage}</span>
          </div>
        ) : (submitError || hasPendingRetry) ? (
          <div className="px-4 py-2 bg-red-50 border-t border-red-200 flex items-center gap-2">
            <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />
            <span className="text-xs text-red-700">
              {submitError || t.submitRetryMsg || 'Submission failed — please check your connection and retry.'}
            </span>
          </div>
        ) : null}
        <div className="p-4 bg-white/50 backdrop-blur-sm border-t border-slate-200 flex gap-4">
          <button onClick={() => setIsMenuOpen(true)} className="p-4 rounded-2xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
            <Menu className="w-6 h-6" />
            <span className="hidden">{t.prev}</span>
          </button>
          <button
            onClick={handleNext}
            disabled={(stepConfig.id === 'registration' && !isRegValid()) || (stepConfig.id === 'stayDuration' && (!checkInDate || !checkOutDate)) || (stepConfig.id === 'rules' && !hasAgreed) || isSubmitting}
            className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-bold transition-all ${((stepConfig.id === 'registration' && !isRegValid()) || (stepConfig.id === 'stayDuration' && (!checkInDate || !checkOutDate)) || (stepConfig.id === 'rules' && !hasAgreed)) ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-slate-900 text-white shadow-lg hover:bg-slate-800'}`}
          >
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (currentStep === steps.length - 1 ? t.finish : t.next)}
            {!isSubmitting && <ChevronRight className="w-5 h-5" />}
          </button>
        </div>
        <PassportScannerFlow
          isOpen={Boolean(scannerGuestId)}
          onClose={() => setScannerGuestId(null)}
          uploadAndOcrPassport={uploadAndOcrPassport}
          onApply={(payload) => applyPassportScanResult(scannerGuestId, payload)}
          labels={t}
        />
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// GuideView（住宿指南，導航棧驅動）
// ----------------------------------------------------------------------
const GuideView = ({ lang, guideNavStack, guidePush, guidePop, stepsConfig, savedRegistration, hasHistory, onGoHome, onAdminRequest }) => {
  const t = translations[lang] || translations[DEFAULT_LANG];
  const rawSteps = stepsConfig.length ? stepsConfig : buildDefaultSteps(lang || DEFAULT_LANG);
  const getStep = (id) => rawSteps.find(s => s.id === id);
  const current = guideNavStack[guideNavStack.length - 1] ?? null;
  const prevEntry = guideNavStack[guideNavStack.length - 2] ?? null;

  // Back from group sub-list: if previous stack entry is __home__ sentinel, go home instead of directory
  const handleGroupBack = () => {
    if (prevEntry?.type === '__home__') { onGoHome(); } else { guidePop(); }
  };

  if (current?.type === 'child') {
    const groupStep = getStep(current.groupId);
    const childStep = groupStep?.children?.find(c => c.id === current.childId);
    const fallback = getBuiltinStepFallback(lang, current.childId);
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <div className="bg-white border-b border-slate-200 p-4 flex items-center gap-3">
          <button onClick={guidePop} className="p-2 text-slate-500 hover:text-slate-900"><ArrowLeft className="w-5 h-5" /></button>
          <div className="flex items-center gap-2">
            {getStepIcon(current.childId)}
            <h2 className="font-bold text-slate-900">{childStep?.title || current.childId}</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-3xl mx-auto bg-white p-6 md:p-10 rounded-2xl border border-slate-100 shadow-sm">
            {(childStep?.content || fallback)
              ? <StepContent content={childStep?.content || fallback} fallback="" />
              : <p className="text-sm text-slate-400">{t.noContent}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (current?.type === 'solo') {
    const soloStep = getStep(current.stepId);
    const fallback = getBuiltinStepFallback(lang, current.stepId);
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <div className="bg-white border-b border-slate-200 p-4 flex items-center gap-3">
          <button onClick={guidePop} className="p-2 text-slate-500 hover:text-slate-900"><ArrowLeft className="w-5 h-5" /></button>
          <div className="flex items-center gap-2">
            {getStepIcon(current.stepId)}
            <h2 className="font-bold text-slate-900">{soloStep?.title || current.stepId}</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-3xl mx-auto bg-white p-6 md:p-10 rounded-2xl border border-slate-100 shadow-sm">
            {(soloStep?.content || fallback)
              ? <StepContent content={soloStep?.content || fallback} fallback="" />
              : <p className="text-sm text-slate-400">{t.noContent}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (current?.type === 'group') {
    const groupStep = getStep(current.groupId);
    const children = (groupStep?.children || []).filter(c => c.enabled !== false);
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <div className="bg-white border-b border-slate-200 p-4 flex items-center gap-3">
          <button onClick={handleGroupBack} className="p-2 text-slate-500 hover:text-slate-900"><ArrowLeft className="w-5 h-5" /></button>
          <div className="flex items-center gap-2 flex-1">
            {getStepIcon(current.groupId)}
            <h2 className="font-bold text-slate-900">{groupStep?.title || current.groupId}</h2>
          </div>
          <button onClick={onAdminRequest} className="p-2 text-slate-300 hover:text-slate-500"><Lock className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-2xl mx-auto space-y-3">
            {children.length > 0 ? children.map(child => (
              <button key={child.id} onClick={() => guidePush({ type: 'child', groupId: current.groupId, childId: child.id })}
                className="w-full flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 transition-all">
                <div className="flex items-center gap-3">
                  {getStepIcon(child.id)}
                  <span className="font-semibold text-slate-900">{child.title}</span>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300" />
              </button>
            )) : <p className="text-sm text-slate-400 text-center py-8">{t.noContent}</p>}
          </div>
        </div>
      </div>
    );
  }

  // Directory view (stack empty)
  const guideSteps = rawSteps.filter(s => s.category === 'guide' && s.enabled !== false);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b border-slate-200 p-4 flex items-center justify-between">
        <button onClick={onGoHome} className="flex items-center gap-2 text-slate-500 hover:text-slate-900">
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-semibold">{t.backToHome}</span>
        </button>
        <h1 className="font-bold text-slate-900">{t.viewGuide}</h1>
        <button onClick={onAdminRequest} className="p-2 text-slate-300 hover:text-slate-500"><Lock className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-2xl mx-auto space-y-4">
          {hasHistory && savedRegistration && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h2 className="font-bold text-emerald-800">{t.registeredData}</h2>
              </div>
              {(savedRegistration.checkInDate || savedRegistration.checkOutDate) && (
                <p className="text-xs text-emerald-600 font-mono">
                  {savedRegistration.checkInDate && `${t.checkIn}: ${savedRegistration.checkInDate}`}
                  {savedRegistration.checkInDate && savedRegistration.checkOutDate && '  →  '}
                  {savedRegistration.checkOutDate && `${t.checkOut}: ${savedRegistration.checkOutDate}`}
                </p>
              )}
              <div className="space-y-2">
                {(savedRegistration.guests || []).map((g, i) => (
                  <div key={g.id || i} className="bg-white rounded-xl p-3 border border-emerald-100 text-xs text-slate-700 space-y-1">
                    <p className="font-bold text-slate-900">{g.name || '—'} <span className="font-normal text-slate-400">· {g.type === 'child' ? (t.guestTypeMinor || '未成年') : (t.guestTypeAdult || '成人')}</span></p>
                    {g.nationality && <p className="text-slate-500">{t.regFormNation}: {g.nationality}</p>}
                    {g.passportNumber && <p className="font-mono text-slate-500">{t.regFormPass}: {g.passportNumber}</p>}
                    {g.phone && <p className="text-slate-500">{t.regFormPhone}: {g.phone}</p>}
                    {g.address && <p className="text-slate-500 truncate">{t.regFormAddr}: {g.address}</p>}
                  </div>
                ))}
                {savedRegistration.petCount > 0 && (
                  <p className="text-xs text-emerald-600">{t.petLabel}: {savedRegistration.petCount}</p>
                )}
              </div>
            </div>
          )}
          {guideSteps.map(step => {
            if (step.type === 'group') {
              const enabledChildren = (step.children || []).filter(c => c.enabled !== false).length;
              const colorCls = step.id === 'safety'
                ? 'bg-red-50 text-red-800 border-red-100 hover:bg-red-100'
                : step.id === 'equipment'
                  ? 'bg-blue-50 text-blue-800 border-blue-100 hover:bg-blue-100'
                  : 'bg-indigo-50 text-indigo-800 border-indigo-100 hover:bg-indigo-100';
              const subtextCls = step.id === 'safety' ? 'text-red-500' : step.id === 'equipment' ? 'text-blue-500' : 'text-indigo-500';
              return (
                <button key={step.id} onClick={() => guidePush({ type: 'group', groupId: step.id })}
                  className={`w-full flex items-center justify-between p-5 rounded-2xl border shadow-sm transition-all ${colorCls}`}>
                  <div className="flex items-center gap-3">
                    {getStepIcon(step.id, 'w-6 h-6')}
                    <div className="text-left">
                      <p className="font-bold">{step.title}</p>
                      <p className={`text-xs ${subtextCls}`}>{enabledChildren} 項目</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 opacity-60" />
                </button>
              );
            }
            return (
              <button key={step.id} onClick={() => guidePush({ type: 'solo', stepId: step.id })}
                className="w-full flex items-center justify-between p-5 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 transition-all">
                <div className="flex items-center gap-3">
                  {getStepIcon(step.id, 'w-6 h-6 text-slate-500')}
                  <span className="font-semibold text-slate-900">{step.title}</span>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default App;
