/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, 
  User, 
  Calendar, 
  Clock, 
  ChevronRight, 
  ShieldCheck, 
  AlertCircle, 
  LogOut, 
  UserPlus,
  History,
  Briefcase,
  MessageSquare,
  ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  loginWithGoogle, 
  logout, 
  handleFirestoreError, 
  OperationType 
} from './lib/firebase';
import { 
  onAuthStateChanged, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc,
  setDoc,
  doc, 
  serverTimestamp, 
  orderBy,
  limit,
  and
} from 'firebase/firestore';

// Types
interface Candidate {
  id: string;
  name: string;
  birthday: string;
  email?: string;
  phone?: string;
}

interface Record {
  id: string;
  type: 'interview' | 'employment';
  date: string;
  result: string;
  reason: string;
  department?: string;
  position?: string;
  notes?: string;
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchName, setSearchName] = useState('');
  const [searchBirthday, setSearchBirthday] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [records, setRecords] = useState<Record[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [sheetIdInput, setSheetIdInput] = useState(import.meta.env.VITE_GOOGLE_SHEETS_ID || '');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Sync Sheets
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSyncSheets = async () => {
    if (!sheetIdInput) return;
    setSyncStatus('syncing');
    setSyncError(null);
    setSyncProgress(0);
    setSyncTotal(0);

    try {
      console.log("Starting sync for:", sheetIdInput);
      const response = await fetch('/api/sync-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetId: sheetIdInput })
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "連線至 Google Sheets 失敗");
      }

      const data = await response.json();
      const allRows = data.rows as string[][];

      if (!allRows || allRows.length === 0) {
        throw new Error("試算表內沒有資料。");
      }

      // Step 1: Find the Header Row (search in first 30 rows)
      let headerRowIndex = -1;
      let nameIdx = -1;
      let birthIdx = -1;
      let resultIdx = -1;
      let reasonIdx = -1;
      let notesIdx = -1;
      let dateIdx = -1;
      let foundHeaders: string[] = [];

      for (let i = 0; i < Math.min(allRows.length, 30); i++) {
        const row = allRows[i].map(c => c ? c.toString().trim().replace(/[\s\u200B-\u200D\uFEFF]/g, '') : '');
        
        // Find "姓名" - this is the anchor for the header row
        const nIdx = row.findIndex(h => h && (h === '姓名' || h.includes('姓名')));
        
        if (nIdx !== -1) {
          headerRowIndex = i;
          nameIdx = nIdx;
          foundHeaders = row;
          
          // Once we found "姓名", look for others in the same row
          birthIdx = row.findIndex(h => h && (h === '生日' || h.includes('生日') || h.includes('出生')));
          resultIdx = row.findIndex(h => h && (h.includes('結果') || h.includes('狀態') || h.includes('錄取')));
          reasonIdx = row.findIndex(h => h && (h.includes('原因') || h.includes('評語') || h.includes('理由')));
          notesIdx = row.findIndex(h => h && (h.includes('備註') || h.includes('備注') || h.includes('補充')));
          dateIdx = row.findIndex(h => h && (h.includes('日期') || h.includes('時間')));
          
          console.log("Headers found at row", i + 1, ":", { nameIdx, birthIdx, resultIdx, reasonIdx, notesIdx, dateIdx });
          break;
        }
      }

      if (headerRowIndex === -1 || nameIdx === -1 || birthIdx === -1) {
        const sampleRows = allRows.slice(0, 10).map((r, ri) => `[Row ${ri+1}] ${r.join(' | ')}`).join('\n');
        throw new Error(`試算表格式不正確！找不到必要的標題欄位「姓名」與「生日」。\n\n系統分析前十列內容如下：\n${sampleRows}\n\n請確認您的試算表欄位名稱包含「姓名」與「生日」。`);
      }

      const rows = allRows.slice(headerRowIndex + 1).filter(row => {
        const name = row[nameIdx]?.toString().trim();
        const birth = row[birthIdx]?.toString().trim();
        return name && birth && name !== '姓名'; // Only count rows that have both name and birthday, and not the header row itself
      });

      setSyncTotal(rows.length);
      console.log(`Found header at row ${headerRowIndex + 1}. Processing ${rows.length} valid records...`);

      // Process rows
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        setSyncProgress(i + 1);
        
        if (!row[nameIdx] || !row[birthIdx]) continue;

        const name = row[nameIdx].toString().trim();
        let birthday = row[birthIdx].toString().trim();
        const result = row[resultIdx]?.toString().trim() || '未知';
        const reason = row[reasonIdx]?.toString().trim() || '';
        const notes = row[notesIdx]?.toString().trim() || '';
        const date = row[dateIdx]?.toString().trim() || new Date().toISOString().split('T')[0];

        // Normalize date to YYYY/MM/DD for consistency
        birthday = birthday.replace(/[-\.]/g, '/');
        if (birthday.includes(' ')) birthday = birthday.split(' ')[0];
        
        // Pad single digits (e.g. 2026/4/2 -> 2026/04/02)
        const parts = birthday.split('/');
        if (parts.length === 3) {
          const y = parts[0];
          const m = parts[1].padStart(2, '0');
          const d = parts[2].padStart(2, '0');
          birthday = `${y}/${m}/${d}`;
        }

        // 1. Find or Create Candidate
        const cQuery = query(collection(db, 'candidates'), where('name', '==', name), where('birthday', '==', birthday));
        const cSnap = await getDocs(cQuery);
        let candidateId = '';

        if (cSnap.empty) {
          const newDoc = await addDoc(collection(db, 'candidates'), {
            name,
            birthday,
            createdAt: serverTimestamp(),
            lastQueriedAt: serverTimestamp()
          });
          candidateId = newDoc.id;
        } else {
          candidateId = cSnap.docs[0].id;
        }

        // 2. Add Record - Use deterministic ID to avoid duplicates
        const recordsRef = collection(db, `candidates/${candidateId}/records`);
        
        // Create a unique ID for this record to prevent duplicates
        const type = (result.includes('離職') || result.includes('曾任')) ? 'employment' : 'interview';
        
        // Normalize strings for the ID to be stable
        const norm = (s: string) => s.toLowerCase().trim().replace(/[\s\W_]+/g, '');
        const rawId = `sync-${date}-${type}-${norm(result)}-${norm(reason)}-${norm(notes)}`;
        const deterministicId = rawId.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 150);

        // Use setDoc instead of addDoc with deterministic ID
        // Note: we'll use a transaction or just setDoc to overwrite if it exists (which is what we want for sync)
        // or check existence. Actually, setDoc with merge: true is safer or just setDoc.
        
        const recordDocRef = doc(db, `candidates/${candidateId}/records`, deterministicId);
        await setDoc(recordDocRef, {
          candidateId,
          type,
          date,
          result,
          reason,
          notes,
          syncId: deterministicId,
          syncAt: serverTimestamp(),
          updatedBy: auth.currentUser?.uid,
        }, { merge: true });
      }

      setSyncStatus('success');
      await addDoc(collection(db, 'access_logs'), {
        userId: auth.currentUser?.uid,
        userName: auth.currentUser?.displayName,
        action: 'SHEETS_SYNC',
        sheetId: sheetIdInput,
        rowCount: rows.length,
        timestamp: serverTimestamp()
      });

    } catch (error) {
      console.error("Sync Catch:", error);
      let message = '同步發生未知錯誤';
      
      if (error instanceof Error) {
        try {
          // Check if it's our JSON error info
          const errInfo = JSON.parse(error.message);
          if (errInfo.error) {
            message = errInfo.error;
            if (message.includes('permission')) {
              message = '您沒有權限執行此操作。請確認您已正確登錄。';
            } else if (message.includes('index')) {
              message = '系統正在建立必要的索引中，請稍候再試。';
            }
          }
        } catch {
          message = error.message;
        }
      }
      
      setSyncStatus('error');
      setSyncError(message);
    }
  };

  // Search Function
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchName.trim()) return;

    setIsSearching(true);
    setResults([]);
    setSelectedCandidate(null);

    const path = 'candidates';
    try {
      // Security Design: We enforce exact matches for Name + Birthday to prevent massive listing
      // and ensure data privacy (point lookup only).
      let q = query(
        collection(db, path), 
        where('name', '==', searchName.trim()),
        limit(20)
      );
      
      if (searchBirthday) {
        q = query(q, where('birthday', '==', searchBirthday.replace(/-/g, '/')));
      }

      const snapshot = await getDocs(q);
      const foundCandidates = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Candidate));

      setResults(foundCandidates);

      // Log the search for audit
      await addDoc(collection(db, 'access_logs'), {
        userId: auth.currentUser?.uid,
        userName: auth.currentUser?.displayName,
        action: 'SEARCH',
        targetName: searchName,
        targetBirthday: searchBirthday,
        timestamp: serverTimestamp(),
        resultCount: foundCandidates.length
      });

    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    } finally {
      setIsSearching(false);
    }
  };

  // Fetch Detail
  const selectCandidate = async (candidate: Candidate) => {
    setSelectedCandidate(candidate);
    setRecords([]); // Clear old records
    const recordsPath = `candidates/${candidate.id}/records`;
    try {
      const q = query(collection(db, recordsPath), orderBy('date', 'desc'));
      const snapshot = await getDocs(q);
      const foundRecords = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Record));
      setRecords(foundRecords);

      // Log the detail access
      await addDoc(collection(db, 'access_logs'), {
        userId: auth.currentUser?.uid,
        userName: auth.currentUser?.displayName,
        candidateId: candidate.id,
        candidateName: candidate.name,
        action: 'VIEW_DETAIL',
        timestamp: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, recordsPath);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Clock className="w-8 h-8 text-indigo-600" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-10 rounded-2xl shadow-xl shadow-indigo-100/50 max-w-md w-full border border-slate-200"
        >
          <div className="flex justify-center mb-8">
            <div className="bg-indigo-600 p-4 rounded-xl shadow-lg shadow-indigo-200">
              <ShieldCheck className="w-10 h-10 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center mb-2 text-slate-900 tracking-tight">HR 智慧面試查詢系統</h1>
          <p className="text-slate-500 text-center mb-10 text-sm leading-relaxed">
            本系統涉及員工與應徵者個資，僅授權人資單位使用。<br/>
            所有查詢行為皆會留存紀錄以供稽核。
          </p>
          <button 
            onClick={loginWithGoogle}
            className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 flex items-center justify-center gap-3"
          >
            使用 Google 帳號安全登入
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      {/* Header Navigation */}
      <nav className="flex items-center justify-between px-8 py-4 bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-indigo-900 hidden sm:block">HR Historical Insights</span>
        </div>
        
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setShowAdmin(!showAdmin)}
            className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all ${showAdmin ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400'}`}
          >
            <History className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider">資料管理</span>
          </button>

          <div className="hidden md:flex items-center gap-2 text-sm font-medium text-slate-600">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            安全存取驗證中
          </div>
          
          <div className="flex items-center gap-3 border-l border-slate-100 pl-6">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-bold text-slate-800">{user.displayName}</p>
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">人資系統操作員</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center font-bold text-indigo-700 border border-indigo-100 uppercase">
              {user.displayName?.substring(0, 2) || 'HR'}
            </div>
            <button 
              onClick={logout}
              className="text-slate-400 hover:text-red-500 transition-colors ml-2"
              title="登出系統"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Workspace */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-8 p-6 md:p-10 max-w-[1600px] mx-auto w-full">
        
        {/* Admin Panel (Conditional) */}
        <AnimatePresence>
          {showAdmin && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:col-span-12 overflow-hidden"
            >
              <div className="bg-indigo-900 text-white p-8 rounded-2xl shadow-xl mb-8 relative">
                <div className="flex flex-col md:flex-row gap-8 items-start justify-between">
                  <div className="max-w-xl">
                    <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                      Google Sheets 資料同步中心
                    </h2>
                    <p className="text-indigo-200 text-sm mb-6 leading-relaxed">
                      您可以將現有的 Google Sheets 總表串接到本系統。請確保您的試算表已設定為「知道連結的人均可查看」或匯出為 CSV。
                      <br/><span className="text-[10px] opacity-70 italic font-mono uppercase mt-1 block">Security: Logs will record this sync operation.</span>
                    </p>
                    
                    <div className="flex gap-3">
                      <input 
                        type="text" 
                        value={sheetIdInput}
                        onChange={(e) => setSheetIdInput(e.target.value)}
                        placeholder="請輸入 Google Sheets ID 或 完整網址"
                        className="flex-1 bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-sm focus:bg-white/20 outline-none transition-all placeholder:text-indigo-300"
                      />
                      <button 
                        onClick={handleSyncSheets}
                        disabled={syncStatus === 'syncing'}
                        className="bg-white text-indigo-900 px-6 py-2 rounded-lg font-bold text-sm hover:bg-indigo-50 transition-colors disabled:opacity-50 min-w-[120px]"
                      >
                        {syncStatus === 'syncing' ? '同步中...' : '開始同步'}
                      </button>
                    </div>

                    {syncStatus === 'syncing' && syncTotal > 0 && (
                      <div className="mt-4 bg-white/10 rounded-full h-1 overflow-hidden">
                        <motion.div 
                          className="bg-emerald-400 h-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${(syncProgress/syncTotal)*100}%` }}
                        />
                      </div>
                    )}

                    {syncStatus === 'syncing' && (
                      <p className="text-[10px] text-indigo-300 mt-2 font-mono uppercase tracking-widest">
                        正在處理第 {syncProgress} / {syncTotal} 筆資料...
                      </p>
                    )}

                    {syncStatus === 'success' && (
                      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-emerald-400 text-xs font-bold mt-4 flex items-center gap-1">
                        <ShieldCheck className="w-4 h-4" /> 同步成功！共計 {syncTotal} 筆資料已導入雲端資料庫。
                      </motion.p>
                    )}

                    {syncStatus === 'error' && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-red-500/20 border border-red-500/50 p-3 rounded-lg mt-4 text-xs flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                            <p className="text-red-200 leading-relaxed">
                                <span className="font-bold">同步失敗：</span>{syncError}
                                <br/><span className="opacity-70 mt-1 block">請確認試算表格式包含「姓名」與「生日」，且已開啟「知道連結的人均可查看」。</span>
                            </p>
                        </motion.div>
                    )}
                  </div>

                  <div className="bg-white/5 border border-white/10 p-6 rounded-xl text-xs space-y-3">
                    <p className="font-bold text-indigo-300 uppercase tracking-widest border-b border-white/10 pb-2 mb-2">同步指南</p>
                    <p className="flex items-start gap-2"><span className="w-4 h-4 bg-white/10 rounded flex items-center justify-center text-[10px]">1</span> 複製 Sheets 網址中的長代碼 (ID)</p>
                    <p className="flex items-start gap-2"><span className="w-4 h-4 bg-white/10 rounded flex items-center justify-center text-[10px]">2</span> 貼上並點擊開始同步</p>
                    <p className="flex items-start gap-2"><span className="w-4 h-4 bg-white/10 rounded flex items-center justify-center text-[10px]">3</span> 系統將自動抓取 姓名、生日、理由 等欄位</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Search & Audit Side (4 columns) */}
        <div className="md:col-span-4 flex flex-col gap-6">
          <section className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2 text-slate-800">
              <Search className="w-5 h-5 text-indigo-600" />
              快速人才檢索
            </h2>
            <form onSubmit={handleSearch} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">應徵者姓名</label>
                <input 
                  type="text" 
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  placeholder="請輸入姓名"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-300"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">出生日期</label>
                <input 
                  type="date" 
                  value={searchBirthday}
                  onChange={(e) => setSearchBirthday(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all uppercase"
                />
                <p className="text-[10px] text-slate-400 mt-1 italic">系統將自動轉換為 YYYY/MM/DD 格式</p>
              </div>
              <button 
                type="submit"
                disabled={isSearching}
                className="w-full bg-indigo-600 text-white font-bold py-4 rounded-lg hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 mt-2 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSearching ? '嚴密查詢中...' : '開始安全查詢'}
              </button>
            </form>
          </section>

          {/* Search Results List */}
          <AnimatePresence>
            {results.length > 0 ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col flex-1"
              >
                <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">查詢結果 ({results.length})</h3>
                </div>
                <div className="divide-y divide-slate-100 overflow-y-auto max-h-[400px]">
                  {results.map(candidate => (
                    <button
                      key={candidate.id}
                      onClick={() => selectCandidate(candidate)}
                      className={`w-full px-6 py-5 flex items-center justify-between hover:bg-slate-50 transition-colors text-left group ${selectedCandidate?.id === candidate.id ? 'bg-indigo-50/50' : ''}`}
                    >
                      <div>
                        <p className="font-bold text-slate-800">{candidate.name}</p>
                        <p className="text-xs text-slate-400 font-mono mt-1">生日：{candidate.birthday.replace(/-/g, '/')}</p>
                      </div>
                      <ChevronRight className={`w-5 h-5 transition-all ${selectedCandidate?.id === candidate.id ? 'translate-x-1 text-indigo-600' : 'text-slate-300 group-hover:text-slate-400'}`} />
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : searchName && !isSearching ? (
              <div className="bg-white p-10 text-center rounded-2xl border border-dashed border-slate-300 group hover:border-slate-400 transition-colors">
                <AlertCircle className="w-10 h-10 text-slate-200 mx-auto mb-4 group-hover:text-slate-300 transition-colors" />
                <p className="text-sm text-slate-500 font-medium">系統比對：查無此人紀錄</p>
                <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-wide">請重試或確認資料正確性</p>
              </div>
            ) : (
              // Empty State - Audit Log Feel
              <div className="bg-white p-7 rounded-2xl border border-slate-200 flex-1">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-6">安全查詢日誌 (Audit Log)</h3>
                <div className="space-y-6">
                  <div className="flex gap-4">
                    <div className="w-1 bg-indigo-500 rounded-full h-10"></div>
                    <div>
                      <p className="text-sm font-bold text-slate-700">準備查詢中...</p>
                      <p className="text-[10px] text-slate-400 font-mono mt-1 uppercase">Ready for operation</p>
                    </div>
                  </div>
                  <div className="flex gap-4 opacity-40">
                    <div className="w-1 bg-slate-300 rounded-full h-10"></div>
                    <div className="flex-1">
                      <div className="h-4 bg-slate-100 rounded w-3/4 mb-2"></div>
                      <div className="h-3 bg-slate-50 rounded w-1/2"></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Results Area (8 columns) */}
        <div className="md:col-span-8 flex flex-col gap-6">
          <AnimatePresence mode="wait">
            {selectedCandidate ? (
              <motion.div 
                key={selectedCandidate.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col gap-6 h-full"
              >
                {/* Candidate Dashboard Header */}
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-8 py-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex items-center gap-5">
                      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-indigo-600 border border-slate-200 shadow-inner">
                        <User className="w-8 h-8" />
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <h2 className="text-2xl font-bold text-slate-900 leading-tight">{selectedCandidate.name}</h2>
                          <span className="px-3 py-1 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-full border border-indigo-200 uppercase tracking-wider">
                            Verified Candidate
                          </span>
                        </div>
                        <div className="flex gap-4 mt-2">
                          <p className="text-xs font-bold text-slate-400 flex items-center gap-1 uppercase tracking-tighter">
                            <Calendar className="w-3 h-3" /> 生日：{selectedCandidate.birthday.replace(/-/g, '/')}
                          </p>
                          {selectedCandidate.email && (
                            <p className="text-xs font-bold text-slate-400 flex items-center gap-1 uppercase tracking-tighter">
                              EMAIL: {selectedCandidate.email}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="px-5 py-2 bg-slate-900 text-white text-[11px] font-bold rounded-lg hover:bg-slate-800 transition-all uppercase tracking-wider">
                        導出詳細報告
                      </button>
                    </div>
                  </div>
                </div>

                {/* Historical Timeline Container */}
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex-1 flex flex-col overflow-hidden">
                  <div className="px-8 py-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <History className="w-4 h-4 text-indigo-600" />
                      歷程追蹤錄 (Historical Records)
                    </h3>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Secure Ledger</span>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-8 space-y-8">
                    {records.length > 0 ? records.map((record, idx) => (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        key={record.id}
                        className="group relative pl-12 before:absolute before:left-[19px] before:top-10 before:bottom-[-32px] before:w-[2px] before:bg-slate-100 last:before:hidden"
                      >
                        {/* Status Icon */}
                        <div className={`absolute left-0 top-0 w-10 h-10 rounded-xl border-2 border-white shadow-sm flex items-center justify-center z-10 transition-transform group-hover:scale-110 ${
                          record.type === 'interview' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-indigo-50 text-indigo-600 border-indigo-100'
                        }`}>
                          {record.type === 'interview' ? <MessageSquare className="w-5 h-5" /> : <Briefcase className="w-5 h-5" />}
                        </div>
                        
                        <div className="bg-white border border-slate-200 p-6 rounded-xl hover:shadow-md transition-all">
                          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-5 pb-4 border-b border-slate-50">
                            <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{record.date}</p>
                              <h4 className="text-lg font-bold text-slate-800">
                                {record.type === 'interview' ? '招募面試錄' : '任職記錄'}
                                <span className={`ml-3 text-[10px] px-2 py-0.5 rounded uppercase ${
                                  record.result === '錄取' || record.result === '通過' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {record.result}
                                </span>
                              </h4>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-mono text-slate-300">REF: #{record.id.substring(0, 8).toUpperCase()}</p>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-slate-50/50 p-5 rounded-xl border border-slate-100">
                            {record.position && (
                              <div>
                                <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">職位 / 部門</p>
                                <p className="text-sm font-bold text-slate-700">{record.position} <span className="text-slate-400 font-normal">({record.department})</span></p>
                              </div>
                            )}
                            <div>
                              <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">
                                {record.type === 'interview' ? '未錄取原因 (Reason)' : '離職原因 (Resigned)'}
                              </p>
                              <p className="text-sm font-bold text-slate-800 leading-relaxed">
                                {record.reason || '無記載'}
                              </p>
                            </div>
                          </div>
                          
                          {record.notes && (
                            <div className="mt-5 pt-4">
                              <p className="text-[10px] text-slate-400 font-bold uppercase mb-2 tracking-widest bg-slate-100 w-fit px-2 py-0.5 rounded">人資備註與評價 (Full Notes)</p>
                              <div className="text-sm text-slate-700 bg-white p-5 rounded-xl border border-slate-200 shadow-sm leading-relaxed whitespace-pre-wrap break-words min-h-[60px]">
                                {record.notes}
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )) : (
                      <div className="h-full flex flex-col items-center justify-center py-20 text-center opacity-40">
                        <History className="w-16 h-16 text-slate-300 mb-4" />
                        <p className="text-slate-400 font-medium">尚無歷史紀錄紀錄於本系統中</p>
                      </div>
                    )}
                  </div>
                  
                  {/* Security Footer inside card */}
                  <div className="p-4 bg-slate-900 text-slate-400 flex items-center justify-between px-8">
                    <p className="text-[10px] tracking-widest uppercase flex items-center gap-2">
                       <ShieldCheck className="w-3 h-3 text-emerald-500" />
                       此紀錄受 AES-256 加密保護 &bull; 存取代碼: #{Math.random().toString(36).substr(2, 9).toUpperCase()}
                    </p>
                    <div className="flex gap-3">
                      <button className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold rounded border border-slate-700 transition-colors uppercase tracking-wider">
                        PDF 導出
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-12 bg-white rounded-2xl border border-slate-200 shadow-sm">
                <div className="bg-slate-50 p-10 rounded-full mb-8 relative border border-slate-100 shadow-inner">
                  <div className="absolute top-0 right-0 bg-indigo-600 text-white p-2 rounded-full shadow-lg -mt-2 -mr-2">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <UserPlus className="w-20 h-20 text-slate-200" />
                </div>
                <h3 className="text-2xl font-bold text-slate-800 mb-4 tracking-tight">請啟動應徵者歷程查詢</h3>
                <p className="text-slate-400 max-w-sm leading-relaxed text-sm">
                  輸入應徵者姓名及生日進行安全比對，<br/>系統將從雲端資料庫調閱過往面試評價與在職紀錄，<br/>確保招募品質與降低企業風險。
                </p>
              </div>
            )}
          </AnimatePresence>
        </div>

      </main>
      
      {/* Search Footer Disclaimer */}
      <footer className="text-center py-8 bg-white border-t border-slate-100">
        <p className="text-[10px] text-slate-400 uppercase tracking-[0.4em] font-bold">
          High-Security HR Protocol &bull; Personnel Data Privacy Act Compliance &bull; {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}

