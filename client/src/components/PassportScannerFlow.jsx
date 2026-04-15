import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Loader2, Upload, RefreshCcw, CheckCircle2, Users, ScanLine } from 'lucide-react';
import { useWebRTC } from '../hooks/useWebRTC';

export const PassportScanState = Object.freeze({
  PERMISSION_REQUEST: 'PERMISSION_REQUEST',
  TIPS: 'TIPS',
  SCANNING: 'SCANNING',
  FALLBACK_UPLOAD: 'FALLBACK_UPLOAD',
  PROCESSING: 'PROCESSING',
  VERIFYING: 'VERIFYING',
  GUEST_LIST: 'GUEST_LIST'
});

const emptyForm = {
  passportNumber: '',
  fullName: '',
  nationalityCode: '',
  birthDate: '',
  sex: ''
};

const normalizeValue = (value) => String(value || '').trim().toUpperCase();

const pickFirst = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');

const normalizeBirthDate = (value) => {
  const raw = normalizeValue(value).replace(/\s+/g, '');
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 6) return digits;
  if (digits.length === 8) {
    // YYYYMMDD -> YYMMDD
    if (/^(19|20)/.test(digits)) {
      return `${digits.slice(2, 4)}${digits.slice(4, 6)}${digits.slice(6, 8)}`;
    }
    // DDMMYYYY -> YYMMDD
    return `${digits.slice(6, 8)}${digits.slice(2, 4)}${digits.slice(0, 2)}`;
  }
  const dmy = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{2,4})$/);
  if (dmy) {
    const yy = dmy[3].slice(-2);
    return `${yy}${dmy[2]}${dmy[1]}`;
  }
  const ymd = raw.match(/^(\d{4})[./-](\d{2})[./-](\d{2})$/);
  if (ymd) {
    return `${ymd[1].slice(-2)}${ymd[2]}${ymd[3]}`;
  }
  return digits;
};

const MRZ_WEIGHTS = [7, 3, 1];
const OCR_AMBIGUITY_MAP = {
  '0': ['0', 'O', 'Q', 'D'],
  '1': ['1', 'I', 'L'],
  '2': ['2', 'Z'],
  '5': ['5', 'S'],
  '6': ['6', 'G'],
  '8': ['8', 'B'],
  O: ['O', '0', 'Q', 'D'],
  Q: ['Q', '0', 'O'],
  D: ['D', '0', 'O'],
  I: ['I', '1', 'L'],
  L: ['L', '1', 'I'],
  Z: ['Z', '2'],
  S: ['S', '5'],
  G: ['G', '6'],
  B: ['B', '8']
};
const CORE_CONFUSION_DICT = { '2': ['2', 'Z'], Z: ['Z', '2'], '0': ['0', 'O'], O: ['O', '0'], '8': ['8', 'B'], B: ['B', '8'], '1': ['1', 'I'], I: ['I', '1'] };

const getMrzValue = (ch) => {
  if (ch === '<') return 0;
  if (/[0-9]/.test(ch)) return Number(ch);
  if (/[A-Z]/.test(ch)) return ch.charCodeAt(0) - 55;
  return 0;
};

const getMrzCheckDigit = (input) => {
  const cleaned = normalizeValue(input).replace(/[^A-Z0-9<]/g, '<');
  const sum = cleaned.split('').reduce((acc, ch, idx) => acc + getMrzValue(ch) * MRZ_WEIGHTS[idx % 3], 0);
  return String(sum % 10);
};

const enumerateAmbiguousCandidates = (raw, limit = 120) => {
  const chars = normalizeValue(raw).split('');
  let acc = [''];
  for (const ch of chars) {
    const options = OCR_AMBIGUITY_MAP[ch] || [ch];
    const next = [];
    for (const prefix of acc) {
      for (const option of options) {
        next.push(prefix + option);
        if (next.length >= limit) break;
      }
      if (next.length >= limit) break;
    }
    acc = next;
    if (acc.length >= limit) break;
  }
  return [...new Set(acc)];
};

const resolveWithCheckDigit = (rawField, rawCheck) => {
  const field = normalizeValue(rawField).replace(/[^A-Z0-9<]/g, '<');
  const check = normalizeValue(rawCheck).replace(/[^0-9A-Z]/g, '').slice(0, 1);
  const checkCandidates = enumerateAmbiguousCandidates(check || '0', 12).filter((candidate) => /[0-9]/.test(candidate));
  const fieldCandidates = enumerateAmbiguousCandidates(field, 120);
  const valid = fieldCandidates.find((candidate) => checkCandidates.includes(getMrzCheckDigit(candidate)));
  if (valid) return { value: valid, valid: true };
  return { value: field, valid: false };
};

