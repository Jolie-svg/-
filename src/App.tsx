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
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface Candidate {
  id: string;
  name: string;
  birthday: string;
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
const FIXED_SHEET_ID = import.meta.env.VITE_SHEET_ID || DEFAULT_SHEET_ID;

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
  const [activeTab, setActiveTab] = useState<'search' | 'admin'>('search');

  // Data State
  const [allCandidates, setAllCandidates] = useState<Candidate[]>([]);
  const [allRecords, setAllRecords] = useState<Record[]>([]);
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
    } else {
      // Default admin account
      initialUsers = [
        { id: 'u-1', username: 'admin', password: 'admin', role: 'admin', isFrozen: false }
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

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    localStorage.removeItem('hr_session_user');
    setAllCandidates([]);
    setAllRecords([]);
    setSelectedCandidate(null);
    setActiveTab('search');
  };

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

  const fetchDataFromSheets = async () => {
    setLoading(true);
    try {
      // Direct client-side fetch from Google Sheets CSV export
      // URL: https://docs.google.com/spreadsheets/d/{ID}/export?format=csv
      const csvUrl = `https://docs.google.com/spreadsheets/d/${FIXED_SHEET_ID}/export?format=csv`;
      
      const response = await fetch(csvUrl);
      
      if (!response.ok) {
        if (response.status === 403 || response.status === 401) {
          throw new Error("存取被拒。請確認 Google Sheet 已設定為「知道連結的人均可查看」。");
        }
        throw new Error(`無法從 Google 取得資料 (${response.status})`);
      }

      const csvText = await response.text();
      
      // Basic check for HTML (which usually means a login page instead of CSV)
      if (csvText.includes("<!DOCTYPE html>") || csvText.includes("<!doctype html>")) {
         throw new Error("讀取失敗：獲取到的是網頁而非資料。請確認 Google Sheet 已設定為「知道連結的人均可查看」。");
      }

      // Simple CSV Parser (Handles commas in quotes)
      const rows: string[][] = [];
      const lines = csvText.split(/\r?\n/);
      
      for (const line of lines) {
        if (!line.trim()) continue;
        const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
        if (matches) {
          rows.push(matches.map(m => m.replace(/^"|"$/g, '').trim()));
        } else {
          // Fallback split for simpler lines
          rows.push(line.split(',').map(c => c.trim()));
        }
      }

      parseSheetData(rows);
    } catch (err) {
      console.error("Sync Error:", err);
      alert('同步資料失敗：' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const parseSheetData = (allRows: string[][]) => {
    if (!allRows || allRows.length === 0) return;

    // Find headers
    let headerRowIndex = -1;
    let nameIdx = 3; 
    let birthIdx = 4;
    let resultIdx = -1;
    let reasonIdx = -1;
    let notesIdx = -1;
    let dateIdx = -1;

    for (let i = 0; i < Math.min(allRows.length, 30); i++) {
      const row = allRows[i].map(c => c?.toString().trim() || '');
      const isDName = row[3]?.includes('姓名');
      if (isDName) {
        headerRowIndex = i;
        nameIdx = 3;
        birthIdx = 4;
        resultIdx = row.findIndex(h => h.includes('結果') || h.includes('狀態'));
        reasonIdx = row.findIndex(h => h.includes('原因') || h.includes('理由'));
        notesIdx = row.findIndex(h => h.includes('備註') || h.includes('評價'));
        dateIdx = row.findIndex(h => h.includes('日期') || h.includes('時間'));
        break;
      }
    }

    if (headerRowIndex === -1) return;

    const candidatesMap = new Map<string, Candidate>();
    const recordsList: Record[] = [];

    const norm = (s: string) => s.toLowerCase().trim().replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');

    allRows.slice(headerRowIndex + 1).forEach((row, rowIndex) => {
      const name = row[nameIdx]?.trim();
      let birthday = row[birthIdx]?.trim();
      if (!name || !birthday || name === '姓名') return;

      // Format Birthday to YYYY/MM/DD
      birthday = birthday.replace(/[-\.]/g, '/');
      const parts = birthday.split('/');
      if (parts.length === 3) {
        birthday = `${parts[0]}/${parts[1].padStart(2, '0')}/${parts[2].padStart(2, '0')}`;
      }

      const candId = `c-${norm(name)}-${norm(birthday)}`;
      if (!candidatesMap.has(candId)) {
        candidatesMap.set(candId, { id: candId, name, birthday });
      }

      const result = row[resultIdx]?.trim() || '未知';
      const reason = row[reasonIdx]?.trim() || '';
      const notes = row[notesIdx]?.trim() || '';
      const date = row[dateIdx]?.trim() || new Date().toISOString().split('T')[0];
      const type = (result.includes('離職') || result.includes('曾任')) ? 'employment' : 'interview';

      recordsList.push({
        id: `r-${rowIndex}-${candId}`,
        candidateId: candId,
        type,
        date,
        result,
        reason,
        notes
      });
    });

    setAllCandidates(Array.from(candidatesMap.values()));
    setAllRecords(recordsList);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearching(true);
    
    // Memory-only filtering
    setTimeout(() => {
      const results = allCandidates.filter(c => {
        const nameMatch = c.name.includes(searchName.trim());
        const birthMatch = searchBirthday 
          ? c.birthday === searchBirthday.replace(/-/g, '/')
          : true;
        return nameMatch && birthMatch;
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
          <span className="text-xl font-bold tracking-tight text-indigo-900">HR Historical Insights</span>
        </div>
        
        <div className="flex items-center gap-6">
          {currentUser?.role === 'admin' && (
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button 
                onClick={() => setActiveTab('search')}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'search' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
              >
                人才搜尋
              </button>
              <button 
                onClick={() => setActiveTab('admin')}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'admin' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
              >
                權限管理
              </button>
            </div>
          )}
          <div className="hidden md:flex items-center gap-2 text-sm font-medium text-slate-600">
            {loading ? (
              <span className="flex items-center gap-2 text-indigo-600 animate-pulse">
                <Clock className="w-4 h-4 animate-spin" /> 資料同步中...
              </span>
            ) : (
              <span className="flex items-center gap-2 text-green-600">
                <ShieldCheck className="w-4 h-4" /> 雲端連線正常
              </span>
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
              <input 
                type="text" value={searchName} onChange={e => setSearchName(e.target.value)}
                placeholder="應徵者姓名"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
              />
              <input 
                type="date" value={searchBirthday} onChange={e => setSearchBirthday(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg outline-none uppercase"
              />
              <button disabled={isSearching} className="w-full bg-indigo-600 text-white font-bold py-4 rounded-lg hover:bg-indigo-700 transition-all flex items-center justify-center gap-2">
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
                    <p className="font-bold text-slate-800">{c.name}</p>
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
                <div className="bg-white border border-slate-200 rounded-2xl p-8 flex items-center gap-6 shadow-sm">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-indigo-600 border border-slate-200"><User className="w-8 h-8" /></div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">{selectedCandidate.name}</h2>
                    <p className="text-xs font-bold text-slate-400 flex items-center gap-1 uppercase tracking-tighter mt-1">
                      <Calendar className="w-3 h-3" /> 生日：{selectedCandidate.birthday}
                    </p>
                  </div>
                </div>

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
        ) : (
          <div className="md:col-span-12">
            <UserManagementView 
              users={users} 
              onAdd={addUser} 
              onDelete={removeUser} 
              onToggleFreeze={toggleFreeze} 
            />
          </div>
        )}
      </main>
    </div>
  );
}

// --- Sub-components ---

function UserManagementView({ 
  users, 
  onAdd, 
  onDelete, 
  onToggleFreeze 
}: { 
  users: UserAccount[], 
  onAdd: (name: string, pass: string) => void,
  onDelete: (id: string) => void,
  onToggleFreeze: (id: string) => void
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
