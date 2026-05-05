import { useEffect, useRef, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import UnderlineExtension from '@tiptap/extension-underline';
import LinkExtension from '@tiptap/extension-link';
import ImageExtension from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import {
  AlertTriangle,
  Lock,
  FileSpreadsheet,
  FolderOpen,
  Settings,
  LayoutDashboard,
  LogOut,
  Download,
  Bold,
  Italic,
  Underline,
  Link2,
  List,
  ListOrdered,
  ImagePlus,
  Server,
  MapPin,
  Globe,
  Trash2,
  RotateCcw,
  ExternalLink,
  GripVertical,
  LogIn
} from 'lucide-react';
import { DEFAULT_APP_SETTINGS, TAIWAN_NAMING_MODE_OPTIONS, getCountryName } from './countryOptions';
import {
  BUILTIN_FIELD_KEYS,
  ALWAYS_ENABLED_BUILTINS,
  CUSTOM_FIELD_TYPES,
  SCOPES,
  DEFAULT_GUEST_FIELDS_CONFIG,
  buildDefaultBuiltinsConfig
} from './guestFieldsConfig';

const BUILTIN_FIELD_LABELS = {
  name: '姓名',
  age: '年龄',
  phone: '电话',
  address: '地址',
  postalCode: '邮政编码',
  nationality: '国籍',
  passportNumber: '护照号码',
  passportPhoto: '护照照片',
  guardianName: '监护人姓名',
  guardianPhone: '监护人电话'
};

const CUSTOM_FIELD_TYPE_LABELS = {
  text: '文本',
  number: '数字',
  select: '下拉选择',
  checkbox: '复选框',
  date: '日期',
  file: '文件'
};

const SCOPE_LABELS = { both: '两者皆可', resident: '仅居民', visitor: '仅访客' };

const sanitizeKey = (raw) => String(raw || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);

const newCustomFieldDraft = () => ({
  id: `cf_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`,
  key: '',
  label: '',
  type: 'text',
  required: false,
  defaultValue: '',
  scope: 'both',
  options: [],
  validation: {},
  archived: false
});

const GuestFieldsManager = ({ value, onChange }) => {
  const config = value || DEFAULT_GUEST_FIELDS_CONFIG;
  const builtins = config.builtins || buildDefaultBuiltinsConfig();
  const custom = Array.isArray(config.custom) ? config.custom : [];

  const updateBuiltin = (key, patch) => {
    const next = { ...builtins, [key]: { ...builtins[key], ...patch } };
    onChange({ ...config, builtins: next });
  };

  const updateCustom = (id, patch) => {
    const next = custom.map((f) => (f.id === id ? { ...f, ...patch } : f));
    onChange({ ...config, custom: next });
  };

  const updateCustomValidation = (id, patch) => {
    const next = custom.map((f) => (f.id === id ? { ...f, validation: { ...(f.validation || {}), ...patch } } : f));
    onChange({ ...config, custom: next });
  };

  const addCustom = () => {
    onChange({ ...config, custom: [...custom, newCustomFieldDraft()] });
  };

  const archiveCustom = (id) => {
    if (!window.confirm('归档后该字段不再出现在表单中，但已登记的历史数据保持不变。继续？')) return;
    updateCustom(id, { archived: true });
  };

  const restoreCustom = (id) => updateCustom(id, { archived: false });

  const removeCustomPermanently = (id) => {
    if (!window.confirm('永久删除该字段配置？已登记的历史数据中的该字段值会保留但不再显示。')) return;
    onChange({ ...config, custom: custom.filter((f) => f.id !== id) });
  };

  const addOption = (id) => {
    const f = custom.find((c) => c.id === id);
    if (!f) return;
    const opts = Array.isArray(f.options) ? f.options : [];
    updateCustom(id, { options: [...opts, { value: '', label: '' }] });
  };

  const updateOption = (id, idx, patch) => {
    const f = custom.find((c) => c.id === id);
    if (!f) return;
    const opts = (f.options || []).map((o, i) => (i === idx ? { ...o, ...patch } : o));
    updateCustom(id, { options: opts });
  };

  const removeOption = (id, idx) => {
    const f = custom.find((c) => c.id === id);
    if (!f) return;
    updateCustom(id, { options: (f.options || []).filter((_, i) => i !== idx) });
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-6">
      <div>
        <h3 className="font-bold text-xl text-slate-800">登记表单字段管理</h3>
        <p className="text-sm text-slate-500 mt-1">控制内置字段的显示与默认值，添加自定义字段。修改不会影响已登记的历史数据。</p>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-bold text-slate-700">内置字段</h4>
        <div className="border border-slate-100 rounded-2xl divide-y divide-slate-100">
          {BUILTIN_FIELD_KEYS.map((key) => {
            const cfg = builtins[key] || { enabled: true, defaultValue: '' };
            const locked = ALWAYS_ENABLED_BUILTINS.has(key);
            const allowsDefault = key !== 'passportPhoto';
            return (
              <div key={key} className="flex flex-col gap-3 p-3 sm:grid sm:grid-cols-12 sm:items-center">
                <div className="col-span-3">
                  <p className="font-bold text-sm text-slate-800">{BUILTIN_FIELD_LABELS[key] || key}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{key}</p>
                </div>
                <div className="col-span-3">
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={cfg.enabled !== false}
                      onChange={(e) => updateBuiltin(key, { enabled: e.target.checked })}
                    />
                    {locked ? '必启用' : '启用'}
                  </label>
                </div>
                <div className="col-span-6">
                  {allowsDefault ? (
                    <input
                      type={key === 'age' ? 'number' : 'text'}
                      placeholder="默认值（可选）"
                      value={cfg.defaultValue ?? ''}
                      onChange={(e) => updateBuiltin(key, { defaultValue: e.target.value })}
                      className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-white"
                    />
                  ) : (
                    <span className="text-xs text-slate-400">（图片字段无默认值）</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-700">自定义字段</h4>
          <button onClick={addCustom} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold">＋ 新增字段</button>
        </div>
        {custom.length === 0 && (
          <p className="text-xs text-slate-400">尚未添加自定义字段。</p>
        )}
        {custom.map((field) => (
          <div key={field.id} className={`border rounded-2xl p-4 space-y-3 ${field.archived ? 'bg-slate-50 border-dashed opacity-70' : 'bg-white border-slate-200'}`}>
            <div className="flex flex-col gap-3 sm:grid sm:grid-cols-12">
              <div className="col-span-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase">键名 (key)</label>
                <input
                  value={field.key}
                  onChange={(e) => updateCustom(field.id, { key: sanitizeKey(e.target.value) })}
                  placeholder="companyName"
                  className="w-full p-2 rounded-lg border border-slate-200 text-sm font-mono bg-white"
                />
                <p className="text-[10px] text-slate-400 mt-1">字母开头，仅含字母数字下划线。保存后请勿再修改。</p>
              </div>
              <div className="col-span-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase">显示名称</label>
                <input
                  value={field.label}
                  onChange={(e) => updateCustom(field.id, { label: e.target.value })}
                  placeholder="公司名称"
                  className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-white"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase">类型</label>
                <select
                  value={field.type}
                  onChange={(e) => updateCustom(field.id, { type: e.target.value, defaultValue: '', options: e.target.value === 'select' ? (field.options || []) : [], validation: {} })}
                  className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-white"
                >
                  {CUSTOM_FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>{CUSTOM_FIELD_TYPE_LABELS[t] || t}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase">作用范围</label>
                <select
                  value={field.scope || 'both'}
                  onChange={(e) => updateCustom(field.id, { scope: e.target.value })}
                  className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-white"
                >
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 flex items-end">
                <label className="flex items-center gap-2 text-xs text-slate-700 mb-1">
                  <input
                    type="checkbox"
                    checked={!!field.required}
                    onChange={(e) => updateCustom(field.id, { required: e.target.checked })}
                  />
                  必填
                </label>
              </div>
            </div>

            {field.type === 'select' && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase">下拉选项</p>
                {(field.options || []).map((opt, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={opt.value} onChange={(e) => updateOption(field.id, i, { value: e.target.value })} placeholder="value" className="flex-1 p-2 rounded-lg border border-slate-200 text-xs font-mono bg-white" />
                    <input value={opt.label} onChange={(e) => updateOption(field.id, i, { label: e.target.value })} placeholder="显示名" className="flex-1 p-2 rounded-lg border border-slate-200 text-xs bg-white" />
                    <button onClick={() => removeOption(field.id, i)} className="p-2 text-rose-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <button onClick={() => addOption(field.id)} className="text-xs text-slate-600 underline">＋ 添加选项</button>
              </div>
            )}

            {field.type === 'text' && (
              <div className="flex flex-col gap-3 sm:grid sm:grid-cols-12">
                <div className="col-span-4">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">最小长度</label>
                  <input type="number" min={0} value={field.validation?.minLength ?? ''} onChange={(e) => updateCustomValidation(field.id, { minLength: e.target.value === '' ? undefined : Number(e.target.value) })} className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-white" />
                </div>
                <div className="col-span-4">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">最大长度</label>
                  <input type="number" min={1} value={field.validation?.maxLength ?? ''} onChange={(e) => updateCustomValidation(field.id, { maxLength: e.target.value === '' ? undefined : Number(e.target.value) })} className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-white" />
                </div>
                <div className="col-span-12">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">正则校验 (可选)</label>
                  <input value={field.validation?.regex ?? ''} onChange={(e) => updateCustomValidation(field.id, { regex: e.target.value })} placeholder="^[A-Z]{2}\\d+$" className="w-full p-2 rounded-lg border border-slate-200 text-sm font-mono bg-white" />
                </div>
                <div className="col-span-12">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">校验失败提示</label>
                  <input value={field.validation?.regexMessage ?? ''} onChange={(e) => updateCustomValidation(field.id, { regexMessage: e.target.value })} placeholder="格式错误" className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-white" />
                </div>
              </div>
            )}

            {field.type === 'number' && (
              <div className="flex flex-col gap-3 sm:grid sm:grid-cols-12">
                <div className="col-span-6">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">最小值</label>
                  <input type="number" value={field.validation?.min ?? ''} onChange={(e) => updateCustomValidation(field.id, { min: e.target.value === '' ? undefined : Number(e.target.value) })} className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-white" />
                </div>
                <div className="col-span-6">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">最大值</label>
                  <input type="number" value={field.validation?.max ?? ''} onChange={(e) => updateCustomValidation(field.id, { max: e.target.value === '' ? undefined : Number(e.target.value) })} className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-white" />
                </div>
              </div>
            )}

            {field.type === 'date' && (
              <div className="flex flex-col gap-3 sm:grid sm:grid-cols-12">
                <div className="col-span-6">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">最早日期 YYYY-MM-DD</label>
                  <input value={field.validation?.min ?? ''} onChange={(e) => updateCustomValidation(field.id, { min: e.target.value })} placeholder="2024-01-01" className="w-full p-2 rounded-lg border border-slate-200 text-sm font-mono bg-white" />
                </div>
                <div className="col-span-6">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">最晚日期 YYYY-MM-DD</label>
                  <input value={field.validation?.max ?? ''} onChange={(e) => updateCustomValidation(field.id, { max: e.target.value })} placeholder="2030-12-31" className="w-full p-2 rounded-lg border border-slate-200 text-sm font-mono bg-white" />
                </div>
              </div>
            )}

            {field.type !== 'file' && field.type !== 'checkbox' && (
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase">默认值（可选）</label>
                {field.type === 'select' ? (
                  <select value={field.defaultValue ?? ''} onChange={(e) => updateCustom(field.id, { defaultValue: e.target.value })} className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-white">
                    <option value="">--</option>
                    {(field.options || []).filter((o) => o.value).map((o) => (
                      <option key={o.value} value={o.value}>{o.label || o.value}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                    value={field.defaultValue ?? ''}
                    onChange={(e) => updateCustom(field.id, { defaultValue: field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-white"
                  />
                )}
              </div>
            )}

            {field.type === 'checkbox' && (
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={field.defaultValue === true} onChange={(e) => updateCustom(field.id, { defaultValue: e.target.checked })} />
                默认勾选
              </label>
            )}

            <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
              {field.archived ? (
                <>
                  <span className="text-[11px] text-slate-500">已归档</span>
                  <button onClick={() => restoreCustom(field.id)} className="text-xs text-emerald-600 underline">恢复</button>
                  <button onClick={() => removeCustomPermanently(field.id)} className="text-xs text-rose-500 underline ml-auto">永久删除</button>
                </>
              ) : (
                <button onClick={() => archiveCustom(field.id)} className="text-xs text-amber-600 underline ml-auto">归档（隐藏）</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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

const sanitizeRichHtml = (html) => DOMPurify.sanitize(html || '', {
  ALLOWED_TAGS: ['p', 'b', 'strong', 'i', 'u', 'ul', 'ol', 'li', 'a', 'img', 'br', 'span'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt'],
  ALLOW_UNKNOWN_PROTOCOLS: false
});


const RichTextEditor = ({ value, onChange, placeholder }) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        code: false,
      }),
      UnderlineExtension,
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      }),
      ImageExtension.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder: placeholder || '' }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class:
          'rich-text-editor min-h-[140px] w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(sanitizeRichHtml(editor.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    const incoming = value || '';
    if (editor.getHTML() === incoming) return;
    editor.commands.setContent(incoming, false);
  }, [editor, value]);

  if (!editor) return null;

  const handleAddLink = () => {
    const url = window.prompt('请输入链接地址');
    if (!url) return;
    if (editor.state.selection.empty) {
      editor.chain().focus().insertContent({
        type: 'text',
        text: url,
        marks: [{ type: 'link', attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' } }],
      }).run();
    } else {
      editor.chain().focus().extendMarkRange('link')
        .setLink({ href: url, target: '_blank', rel: 'noopener noreferrer' }).run();
    }
  };

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    fileToBase64(file).then((base64) => {
      if (!base64) return;
      editor.chain().focus().setImage({ src: base64, alt: 'Uploaded' }).run();
    });
    event.target.value = '';
  };

  const baseBtn = 'inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50';
  const activeBtn = 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800';
  const btn = (active) => `${baseBtn} ${active ? activeBtn : ''}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={btn(editor.isActive('bold'))}>
          <Bold className="w-4 h-4" /> 粗体
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={btn(editor.isActive('italic'))}>
          <Italic className="w-4 h-4" /> 斜体
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={btn(editor.isActive('underline'))}>
          <Underline className="w-4 h-4" /> 下划线
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()}
          onClick={handleAddLink} className={btn(editor.isActive('link'))}>
          <Link2 className="w-4 h-4" /> 超链接
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btn(editor.isActive('bulletList'))}>
          <List className="w-4 h-4" /> 无序列表
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={btn(editor.isActive('orderedList'))}>
          <ListOrdered className="w-4 h-4" /> 有序列表
        </button>
        <label className={`${baseBtn} cursor-pointer`}>
          <ImagePlus className="w-4 h-4" /> 上传图片
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </label>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
};

const bufferToBase64Url = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let str = '';
  bytes.forEach((byte) => {
    str += String.fromCharCode(byte);
  });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlToBuffer = (base64url) => {
  if (!base64url || typeof base64url !== 'string') {
    return new Uint8Array(0).buffer;
  }
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};


const toBase64Url = (input) => {
  if (input == null) return undefined;
  if (input instanceof ArrayBuffer) return bufferToBase64Url(input);
  if (ArrayBuffer.isView(input)) return bufferToBase64Url(input.buffer);
  return input;
};

const toPublicKeyCredentialJSON = (credential) => {
  if (!credential) return null;

  const response = credential.response || {};
  const payload = {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
    }
  };

  // 注册特有字段
  if (response.attestationObject) {
    payload.response.attestationObject = toBase64Url(response.attestationObject);
  }

  // 认证特有字段 (signature 和 authenticatorData)
  if (response.authenticatorData) {
    payload.response.authenticatorData = toBase64Url(response.authenticatorData);
  }
  if (response.signature) {
    payload.response.signature = toBase64Url(response.signature);
  }
  if (response.userHandle) {
    payload.response.userHandle = toBase64Url(response.userHandle);
  }

  // 传输渠道信息
  if (response.getTransports) {
    payload.response.transports = response.getTransports();
  }

  return payload;
};

const prepareRegisterOptions = (options) => {
  if (!options) return {};

  return {
    ...options,
    // 確保 rp 存在，否則瀏覽器會報 Type Error
    rp: options.rp || {
      name: "Checkin Admin",
      id: window.location.hostname
    },
    // 確保 user.id 從 Base64 轉回 ArrayBuffer
    user: options.user ? {
      ...options.user,
      id: base64UrlToBuffer(options.user.id)
    } : undefined,
    // 補全算法參數，這是某些瀏覽器的必填項
    pubKeyCredParams: options.pubKeyCredParams || [
      { alg: -7, type: 'public-key' }, // ES256
      { alg: -257, type: 'public-key' } // RS256
    ],
    challenge: base64UrlToBuffer(options.challenge),
    excludeCredentials: (options.excludeCredentials || []).map((item) => ({
      ...item,
      id: base64UrlToBuffer(item.id)
    }))
  };
};

const prepareAuthOptions = (options) => ({
  ...options,
  challenge: base64UrlToBuffer(options.challenge),
  allowCredentials: (options.allowCredentials || []).map((item) => ({
    ...item,
    id: base64UrlToBuffer(item.id)
  }))
});

// 用 Authorization: Bearer header fetch 圖片，轉成 blob URL 後以 <img> 渲染
const AuthImage = ({ src, token, alt, className }) => {
  const [objectUrl, setObjectUrl] = useState(null);

  useEffect(() => {
    if (!src || !token) return;
    let active = true;
    let createdUrl = null;

    fetch(src, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject()))
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setObjectUrl(url);
      })
      .catch(() => {});

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src, token]);

  if (!objectUrl) return null;
  return <img src={objectUrl} alt={alt} className={className} />;
};

// 用 Authorization: Bearer header fetch 圖片後在新分頁開啟
const openAuthImage = async (url, token) => {
  if (!url || !token) return;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');
  } catch {
    // silently ignore
  }
};

const AdminLogin = ({ db, onLogin, onBack }) => {
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [hasPasskey, setHasPasskey] = useState(false);
  const supportsPasskey = typeof window !== 'undefined' && !!window.PublicKeyCredential;

  useEffect(() => {
    let active = true;
    db.getPasskeyStatus()
      .then((payload) => {
        if (!active) return;
        setHasPasskey(payload?.hasPasskey === true);
      })
      .catch(() => {
        if (!active) return;
        setHasPasskey(false);
      })
      .finally(() => {
        if (!active) return;
        setLoadingStatus(false);
      });
    return () => {
      active = false;
    };
  }, [db]);

  const handleRegisterPasskey = async () => {
    if (!supportsPasskey) {
      setError(true);
      setErrorMessage('此設備不支持 Passkey。');
      return;
    }
    if (!bootstrapToken) {
      setError(true);
      setErrorMessage('请先输入管理员初始化密钥。');
      return;
    }

    setVerifying(true);
    try {
      const options = await db.getPasskeyRegisterOptions(bootstrapToken);
      const credential = await navigator.credentials.create({
        publicKey: prepareRegisterOptions(options)
      });

      if (!credential) throw new Error('credential_create_failed');

      await db.verifyPasskeyRegistration({
        credential: toPublicKeyCredentialJSON(credential)
      });

      setHasPasskey(true);
      setError(false);
      setErrorMessage('');
      await handleLogin();
    } catch (registerError) {
      console.error(registerError);
      setError(true);
      setErrorMessage('Passkey 绑定失败，请检查初始化密钥后重试。');
    } finally {
      setVerifying(false);
    }
  };

  const handleLogin = async () => {
    if (!supportsPasskey) {
      setError(true);
      setErrorMessage('此設備不支持 Passkey。');
      return;
    }

    setVerifying(true);
    try {
      const options = await db.getPasskeyAuthOptions();
      const assertion = await navigator.credentials.get({
        publicKey: prepareAuthOptions(options)
      });

      if (!assertion) throw new Error('credential_get_failed');

      const payload = await db.verifyPasskeyAuth({
        credential: toPublicKeyCredentialJSON(assertion)
      });

      onLogin(payload.sessionToken);
      setError(false);
      setErrorMessage('');
    } catch (loginError) {
      console.error(loginError);
      setError(true);
      setErrorMessage('Passkey 验证失败，请重试。');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen-dvh bg-slate-900 flex flex-col items-center justify-center p-6 text-white animate-in fade-in duration-500">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="mx-auto w-20 h-20 bg-slate-800 rounded-3xl flex items-center justify-center mb-6 shadow-2xl border border-slate-700">
          <Lock className="w-10 h-10 text-emerald-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-black tracking-tight">管理員入口</h2>
          <p className="text-slate-400 text-sm">請使用 Passkey 驗證以訪問後台</p>
        </div>
        <div className="space-y-4">
          {!loadingStatus && !hasPasskey && (
            <input
              type="password"
              value={bootstrapToken}
              onChange={(e) => { setBootstrapToken(e.target.value); setError(false); setErrorMessage(''); }}
              placeholder="首次绑定：管理员初始化密钥"
              className="w-full p-4 bg-slate-800 border border-slate-700 rounded-2xl text-center text-lg tracking-wider focus:border-emerald-500 outline-none transition-all placeholder:text-slate-500"
            />
          )}
          {error && <p className="text-rose-500 text-sm font-bold flex items-center justify-center gap-2 animate-shake"><AlertTriangle className="w-4 h-4" /> {errorMessage || '验证失败'}</p>}
          {loadingStatus ? (
            <button disabled className="w-full py-4 bg-slate-700 rounded-2xl font-bold opacity-70">加载中...</button>
          ) : !hasPasskey ? (
            <button disabled={verifying || !supportsPasskey} onClick={handleRegisterPasskey} className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 rounded-2xl font-bold transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed">{verifying ? '绑定中...' : '绑定 Passkey 并登录'}</button>
          ) : (
            <button disabled={verifying || !supportsPasskey} onClick={handleLogin} className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 rounded-2xl font-bold transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed">{verifying ? '驗證中...' : '使用 Passkey 登录'}</button>
          )}
          <button onClick={onBack} className="w-full py-4 text-slate-500 text-sm hover:text-white transition-colors">返回住客模式</button>
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// 管理後台組件
// ----------------------------------------------------------------------
const AdminDashboard = ({
  db,
  adminToken,
  onLogout,
  defaultLang,
  translations,
  buildDefaultSteps,
  loadSteps,
  saveSteps,
  normalizeSteps,
  createStepId,
  StepContent,
  langOptions,
  buildDefaultCompletionTemplate,
  loadCompletionTemplate,
  saveCompletionTemplate,
  normalizeCompletionTemplate
}) => {
  const adminNavigate = useNavigate();
  const adminLocation = useLocation();
  const VALID_ADMIN_TABS = ['data', 'files', 'settings', 'steps'];
  const pathTab = adminLocation.pathname.replace(/^\/admin\/?/, '').split('/')[0];
  const tab = VALID_ADMIN_TABS.includes(pathTab) ? pathTab : 'data';
  const setTab = (next) => adminNavigate(`/admin/${next}`);

  useEffect(() => {
    if (adminLocation.pathname === '/admin' || adminLocation.pathname === '/admin/') {
      adminNavigate('/admin/data', { replace: true });
    } else if (pathTab && !VALID_ADMIN_TABS.includes(pathTab)) {
      adminNavigate('/admin/data', { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminLocation.pathname]);

  const [records, setRecords] = useState([]);
  const [serverStatus, setServerStatus] = useState('checking');
  const [stepLang, setStepLang] = useState(defaultLang);
  const [editableSteps, setEditableSteps] = useState(() => buildDefaultSteps(defaultLang));
  const [stepsSaved, setStepsSaved] = useState(false);
  const [completionTemplate, setCompletionTemplate] = useState(() => buildDefaultCompletionTemplate(defaultLang));
  const [completionSaved, setCompletionSaved] = useState(false);
  const [showDeletedRows, setShowDeletedRows] = useState(false);
  const [pendingActionKey, setPendingActionKey] = useState('');
  const [translationSourceLang, setTranslationSourceLang] = useState(defaultLang);
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // 拖曳狀態
  const [dragItem, setDragItem] = useState(null);
  // { kind: 'step', id, index } | { kind: 'child', id, parentId, index }
  const [dropTarget, setDropTarget] = useState(null);
  // { kind: 'between', index } | { kind: 'intoGroup', groupId } | { kind: 'childBetween', groupId, index }
  const dragCounter = useRef(0);

  const dismissedKey = `checkin.dismissedBuiltinSteps.${stepLang}`;
  const [dismissedBuiltinIds, setDismissedBuiltinIds] = useState(() => {
    try {
      const raw = localStorage.getItem(dismissedKey);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`checkin.dismissedBuiltinSteps.${stepLang}`);
      setDismissedBuiltinIds(new Set(raw ? JSON.parse(raw) : []));
    } catch { setDismissedBuiltinIds(new Set()); }
  }, [stepLang]);

  const persistDismissed = (next) => {
    setDismissedBuiltinIds(next);
    try { localStorage.setItem(`checkin.dismissedBuiltinSteps.${stepLang}`, JSON.stringify([...next])); }
    catch { /* localStorage unavailable */ }
  };

  // Walk top-level + group children so a built-in moved into a group is not flagged as missing.
  const collectExistingIds = (steps) => {
    const ids = new Set();
    steps.forEach((s) => {
      ids.add(s.id);
      if (Array.isArray(s.children)) s.children.forEach((c) => ids.add(c.id));
    });
    return ids;
  };

  const missingBuiltinSteps = useMemo(() => {
    const defaults = buildDefaultSteps(stepLang);
    const existingIds = collectExistingIds(editableSteps);
    return defaults.filter((d) => !existingIds.has(d.id) && !dismissedBuiltinIds.has(d.id));
  }, [editableSteps, stepLang, buildDefaultSteps, dismissedBuiltinIds]);

  const mergeNewSteps = () => {
    const defaults = buildDefaultSteps(stepLang);
    const merged = [...editableSteps];

    missingBuiltinSteps.forEach(missing => {
      const defaultIdx = defaults.findIndex(d => d.id === missing.id);
      let inserted = false;

      for (let i = defaultIdx - 1; i >= 0; i--) {
        const prevId = defaults[i].id;
        const targetIdx = merged.findIndex(s => s.id === prevId);
        if (targetIdx !== -1) {
          merged.splice(targetIdx + 1, 0, { ...missing, enabled: true });
          inserted = true;
          break;
        }
      }

      if (!inserted) {
        for (let i = defaultIdx + 1; i < defaults.length; i++) {
          const nextId = defaults[i].id;
          const targetIdx = merged.findIndex(s => s.id === nextId);
          if (targetIdx !== -1) {
            merged.splice(targetIdx, 0, { ...missing, enabled: true });
            inserted = true;
            break;
          }
        }
      }

      if (!inserted) {
        merged.push({ ...missing, enabled: true });
      }
    });

    setEditableSteps(merged);
    setStepsSaved(false);
  };

  const dismissAllMissing = () => {
    if (missingBuiltinSteps.length === 0) return;
    const next = new Set(dismissedBuiltinIds);
    missingBuiltinSteps.forEach((s) => next.add(s.id));
    persistDismissed(next);
  };

  const dismissOneMissing = (id) => {
    const next = new Set(dismissedBuiltinIds);
    next.add(id);
    persistDismissed(next);
  };

  const restoreAllDismissed = () => {
    persistDismissed(new Set());
  };

  useEffect(() => {
    db.getAllRecords(adminToken)
      .then(data => {
        setRecords(data || []);
        setServerStatus('online');
      })
      .catch(() => {
        setRecords([]);
        setServerStatus('offline');
      });
  }, [adminToken, db]);

  useEffect(() => {
    let active = true;
    db.getAppSettings()
      .then((settings) => {
        if (!active) return;
        setAppSettings({ ...DEFAULT_APP_SETTINGS, ...(settings || {}) });
        setSettingsSaved(false);
      })
      .catch(() => {
        if (!active) return;
        setAppSettings(DEFAULT_APP_SETTINGS);
        setSettingsSaved(false);
      });

    return () => {
      active = false;
    };
  }, [db]);

  useEffect(() => {
    let isActive = true;
    db.getSteps(stepLang)
      .then((steps) => {
        if (!isActive) return;
        const normalized = normalizeSteps(steps, buildDefaultSteps(stepLang));
        setEditableSteps(normalized);
        saveSteps(stepLang, normalized);
        setStepsSaved(false);
      })
      .catch(() => {
        if (!isActive) return;
        const stored = loadSteps(stepLang);
        if (stored) {
          setEditableSteps(stored);
          setStepsSaved(false);
          return;
        }
        setEditableSteps(buildDefaultSteps(stepLang));
        setStepsSaved(false);
      });
    return () => {
      isActive = false;
    };
  }, [stepLang, db, buildDefaultSteps, loadSteps, normalizeSteps, saveSteps]);

  useEffect(() => {
    let isActive = true;
    db.getCompletionTemplate(stepLang)
      .then((template) => {
        if (!isActive) return;
        const normalized = normalizeCompletionTemplate(template, buildDefaultCompletionTemplate(stepLang));
        setCompletionTemplate(normalized);
        saveCompletionTemplate(stepLang, normalized);
        setCompletionSaved(false);
      })
      .catch(() => {
        if (!isActive) return;
        const stored = loadCompletionTemplate(stepLang);
        if (stored) {
          setCompletionTemplate(stored);
          setCompletionSaved(false);
          return;
        }
        setCompletionTemplate(buildDefaultCompletionTemplate(stepLang));
        setCompletionSaved(false);
      });
    return () => {
      isActive = false;
    };
  }, [stepLang, db, buildDefaultCompletionTemplate, loadCompletionTemplate, normalizeCompletionTemplate, saveCompletionTemplate]);

  const stepLangText = translations[stepLang] || translations[defaultLang];
  const flatRows = records.flatMap((group) => (group.guests || []).map((guest, idx) => ({
    key: `${group.id}-${guest.id || idx}`,
    group,
    guest
  })));
  const activeRows = flatRows.filter((row) => row.guest.deleted !== true);
  const deletedRows = flatRows.filter((row) => row.guest.deleted === true);
  const visibleRows = showDeletedRows ? deletedRows : activeRows;

  const toggleGuestDeleted = async (recordId, guestId, deleted) => {
    const actionKey = `${recordId}:${guestId}:${deleted ? 'delete' : 'restore'}`;
    setPendingActionKey(actionKey);
    try {
      await db.setGuestDeleted(adminToken, recordId, guestId, deleted);
      setRecords((prev) => prev.map((group) => {
        if (group.id !== recordId) return group;
        return {
          ...group,
          guests: (group.guests || []).map((guest) => (
            String(guest.id) === String(guestId)
              ? { ...guest, deleted }
              : guest
          ))
        };
      }));
    } catch (error) {
      alert(deleted ? '標記刪除失敗' : '還原失敗');
    } finally {
      setPendingActionKey('');
    }
  };

  const updateStepField = (id, field, value) => {
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
      { id: createStepId(), title: '新步骤', subtitle: 'Custom Step', type: 'custom', category: 'checkin', content: '', enabled: true }
    ]);
    setStepsSaved(false);
  };

  const addGroupStep = () => {
    setEditableSteps((prev) => [
      ...prev,
      { id: createStepId(), title: '新群组', subtitle: '', type: 'group', category: 'guide', content: '', enabled: true, children: [] }
    ]);
    setStepsSaved(false);
  };

  // 刪除任何步驟（不限 custom）
  const removeStep = (id) => {
    setEditableSteps((prev) => prev.filter((step) => step.id !== id));
    setStepsSaved(false);
  };

  // 拖曳排序頂層步驟
  const reorderSteps = (fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    setEditableSteps((prev) => {
      const arr = [...prev];
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return arr;
    });
    setStepsSaved(false);
  };

  // 將頂層步驟移入群組成為子項目
  const moveStepToGroup = (stepId, groupId) => {
    setEditableSteps((prev) => {
      const step = prev.find((s) => s.id === stepId);
      if (!step || step.id === groupId || step.type === 'group') return prev;
      const child = { id: step.id, title: step.title || '', content: step.content || '', enabled: step.enabled !== false };
      return prev
        .filter((s) => s.id !== stepId)
        .map((s) => s.id !== groupId ? s : { ...s, children: [...(s.children || []), child] });
    });
    setStepsSaved(false);
  };

  // 將群組子項目提升回頂層
  const promoteChildToTop = (groupId, childId) => {
    setEditableSteps((prev) => {
      const group = prev.find((s) => s.id === groupId);
      const child = group?.children?.find((c) => c.id === childId);
      if (!child) return prev;
      const newStep = { ...child, type: 'custom', subtitle: '' };
      const withoutChild = prev.map((s) => s.id !== groupId ? s : { ...s, children: (s.children || []).filter((c) => c.id !== childId) });
      const groupIdx = withoutChild.findIndex((s) => s.id === groupId);
      const result = [...withoutChild];
      result.splice(groupIdx + 1, 0, newStep);
      return result;
    });
    setStepsSaved(false);
  };

  // 拖曳排序群組子項目
  const reorderGroupChildren = (groupId, fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    setEditableSteps((prev) => prev.map((s) => {
      if (s.id !== groupId) return s;
      const children = [...(s.children || [])];
      const [item] = children.splice(fromIdx, 1);
      children.splice(toIdx, 0, item);
      return { ...s, children };
    }));
    setStepsSaved(false);
  };

  const addGroupChild = (groupId) => {
    const newChild = { id: createStepId(), title: '新子項目', enabled: true, content: '' };
    setEditableSteps((prev) => prev.map((step) =>
      step.id !== groupId ? step : { ...step, children: [...(step.children || []), newChild] }
    ));
    setStepsSaved(false);
  };

  const updateGroupChild = (groupId, childId, field, value) => {
    setEditableSteps((prev) => prev.map((step) =>
      step.id !== groupId ? step : {
        ...step,
        children: (step.children || []).map((c) => c.id === childId ? { ...c, [field]: value } : c)
      }
    ));
    setStepsSaved(false);
  };

  const toggleGroupChildEnabled = (groupId, childId) => {
    setEditableSteps((prev) => prev.map((step) =>
      step.id !== groupId ? step : {
        ...step,
        children: (step.children || []).map((c) => c.id === childId ? { ...c, enabled: !c.enabled } : c)
      }
    ));
    setStepsSaved(false);
  };

  const removeGroupChild = (groupId, childId) => {
    setEditableSteps((prev) => prev.map((step) =>
      step.id !== groupId ? step : {
        ...step,
        children: (step.children || []).filter((c) => c.id !== childId)
      }
    ));
    setStepsSaved(false);
  };

  const handleSaveSteps = async () => {
    try {
      await db.updateSteps(adminToken, stepLang, editableSteps);
      saveSteps(stepLang, editableSteps);
      setStepsSaved(true);
    } catch (error) {
      alert('保存失败，请稍后重试');
      setStepsSaved(false);
    }
  };

  const handleResetSteps = () => {
    setEditableSteps(buildDefaultSteps(stepLang));
    setStepsSaved(false);
  };

  const updateCompletionField = (field, value) => {
    setCompletionTemplate((prev) => ({ ...prev, [field]: value }));
    setCompletionSaved(false);
  };

  const copyStepsFromLanguage = async () => {
    if (!translationSourceLang || translationSourceLang === stepLang) return;
    try {
      const sourceSteps = await db.getSteps(translationSourceLang);
      const normalized = normalizeSteps(sourceSteps, buildDefaultSteps(stepLang));
      setEditableSteps(normalized);
      setStepsSaved(false);
    } catch (error) {
      alert('复制源语言步骤失败，请稍后重试');
    }
  };

  const copyCompletionFromLanguage = async () => {
    if (!translationSourceLang || translationSourceLang === stepLang) return;
    try {
      const sourceTemplate = await db.getCompletionTemplate(translationSourceLang);
      const normalized = normalizeCompletionTemplate(sourceTemplate, buildDefaultCompletionTemplate(stepLang));
      setCompletionTemplate(normalized);
      setCompletionSaved(false);
    } catch (error) {
      alert('复制源语言完成页失败，请稍后重试');
    }
  };

  const handleSaveCompletion = async () => {
    try {
      await db.updateCompletionTemplate(adminToken, stepLang, completionTemplate);
      saveCompletionTemplate(stepLang, completionTemplate);
      setCompletionSaved(true);
    } catch (error) {
      alert('完成页保存失败，请稍后重试');
      setCompletionSaved(false);
    }
  };

  const handleResetCompletion = () => {
    setCompletionTemplate(buildDefaultCompletionTemplate(stepLang));
    setCompletionSaved(false);
  };

  const handleSaveAppSettings = async () => {
    try {
      await db.updateAppSettings(adminToken, appSettings);
      setSettingsSaved(true);
    } catch (error) {
      alert('系统设置保存失败，请稍后重试');
      setSettingsSaved(false);
    }
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

    switch (tab) {
      case 'data':
        return (
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="font-bold text-lg text-slate-800">住客登記記錄</h3>
                <p className="text-xs text-slate-400">數據來源: 本地 SQLite（全部欄位）</p>
              </div>
              <button onClick={() => db.exportCSV(records)} className="flex items-center gap-2 text-xs font-bold bg-slate-900 text-white px-4 py-2.5 rounded-xl hover:bg-slate-700 transition-colors shadow-lg shadow-slate-200">
                <Download className="w-4 h-4" /> 導出 CSV 表格
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left min-w-[1650px]">
                <thead className="bg-slate-50 text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="p-3 pl-6">日期</th>
                    <th className="p-3">組ID</th>
                    <th className="p-3">入住</th>
                    <th className="p-3">退房</th>
                    <th className="p-3">住客ID</th>
                    <th className="p-3">姓名</th>
                    <th className="p-3">類型</th>
                    <th className="p-3">身份</th>
                    <th className="p-3">年齡</th>
                    <th className="p-3">職業</th>
                    <th className="p-3">電話</th>
                    <th className="p-3">郵編</th>
                    <th className="p-3">地址</th>
                    <th className="p-3">國籍</th>
                    <th className="p-3">護照號</th>
                    <th className="p-3">監護人</th>
                    <th className="p-3">監護人電話</th>
                    <th className="p-3">護照圖片</th>
                    <th className="p-3 text-right pr-6">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map(({ key, group, guest }) => {
                    const actionKey = `${group.id}:${guest.id || ''}:${showDeletedRows ? 'restore' : 'delete'}`;
                    return (
                      <tr key={key} className="hover:bg-slate-50/80 transition-colors align-top">
                        <td className="p-3 pl-6 text-slate-500 font-mono text-xs">{group.submittedAt.split('T')[0]}</td>
                        <td className="p-3 font-mono text-xs text-slate-500">{group.id}</td>
                        <td className="p-3 font-mono text-xs text-emerald-600 font-bold">{group.checkIn || '-'}</td>
                        <td className="p-3 font-mono text-xs text-rose-600 font-bold">{group.checkOut || '-'}</td>
                        <td className="p-3 font-mono text-xs text-slate-500">{guest.id || '-'}</td>
                        <td className="p-3 font-bold text-slate-900">{guest.name || '-'}</td>
                        <td className="p-3">{guest.type || '-'}</td>
                        <td className="p-3">
                          {guest.isResident ?
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100"><MapPin className="w-3 h-3" /> 居民</span> :
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-100"><Globe className="w-3 h-3" /> 遊客</span>
                          }
                        </td>
                        <td className="p-3">{guest.age || '-'}</td>
                        <td className="p-3">{guest.occupation || '-'}</td>
                        <td className="p-3">{guest.phone || '-'}</td>
                        <td className="p-3">{guest.postalCode || '-'}</td>
                        <td className="p-3 max-w-[220px] truncate" title={guest.address || ''}>{guest.address || '-'}</td>
                        <td className="p-3">{guest.nationality ? getCountryName(guest.nationality, 'zh-hant', appSettings.taiwanNamingMode) : '-'}</td>
                        <td className="p-3 font-mono text-xs">{guest.passportNumber || '-'}</td>
                        <td className="p-3">{guest.guardianName || '-'}</td>
                        <td className="p-3">{guest.guardianPhone || '-'}</td>
                        <td className="p-3">
                          {guest.passportPhoto ? (
                            <button
                              onClick={() => openAuthImage(guest.passportPhoto, adminToken)}
                              className="text-emerald-700 underline"
                            >
                              查看
                            </button>
                          ) : '-'}
                        </td>
                        <td className="p-3 pr-6 text-right">
                          {showDeletedRows ? (
                            <button
                              onClick={() => toggleGuestDeleted(group.id, guest.id, false)}
                              disabled={pendingActionKey === actionKey}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              <RotateCcw className="w-4 h-4" /> 還原
                            </button>
                          ) : (
                            <button
                              onClick={() => toggleGuestDeleted(group.id, guest.id, true)}
                              disabled={pendingActionKey === actionKey}
                              className="inline-flex items-center justify-center rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                              title="標記刪除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={17} className="py-8 text-center text-slate-400">{showDeletedRows ? '暂无已删除数据' : '暂无数据'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 text-sm">
              {showDeletedRows ? (
                <button onClick={() => setShowDeletedRows(false)} className="text-slate-600 hover:text-slate-900 underline">返回正常数据列表</button>
              ) : (
                <button onClick={() => setShowDeletedRows(true)} className="text-rose-600 hover:text-rose-700 underline">浏览所有已标记删除的数据（{deletedRows.length}）</button>
              )}
            </div>
          </div>
        );
      case 'files': {
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
                const dayGuests = records
                  .filter(r => r.submittedAt.startsWith(date))
                  .flatMap(r => r.guests
                    .filter(g => g.passportPhoto)
                    .map(g => ({
                      ...g,
                      recordId: r.id,
                      checkIn: r.checkIn,
                      checkOut: r.checkOut
                    })));
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
                    <div className="grid grid-cols-2 gap-3">
                      {dayGuests.map((g, i) => (
                        <div key={`${g.recordId}-${g.id || i}`} onClick={() => openAuthImage(g.passportPhoto, adminToken)} className="bg-slate-50 rounded-xl overflow-hidden border border-slate-100 block hover:border-emerald-200 transition-colors cursor-pointer">
                          <div className="aspect-[4/3] bg-slate-100 relative">
                            <AuthImage src={g.passportPhoto} token={adminToken} alt={g.name || g.passportNumber || 'passport'} className="w-full h-full object-cover" />
                            <div className="absolute right-2 top-2 w-7 h-7 rounded-lg bg-white/90 flex items-center justify-center text-slate-600">
                              <ExternalLink className="w-4 h-4" />
                            </div>
                          </div>
                          <div className="p-2 space-y-1">
                            <p className="text-xs font-bold text-slate-800 truncate" title={g.name || ''}>{g.name || '未命名旅客'}</p>
                            <p className="text-[10px] font-mono text-slate-500 truncate">{g.passportNumber || '-'}</p>
                            <p className="text-[10px] text-slate-400 truncate">入住: {g.checkIn || '-'} / 退房: {g.checkOut || '-'}</p>
                            <p className="text-[10px] text-slate-400 truncate" title={g.recordId}>記錄: {g.recordId}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }
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
            <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-700">
                  <Globe className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-xl text-slate-800">国家与地区显示</h3>
                  <p className="text-sm text-slate-500">前台和后台都使用 ISO 3166-1 标准国家代码，台湾表述可在这里调整。</p>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase">台湾表述模式</label>
                <select
                  value={appSettings.taiwanNamingMode}
                  onChange={(e) => {
                    setAppSettings((prev) => ({ ...prev, taiwanNamingMode: e.target.value }));
                    setSettingsSaved(false);
                  }}
                  className="w-full p-3 rounded-xl border border-slate-200 text-sm bg-white"
                >
                  {TAIWAN_NAMING_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600 space-y-1">
                <p>简体中文示例：{getCountryName('TW', 'zh-hans', appSettings.taiwanNamingMode)}</p>
                <p>繁體中文示例：{getCountryName('TW', 'zh-hant', appSettings.taiwanNamingMode)}</p>
                <p>English example: {getCountryName('TW', 'en', appSettings.taiwanNamingMode)}</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handleSaveAppSettings} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold">保存系统设置</button>
                {settingsSaved && <span className="text-sm text-emerald-600 font-bold">已保存</span>}
              </div>
            </div>
            <GuestFieldsManager
              value={appSettings.guestFieldsConfig || DEFAULT_GUEST_FIELDS_CONFIG}
              onChange={(next) => {
                setAppSettings((prev) => ({ ...prev, guestFieldsConfig: next }));
                setSettingsSaved(false);
              }}
            />
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm flex flex-wrap items-center gap-3">
              <button onClick={handleSaveAppSettings} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold">保存登记字段配置</button>
              {settingsSaved && <span className="text-sm text-emerald-600 font-bold">已保存</span>}
              <span className="ml-auto text-xs text-slate-400">未保存的修改不会生效。</span>
            </div>
            <div className="md:hidden text-center pt-2">
              <a href="/third-party-licenses.html" target="_blank" rel="noopener noreferrer" className="text-[11px] text-slate-400">
                MIT · 开源许可证 ↗
              </a>
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
              {missingBuiltinSteps.length > 0 && (
                <div className="flex-1 bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-start gap-3 text-amber-800">
                    <Settings className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-bold">发现 {missingBuiltinSteps.length} 个未启用的内置步骤</p>
                      <p className="opacity-80">下列步骤是默认模板提供但当前配置中不存在的。可逐个忽略或一键合并。</p>
                    </div>
                  </div>
                  <ul className="space-y-1.5">
                    {missingBuiltinSteps.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 bg-white/60 rounded-lg px-3 py-1.5">
                        <span className="text-xs font-bold text-amber-900 truncate">{s.title}</span>
                        <button onClick={() => dismissOneMissing(s.id)} className="text-[11px] font-bold text-slate-500 hover:text-slate-800 underline whitespace-nowrap">忽略</button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button onClick={dismissAllMissing} className="px-3 py-1.5 bg-white border border-amber-200 text-amber-800 text-xs font-bold rounded-xl hover:bg-amber-100 transition-colors">全部忽略</button>
                    <button onClick={mergeNewSteps} className="px-4 py-1.5 bg-amber-600 text-white text-xs font-bold rounded-xl hover:bg-amber-700 transition-colors">立即合并</button>
                  </div>
                </div>
              )}
              {dismissedBuiltinIds.size > 0 && missingBuiltinSteps.length === 0 && (
                <button onClick={restoreAllDismissed} className="text-xs font-bold text-slate-500 hover:text-slate-800 underline whitespace-nowrap">还原已忽略的内置步骤提醒（{dismissedBuiltinIds.size}）</button>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={stepLang}
                  onChange={(e) => setStepLang(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700"
                >
                  {(langOptions || []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select
                  value={translationSourceLang}
                  onChange={(e) => setTranslationSourceLang(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700"
                >
                  {(langOptions || []).map((option) => (
                    <option key={option.value} value={option.value}>{`翻译来源：${option.label}`}</option>
                  ))}
                </select>
                <button
                  onClick={copyStepsFromLanguage}
                  disabled={translationSourceLang === stepLang}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  复制来源步骤
                </button>
                <button onClick={addCustomStep} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold">新增步骤</button>
                <button onClick={addGroupStep} className="px-4 py-2 rounded-xl bg-purple-600 text-white text-sm font-bold">新增群组</button>
              </div>
            </div>

            <div className="space-y-0">
              {/* 頂部 drop zone（插入到最前面） */}
              <DropZone
                active={dropTarget?.kind === 'between' && dropTarget.index === 0}
                onDragOver={() => setDropTarget({ kind: 'between', index: 0 })}
                onDragLeave={() => setDropTarget(null)}
                onDrop={() => {
                  if (dragItem?.kind === 'step') reorderSteps(dragItem.index, 0);
                  setDragItem(null); setDropTarget(null);
                }}
              />
              {editableSteps.map((step, index) => (
                <div key={step.id}>
                  {/* 每個步驟卡片 */}
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      dragCounter.current = 0;
                      setDragItem({ kind: 'step', id: step.id, index });
                    }}
                    onDragEnd={() => { setDragItem(null); setDropTarget(null); dragCounter.current = 0; }}
                    className={`bg-white border rounded-2xl p-5 shadow-sm space-y-4 transition-opacity ${dragItem?.kind === 'step' && dragItem.id === step.id ? 'opacity-40' : 'opacity-100'} ${dropTarget?.kind === 'intoGroup' && dropTarget.groupId === step.id ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-slate-200'}`}
                  >
                    {step.type === 'group' ? (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing touch-none"><GripVertical className="w-4 h-4" /></span>
                            <span className="text-xs font-bold text-slate-400 uppercase">Group {index + 1}</span>
                            <span className="text-[10px] px-2 py-1 rounded-full bg-purple-50 text-purple-600">Group</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                              <input type="checkbox" checked={step.enabled !== false} onChange={() => toggleStepEnabled(step.id)} />
                              啟用
                            </label>
                            <button onClick={() => { if (window.confirm(`確認刪除步驟「${step.title || step.id}」？`)) removeStep(step.id); }} className="p-1 text-rose-400 hover:text-rose-600" title="刪除此步驟"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">分类</span>
                          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                            <input type="radio" checked={step.category !== 'guide'} onChange={() => updateStepField(step.id, 'category', 'checkin')} />
                            入住流程
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                            <input type="radio" checked={step.category === 'guide'} onChange={() => updateStepField(step.id, 'category', 'guide')} />
                            房屋指南
                          </label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase">标题</label>
                            <input type="text" value={step.title} onChange={(e) => updateStepField(step.id, 'title', e.target.value)} className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase">副标题</label>
                            <input type="text" value={step.subtitle} onChange={(e) => updateStepField(step.id, 'subtitle', e.target.value)} className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm" />
                          </div>
                        </div>
                        <div className="border-t border-slate-100 pt-4 space-y-3">
                          <p className="text-[10px] font-bold text-slate-400 uppercase">子項目 ({(step.children || []).length})</p>
                          {/* 群組子項目可拖曳排序 */}
                          {(step.children || []).map((child, ci) => (
                            <div key={child.id}>
                              <ChildDropZone
                                active={dropTarget?.kind === 'childBetween' && dropTarget.groupId === step.id && dropTarget.index === ci}
                                onDragOver={() => setDropTarget({ kind: 'childBetween', groupId: step.id, index: ci })}
                                onDragLeave={() => setDropTarget(null)}
                                onDrop={() => {
                                  if (dragItem?.kind === 'child' && dragItem.parentId === step.id) reorderGroupChildren(step.id, dragItem.index, ci);
                                  setDragItem(null); setDropTarget(null);
                                }}
                              />
                              <div
                                draggable
                                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); setDragItem({ kind: 'child', id: child.id, parentId: step.id, index: ci }); }}
                                onDragEnd={() => { setDragItem(null); setDropTarget(null); }}
                                className={`bg-slate-50 rounded-xl border border-slate-100 p-4 space-y-3 transition-opacity ${dragItem?.kind === 'child' && dragItem.id === child.id ? 'opacity-40' : 'opacity-100'}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="cursor-grab text-slate-300 hover:text-slate-400 touch-none"><GripVertical className="w-3.5 h-3.5" /></span>
                                    <span className="text-[10px] font-mono text-slate-400">#{ci + 1} · {child.id}</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <label className="flex items-center gap-2 text-xs text-slate-600">
                                      <input type="checkbox" checked={child.enabled !== false} onChange={() => toggleGroupChildEnabled(step.id, child.id)} />
                                      啟用
                                    </label>
                                    <button onClick={() => promoteChildToTop(step.id, child.id)} className="p-1 text-slate-400 hover:text-slate-700" title="提升為獨立步驟"><LogIn className="w-3.5 h-3.5 rotate-180" /></button>
                                    <button onClick={() => removeGroupChild(step.id, child.id)} className="p-1 text-rose-400 hover:text-rose-600" title="移除子項目"><Trash2 className="w-3.5 h-3.5" /></button>
                                  </div>
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-slate-400 uppercase">子項標題</label>
                                  <input type="text" value={child.title} onChange={(e) => updateGroupChild(step.id, child.id, 'title', e.target.value)} className="w-full mt-1 p-2.5 rounded-lg border border-slate-200 text-sm bg-white" />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-slate-400 uppercase">內容編輯</label>
                                  <div className="mt-2">
                                    <RichTextEditor value={child.content} onChange={(value) => updateGroupChild(step.id, child.id, 'content', value)} placeholder="输入子项目内容..." />
                                  </div>
                                </div>
                                <div className="step-content-surface">
                                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">預覽</p>
                                  <StepContent content={child.content} fallback={stepLangText.customStepEmpty} />
                                </div>
                              </div>
                            </div>
                          ))}
                          {/* 群組末尾 child drop zone */}
                          <ChildDropZone
                            active={dropTarget?.kind === 'childBetween' && dropTarget.groupId === step.id && dropTarget.index === (step.children || []).length}
                            onDragOver={() => setDropTarget({ kind: 'childBetween', groupId: step.id, index: (step.children || []).length })}
                            onDragLeave={() => setDropTarget(null)}
                            onDrop={() => {
                              if (dragItem?.kind === 'child' && dragItem.parentId === step.id) reorderGroupChildren(step.id, dragItem.index, (step.children || []).length - 1);
                              setDragItem(null); setDropTarget(null);
                            }}
                          />
                          {/* 拖入群組 drop zone（接受外部步驟） */}
                          {dragItem?.kind === 'step' && dragItem.id !== step.id && (
                            <div
                              onDragOver={(e) => { e.preventDefault(); setDropTarget({ kind: 'intoGroup', groupId: step.id }); }}
                              onDragLeave={() => setDropTarget(null)}
                              onDrop={(e) => { e.stopPropagation(); moveStepToGroup(dragItem.id, step.id); setDragItem(null); setDropTarget(null); }}
                              className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed text-sm font-bold transition-all ${dropTarget?.kind === 'intoGroup' && dropTarget.groupId === step.id ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-400'}`}
                            >
                              ↓ 拖放至此以加入此群組
                            </div>
                          )}
                          <button onClick={() => addGroupChild(step.id)} className="w-full py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 hover:text-slate-700 text-sm font-bold transition-all">
                            + 新增子項目
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing touch-none"><GripVertical className="w-4 h-4" /></span>
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
                            <button onClick={() => { if (window.confirm(`確認刪除步驟「${step.title || step.id}」？`)) removeStep(step.id); }} className="p-1 text-rose-400 hover:text-rose-600" title="刪除此步驟"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">分类</span>
                          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                            <input type="radio" checked={step.category !== 'guide'} onChange={() => updateStepField(step.id, 'category', 'checkin')} />
                            入住流程
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                            <input type="radio" checked={step.category === 'guide'} onChange={() => updateStepField(step.id, 'category', 'guide')} />
                            房屋指南
                          </label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase">标题</label>
                            <input type="text" value={step.title} onChange={(e) => updateStepField(step.id, 'title', e.target.value)} className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase">副标题</label>
                            <input type="text" value={step.subtitle} onChange={(e) => updateStepField(step.id, 'subtitle', e.target.value)} className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm" />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">内容编辑</label>
                            <span className="text-[10px] text-slate-400">支持图片与常见文本样式</span>
                          </div>
                          <div className="mt-3">
                            <RichTextEditor value={step.content} onChange={(value) => updateStepField(step.id, 'content', value)} placeholder="输入该步骤要展示的内容..." />
                          </div>
                        </div>
                        <div className="step-content-surface">
                          <p className="text-[10px] font-bold text-slate-400 uppercase mb-3">预览</p>
                          <StepContent content={step.content} fallback={stepLangText.customStepEmpty} />
                        </div>
                      </>
                    )}
                  </div>
                  {/* 每個步驟下方的 drop zone（插入到 index+1） */}
                  <DropZone
                    active={dropTarget?.kind === 'between' && dropTarget.index === index + 1}
                    onDragOver={() => setDropTarget({ kind: 'between', index: index + 1 })}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={() => {
                      if (dragItem?.kind === 'step') {
                        const toIdx = dragItem.index < index + 1 ? index : index + 1;
                        reorderSteps(dragItem.index, toIdx);
                      }
                      setDragItem(null); setDropTarget(null);
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button onClick={handleSaveSteps} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold">保存设置</button>
              <button onClick={handleResetSteps} className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold">恢复默认</button>
              {stepsSaved && <span className="text-sm text-emerald-600 font-bold">已保存</span>}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <h4 className="font-bold text-slate-800">完成页内容（获取房号页面）</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase">主标题</label>
                  <input type="text" value={completionTemplate.title} onChange={(e) => updateCompletionField('title', e.target.value)} className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase">副标题</label>
                  <input type="text" value={completionTemplate.subtitle} onChange={(e) => updateCompletionField('subtitle', e.target.value)} className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase">卡片内容（Wi‑Fi等）</label>
                <div className="mt-3">
                  <RichTextEditor value={completionTemplate.cardHtml} onChange={(value) => updateCompletionField('cardHtml', value)} placeholder="输入完成页顶部卡片内容..." />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase">附加内容（如空调控制）</label>
                <div className="mt-3">
                  <RichTextEditor value={completionTemplate.extraHtml} onChange={(value) => updateCompletionField('extraHtml', value)} placeholder="输入完成页下方卡片内容..." />
                </div>
              </div>
              <div className="step-content-surface">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-3">预览</p>
                <p className="text-lg font-bold text-slate-900 mb-1">{completionTemplate.title}</p>
                <p className="text-sm text-slate-500 mb-3">{completionTemplate.subtitle}</p>
                <StepContent content={completionTemplate.cardHtml} fallback={stepLangText.customStepEmpty} />
                <div className="mt-3">
                  <StepContent content={completionTemplate.extraHtml} fallback={stepLangText.customStepEmpty} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={handleSaveCompletion} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold">保存完成页</button>
                <button
                  onClick={copyCompletionFromLanguage}
                  disabled={translationSourceLang === stepLang}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  复制来源完成页
                </button>
                <button onClick={handleResetCompletion} className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold">恢复默认</button>
                {completionSaved && <span className="text-sm text-emerald-600 font-bold">已保存</span>}
              </div>
            </div>
          </div>
        );
      default: return null;
    }
  };

  const ADMIN_TABS = [
    { id: 'data',     label: '住客数据', short: '数据', icon: FileSpreadsheet },
    { id: 'files',    label: '护照管理', short: '护照', icon: FolderOpen },
    { id: 'settings', label: '系统设置', short: '设置', icon: Settings },
    { id: 'steps',    label: '步骤管理', short: '步骤', icon: LayoutDashboard }
  ];

  return (
    <div className="min-h-screen-dvh bg-slate-50 flex flex-col md:flex-row text-slate-900 font-sans">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-slate-900 text-white px-4 py-3 flex items-center justify-between shadow-lg" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-lg flex items-center justify-center font-black">H</div>
          <h1 className="font-bold tracking-wide">Hotel Admin</h1>
        </div>
        <button onClick={onLogout} className="px-3 py-2 text-rose-300 active:text-rose-400 text-xs font-bold bg-rose-500/10 rounded-lg">退出</button>
      </header>

      {/* Desktop sidebar */}
      <div className="hidden md:flex w-72 bg-slate-900 text-white p-6 flex-col justify-between shrink-0 z-20">
        <div>
          <div className="flex items-center gap-4 mb-12 px-2">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center font-black text-xl">H</div>
            <h1 className="font-bold text-lg tracking-wide">Hotel Admin</h1>
          </div>
          <nav className="space-y-2">
            {ADMIN_TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all font-bold text-sm ${tab === id ? 'bg-white text-slate-900 shadow-xl' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
              >
                <Icon className="w-5 h-5" /> {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="space-y-3">
          <button onClick={onLogout} className="flex w-full items-center gap-3 p-4 text-rose-400 hover:text-rose-300 transition-colors text-sm font-bold bg-rose-500/10 rounded-2xl">
            <LogOut className="w-5 h-5" /> 退出登錄
          </button>
          <a
            href="/third-party-licenses.html"
            target="_blank"
            rel="noopener noreferrer"
            className="block px-2 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            title="查看本应用使用的开源依赖与许可证"
          >
            MIT · 开源许可证 ↗
          </a>
        </div>
      </div>

      <div className="flex-1 p-4 md:p-10 overflow-y-auto md:h-screen relative pb-24 md:pb-10">
        {renderContent()}
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-slate-900 text-white border-t border-white/10 grid grid-cols-4"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {ADMIN_TABS.map(({ id, short, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-col items-center justify-center gap-1 py-3 text-[11px] font-bold active:bg-white/5 ${tab === id ? 'text-emerald-300' : 'text-slate-400'}`}
          >
            <Icon className="w-5 h-5" />
            {short}
          </button>
        ))}
      </nav>
    </div>
  );
};

// 頂層步驟之間的 drop 指示線
const DropZone = ({ active, onDragOver, onDragLeave, onDrop }) => (
  <div
    onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    className="relative h-4 -my-0.5 flex items-center z-10"
  >
    <div className={`absolute inset-x-0 h-0.5 rounded-full transition-all ${active ? 'bg-emerald-400 scale-x-100' : 'bg-transparent'}`} />
  </div>
);

// 群組子項目之間的 drop 指示線
const ChildDropZone = ({ active, onDragOver, onDragLeave, onDrop }) => (
  <div
    onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    className="relative h-3 flex items-center"
  >
    <div className={`absolute inset-x-0 h-0.5 rounded-full transition-all ${active ? 'bg-indigo-400 scale-x-100' : 'bg-transparent'}`} />
  </div>
);

const AdminPage = ({
  adminToken,
  onAdminTokenChange,
  onExitAdmin,
  db,
  defaultLang,
  translations,
  buildDefaultSteps,
  loadSteps,
  saveSteps,
  normalizeSteps,
  createStepId,
  StepContent,
  langOptions,
  buildDefaultCompletionTemplate,
  loadCompletionTemplate,
  saveCompletionTemplate,
  normalizeCompletionTemplate
}) => {
  if (!adminToken) {
    return (
      <AdminLogin
        db={db}
        onLogin={(token) => {
          onAdminTokenChange(token);
        }}
        onBack={onExitAdmin}
      />
    );
  }

  return (
    <AdminDashboard
      db={db}
      adminToken={adminToken}
      onLogout={async () => {
        await db.logoutAdmin(adminToken).catch(() => { });
        onAdminTokenChange('');
        onExitAdmin();
      }}
      defaultLang={defaultLang}
      translations={translations}
      buildDefaultSteps={buildDefaultSteps}
      loadSteps={loadSteps}
      saveSteps={saveSteps}
      normalizeSteps={normalizeSteps}
      createStepId={createStepId}
      StepContent={StepContent}
      langOptions={langOptions}
      buildDefaultCompletionTemplate={buildDefaultCompletionTemplate}
      loadCompletionTemplate={loadCompletionTemplate}
      saveCompletionTemplate={saveCompletionTemplate}
      normalizeCompletionTemplate={normalizeCompletionTemplate}
    />
  );
};

export default AdminPage;
