import { useEffect, useRef, useState } from 'react';
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
  ExternalLink
} from 'lucide-react';


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

    // 获取当前选中的文本
    const selectedText = window.getSelection().toString();

    // 构建带 target="_blank" 的 HTML 字符串
    // 如果没选中文本，就把 URL 当做文本显示
    const linkHtml = `<a href="${url}" target="_blank" rel="noopener noreferrer">${selectedText || url}</a>`;

    runCommand('insertHTML', linkHtml);
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

const bufferToBase64Url = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let str = '';
  bytes.forEach((byte) => {
    str += String.fromCharCode(byte);
  });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlToBuffer = (base64url) => {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
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
        publicKey: {
          challenge: base64UrlToBuffer(options.challenge),
          rp: { name: 'Checkin Admin' },
          user: {
            id: new TextEncoder().encode('admin-user'),
            name: 'admin@checkin.local',
            displayName: 'Hotel Admin'
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },
            { alg: -257, type: 'public-key' }
          ],
          timeout: 60000,
          attestation: 'none',
          authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'preferred'
          }
        }
      });

      if (!credential) throw new Error('credential_create_failed');

      await db.verifyPasskeyRegistration({
        challenge: options.challenge,
        credentialId: bufferToBase64Url(credential.rawId)
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
        publicKey: {
          challenge: base64UrlToBuffer(options.challenge),
          allowCredentials: (options.allowCredentials || []).map((item) => ({
            type: 'public-key',
            id: base64UrlToBuffer(item.id)
          })),
          timeout: 60000,
          userVerification: 'preferred'
        }
      });

      if (!assertion) throw new Error('credential_get_failed');

      const payload = await db.verifyPasskeyAuth({
        challenge: options.challenge,
        credentialId: bufferToBase64Url(assertion.rawId)
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
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-white animate-in fade-in duration-500">
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
  langOptions
}) => {
  const [tab, setTab] = useState('data');
  const [records, setRecords] = useState([]);
  const [serverStatus, setServerStatus] = useState('checking');
  const [stepLang, setStepLang] = useState(defaultLang);
  const [editableSteps, setEditableSteps] = useState(() => buildDefaultSteps(defaultLang));
  const [stepsSaved, setStepsSaved] = useState(false);
  const [showDeletedRows, setShowDeletedRows] = useState(false);
  const [pendingActionKey, setPendingActionKey] = useState('');

  useEffect(() => {
    db.getAllRecords(adminToken)
      .then(data => {
        setRecords(data);
        setServerStatus('online');
      })
      .catch(() => {
        setRecords([]);
        setServerStatus('offline');
      });
  }, [adminToken]);

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
  }, [stepLang]);

  const totalGuests = records.reduce((acc, r) => acc + (r.guests?.length || 0), 0);
  const todayCount = records.filter(r => r.submittedAt.startsWith(new Date().toISOString().split('T')[0])).reduce((acc, r) => acc + (r.guests?.length || 0), 0);
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
      { id: createStepId(), title: '新步骤', subtitle: 'Custom Step', type: 'custom', content: '', enabled: true }
    ]);
    setStepsSaved(false);
  };

  const removeCustomStep = (id) => {
    setEditableSteps((prev) => prev.filter((step) => step.id !== id));
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
                        <td className="p-3">{guest.nationality || '-'}</td>
                        <td className="p-3 font-mono text-xs">{guest.passportNumber || '-'}</td>
                        <td className="p-3">{guest.guardianName || '-'}</td>
                        <td className="p-3">{guest.guardianPhone || '-'}</td>
                        <td className="p-3">
                          {guest.passportPhoto ? <a href={guest.passportPhoto} target="_blank" rel="noreferrer" className="text-emerald-700 underline">查看</a> : '-'}
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
                  {(langOptions || []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button onClick={addCustomStep} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold">新增步骤</button>
              </div>
            </div>

            <div className="space-y-4">
              {editableSteps.map((step, index) => (
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
                        value={step.title}
                        onChange={(e) => updateStepField(step.id, 'title', e.target.value)}
                        className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">副标题</label>
                      <input
                        type="text"
                        value={step.subtitle}
                        onChange={(e) => updateStepField(step.id, 'subtitle', e.target.value)}
                        className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">内容编辑</label>
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
              ))}
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
  langOptions
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
        await db.logoutAdmin(adminToken).catch(() => {});
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
    />
  );
};

export default AdminPage;
