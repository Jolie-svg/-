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

// --- Constants ---
const DEFAULT_SHEET_ID = '1syQgXhAwQV2DLn54gRjsNG1NTLAR59g5hBKzJDK6uh8';
const FIXED_SHEET_ID = import.meta.env.VITE_SHEET_ID || DEFAULT_SHEET_ID;

export default function App() {
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

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
    const session = localStorage.getItem('hr_session');
    if (session === 'active') {
      setIsAuthenticated(true);
      fetchDataFromSheets();
    }
  }, []);

  // --- Handlers ---
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setAuthError('');

    // Simulate simple login
    setTimeout(() => {
      if (username === 'admin' && password === 'admin') {
        setIsAuthenticated(true);
        localStorage.setItem('hr_session', 'active');
        fetchDataFromSheets();
      } else {
        setAuthError('帳號或密碼錯誤');
      }
      setIsLoggingIn(false);
    }, 800);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('hr_session');
    setAllCandidates([]);
    setAllRecords([]);
    setSelectedCandidate(null);
  };

  const fetchDataFromSheets = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/sync-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetId: FIXED_SHEET_ID })
      });
      
      const contentType = response.headers.get('content-type');
      if (!response.ok) {
        let errorMsg = '抓取資料失敗';
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          errorMsg = data.error || errorMsg;
        } else {
          const text = await response.text();
          console.error('Non-JSON error response:', text);
          errorMsg = `伺服器回傳錯誤 (${response.status}): ${text.substring(0, 100)}`;
        }
        throw new Error(errorMsg);
      }

      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('伺服器回傳格式錯誤 (非 JSON)');
      }

      const data = await response.json();
      const allRows = data.rows as string[][];
      parseSheetData(allRows);
    } catch (err) {
      console.error(err);
      alert('自動同步資料失敗：' + (err as Error).message);
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
                value={username} onChange={e => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="預設 admin" required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">密碼</label>
              <input 
                type="password" 
                value={password} onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="預設 admin" required
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
      </main>
    </div>
  );
}
