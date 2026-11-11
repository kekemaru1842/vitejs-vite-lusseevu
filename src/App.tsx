import React, { useState, useMemo, useEffect } from 'react';
import { Calendar, Clock, User, Plus, Trash2, ChevronRight, CheckCircle2, X, Settings, AlertCircle, Edit, Loader2, Link as LinkIcon, Copy, Check } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection } from 'firebase/firestore';

// --- Firebase初期化 ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- ユーティリティ ---
const generateId = () => Math.random().toString(36).substring(2, 15);
const today = new Date();
const formatDate = (date) => date.toISOString().split('T')[0];

export default function App() {
  // ユーザー認証・DB準備状態
  const [user, setUser] = useState(null);
  const [isDbReady, setIsDbReady] = useState(false);

  const [view, setView] = useState('parent'); // 'admin' or 'parent'
  const [isLockedToParent, setIsLockedToParent] = useState(false); // 保護者専用モードかどうかの判定
  const [copySuccess, setCopySuccess] = useState(false); // リンクコピー成功時の表示用
  const [slots, setSlots] = useState([]);

  // 予約モーダル用ステート
  const [bookingSlot, setBookingSlot] = useState(null);
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [bookingError, setBookingError] = useState('');

  // 管理者用：新規枠追加ステート
  const [newDate, setNewDate] = useState(formatDate(today));
  const [newStartTime, setNewStartTime] = useState('09:00');
  const [newEndTime, setNewEndTime] = useState('09:30');

  // 管理者用：予約受付期間ステート
  const [bookingPeriod, setBookingPeriod] = useState({ start: '', end: '' });

  // 管理者用：枠編集ステート
  const [editingSlot, setEditingSlot] = useState(null);
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');

  // --- 1. Firebase 認証 ---
  useEffect(() => {
    let isMounted = true;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
        if (isMounted) setUser(auth.currentUser);
      } catch (error) {
        console.error("認証エラー:", error);
      }
    };
    initAuth();
    return () => { isMounted = false; };
  }, []);

  // --- URLパラメータの確認 (保護者用リンクからのアクセス判定) ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'parent') {
      setView('parent');
      setIsLockedToParent(true);
    }
  }, []);

  // --- 2. データベースのリアルタイム購読 ---
  useEffect(() => {
    if (!user) return;

    const slotsRef = collection(db, 'artifacts', appId, 'public', 'data', 'slots');
    const settingsRef = collection(db, 'artifacts', appId, 'public', 'data', 'settings');

    // 予約枠の同期
    const unsubSlots = onSnapshot(slotsRef, (snapshot) => {
      const slotsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSlots(slotsData);
      setIsDbReady(true);
    }, (error) => console.error("枠の取得エラー:", error));

    // 受付期間設定の同期
    const unsubSettings = onSnapshot(settingsRef, (snapshot) => {
      let period = { start: '', end: '' };
      snapshot.docs.forEach(doc => {
        if (doc.id === 'bookingPeriod') period = doc.data();
      });
      setBookingPeriod(period);
    }, (error) => console.error("設定の取得エラー:", error));

    return () => {
      unsubSlots();
      unsubSettings();
    };
  }, [user]);

  // --- 管理者機能 (クラウドDBへ書き込み) ---
  const handleAddSlot = async (e) => {
    e.preventDefault();
    if (!user) return;
    
    const newId = generateId();
    const newSlot = {
      date: newDate,
      startTime: newStartTime,
      endTime: newEndTime,
      isBooked: false,
      bookedBy: '',
      color: '',
      createdAt: new Date().getTime()
    };
    
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'slots', newId), newSlot);
    } catch (error) {
      console.error("追加エラー:", error);
    }
  };

  const handleDeleteSlot = async (id) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'slots', id));
    } catch (error) {
      console.error("削除エラー:", error);
    }
  };

  const openEditModal = (slot) => {
    setEditingSlot(slot);
    setEditDate(slot.date);
    setEditStartTime(slot.startTime);
    setEditEndTime(slot.endTime);
  };

  const handleUpdateSlot = async () => {
    if (!user || !editingSlot) return;
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'slots', editingSlot.id), {
        date: editDate,
        startTime: editStartTime,
        endTime: editEndTime
      });
      setEditingSlot(null);
    } catch (error) {
      console.error("更新エラー:", error);
    }
  };

  const handleCancelBookingAdmin = async (id) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'slots', id), { 
        isBooked: false, 
        bookedBy: '', 
        color: '',
        bookerUserId: null
      });
    } catch (error) {
      console.error("キャンセルエラー:", error);
    }
  };

  const handleUpdateBookingPeriod = async (field, value) => {
    if (!user) return;
    const newPeriod = { ...bookingPeriod, [field]: value };
    // ローカルも即時更新して体感を良くする
    setBookingPeriod(newPeriod); 
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'bookingPeriod'), newPeriod);
    } catch (error) {
      console.error("設定保存エラー:", error);
    }
  };

  // --- 保護者用リンクのコピー機能 ---
  const handleCopyLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', 'parent');
    const linkToCopy = url.toString();

    const fallbackCopyTextToClipboard = (text) => {
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        // スクロールを防ぐためのスタイル
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.position = "fixed";
        
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        if (successful) {
          setCopySuccess(true);
          setTimeout(() => setCopySuccess(false), 2000);
        }
        document.body.removeChild(textArea);
      } catch (err) {
        console.error('Fallback: オフラインコピーに失敗しました', err);
      }
    };

    if (!navigator.clipboard) {
      fallbackCopyTextToClipboard(linkToCopy);
      return;
    }
    
    navigator.clipboard.writeText(linkToCopy).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }).catch(err => {
      console.warn('Clipboard API エラー、代替手段でコピーを試みます: ', err);
      fallbackCopyTextToClipboard(linkToCopy);
    });
  };

  // --- 保護者機能 (クラウドDBへ書き込み) ---
  const handleBookSlot = async () => {
    if (!lastName.trim() || !firstName.trim()) {
      setBookingError('姓と名の両方を入力してください。');
      return;
    }
    if (!user || !bookingSlot) return;

    try {
      const slotRef = doc(db, 'artifacts', appId, 'public', 'data', 'slots', bookingSlot.id);
      
      // 直前に最新のデータを取得し、埋まっていないか最終チェック（二重予約防止）
      const slotSnap = await getDoc(slotRef);
      if (slotSnap.exists() && slotSnap.data().isBooked) {
        setBookingError('申し訳ありません。この枠は先ほど他の方に予約されました。');
        return;
      }

      // 予約を確定
      await updateDoc(slotRef, { 
        isBooked: true, 
        bookedBy: `${lastName.trim()} ${firstName.trim()}`, 
        color: 'blue',
        bookerUserId: user.uid // 自分自身の予約を識別するためのID
      });

      setBookingSlot(null);
      setLastName('');
      setFirstName('');
      setBookingError('');
    } catch (error) {
      console.error("予約エラー:", error);
      setBookingError('通信エラーが発生しました。');
    }
  };

  // 予約受付状況の判定
  const getBookingStatus = () => {
    const now = new Date();
    if (bookingPeriod.start) {
      const start = new Date(bookingPeriod.start);
      if (now < start) return 'NOT_STARTED';
    }
    if (bookingPeriod.end) {
      const end = new Date(bookingPeriod.end);
      if (now > end) return 'ENDED';
    }
    return 'OPEN';
  };

  // --- データ整形 ---
  const sortedSlots = useMemo(() => {
    return [...slots].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    });
  }, [slots]);

  const groupedSlots = useMemo(() => {
    const grouped = {};
    sortedSlots.forEach(slot => {
      if (!grouped[slot.date]) grouped[slot.date] = [];
      grouped[slot.date].push(slot);
    });
    return grouped;
  }, [sortedSlots]);

  // --- カラー設定 ---
  const colorOptions = [
    { id: 'blue', hex: '#3b82f6', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100' },
    { id: 'pink', hex: '#ec4899', bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-700', badge: 'bg-pink-100' },
    { id: 'green', hex: '#10b981', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', badge: 'bg-green-100' },
    { id: 'orange', hex: '#f97316', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', badge: 'bg-orange-100' },
    { id: 'purple', hex: '#8b5cf6', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100' },
  ];

  const getColorStyle = (colorId) => {
    return colorOptions.find(c => c.id === colorId) || colorOptions[0];
  };

  if (!isDbReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        <span className="ml-2 text-gray-600 font-medium">システムに接続中...</span>
      </div>
    );
  }

  // --- UIコンポーネント ---
  const AdminView = () => (
    <div className="space-y-8">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-indigo-200 bg-indigo-50/30">
        <h2 className="text-xl font-bold text-indigo-900 mb-4 flex items-center">
          <LinkIcon className="w-5 h-5 mr-2 text-indigo-600" />
          保護者用リンクの共有
        </h2>
        <p className="text-sm text-gray-700 mb-4 leading-relaxed">
          以下のボタンから保護者用の専用リンクをコピーし、LINEやメール等で配布してください。<br/>
          ※このリンクからアクセスした保護者には、管理者モードへの切り替えボタンは表示されません。
        </p>
        <button
          onClick={handleCopyLink}
          className="flex items-center justify-center w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-6 rounded-lg transition-colors shadow-sm"
        >
          {copySuccess ? (
            <><Check className="w-5 h-5 mr-2" /> コピーしました！</>
          ) : (
            <><Copy className="w-5 h-5 mr-2" /> 保護者用リンクをコピー</>
          )}
        </button>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
          <Plus className="w-5 h-5 mr-2 text-indigo-600" />
          新規予約枠の追加
        </h2>
        <form onSubmit={handleAddSlot} className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-gray-700 mb-1">日付</label>
            <input 
              type="date" 
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
              required
            />
          </div>
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
            <input 
              type="time" 
              value={newStartTime}
              onChange={(e) => setNewStartTime(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
              required
            />
          </div>
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-gray-700 mb-1">終了時間</label>
            <input 
              type="time" 
              value={newEndTime}
              onChange={(e) => setNewEndTime(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
              required
            />
          </div>
          <button 
            type="submit"
            className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-6 rounded-lg transition-colors flex items-center justify-center whitespace-nowrap h-[42px]"
          >
            <Plus className="w-4 h-4 mr-1" /> 枠を追加
          </button>
        </form>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-xl font-bold text-gray-800 mb-4">設定済みの予約枠</h2>
        {Object.keys(groupedSlots).length === 0 ? (
          <p className="text-gray-500 text-center py-8">予約枠がありません。</p>
        ) : (
          <div className="space-y-6">
            {Object.keys(groupedSlots).map(date => (
              <div key={date}>
                <h3 className="text-lg font-semibold text-gray-700 border-b pb-2 mb-3">{date}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {groupedSlots[date].map(slot => {
                    const style = slot.isBooked ? getColorStyle(slot.color) : { bg: 'bg-gray-50', border: 'border-gray-200' };
                    return (
                    <div key={slot.id} className={`p-4 rounded-lg border ${style.bg} ${style.border}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center text-gray-800 font-medium">
                          <Clock className="w-4 h-4 mr-1 text-gray-500" />
                          {slot.startTime} - {slot.endTime}
                        </div>
                        {slot.isBooked ? (
                          <span className={`px-2 py-1 text-xs font-semibold ${style.badge} ${style.text} rounded-full`}>予約済</span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-600 rounded-full">空き</span>
                        )}
                      </div>
                      
                      {slot.isBooked ? (
                        <div className="mt-3 flex items-center justify-between">
                          <div className="flex items-center text-sm text-gray-700 font-medium">
                            <User className="w-4 h-4 mr-1 text-gray-400" />
                            {slot.bookedBy}
                          </div>
                          <button 
                            onClick={() => handleCancelBookingAdmin(slot.id)}
                            className="text-xs text-red-500 hover:text-red-700 underline"
                          >
                            キャンセル
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 flex justify-end gap-2">
                          <button 
                            onClick={() => openEditModal(slot)}
                            className="text-gray-400 hover:text-indigo-600 transition-colors p-1 bg-white rounded-md border border-gray-200 shadow-sm"
                            title="枠を編集"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteSlot(slot.id)}
                            className="text-gray-400 hover:text-red-500 transition-colors p-1 bg-white rounded-md border border-gray-200 shadow-sm"
                            title="枠を削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  )})}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const ParentView = () => {
    const status = getBookingStatus();
    // 自分が予約した枠だけをフィルタリング
    const myBookings = slots.filter(s => s.isBooked && s.bookerUserId === user?.uid);
    
    return (
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-xl font-bold text-gray-800 mb-2">面談予約</h2>
          
          {status === 'NOT_STARTED' && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg mb-6 flex items-start">
              <AlertCircle className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">予約開始前です</p>
                <p className="text-sm">予約受付は {new Date(bookingPeriod.start).toLocaleString()} から開始します。</p>
              </div>
            </div>
          )}
          
          {status === 'ENDED' && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-6 flex items-start">
              <AlertCircle className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">予約受付終了</p>
                <p className="text-sm">予約受付期間は終了しました。</p>
              </div>
            </div>
          )}

          {status === 'OPEN' && (
            <p className="text-gray-500 text-sm mb-6">ご希望の日時を選択して、予約を行ってください。</p>
          )}

          {Object.keys(groupedSlots).length === 0 ? (
            <p className="text-gray-500 text-center py-8 bg-gray-50 rounded-lg">現在、予約可能な日程がありません。</p>
          ) : (
            <div className="space-y-6">
              {Object.keys(groupedSlots).map(date => (
                <div key={date} className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-semibold text-gray-700 flex items-center">
                    <Calendar className="w-4 h-4 mr-2 text-indigo-600" />
                    {date}
                  </div>
                  <div className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {groupedSlots[date].map(slot => {
                      const canBook = status === 'OPEN' && !slot.isBooked;
                      return (
                        <div 
                          key={slot.id} 
                          className={`p-4 rounded-lg border transition-all ${
                            !canBook 
                              ? 'bg-gray-50 border-gray-200 opacity-60' 
                              : 'bg-white border-green-200 hover:border-green-400 hover:shadow-md cursor-pointer'
                          }`}
                          onClick={() => canBook && setBookingSlot(slot)}
                        >
                          <div className="flex items-center text-gray-800 font-medium mb-2">
                            <Clock className="w-4 h-4 mr-1 text-gray-500" />
                            {slot.startTime} - {slot.endTime}
                          </div>
                          
                          {slot.isBooked ? (
                             <div className="text-sm text-gray-500 flex items-center justify-center py-1 bg-gray-200 rounded">
                               予約埋まりました
                             </div>
                          ) : status !== 'OPEN' ? (
                             <div className="text-sm text-gray-500 flex items-center justify-center py-1 bg-gray-100 rounded">
                               受付時間外
                             </div>
                          ) : (
                            <div className="text-sm font-medium text-green-600 flex items-center justify-center py-1 bg-green-50 rounded group-hover:bg-green-100">
                              予約する <ChevronRight className="w-4 h-4 ml-1" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 保護者自身の予約確認 (クラウド上の自分のIDに紐づくデータ) */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-xl font-bold text-gray-800 mb-4">あなたの予約状況</h2>
          {myBookings.length > 0 ? (
            <div className="space-y-3">
              {myBookings.map(slot => {
                const style = getColorStyle(slot.color);
                return (
                <div key={slot.id} className={`p-4 ${style.bg} border ${style.border} rounded-lg flex justify-between items-center shadow-sm`}>
                  <div>
                    <div className={`font-bold ${style.text}`}>{slot.date} {slot.startTime} - {slot.endTime}</div>
                    <div className={`text-sm ${style.text} mt-1 opacity-80 flex items-center`}>
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      予約完了 ({slot.bookedBy} 様)
                    </div>
                  </div>
                </div>
              )})}
            </div>
          ) : (
            <p className="text-gray-500">現在、あなたの予約はありません。</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-gray-800 font-sans pb-10">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-center gap-4">
          <h1 className="text-2xl font-bold text-indigo-700 flex items-center">
            <Calendar className="w-6 h-6 mr-2" />
            かんたん日程調整
          </h1>
          {!isLockedToParent && (
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setView('admin')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === 'admin' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                管理者モード
              </button>
              <button
                onClick={() => setView('parent')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === 'parent' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                保護者モード
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {view === 'admin' ? <AdminView /> : <ParentView />}
      </main>

      {/* 予約モーダル */}
      {bookingSlot && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-indigo-600 px-6 py-4 flex justify-between items-center text-white">
              <h3 className="text-lg font-bold">予約の確認</h3>
              <button onClick={() => { setBookingSlot(null); setBookingError(''); }} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <div className="mb-6 bg-indigo-50 p-4 rounded-lg">
                <p className="text-sm text-indigo-900 font-medium mb-1">選択した日時</p>
                <p className="text-lg font-bold text-indigo-700">
                  {bookingSlot.date} <br/>
                  {bookingSlot.startTime} 〜 {bookingSlot.endTime}
                </p>
              </div>

              <div className="mb-8">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  保護者様（またはお子様）のお名前 <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-4 mb-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="姓 (例：山田)"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                      autoFocus
                    />
                  </div>
                  <div className="flex-1">
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="名 (例：太郎)"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500">※漢字で入力してください。</p>
                {bookingError && <p className="text-red-500 text-sm mt-2 font-medium">{bookingError}</p>}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setBookingSlot(null); setBookingError(''); }}
                  className="flex-1 py-3 px-4 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleBookSlot}
                  className="flex-1 py-3 px-4 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center"
                >
                  <CheckCircle2 className="w-5 h-5 mr-1" />
                  予約を確定する
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 枠編集モーダル (管理者用) */}
      {editingSlot && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-gray-800 px-6 py-4 flex justify-between items-center text-white">
              <h3 className="text-lg font-bold">予約枠の編集</h3>
              <button onClick={() => setEditingSlot(null)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">日付</label>
                <input 
                  type="date" 
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
                  <input 
                    type="time" 
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">終了時間</label>
                  <input 
                    type="time" 
                    value={editEndTime}
                    onChange={(e) => setEditEndTime(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setEditingSlot(null)}
                  className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleUpdateSlot}
                  className="flex-1 py-2 px-4 bg-gray-800 text-white rounded-lg font-medium hover:bg-gray-900 transition-colors"
                >
                  保存する
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}