const extractMrzLinesFromText = (text) => {
  if (!text) return null;
  const lines = text
    .split('\n')
    .map((line) => normalizeValue(line).replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, ''))
    .filter(Boolean);

  const line1Candidates = lines
    .filter((line) => line.startsWith('P') && line.length >= 15)
    .sort((a, b) => b.length - a.length);

  const line2Candidates = lines
    // 不再强制要求包含 '<'。只要长度够，且包含至少4个连续数字(如出生年份)，就认为是第二行
    .filter((line) => !line.startsWith('P') && line.length >= 28 && /\d{4}/.test(line))
    .sort((a, b) => b.length - a.length);

  const line1 = line1Candidates[0];
  const line2 = line2Candidates[0];
  if (!line1 || !line2) return null;

  return {
    line1,
    line2
  };
};

const initVotes44 = () => Array.from({ length: 44 }, () => new Map());

const normalizeTo44 = (line) => {
  const compact = normalizeValue(line).replace(/[^A-Z0-9<]/g, '');
  if (compact.length >= 44) return compact.slice(0, 44);
  return compact.padEnd(44, '<');
};

const alignWithLcsToReference = (reference, source) => {
  const ref = normalizeTo44(reference);
  const src = normalizeTo44(source);
  const n = ref.length;
  const m = src.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i][j] = ref[i - 1] === src[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const aligned = Array(n).fill('<');
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (ref[i - 1] === src[j - 1]) {
      aligned[i - 1] = src[j - 1];
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  for (let k = 0; k < n; k += 1) {
    if (aligned[k] === '<' && /[A-Z0-9]/.test(src[k] || '')) {
      aligned[k] = src[k];
    }
  }
  return aligned.join('');
};

const voteLine = (votes, alignedLine, weight) => {
  for (let idx = 0; idx < 44; idx += 1) {
    const ch = alignedLine[idx] || '<';
    const bucket = votes[idx];
    bucket.set(ch, (bucket.get(ch) || 0) + weight);
  }
};

const whitelistMrzDateChar = (ch) => {
  const upper = normalizeValue(ch);
  if (upper === 'O') return '0';
  if (upper === 'I' || upper === 'L') return '1';
  return /[0-9]/.test(upper) ? upper : '0';
};

const whitelistPassportChar = (ch) => {
  const upper = normalizeValue(ch);
  if (/[A-Z0-9]/.test(upper)) return upper;
  return '<';
};

const getSortedCandidates = (bucket, fallback = '<') => {
  const entries = [...bucket.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return [{ char: fallback, score: 0 }];
  return entries.map(([char, score]) => ({ char, score }));
};

const composeConsensusLine = (votes, sanitizer) => {
  const pools = [];
  const chars = votes.map((bucket) => {
    const sorted = getSortedCandidates(bucket, '<').map((entry) => ({ ...entry, char: sanitizer ? sanitizer(entry.char) : entry.char }));
    const unique = [];
    const seen = new Set();
    sorted.forEach((entry) => {
      if (!seen.has(entry.char)) {
        seen.add(entry.char);
        unique.push(entry);
      }
    });
    pools.push(unique);
    return unique[0]?.char || '<';
  });
  return { line: chars.join(''), pools };
};

/**
 * @typedef {'passport' | 'date'} MrzFieldType
 */

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const PASSPORT_BASE = ['<', ...DIGITS, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
const CHECK_MUTATIONS = { ...CORE_CONFUSION_DICT, '6': ['6', 'G'], G: ['G', '6'] };

const buildMutationCandidates = (char, fieldType, isCheckDigit) => {
  const raw = normalizeValue(char || '<');
  if (fieldType === 'date') {
    const mapped = whitelistMrzDateChar(raw);
    const confusion = CORE_CONFUSION_DICT[mapped] || [mapped];
    return [...new Set([...confusion.map(whitelistMrzDateChar), ...DIGITS])];
  }
  if (isCheckDigit) {
    const confusion = CHECK_MUTATIONS[raw] || [raw];
    return [...new Set([...confusion.map(whitelistMrzDateChar), ...DIGITS])];
  }
  const base = whitelistPassportChar(raw);
  const confusion = CORE_CONFUSION_DICT[base] || [base];
  return [...new Set([...confusion, base, ...PASSPORT_BASE])].filter((candidate) => /[A-Z0-9<]/.test(candidate));
};

const verifySolvedField = (value, expectedLength) => {
  if (!value || value.length !== expectedLength) return false;
  const data = value.slice(0, expectedLength - 1);
  const check = value.slice(expectedLength - 1);
  return getMrzCheckDigit(data) === whitelistMrzDateChar(check);
};

/**
 * Solve one MRZ block with 3 strategies:
 * A) bidirectional mutation, B) missing-char interpolation, C) extra-char deletion.
 * @param {string} rawString raw OCR block (data + check digit)
 * @param {number} expectedLength full expected length (data + check)
 * @param {MrzFieldType} fieldType field type
 * @param {number} maxIters circuit-breaker max iterations
 * @returns {{ value: string, valid: boolean } | null}
 */
/**
 * 基于优先级代价 (Heuristic Priority) 的确切性求解器
 * 拒绝盲目 DFS，优先修复最符合人类与 OCR 视觉直觉的错误。
 */
const solveMrzField = (rawString, expectedLength, fieldType) => {
  const cleaned = normalizeValue(rawString).replace(/[^A-Z0-9<]/g, '');
  console.log(`🔍 [Solver V3] Field: ${fieldType} | Input: "${cleaned}" | TargetLen: ${expectedLength}`);
  if (!cleaned) return null;

  const verify = (str) => verifySolvedField(str, expectedLength);

  // === 场景 A: 长度完美一致 ===
  if (cleaned.length === expectedLength) {
    
    // 优先级 1: 完美匹配 (0 变异)
    if (verify(cleaned)) {
      console.log(`✅ [Solver V3] 完美匹配无须修改: ${cleaned}`);
      return { value: cleaned, valid: true };
    }

    // 优先级 2: 修复数据区的 1 个易混淆字符 (例如 2 -> Z)
    // 坚决不动校验位，逼迫算法向前寻找数据区的错误
    for (let i = 0; i < expectedLength - 1; i++) {
      const char = cleaned[i];
      const mutations = CORE_CONFUSION_DICT[char] || [];
      for (const mut of mutations) {
        if (mut === char) continue;
        const candidate = cleaned.substring(0, i) + mut + cleaned.substring(i + 1);
        if (verify(candidate)) {
          console.log(`✅ [Solver V3] 精确纠错 (数据区): 位置 ${i} 的 [${char}] 修复为 [${mut}] -> 最终结果: ${candidate}`);
          return { value: candidate, valid: true };
        }
      }
    }

    // 优先级 3: 修复校验位本身
    // 如果数据区都试过了还不行，那可能真的是校验位读错了
    const checkChar = cleaned[expectedLength - 1];
    // 只从核心混淆字典取值（比如把 'O' 纠正为 '0'）
    const validMutations = CORE_CONFUSION_DICT[checkChar] || [];
    for (const mut of validMutations) {
      if (mut === checkChar || !/[0-9]/.test(mut)) continue; // 校验位必须是数字
      const candidate = cleaned.substring(0, expectedLength - 1) + mut;
      if (verify(candidate)) {
        console.log(`✅ [Solver V3] 合法纠错 (校验位): [${checkChar}] 修复为 [${mut}] -> 最终结果: ${candidate}`);
        return { value: candidate, valid: true };
      }
    }
  }

  // === 场景 B: 尾部截断漏字 (长度恰好少 1) ===
  if (cleaned.length === expectedLength - 1) {
    
    // 优先级 4: 尾部追加 0-9 
    for (let i = 0; i <= 9; i++) {
      const candidate = cleaned + String(i);
      if (verify(candidate)) {
        console.log(`✅ [Solver V3] 截断补全: 尾部追加 [${i}] -> 最终结果: ${candidate}`);
        return { value: candidate, valid: true };
      }
    }

    // 优先级 4.5: 头部追加 A-Z 和 0-9 (专治护照号首字母丢失！)
    if (fieldType === 'passport') {
      const headPool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
      for (const char of headPool) {
        const candidate = char + cleaned;
        if (verify(candidate)) {
          console.log(`✅ [Solver V3] 首字补全成功: 头部追加 [${char}] -> 最终结果: ${candidate}`);
          return { value: candidate, valid: true };
        }
      }
    }
    // 优先级 5: 复合修复 (数据区有 1 个错字 + 尾部缺 1 个字)
    for (let pos = 0; pos < cleaned.length; pos++) {
      const char = cleaned[pos];
      const mutations = CORE_CONFUSION_DICT[char] || [];
      for (const mut of mutations) {
        if (mut === char) continue;
        const fixedData = cleaned.substring(0, pos) + mut + cleaned.substring(pos + 1);
        for (let i = 0; i <= 9; i++) {
          const candidate = fixedData + String(i);
          if (verify(candidate)) {
            console.log(`✅ [Solver V3] 复合纠错成功: 修复位置 ${pos} [${char}->${mut}] 并追加尾部 [${i}] -> ${candidate}`);
            return { value: candidate, valid: true };
          }
        }
      }
    }
  }

  console.log(`💀 [Solver V3] 束手无策: "${cleaned}" 无法通过现有规则推导。`);
  return null;
};

const parseTd3FromConsensus = (line1, line2) => {
  console.log(`\n=================== [ 解析器启动 ] ===================`);
  const l1 = normalizeTo44(line1);
  const l2 = normalizeTo44(line2);
  
  let passportRawSlice = l2.slice(0, 10);
  let natRaw = l2.slice(10, 13);
  let birthRawSlice = l2.slice(13, 20);
  let sexRaw = l2.slice(20, 21);
  let expiryRawSlice = l2.slice(21, 28);

  // 🎯 核心杀招：动态正则锚点
  // 匹配：3位字母(国籍) + 7位字符(生日) + 1位字符(性别) + 7位字符(有效期)
  // 允许国籍区出现数字(如 K0R)，确保锚点在最恶劣的 OCR 下依然坚挺
  const anchorMatch = l2.match(/([A-Z0-9<]{3})([0-9A-Z<]{7})([A-Z0-9<])([0-9A-Z<]{7})/i);
  
  if (anchorMatch) {
    console.log(`⚓ [正则锚点触发] 成功定位特征序列！免疫一切位移错乱。(Index: ${anchorMatch.index})`);
    passportRawSlice = l2.substring(0, anchorMatch.index).replace(/<+$/, '');
    natRaw = anchorMatch[1];
    birthRawSlice = anchorMatch[2];
    sexRaw = anchorMatch[3];
    expiryRawSlice = anchorMatch[4];
  } else {
    console.log(`⚠️ [正则锚点失效] 未找到标准特征序列，回退至固定索引切片...`);
  }

  const passportClean = passportRawSlice.replace(/<+$/, '');
  const birthClean = birthRawSlice.replace(/</g, '');
  const expiryClean = expiryRawSlice.replace(/</g, '');

  const passportSolved = solveMrzField(passportClean, 10, 'passport');
  const birthSolved = birthClean.length === 0 ? { valid: true, value: '' } : solveMrzField(birthClean, 7, 'date');
  const expirySolved = expiryClean.length === 0 ? { valid: true, value: '' } : solveMrzField(expiryClean, 7, 'date');

  const isValid = Boolean(passportSolved?.valid && birthSolved?.valid && expirySolved?.valid);
  console.log(`💡 [总体验证结果] -> ${isValid ? '🟢 完美通过' : '🔴 校验失败'}\n======================================================`);

  return {
    passportNumber: (passportSolved?.value || passportClean).slice(0, 9).replace(/</g, ''),
    birthDate: (birthSolved?.value || birthClean).slice(0, 6),
    expiryDate: (expirySolved?.value || expiryClean).slice(0, 6),
    sex: sexRaw.replace('<', ''),
    nationalityCode: natRaw.replace(/</g, ''),
    fullName: l1.slice(5).replace(/<+/g, ' ').trim(),
    checksumValid: isValid
  };
};

const buildObservation = (ocrRaw) => {
  const viz = ocrRaw?.viz || {};
  const mrz = ocrRaw?.mrz || {};
  const extractedMrz = extractMrzLinesFromText(ocrRaw?.text);
  return {
    isPassport: Boolean(ocrRaw?.isPassport),
    fullName: normalizeValue(pickFirst(ocrRaw?.fullName, viz?.fullName, viz?.name)),
    birthDate: normalizeBirthDate(pickFirst(ocrRaw?.birthDate, viz?.birthDate, viz?.dateOfBirth, mrz?.birthDate)),
    nationalityCode: normalizeValue(pickFirst(ocrRaw?.nationalityCode, viz?.nationalityCode, mrz?.nationalityCode)),
    sex: normalizeValue(pickFirst(ocrRaw?.sex, viz?.sex, mrz?.sex)),
    passportNumber: normalizeValue(pickFirst(ocrRaw?.passportNumber, viz?.passportNumber, mrz?.passportNumber)),
    mrzPassportNumber: normalizeValue(pickFirst(ocrRaw?.mrzPassportNumber, mrz?.passportNumber)),
    mrzBirthDate: normalizeBirthDate(pickFirst(ocrRaw?.mrzBirthDate, mrz?.birthDate)),
    mrzNationality: normalizeValue(pickFirst(ocrRaw?.mrzNationality, mrz?.nationalityCode)),
    mrzSex: normalizeValue(pickFirst(ocrRaw?.mrzSex, mrz?.sex)),
    mrzFullName: normalizeValue(pickFirst(ocrRaw?.mrzFullName, mrz?.fullName, mrz?.name)),
    mrzLine1: extractedMrz?.line1 || '',
    mrzLine2: extractedMrz?.line2 || '',
    confidence: Number(ocrRaw?.confidence ?? 0.65),
    checksumValid: false
  };
};

const updateWeightedVote = (bucket, key, weight) => {
  if (!key) return;
  bucket.set(key, (bucket.get(key) || 0) + weight);
};

const getTopVote = (bucket) => {
  let topKey = '';
  let topScore = 0;
  let total = 0;
  bucket.forEach((score, key) => {
    total += score;
    if (score > topScore) {
      topScore = score;
      topKey = key;
    }
  });
  return {
    value: topKey,
    score: topScore,
    ratio: total > 0 ? topScore / total : 0
  };
};

const createEmptyAccumulator = () => ({
  attempts: 0,
  mrzReferenceLine1: '',
  mrzReferenceLine2: '',
  mrzVotesLine1: initVotes44(),
  mrzVotesLine2: initVotes44(),
  votes: {
    fullName: new Map(),
    birthDate: new Map(),
    nationalityCode: new Map(),
    sex: new Map(),
    passportNumber: new Map(),
    mrzPassportNumber: new Map(),
    mrzBirthDate: new Map(),
    mrzNationality: new Map(),
    mrzSex: new Map(),
    mrzFullName: new Map()
  }
});

const checkImageQuality = async (base64, recognizeFrame, accumulatorRef) => {
  const ocrRaw = await recognizeFrame(base64);
  const observation = buildObservation(ocrRaw || {});
  const acc = accumulatorRef.current;
  acc.attempts += 1;
  
  // ==========================================
  // 🚀 快速通道 (Fast-Track)：单帧直接截胡
  // ==========================================
  if (observation.mrzLine1 && observation.mrzLine2) {
    console.log(`🚄 [Fast-Track] 尝试单帧独立运算...`);
    const td3Raw = parseTd3FromConsensus(observation.mrzLine1, observation.mrzLine2);
    if (td3Raw.checksumValid && td3Raw.passportNumber && td3Raw.birthDate) {
      console.log(`🏆 [Fast-Track WIN] 单帧质量极高，直接绕过共识池强行过关！`);
      return {
        passed: true,
        attempts: acc.attempts,
        reliability: 1.0, // 只要通过了严苛的 V3 校验，置信度直接拉满
        reason: '',
        data: {
          fullName: td3Raw.fullName || observation.fullName,
          birthDate: td3Raw.birthDate,
          nationalityCode: td3Raw.nationalityCode || observation.nationalityCode,
          sex: td3Raw.sex || observation.sex,
          passportNumber: td3Raw.passportNumber
        }
      };
    }
  }

  if (observation.mrzLine1 && observation.mrzLine2) {
    if (!acc.mrzReferenceLine1) {
      acc.mrzReferenceLine1 = normalizeTo44(observation.mrzLine1);
      acc.mrzReferenceLine2 = normalizeTo44(observation.mrzLine2);
      console.log(`🎯 [LCS 基准锁定!] 以后所有的帧都会按这行对齐: ${acc.mrzReferenceLine2}`);
    }
    const aligned1 = alignWithLcsToReference(acc.mrzReferenceLine1, observation.mrzLine1);
    const aligned2 = alignWithLcsToReference(acc.mrzReferenceLine2, observation.mrzLine2);
    voteLine(acc.mrzVotesLine1, aligned1, observation.confidence || 0.6);
    voteLine(acc.mrzVotesLine2, aligned2, observation.confidence || 0.6);
    const consensusLine1 = composeConsensusLine(acc.mrzVotesLine1, (ch) => (/[A-Z<]/.test(ch) ? ch : '<'));
    const consensusLine2 = composeConsensusLine(acc.mrzVotesLine2, (ch) => (/[A-Z0-9<]/.test(ch) ? ch : '<'));
    const td3 = parseTd3FromConsensus(consensusLine1.line, consensusLine2.line);
    if (td3.checksumValid) {
      observation.checksumValid = true;
      observation.isPassport = true;
      observation.passportNumber = normalizeValue(td3.passportNumber || observation.passportNumber);
      observation.mrzPassportNumber = normalizeValue(td3.passportNumber || observation.mrzPassportNumber);
      observation.birthDate = normalizeBirthDate(td3.birthDate || observation.birthDate);
      observation.mrzBirthDate = normalizeBirthDate(td3.birthDate || observation.mrzBirthDate);
      observation.sex = normalizeValue(td3.sex || observation.sex);
      observation.mrzSex = normalizeValue(td3.sex || observation.mrzSex);
      observation.nationalityCode = normalizeValue(td3.nationalityCode || observation.nationalityCode);
      observation.mrzNationality = normalizeValue(td3.nationalityCode || observation.mrzNationality);
      observation.fullName = normalizeValue(td3.fullName || observation.fullName);
      observation.mrzFullName = normalizeValue(td3.fullName || observation.mrzFullName);
    }
  }

  if (!observation.isPassport) {
    return { passed: false, reason: 'NOT_PASSPORT' };
  }

  const baseWeight = Math.min(Math.max(observation.confidence || 0.65, 0.25), 0.99);
  const mrzBonus = observation.mrzPassportNumber && observation.mrzBirthDate ? 0.18 : 0;
  const checksumBonus = observation.checksumValid ? 0.2 : 0;
  const weight = baseWeight + mrzBonus + checksumBonus;

  Object.keys(acc.votes).forEach((field) => {
    updateWeightedVote(acc.votes[field], observation[field], weight);
  });

  const consensus = {
    fullName: getTopVote(acc.votes.fullName),
    birthDate: getTopVote(acc.votes.birthDate),
    nationalityCode: getTopVote(acc.votes.nationalityCode),
    sex: getTopVote(acc.votes.sex),
    passportNumber: getTopVote(acc.votes.passportNumber),
    mrzPassportNumber: getTopVote(acc.votes.mrzPassportNumber),
    mrzBirthDate: getTopVote(acc.votes.mrzBirthDate),
    mrzNationality: getTopVote(acc.votes.mrzNationality),
    mrzSex: getTopVote(acc.votes.mrzSex),
    mrzFullName: getTopVote(acc.votes.mrzFullName)
  };

  const hasCoreFields = Boolean(
    consensus.fullName.value &&
    consensus.birthDate.value &&
    consensus.nationalityCode.value &&
    consensus.sex.value &&
    consensus.passportNumber.value
  );
  const hasMrzFields = Boolean(
    consensus.mrzPassportNumber.value &&
    consensus.mrzBirthDate.value &&
    consensus.mrzNationality.value &&
    consensus.mrzSex.value
  );
  const crossValidated = Boolean(
    hasCoreFields &&
    hasMrzFields &&
    consensus.passportNumber.value === consensus.mrzPassportNumber.value &&
    consensus.birthDate.value === consensus.mrzBirthDate.value &&
    consensus.nationalityCode.value === consensus.mrzNationality.value &&
    consensus.sex.value === consensus.mrzSex.value &&
    (!consensus.mrzFullName.value || consensus.fullName.value === consensus.mrzFullName.value)
  );

  const reliability = (
    consensus.fullName.ratio * 0.18 +
    consensus.birthDate.ratio * 0.2 +
    consensus.nationalityCode.ratio * 0.16 +
    consensus.sex.ratio * 0.12 +
    consensus.passportNumber.ratio * 0.22 +
    consensus.mrzPassportNumber.ratio * 0.12
  );

  const passed = acc.attempts >= 3 && crossValidated && reliability >= 0.82 && observation.checksumValid;

  return {
    passed,
    attempts: acc.attempts,
    reliability,
    reason: passed ? '' : 'LOW_CONFIDENCE_OR_MISMATCH',
    data: {
      fullName: consensus.fullName.value,
      birthDate: consensus.birthDate.value,
      nationalityCode: consensus.nationalityCode.value,
      sex: consensus.sex.value,
      passportNumber: consensus.passportNumber.value
    }
  };
};

export default function PassportScannerFlow({ isOpen, onClose, uploadAndOcrPassport, onApply }) {
  const {
    videoRef,
    canvasRef,
    isSupported,
    isStarting,
    startCamera,
    stopCamera,
    captureFrame
  } = useWebRTC();

  const fileInputRef = useRef(null);
  const scanTimerRef = useRef(null);
  const scanningStartedAtRef = useRef(0);
  const lastRequestAtRef = useRef(0);
  const requestIntervalMsRef = useRef(3000);
  const overlapAttemptsRef = useRef(0);
  const pendingRequestsRef = useRef(0);
  const pausedByBackpressureRef = useRef(false);
  const hasCompletedRef = useRef(false);

  const [scanState, setScanState] = useState(PassportScanState.PERMISSION_REQUEST);
  const [base64Image, setBase64Image] = useState('');
  const [detectedForm, setDetectedForm] = useState(emptyForm);
  const [guests, setGuests] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [scanHint, setScanHint] = useState('正在持续检测，请保持护照稳定。');
  const accumulatorRef = useRef(createEmptyAccumulator());
  const recognizedDuringScanRef = useRef(null);

  const isVisible = isOpen;

  const resetFlow = () => {
    setScanState(PassportScanState.PERMISSION_REQUEST);
    setBase64Image('');
    setDetectedForm(emptyForm);
    setErrorMessage('');
    setScanHint('正在持续检测，请保持护照稳定。');
    accumulatorRef.current = createEmptyAccumulator();
    recognizedDuringScanRef.current = null;
    scanningStartedAtRef.current = 0;
    lastRequestAtRef.current = 0;
    requestIntervalMsRef.current = 3000;
    overlapAttemptsRef.current = 0;
    pendingRequestsRef.current = 0;
    pausedByBackpressureRef.current = false;
    hasCompletedRef.current = false;
  };

  useEffect(() => {
    if (!isVisible) {
      stopCamera();
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }
      resetFlow();
    }
  }, [isVisible, stopCamera]);

  useEffect(() => {
    if (scanState !== PassportScanState.SCANNING && scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }

    if (scanState !== PassportScanState.SCANNING) {
      stopCamera();
    }
  }, [scanState, stopCamera]);

  const canRestartScan = useMemo(() => isSupported, [isSupported]);

  const handleRequestPermission = async () => {
    setErrorMessage('');
    try {
      await startCamera();
      setScanState(PassportScanState.TIPS);
    } catch (error) {
      setErrorMessage('相機開啟失敗，已自動切換為手動上傳。');
      setScanState(PassportScanState.FALLBACK_UPLOAD);
    }
  };

  const startScanningLoop = async () => {
    setErrorMessage('');
    setScanHint('已开启取景，先稳定画面 5 秒后开始识别。');
    accumulatorRef.current = createEmptyAccumulator();
    recognizedDuringScanRef.current = null;
    scanningStartedAtRef.current = Date.now();
    lastRequestAtRef.current = 0;
    requestIntervalMsRef.current = 3000;
    overlapAttemptsRef.current = 0;
    pendingRequestsRef.current = 0;
    pausedByBackpressureRef.current = false;
    hasCompletedRef.current = false;
    setScanState(PassportScanState.SCANNING);
    await startCamera();

    scanTimerRef.current = setInterval(async () => {
      if (hasCompletedRef.current) return;

      const frame = captureFrame();
      if (!frame) return;

      const now = Date.now();
      const warmupElapsed = now - scanningStartedAtRef.current;
      if (warmupElapsed < 5000) {
        const leftSeconds = Math.ceil((5000 - warmupElapsed) / 1000);
        setScanHint(`正在稳定取景，约 ${leftSeconds} 秒后开始OCR识别。`);
        return;
      }

      if (pausedByBackpressureRef.current) {
        if (pendingRequestsRef.current === 0) {
          pausedByBackpressureRef.current = false;
          overlapAttemptsRef.current = 0;
          requestIntervalMsRef.current = 12000;
          setScanHint('积压已清空，恢复低频识别。');
        } else {
          setScanHint(`后端繁忙：仍有 ${pendingRequestsRef.current} 个请求处理中，已暂停新请求。`);
          return;
        }
      }

      const intervalMs = requestIntervalMsRef.current;
      if (lastRequestAtRef.current && now - lastRequestAtRef.current < intervalMs) return;

      if (pendingRequestsRef.current > 0) {
        overlapAttemptsRef.current += 1;
        if (overlapAttemptsRef.current >= 3) {
          requestIntervalMsRef.current = 12000;
          setScanHint(`检测到请求堆积（${pendingRequestsRef.current}个未返回），已降频到每12秒一次。`);
        }
      }

      if (pendingRequestsRef.current >= 6) {
        pausedByBackpressureRef.current = true;
        setScanHint('未完成OCR请求累计达到6个，已暂停发送新请求，等待后端返回。');
        return;
      }

      lastRequestAtRef.current = now;
      pendingRequestsRef.current += 1;

      checkImageQuality(
        frame,
        (imageBase64) => uploadAndOcrPassport(imageBase64, { strict: false }),
        accumulatorRef
      )
        .then((result) => {
          if (!result.passed || hasCompletedRef.current) {
            const attemptText = result.attempts ? `（第 ${result.attempts} 次识别）` : '';
            setScanHint(`持续识别中${attemptText}：需匹配姓名/出生日期/国籍/性别与MRZ机读码。`);
            return;
          }

          hasCompletedRef.current = true;
          recognizedDuringScanRef.current = result.data;
          clearInterval(scanTimerRef.current);
          scanTimerRef.current = null;
          stopCamera();
          setBase64Image(frame);
          setScanState(PassportScanState.PROCESSING);
        })
        .catch(() => {
          setScanHint('识别中，正在自动重试...');
        })
        .finally(() => {
          pendingRequestsRef.current = Math.max(0, pendingRequestsRef.current - 1);
          if (pausedByBackpressureRef.current && pendingRequestsRef.current === 0) {
            pausedByBackpressureRef.current = false;
            overlapAttemptsRef.current = 0;
            requestIntervalMsRef.current = 12000;
            setScanHint('后端积压已清空，恢复低频识别。');
          }
        });
    }, 500);
  };

  const handleFilePick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setBase64Image(reader.result?.toString() || '');
      setScanState(PassportScanState.PROCESSING);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const run = async () => {
      if (scanState !== PassportScanState.PROCESSING || !base64Image) return;

      try {
        const ocr = await uploadAndOcrPassport(base64Image);
        const merged = {
          passportNumber: pickFirst(recognizedDuringScanRef.current?.passportNumber, ocr.passportNumber),
          fullName: pickFirst(recognizedDuringScanRef.current?.fullName, ocr.fullName),
          nationalityCode: pickFirst(recognizedDuringScanRef.current?.nationalityCode, ocr.nationalityCode),
          birthDate: pickFirst(recognizedDuringScanRef.current?.birthDate, ocr.birthDate),
          sex: pickFirst(recognizedDuringScanRef.current?.sex, ocr.sex)
        };
        setDetectedForm({
          passportNumber: merged.passportNumber || '',
          fullName: merged.fullName || '',
          nationalityCode: merged.nationalityCode || '',
          birthDate: merged.birthDate || '',
          sex: merged.sex || ''
        });
        setScanState(PassportScanState.VERIFYING);
      } catch (error) {
        setErrorMessage(error?.message || '識別失敗，請改用手動上傳重試。');
        setScanState(PassportScanState.FALLBACK_UPLOAD);
      }
    };

    run();
  }, [scanState, base64Image, uploadAndOcrPassport]);

  const handleConfirm = () => {
    const guest = {
      ...detectedForm,
      image: base64Image,
      id: crypto.randomUUID()
    };
    setGuests((prev) => [...prev, guest]);
    onApply?.(guest);
    setScanState(PassportScanState.GUEST_LIST);
  };

  const handleClose = () => {
    stopCamera();
    onClose?.();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-xl h-[92vh] sm:h-[90vh] bg-white rounded-t-3xl sm:rounded-3xl p-5 overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">護照掃描與上傳</h3>
          <button onClick={handleClose} className="text-sm text-slate-500 font-semibold">關閉</button>
        </div>

        {scanState === PassportScanState.PERMISSION_REQUEST && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">我們需要使用您的相機來掃描護照資訊，請在接下來的彈窗中允許相機權限。</p>
            <button onClick={handleRequestPermission} className="w-full py-3 rounded-xl bg-slate-900 text-white font-semibold flex items-center justify-center gap-2">
              <Camera className="w-4 h-4" /> 去授權並開啟相機
            </button>
            <button onClick={() => setScanState(PassportScanState.FALLBACK_UPLOAD)} className="w-full py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold">
              無法開啟？點擊手動上傳
            </button>
            {errorMessage && <p className="text-xs text-amber-600">{errorMessage}</p>}
          </div>
        )}

        {scanState === PassportScanState.TIPS && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <p className="text-sm text-slate-700">請確保光線充足，避免反光，並將護照底部的兩行機讀碼（{'<<<<'}）對準取景框。</p>
            </div>
            <button
              disabled={isStarting}
              onClick={startScanningLoop}
              className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold flex items-center justify-center gap-2 disabled:bg-emerald-300"
            >
              {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />} 我知道了，開始掃描
            </button>
          </div>
        )}

        {scanState === PassportScanState.SCANNING && (
          <div className="space-y-3">
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-[3/4]">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <div className="absolute inset-0 bg-slate-950/35" />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[78%] aspect-[1.42/1] border-2 border-white rounded-xl overflow-hidden shadow-[0_0_0_2000px_rgba(2,6,23,0.45)]">
                <div className="absolute inset-x-0 top-0 h-[2px] bg-emerald-300 animate-scan-line" />
              </div>
              <button
                onClick={() => setScanState(PassportScanState.FALLBACK_UPLOAD)}
                className="absolute right-3 bottom-3 px-3 py-2 rounded-lg bg-white/90 text-slate-700 text-xs font-semibold"
              >
                手動拍照/上傳
              </button>
            </div>
            <p className="text-xs text-slate-500">{scanHint}</p>
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}

        {scanState === PassportScanState.FALLBACK_UPLOAD && (
          <div className="space-y-4">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            <button onClick={handleFilePick} className="w-full p-8 border-2 border-dashed border-slate-300 rounded-2xl text-slate-500 hover:border-slate-500 transition-colors">
              <div className="flex flex-col items-center gap-3">
                <Upload className="w-8 h-8" />
                <span className="text-sm font-semibold">請拍攝或上傳護照資訊頁</span>
              </div>
            </button>
            {canRestartScan && (
              <button onClick={() => setScanState(PassportScanState.PERMISSION_REQUEST)} className="w-full py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold">
                返回即時掃描
              </button>
            )}
            {errorMessage && <p className="text-xs text-rose-600">{errorMessage}</p>}
          </div>
        )}

        {scanState === PassportScanState.PROCESSING && (
          <div className="py-10 flex flex-col items-center gap-3 text-slate-600">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            <p className="text-sm font-medium">正在識別護照資訊，請稍候...</p>
          </div>
        )}

        {scanState === PassportScanState.VERIFYING && (
          <div className="space-y-3">
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
              <button onClick={handleConfirm} className="py-3 rounded-xl bg-emerald-600 text-white font-semibold flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4" />確認無誤</button>
              <button onClick={() => setScanState(PassportScanState.FALLBACK_UPLOAD)} className="py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold flex items-center justify-center gap-2"><RefreshCcw className="w-4 h-4" />重新拍攝/上傳</button>
            </div>
          </div>
        )}

        {scanState === PassportScanState.GUEST_LIST && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-700">
              <Users className="w-5 h-5" />
              <h4 className="font-semibold">已成功識別人員</h4>
            </div>
            <div className="space-y-2">
              {guests.map((guest) => (
                <div key={guest.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm space-y-1">
                  <p className="font-semibold text-slate-900">{guest.fullName || '未命名旅客'}</p>
                  <p className="text-slate-500">護照號：{guest.passportNumber || '-'}</p>
                  <p className="text-slate-500">國籍：{guest.nationalityCode || '-'}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setScanState(PassportScanState.PERMISSION_REQUEST)} className="py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold">繼續添加其他人</button>
              <button onClick={handleClose} className="py-3 rounded-xl bg-slate-900 text-white font-semibold">下一步</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
