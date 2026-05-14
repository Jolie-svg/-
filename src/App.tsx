/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Search, 
  User, 
  Calendar, 
  ShieldCheck, 
  AlertCircle, 
  LogOut, 
  UserPlus,
  History,
  Briefcase,
  MessageSquare,
  ChevronRight,
  Clock,
  Lock,
  Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// 輔助函式：正規化姓名，移除空格與特殊字元，僅保留中文與英數字
const normalizeVal = (s: any) => {
  if (!s) return '';
  return s.toString().toLowerCase().trim().replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');
};

// --- Types ---
interface ResignationDetail {
  resignationType?: string;
  onboardDate?: string;
  resignationDate?: string;
  resignationReason?: string;
}

interface Candidate {
  id: string;
  name: string;
  birthday: string;
  // GOOGLE_SHEET_ID 專用欄位
  notes?: string;
  // SHEET_3 專用欄位
  isResigned?: boolean;
  resignations?: ResignationDetail[];
}

interface Record {
  id: string;
  candidateId: string;
  type: 'interview' | 'employment';
  date: string;
  result: string;
  reason: string;
  notes: string;
}

interface UserAccount {
  id: string;
  username: string;
  role: 'admin' | 'user';
  isFrozen: boolean;
  password?: string;
}

// --- Constants ---
const DEFAULT_SHEET_ID = '1syQgXhAwQV2DLn54gRjsNG1NTLAR59g5hBKzJDK6uh8';

export default function App() {
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [authError, setAuthError] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // User Management State
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [activeTab, setActiveTab] = useState<'search' | 'admin' | 'password' | 'success'>('search');

  // Data State
  const [allCandidates, setAllCandidates] = useState<Candidate[]>([]);
  const [allRecords, setAllRecords] = useState<Record[]>([]);
  const [rawRowCount, setRawRowCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // Search State
  const [searchName, setSearchName] = useState('');
  const [searchBirthday, setSearchBirthday] = useState('');
  const [searchResults, setSearchResults] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [candidateRecords, setCandidateRecords] = useState<Record[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Session Persistence
  useEffect(() => {
    // Initialize Users if not exists
    const storedUsers = localStorage.getItem('hr_users');
    let initialUsers: UserAccount[] = [];
    if (storedUsers) {
      initialUsers = JSON.parse(storedUsers);
      // 自動更新現有的 admin 帳號（遷移邏輯）
      const adminUser = initialUsers.find(u => u.username === 'admin' && u.role === 'admin');
      if (adminUser) {
        adminUser.username = 'onlyadmin';
        adminUser.password = 'onlyadmin';
        localStorage.setItem('hr_users', JSON.stringify(initialUsers));
      }
    } else {
      // Default admin account
      initialUsers = [
        { id: 'u-1', username: 'onlyadmin', password: 'onlyadmin', role: 'admin', isFrozen: false }
      ];
      localStorage.setItem('hr_users', JSON.stringify(initialUsers));
    }
    setUsers(initialUsers);

    const session = localStorage.getItem('hr_session_user');
    if (session) {
      const user = JSON.parse(session) as UserAccount;
      // Re-verify against current users list (in case of freeze/delete)
      const freshUser = initialUsers.find(u => u.id === user.id);
      if (freshUser && !freshUser.isFrozen) {
        setIsAuthenticated(true);
        setCurrentUser(freshUser);
        fetchDataFromSheets();
      } else {
        localStorage.removeItem('hr_session_user');
      }
    }
  }, []);

  // Update localStorage whenever users change
  useEffect(() => {
    if (users.length > 0) {
      localStorage.setItem('hr_users', JSON.stringify(users));
    }
  }, [users]);

  // --- Handlers ---
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setAuthError('');

    setTimeout(() => {
      const user = users.find(u => u.username === usernameInput && u.password === passwordInput);
      
      if (user) {
        if (user.isFrozen) {
          setAuthError('此帳號已被凍結，請聯繫管理員');
        } else {
          setIsAuthenticated(true);
          setCurrentUser(user);
          localStorage.setItem('hr_session_user', JSON.stringify(user));
          fetchDataFromSheets();
        }
      } else {
        setAuthError('帳號或密碼錯誤');
      }
      setIsLoggingIn(false);
    }, 800);
  };

  const handleLogout = React.useCallback(() => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    setUsernameInput('');
    setPasswordInput('');
    localStorage.removeItem('hr_session_user');
    setAllCandidates([]);
    setAllRecords([]);
    setSelectedCandidate(null);
    setActiveTab('search');
  }, []);

  const addUser = (name: string, pass: string) => {
    if (users.some(u => u.username === name)) {
      alert('帳號已存在');
      return;
    }
    const newUser: UserAccount = {
      id: `u-${Date.now()}`,
      username: name,
      password: pass,
      role: 'user',
      isFrozen: false
    };
    setUsers([...users, newUser]);
  };

  const removeUser = (id: string) => {
    const user = users.find(u => u.id === id);
    if (user?.role === 'admin') {
      alert('不能刪除管理員帳號');
      return;
    }
    setUsers(users.filter(u => u.id !== id));
  };

  const toggleFreeze = (id: string) => {
    const user = users.find(u => u.id === id);
    if (user?.role === 'admin') return;
    setUsers(users.map(u => 
      u.id === id ? { ...u, isFrozen: !u.isFrozen } : u
    ));
  };

  const changePassword = React.useCallback((newPass: string) => {
    if (!currentUser) return;
    
    const updatedUsers = users.map(u => 
      u.id === currentUser.id ? { ...u, password: newPass } : u
    );
    
    setUsers(updatedUsers);
    localStorage.setItem('hr_users', JSON.stringify(updatedUsers));
    
    setActiveTab('success');
  }, [currentUser, users]);

  const norm = (s: string) => s.toLowerCase().trim().replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');

  const fetchDataFromSheets = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/sync-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ }) // Server will use GOOGLE_SHEET_ID and other envs
      });
      
      const contentType = response.headers.get('content-type');
      if (!response.ok) {
        let errorMsg = '抓取資料失敗';
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          errorMsg = data.error || errorMsg;
        } else {
          const text = await response.text();
          errorMsg = `伺服器錯誤 (${response.status}): ${text.substring(0, 100)}`;
        }
        throw new Error(errorMsg);
      }

    const data = await response.json();
      
      let combinedCandidates: Candidate[] = [];
      let combinedRecords: Record[] = [];
      let totalRaw = 0;

      if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        // 多表處理
        const candMap = new Map<string, Candidate>();
        const recList: Record[] = [];
        
        data.results.forEach((sheetResult: any) => {
          totalRaw += sheetResult.rows?.length || 0;
          const { candidates, records } = parseSheetData(
            sheetResult.rows, 
            sheetResult.sheetType || 'default',
            sheetResult.envKey
          );
          
          // 合併 Candidate (避免重複)
          candidates.forEach(c => {
            // 使用正規化姓名與生日進行匹配
            let existingId: string | undefined;
            const normCName = normalizeVal(c.name);
            
            if (candMap.has(c.id)) {
              existingId = c.id;
            } else {
              // 模糊匹配：如果正規化姓名相同，且至少一方生日是 "未設定" 或 生日完全相同
              const sameNameCand = Array.from(candMap.values()).find(ex => 
                normalizeVal(ex.name) === normCName && (ex.birthday === '未設定' || c.birthday === '未設定' || normalizeVal(ex.birthday) === normalizeVal(c.birthday))
              );
              if (sameNameCand) existingId = sameNameCand.id;
            }

            if (!existingId) {
              candMap.set(c.id, c);
            } else {
              const existing = candMap.get(existingId)!;
              const updated = { ...existing };
              
              // 優先保留有值的資料
              if (updated.birthday === '未設定' && c.birthday !== '未設定') updated.birthday = c.birthday;
              if (c.notes) updated.notes = c.notes;
              
              if (c.isResigned) {
                updated.isResigned = true;
                // 只有當新值不為空時才覆蓋，避免被同一張表的不同列（可能缺漏資訊）洗掉
                if (c.resignationType) updated.resignationType = c.resignationType;
                if (c.onboardDate) updated.onboardDate = c.onboardDate;
                if (c.resignationDate) updated.resignationDate = c.resignationDate;
                if (c.resignationReason) updated.resignationReason = c.resignationReason;
              }
              candMap.set(existingId, updated);
            }
          });
          
          // 合併 Records
          recList.push(...records);
        });

        combinedCandidates = Array.from(candMap.values());
        combinedRecords = recList;
      } else if (data.rows) {
        // 後端相容邏輯 (單一陣列)
        const allRows = data.rows as string[][];
        totalRaw = allRows?.length || 0;
        const { candidates, records } = parseSheetData(allRows, 'default');
        combinedCandidates = candidates;
        combinedRecords = records;
      }

      setRawRowCount(totalRaw);
      setAllCandidates(combinedCandidates);
      setAllRecords(combinedRecords);

      if (combinedCandidates.length === 0) {
        alert('同步完成，但未發現任何應徵者資料。請檢查試算表是否為空或標題列設定正確。');
      } else {
        console.log(`Sync success: ${combinedCandidates.length} candidates loaded.`);
      }
    } catch (err) {
      console.error("Sync Error:", err);
      alert('同步資料失敗：' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const parseSheetData = (allRows: string[][], sheetType: string, envKey?: string): { candidates: Candidate[], records: Record[] } => {
    if (!allRows || allRows.length === 0) {
      return { candidates: [], records: [] };
    }

    // Find headers by looking for "姓名" or "Name" in the first 50 rows
    let headerRowIndex = -1;
    let nameIdx = -1;
    let birthIdx = -1;
    let resultIdx = -1;
    let reasonIdx = -1;
    let notesIdx = -1;
    let dateIdx = -1;

    // SHEET_3 欄位
    let resignTypeIdx = -1;
    let onboardDateIdx = -1;
    let resignDateIdx = -1;
    let resignReasonIdx = -1;

    const isSheet3 = envKey?.toUpperCase().includes('SHEET_3');
    const isGoogleSheet = envKey?.toUpperCase().includes('GOOGLE_SHEET_ID');

    // 尋找標題列
    for (let i = 0; i < Math.min(allRows.length, 50); i++) {
      const row = allRows[i].map(c => c?.toString().trim() || '');
      // 擴大標題搜尋範圍
      const idx = row.findIndex(h => 
        h.includes('姓名') || h.includes('Name') || h.includes('人才') || 
        h.includes('應徵者') || h.includes('員工名稱') || h.includes('職員')
      );
      
      if (idx !== -1) {
        headerRowIndex = i;
        nameIdx = idx;
        // Search for other headers in the same row
        birthIdx = row.findIndex(h => h.includes('生日') || h.includes('出生') || h.toLowerCase().includes('birth'));
        resultIdx = row.findIndex(h => h.includes('結果') || h.includes('狀態') || h.toLowerCase().includes('result') || h.toLowerCase().includes('status'));
        reasonIdx = row.findIndex(h => h.includes('原因') || h.includes('理由') || h.toLowerCase().includes('reason'));
        notesIdx = row.findIndex(h => h.includes('備註') || h.includes('評價') || h.toLowerCase().includes('note') || h.toLowerCase().includes('comment'));
        dateIdx = row.findIndex(h => h.includes('日期') || h.includes('時間') || h.toLowerCase().includes('date'));
        break;
      }
    }

    // --- 強制設定邏輯 (確保符合使用者指定的特定欄位，蓋過自動偵測) ---
    if (isGoogleSheet) {
      nameIdx = 3; // D 欄位
      notesIdx = 21; // V 欄位
    }

    if (isSheet3) {
      nameIdx = 3; // D 欄位
      resignTypeIdx = 0; // A 欄位
      onboardDateIdx = 5; // F 欄位
      resignDateIdx = 6; // G 欄位
      resignReasonIdx = 9; // J 欄位
    }

    if (headerRowIndex === -1 && nameIdx === -1) {
       // 找不到標題列也不在上述白名單中
       console.warn("Could not find '姓名' column in this sheet. sheetType:", sheetType, "envKey:", envKey);
       return { candidates: [], records: [] };
    }

    // Default if birthIdx not found: try next column after name (except for Sheet3/GoogleSheet where we use absolute)
    if (birthIdx === -1 && !isSheet3 && !isGoogleSheet) birthIdx = nameIdx + 1;

    const candidatesMap = new Map<string, Candidate>();
    const recordsList: Record[] = [];

    // 如果 headerRowIndex 是 -1，表示沒有發現標題列，資料從 0 開始
    // 否則從標題列下一列開始 (但強制指定的表可以放寬從 0 開始掃描)
    const startIdx = (isSheet3 || isGoogleSheet) ? 0 : (headerRowIndex === -1 ? 0 : headerRowIndex + 1);
    const dataRows = allRows.slice(startIdx);

    dataRows.forEach((row, rowIndex) => {
      const rawName = row[nameIdx]?.toString().trim();
      // 跳過空值或標題文字
      if (!rawName || rawName === '姓名' || rawName === 'Name' || rawName === '人材' || rawName === '應徵者' || rawName === '員工名稱') return;

      const candName = rawName;
      // 生日：若 birthIdx 為 -1 則設為空
      let birthday = (birthIdx !== -1 && row[birthIdx]) ? row[birthIdx].toString().trim() : '';
      
      const candId = `c-${normalizeVal(candName)}-${normalizeVal(birthday)}`;

      if (!candidatesMap.has(candId)) {
        const candObj: Candidate = { id: candId, name: candName, birthday: birthday || '未設定' };
        
        if (isGoogleSheet) {
          // 安全讀取 V 欄 (21)
          if (notesIdx !== -1 && row.length > notesIdx) {
            candObj.notes = row[notesIdx]?.toString().trim() || '';
          }
        }

        if (isSheet3) {
          candObj.isResigned = true;
          candObj.resignations = [{
            resignationType: (resignTypeIdx !== -1 && row.length > resignTypeIdx) ? row[resignTypeIdx]?.toString().trim() : '',
            onboardDate: (onboardDateIdx !== -1 && row.length > onboardDateIdx) ? row[onboardDateIdx]?.toString().trim() : '',
            resignationDate: (resignDateIdx !== -1 && row.length > resignDateIdx) ? row[resignDateIdx]?.toString().trim() : '',
            resignationReason: (resignReasonIdx !== -1 && row.length > resignReasonIdx) ? row[resignReasonIdx]?.toString().trim() : ''
          }];
        }

        candidatesMap.set(candId, candObj);
      } else {
        // 同一名稱在同一份表出現多次 (例如重複輸入或多筆紀錄)，保留「最後一筆有值的紀錄」
        const existing = candidatesMap.get(candId)!;
        
        if (isGoogleSheet && notesIdx !== -1 && row.length > notesIdx) {
          const notesVal = row[notesIdx]?.toString().trim();
          if (notesVal) existing.notes = notesVal;
        }

        if (isSheet3) {
          existing.isResigned = true;
          if (!existing.resignations) existing.resignations = [];
          
          existing.resignations.push({
            resignationType: (resignTypeIdx !== -1 && row.length > resignTypeIdx) ? row[resignTypeIdx]?.toString().trim() : '',
            onboardDate: (onboardDateIdx !== -1 && row.length > onboardDateIdx) ? row[onboardDateIdx]?.toString().trim() : '',
            resignationDate: (resignDateIdx !== -1 && row.length > resignDateIdx) ? row[resignDateIdx]?.toString().trim() : '',
            resignationReason: (resignReasonIdx !== -1 && row.length > resignReasonIdx) ? row[resignReasonIdx]?.toString().trim() : ''
          });
        }
      }

      // 提取結果：如果找不到標題，試著抓取姓名後面的欄位
      const resultValue = resultIdx !== -1 ? row[resultIdx] : (row[nameIdx+1] || row[nameIdx+2]);
      const result = resultValue?.trim() || '未知';
      
      const reason = reasonIdx !== -1 ? (row[reasonIdx]?.trim() || '') : '';
      const notes = notesIdx !== -1 ? (row[notesIdx]?.trim() || '') : '';
      const date = dateIdx !== -1 ? (row[dateIdx]?.trim() || '') : '';
      
      const type = (result.includes('離職') || result.includes('曾任')) ? 'employment' : 'interview';

      if (!isSheet3) {
        recordsList.push({
          id: `r-${rowIndex}-${candId}-${Math.random().toString(36).substr(2, 5)}`,
          candidateId: candId,
          type,
          date: date || new Date().toISOString().split('T')[0],
          result,
          reason,
          notes
        });
      }
    });

    console.log(`Parsed ${sheetType}: Found ${candidatesMap.size} candidates`);

    return { 
      candidates: Array.from(candidatesMap.values()), 
      records: recordsList 
    };
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchName.trim()) {
      alert('請輸入姓名');
      return;
    }

    setIsSearching(true);
    
    // Fuzzy matching: ignore case and spaces
    const query = searchName.trim().toLowerCase().replace(/\s+/g, '');
    
    setTimeout(() => {
      const results = allCandidates.filter(c => {
        const targetName = c.name.toLowerCase().replace(/\s+/g, '');
        return targetName.includes(query) || query.includes(targetName);
      });

      setSearchResults(results);
      setSelectedCandidate(null);
      setIsSearching(false);
    }, 300);
  };

  const selectCandidate = (candidate: Candidate) => {
    setSelectedCandidate(candidate);
    const related = allRecords
      .filter(r => r.candidateId === candidate.id)
      .sort((a, b) => b.date.localeCompare(a.date));
    setCandidateRecords(related);
  };

  // --- Views ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-10 rounded-2xl shadow-xl shadow-indigo-100/50 max-w-md w-full border border-slate-200">
          <div className="flex justify-center mb-8">
            <div className="bg-indigo-600 p-4 rounded-xl shadow-lg shadow-indigo-200">
              <ShieldCheck className="w-10 h-10 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center mb-2 text-slate-900 tracking-tight">HR 智慧面試查詢系統</h1>
          <p className="text-slate-500 text-center mb-8 text-sm leading-relaxed">請輸入系統管理者帳號密碼</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">帳號</label>
              <input 
                type="text" 
                value={usernameInput} onChange={e => setUsernameInput(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="請輸入帳號" required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">密碼</label>
              <input 
                type="password" 
                value={passwordInput} onChange={e => setPasswordInput(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="請輸入密碼" required
              />
            </div>
            {authError && <p className="text-red-500 text-xs mt-2 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {authError}</p>}
            <button 
              disabled={isLoggingIn}
              className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
            >
              {isLoggingIn ? <Clock className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              系統登錄
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      <nav className="flex items-center justify-between px-8 py-4 bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg"><ShieldCheck className="w-6 h-6 text-white" /></div>
          <span className="text-xl font-bold tracking-tight text-indigo-900">應徵者查詢系統</span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button 
                onClick={() => setActiveTab('search')}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'search' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
              >
                人才搜尋
              </button>
              {currentUser?.role === 'admin' && (
                <button 
                  onClick={() => setActiveTab('admin')}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'admin' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                >
                  權限管理
                </button>
              )}
            </div>

            <button 
              onClick={() => setActiveTab('password')}
              title="修改密碼"
              className={`p-2 rounded-lg transition-all ${activeTab === 'password' ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'}`}
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
          
          <div className="hidden md:flex items-center gap-2 text-sm font-medium text-slate-600">
            {loading ? (
              <span className="flex items-center gap-2 text-indigo-600 animate-pulse">
                <Clock className="w-4 h-4 animate-spin" /> 資料同步中...
              </span>
            ) : (
              <div className="flex flex-col items-end">
                <span className="flex items-center gap-2 text-green-600">
                  <ShieldCheck className="w-4 h-4" /> 雲端連線正常
                </span>
                {allCandidates.length > 0 && (
                  <span className="text-[10px] text-slate-400 font-bold">表格總列數: {rawRowCount} | 應徵者: {allCandidates.length} | 紀錄: {allRecords.length}</span>
                )}
              </div>
            )}
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 text-slate-400 hover:text-red-500 transition-colors font-bold text-sm">
            <LogOut className="w-5 h-5" /> 登出
          </button>
        </div>
      </nav>

      <main className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-8 p-6 md:p-10 max-w-[1600px] mx-auto w-full">
        {activeTab === 'search' ? (
          <>
            {/* Left Side: Search */}
            <div className="md:col-span-4 flex flex-col gap-6">
          <section className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2 text-slate-800"><Search className="w-5 h-5 text-indigo-600" /> 人才檢索</h2>
            <form onSubmit={handleSearch} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 ml-1">應徵者姓名</label>
                <input 
                  type="text" value={searchName} onChange={e => setSearchName(e.target.value)}
                  placeholder="請輸入姓名"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button disabled={isSearching} className="w-full bg-indigo-600 text-white font-bold py-4 rounded-lg hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 mt-2">
                {isSearching ? <Clock className="animate-spin w-4 h-4" /> : '開始安全查詢'}
              </button>
            </form>
          </section>

          {/* Results List */}
          <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">
              查詢結果 ({searchResults.length})
            </div>
            <div className="divide-y divide-slate-100 overflow-y-auto max-h-[500px]">
              {searchResults.map(c => (
                <button
                  key={c.id}
                  onClick={() => selectCandidate(c)}
                  className={`w-full px-6 py-5 flex items-center justify-between hover:bg-slate-50 transition-colors text-left group ${selectedCandidate?.id === c.id ? 'bg-indigo-50/50' : ''}`}
                >
                  <div>
                    <p className="font-bold text-slate-800">姓名：{c.name}</p>
                    <p className="text-xs text-slate-400 font-mono mt-1">生日：{c.birthday}</p>
                  </div>
                  <ChevronRight className={`w-5 h-5 text-slate-300 group-hover:text-indigo-600 transition-all ${selectedCandidate?.id === c.id ? 'translate-x-1' : ''}`} />
                </button>
              ))}
              {searchResults.length === 0 && !isSearching && (
                <div className="p-12 text-center opacity-40">
                  <UserPlus className="w-12 h-12 mx-auto mb-4" />
                  <p className="text-sm">尚未開始查詢</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Details */}
        <div className="md:col-span-8">
          <AnimatePresence mode="wait">
            {selectedCandidate ? (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6 h-full flex flex-col">
                <div className="bg-white border border-slate-200 rounded-2xl p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-indigo-600 border border-slate-200"><User className="w-8 h-8" /></div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">姓名：{selectedCandidate.name}</h2>
                      <p className="text-xs font-bold text-slate-400 flex items-center gap-1 uppercase tracking-tighter mt-1">
                        <Calendar className="w-3 h-3" /> 生日：{selectedCandidate.birthday}
                      </p>
                    </div>
                  </div>
                  
                  {selectedCandidate.isResigned && (
                    <div className="flex flex-wrap gap-2">
                       <span className="px-3 py-1 bg-red-50 text-red-600 rounded-full text-[10px] font-bold border border-red-100 flex items-center gap-1">
                         <AlertCircle className="w-3 h-3" /> 已出現在離職名單
                       </span>
                    </div>
                  )}
                </div>

                {selectedCandidate.notes && (
                  <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 shadow-sm">
                    <h3 className="text-[10px] font-bold text-indigo-600 mb-2 flex items-center gap-2 uppercase tracking-widest">
                      <MessageSquare className="w-4 h-4" /> 來自 GOOGLE_SHEET_ID 的備註
                    </h3>
                    <p className="text-sm font-medium text-slate-700 leading-relaxed italic">
                      「{selectedCandidate.notes}」
                    </p>
                  </motion.div>
                )}

                {selectedCandidate.isResigned && selectedCandidate.resignations && selectedCandidate.resignations.length > 0 && (
                  <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="bg-white border-2 border-red-100 rounded-2xl p-8 shadow-sm">
                    <h3 className="text-sm font-bold text-red-600 mb-6 flex items-center gap-2">
                      <LogOut className="w-4 h-4" /> 離職明細 (SHEET_3)
                    </h3>
                    <div className="space-y-6">
                      {selectedCandidate.resignations.map((res, idx) => (
                        <div key={idx} className="grid grid-cols-2 md:grid-cols-4 gap-6 pb-6 border-b border-red-50 last:border-0 last:pb-0">
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">離職類型</p>
                            <p className="text-sm font-bold text-slate-800">{res.resignationType || '未填寫'}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">到職日</p>
                            <p className="text-sm font-bold text-slate-800">{res.onboardDate || '未填寫'}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">離職日</p>
                            <p className="text-sm font-bold text-slate-800">{res.resignationDate || '未填寫'}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">離職原因</p>
                            <p className="text-sm font-bold text-slate-800">{res.resignationReason || '未填寫'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex-1 overflow-hidden flex flex-col">
                  <div className="px-8 py-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2"><History className="w-4 h-4 text-indigo-600" /> 歷程追蹤錄</h3>
                  </div>
                  <div className="flex-1 overflow-y-auto p-8 space-y-8">
                    {candidateRecords.map(record => (
                      <div key={record.id} className="relative pl-12 pb-8 border-l-2 border-slate-100 last:border-0 last:pb-0">
                        <div className={`absolute -left-[18px] top-0 w-8 h-8 rounded-lg flex items-center justify-center border-2 border-white shadow-sm ${
                          record.type === 'interview' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'
                        }`}>
                          {record.type === 'interview' ? <MessageSquare className="w-4 h-4" /> : <Briefcase className="w-4 h-4" />}
                        </div>
                        <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-sm">
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">{record.date}</p>
                              <h4 className="font-bold text-slate-800">{record.type === 'interview' ? '招募面試' : '任職紀錄'} <span className="ml-2 text-[10px] bg-slate-100 px-2 py-0.5 rounded">{record.result}</span></h4>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/50 p-4 rounded-lg border border-slate-100">
                            <div>
                              <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">原因</p>
                              <p className="text-sm font-bold text-slate-700">{record.reason || '無記載'}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">評語</p>
                                <p className="text-sm text-slate-600">{record.notes || '無'}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {candidateRecords.length === 0 && <div className="text-center py-20 opacity-30"><History className="w-12 h-12 mx-auto mb-4" /><p>查無歷史紀錄</p></div>}
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-12 bg-white rounded-2xl border border-dashed border-slate-300">
                <Search className="w-16 h-16 text-slate-200 mb-4" />
                <h3 className="text-xl font-bold text-slate-800 mb-2">請從左側選擇或搜尋人才</h3>
                <p className="text-slate-400 text-sm">系統將即時調閱歷史面試與在職評價</p>
              </div>
            )}
          </AnimatePresence>
        </div>
          </>
        ) : activeTab === 'admin' ? (
          <div className="md:col-span-12">
            <UserManagementView 
              users={users} 
              onAdd={addUser} 
              onDelete={removeUser} 
              onToggleFreeze={toggleFreeze} 
              candidateCount={allCandidates.length}
              recordCount={allRecords.length}
              rawRowCount={rawRowCount}
            />
          </div>
        ) : activeTab === 'success' ? (
          <div className="md:col-span-12 flex justify-center py-10">
            <PasswordSuccessView onFinish={handleLogout} />
          </div>
        ) : (
          <div className="md:col-span-12 flex justify-center py-10">
            <ChangePasswordView onUpdate={changePassword} />
          </div>
        )}
      </main>
    </div>
  );
}

// --- Sub-components ---

function PasswordSuccessView({ onFinish }: { onFinish: () => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onFinish();
    }, 2000);
    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }} 
      animate={{ opacity: 1, scale: 1 }} 
      className="bg-white p-12 rounded-2xl shadow-xl border border-slate-200 max-w-md w-full text-center"
    >
      <div className="flex justify-center mb-6">
        <div className="bg-emerald-500 p-4 rounded-full shadow-lg shadow-emerald-100">
          <ShieldCheck className="w-10 h-10 text-white" />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">已修改完成</h2>
      <p className="text-slate-500 mb-8">密碼已成功更新，正在跳轉至登入頁面...</p>
      <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: "0%" }} 
          animate={{ width: "100%" }} 
          transition={{ duration: 2, ease: "linear" }}
          className="bg-emerald-500 h-full"
        />
      </div>
    </motion.div>
  );
}

function ChangePasswordView({ onUpdate }: { onUpdate: (pass: string) => void }) {
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');

    if (newPass.length < 6) {
      setError('密碼長度至少需 6 個字元');
      return;
    }

    const alphaNumeric = /^[a-zA-Z0-9]+$/;
    if (!alphaNumeric.test(newPass)) {
      setError('密碼僅能包含英文字母與數字');
      return;
    }

    if (newPass !== confirmPass) {
      setError('兩次輸入的密碼不一致');
      return;
    }

    setSubmitting(true);
    onUpdate(newPass);
  };

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white p-10 rounded-2xl shadow-xl border border-slate-200 max-w-md w-full">
      <div className="flex justify-center mb-6">
        <div className="bg-indigo-600 p-4 rounded-xl shadow-lg">
          <Lock className="w-8 h-8 text-white" />
        </div>
      </div>
      <h2 className="text-xl font-bold text-center mb-2 text-slate-900">重新設定新密碼</h2>
      <p className="text-slate-500 text-center mb-8 text-sm">修改後系統將自動登出，請使用新密碼重新登入</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">新密碼</label>
          <input 
            type="password" 
            value={newPass} onChange={e => setNewPass(e.target.value)}
            disabled={submitting}
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50"
            placeholder="輸入新密碼" required
          />
          <p className="text-[10px] text-slate-400 mt-1 ml-1 font-medium">※ 須至少 6 個英、數字；不限大小寫</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">確認新密碼</label>
          <input 
            type="password" 
            value={confirmPass} onChange={e => setConfirmPass(e.target.value)}
            disabled={submitting}
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50"
            placeholder="再次輸入新密碼" required
          />
        </div>
        {error && <p className="text-red-500 text-xs mt-2 flex items-center gap-1 font-bold"><AlertCircle className="w-3 h-3" /> {error}</p>}
        <button 
          disabled={submitting}
          className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold hover:bg-indigo-700 transition-all disabled:bg-slate-400"
        >
          {submitting ? '密碼修改中...' : '確認修改密碼'}
        </button>
      </form>
    </motion.div>
  );
}

function UserManagementView({ 
  users, 
  onAdd, 
  onDelete, 
  onToggleFreeze,
  candidateCount,
  recordCount,
  rawRowCount
}: { 
  users: UserAccount[], 
  onAdd: (name: string, pass: string) => void,
  onDelete: (id: string) => void,
  onToggleFreeze: (id: string) => void,
  candidateCount: number,
  recordCount: number,
  rawRowCount: number
}) {
  const [newName, setNewName] = useState('');
  const [newPass, setNewPass] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPass.trim()) return;
    onAdd(newName.trim(), newPass.trim());
    setNewName('');
    setNewPass('');
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
        <h2 className="text-xl font-bold mb-6 text-slate-800 flex items-center gap-2">
          <UserPlus className="w-6 h-6 text-indigo-600" /> 新增使用者帳號
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4">
          <input 
            type="text" value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="使用者帳號 (Username)"
            className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
            required
          />
          <input 
            type="text" value={newPass} onChange={e => setNewPass(e.target.value)}
            placeholder="初始密碼"
            className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
            required
          />
          <button className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-indigo-700 transition-all">
            建立帳號
          </button>
        </form>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-8 py-5 bg-slate-50 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase tracking-widest">
          帳號清單與權限設定
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-8 py-4 text-xs font-bold text-slate-400 uppercase">帳號</th>
                <th className="px-8 py-4 text-xs font-bold text-slate-400 uppercase">密碼 (明碼)</th>
                <th className="px-8 py-4 text-xs font-bold text-slate-400 uppercase">權限級別</th>
                <th className="px-8 py-4 text-xs font-bold text-slate-400 uppercase">狀態</th>
                <th className="px-8 py-4 text-xs font-bold text-slate-400 uppercase text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-8 py-4">
                    <span className="font-bold text-slate-700">{u.username}</span>
                  </td>
                  <td className="px-8 py-4 font-mono text-sm text-slate-400">
                    {u.password}
                  </td>
                  <td className="px-8 py-4">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold ${u.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                      {u.role === 'admin' ? 'SYSTEM ADMIN' : 'USER'}
                    </span>
                  </td>
                  <td className="px-8 py-4">
                    {u.isFrozen ? (
                      <span className="flex items-center gap-1 text-red-500 text-xs font-bold">
                        <AlertCircle className="w-3 h-3" /> 已凍結
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-500 text-xs font-bold">
                        <ShieldCheck className="w-3 h-3" /> 正常
                      </span>
                    )}
                  </td>
                  <td className="px-8 py-4 text-right space-x-2">
                    {u.role !== 'admin' && (
                      <>
                        <button 
                          onClick={() => onToggleFreeze(u.id)}
                          className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${u.isFrozen ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
                        >
                          {u.isFrozen ? '解除凍結' : '凍結帳號'}
                        </button>
                        <button 
                          onClick={() => onDelete(u.id)}
                          className="px-3 py-1.5 rounded bg-red-50 text-red-600 hover:bg-red-100 text-xs font-bold transition-all"
                        >
                          刪除
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
