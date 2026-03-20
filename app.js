// [중복 로드 방지] var를 사용하여 재선언 허용
var DB_KEY = 'attendance_data';
var WORKERS_KEY = 'worker_list';
var PASSWORD_KEY = 'admin_password';
var DEFAULT_PASSWORD = '1234';

// --- 실제 배포된 인터넷 주소를 여기에 적으세요 (예: https://my-app.github.io) ---
// 이 주소가 없으면 직원들이 링크를 눌러도 접속할 수 없습니다.
var GLOBAL_URL = "https://attendance-master-3138.vercel.app";

// --- 서버 설정 (Firebase 연동용) ---
// 실제 사용 시 Firebase 설정을 여기에 붙여넣으세요.
// (설정 방법은 잠시 후 안내해 드리겠습니다.)
var SERVER_CONFIG = {
    useServer: true, // true로 바꾸면 서버와 연동됩니다.
    databaseURL: "https://yrs-workingdaycheck-default-rtdb.firebaseio.com/"
};

// --- [v2.0.0] 회기년도(Fiscal Year) 유틸리티 (3월 1일 ~ 익년 2월 말일) ---
var FiscalYearUtil = {
    getCurrentYear: () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1; // 1-indexed
        // 1~2월은 이전 연도 회기에 포함됨
        return (month < 3) ? year - 1 : year;
    },
    getYearFromDate: (dateStr) => {
        const [y, m] = dateStr.split('-').map(Number);
        return (m < 3) ? y - 1 : y;
    },
    getRange: (fiscalYear) => {
        return { start: `${fiscalYear}-03-01`, end: `${fiscalYear + 1}-02-28` }; // 말일 처리는 date 객체 권장
    }
};

// --- [v2.0.0] 이미지 압축 유틸리티 ---
var ImageUtil = {
    compressSignature: (dataUrl, quality = 0.5) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                // 서명 패드 크기 정도로 축소 (최대 너비 400px)
                const scale = Math.min(1, 400 / img.width);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = dataUrl;
        });
    }
};

var AttendanceDB = {
    getAll: () => {
        try {
            const data = JSON.parse(localStorage.getItem(DB_KEY) || '[]');
            return Array.isArray(data) ? data : Object.values(data);
        } catch (e) { return []; }
    },
    getWorkers: () => {
        try {
            const data = JSON.parse(localStorage.getItem(WORKERS_KEY) || '[]');
            return Array.isArray(data) ? data : Object.values(data);
        } catch (e) { return []; }
    },

    saveWorker: async (worker) => {
        const workers = AttendanceDB.getWorkers();

        // 중복 체크 (이름 + 전화번호)
        const phoneDigits = worker.phone.replace(/[^0-9]/g, ''); // 숫자만 추출

        const isDuplicate = workers.some(w => {
            if (w.name !== worker.name) return false;
            const existingPhone = w.phone.replace(/[^0-9]/g, '');
            return existingPhone === phoneDigits;
        });

        if (isDuplicate) {
            throw new Error(`'${worker.name}'님은 이미 등록된 인원입니다.\n전화번호: ${worker.phone}\n\n중복 등록할 수 없습니다.`);
        }

        workers.push({ ...worker, id: Date.now() + Math.random() });
        localStorage.setItem(WORKERS_KEY, JSON.stringify(workers));

        if (SERVER_CONFIG.useServer) {
            await fetch(`${SERVER_CONFIG.databaseURL}/workers.json`, {
                method: 'PUT',
                body: JSON.stringify(workers)
            });
        }
    },

    updateWorker: async (worker) => {
        const workers = AttendanceDB.getWorkers();
        // ID 비교를 위해 둘 다 Number로 변환
        const targetId = Number(worker.id);
        const index = workers.findIndex(w => Number(w.id) === targetId);

        if (index !== -1) {
            // 저장할 때도 ID는 숫자로 유지
            workers[index] = { ...workers[index], ...worker, id: targetId };
            localStorage.setItem(WORKERS_KEY, JSON.stringify(workers));

            if (SERVER_CONFIG.useServer) {
                await fetch(`${SERVER_CONFIG.databaseURL}/workers.json`, {
                    method: 'PUT',
                    body: JSON.stringify(workers)
                });
            }
        }
    },

    getWorkerByName: (name) => {
        return AttendanceDB.getWorkers().find(w => w.name === name);
    },

    // [v2.4.0] 이름+전화번호 뒷4자리로 직원 찾기
    findWorker: (name, phoneLast4) => {
        const workers = AttendanceDB.getWorkers();
        if (!phoneLast4) return workers.find(w => w.name === name); // 기존 호환

        return workers.find(w => {
            if (w.name !== name) return false;
            // DB에 저장된 전화번호에서 숫자만 추출하여 뒷 4자리 비교
            const dbPhone = w.phone.replace(/[^0-9]/g, '');
            const inputBack = phoneLast4.toString().trim();
            if (dbPhone.length < 4) return false; // DB 번호가 너무 짧으면 패스
            return dbPhone.endsWith(inputBack);
        });
    },

    deleteWorker: async (id) => {
        const workers = AttendanceDB.getWorkers();
        const targetId = Number(id);
        const filtered = workers.filter(w => Number(w.id) !== targetId);
        localStorage.setItem(WORKERS_KEY, JSON.stringify(filtered));

        if (SERVER_CONFIG.useServer) {
            await fetch(`${SERVER_CONFIG.databaseURL}/workers.json`, {
                method: 'PUT',
                body: JSON.stringify(filtered)
            });
        }
    },

    // 명단 서버 동기화 (새 PC로 이사 왔을 때 사용)
    syncWorkersWithServer: async () => {
        if (!SERVER_CONFIG.useServer) return;
        try {
            const res = await fetch(`${SERVER_CONFIG.databaseURL}/workers.json`);
            const serverWorkers = await res.json();
            if (serverWorkers) {
                const workersArr = Array.isArray(serverWorkers) ? serverWorkers : Object.values(serverWorkers);
                localStorage.setItem(WORKERS_KEY, JSON.stringify(workersArr));
                return workersArr.length;
            } else {
                // 서버 명단이 null(삭제된 상태)이면 로컬도 비워서 로그인 차단
                localStorage.setItem(WORKERS_KEY, JSON.stringify([]));
            }
        } catch (e) {
            console.error('명단 동기화 실패', e);
        }
        return 0;
    },

    // --- [v2.3.0] 인원 등록 신청 및 승인 프로세스 ---
    getPendingWorkers: () => {
        try {
            const data = JSON.parse(localStorage.getItem('pending_workers') || '[]');
            return Array.isArray(data) ? data : Object.values(data);
        } catch (e) { return []; }
    },

    savePendingWorker: async (worker) => {
        // 1. 기존 등록된 인원과 중복 체크 (이름 + 전화번호)
        const existingWorkers = AttendanceDB.getWorkers();
        const phoneDigits = worker.phone.replace(/[^0-9]/g, ''); // 숫자만 추출

        const isDuplicateWorker = existingWorkers.some(w => {
            if (w.name !== worker.name) return false;
            const existingPhone = w.phone.replace(/[^0-9]/g, '');
            return existingPhone === phoneDigits;
        });

        if (isDuplicateWorker) {
            throw new Error(`'${worker.name}'님은 이미 등록된 인원입니다.\n전화번호: ${worker.phone}\n\n관리자에게 문의하세요.`);
        }

        // 2. 승인 대기 중인 인원과 중복 체크 (이름 + 전화번호)
        const pending = AttendanceDB.getPendingWorkers();

        const isDuplicatePending = pending.some(p => {
            if (p.name !== worker.name) return false;
            const pendingPhone = p.phone.replace(/[^0-9]/g, '');
            return pendingPhone === phoneDigits;
        });

        if (isDuplicatePending) {
            throw new Error(`'${worker.name}'님은 이미 등록 신청을 하셨습니다.\n전화번호: ${worker.phone}\n\n관리자 승인을 기다려주세요.`);
        }

        // 3. 중복이 없으면 저장
        const newWorker = { ...worker, id: Date.now() + Math.random(), timestamp: new Date().toISOString() };
        pending.push(newWorker);
        localStorage.setItem('pending_workers', JSON.stringify(pending));

        if (SERVER_CONFIG.useServer) {
            await fetch(`${SERVER_CONFIG.databaseURL}/pending_workers.json`, {
                method: 'PUT',
                body: JSON.stringify(pending)
            });
        }
    },

    deletePendingWorker: async (id) => {
        const pending = AttendanceDB.getPendingWorkers();
        const targetId = Number(id);
        const filtered = pending.filter(w => Number(w.id) !== targetId);
        localStorage.setItem('pending_workers', JSON.stringify(filtered));

        if (SERVER_CONFIG.useServer) {
            await fetch(`${SERVER_CONFIG.databaseURL}/pending_workers.json`, {
                method: 'PUT',
                body: JSON.stringify(filtered)
            });
        }
    },

    syncPendingWithServer: async () => {
        if (!SERVER_CONFIG.useServer) return [];
        try {
            const res = await fetch(`${SERVER_CONFIG.databaseURL}/pending_workers.json`);
            const data = await res.json();
            if (data) {
                const arr = Array.isArray(data) ? data : Object.values(data);
                localStorage.setItem('pending_workers', JSON.stringify(arr));
                return arr;
            }
        } catch (e) {
            console.error('대기 명단 동기화 실패', e);
        }
        return [];
    },

    // [검증 함수] 이미 제출했는지, 등록된 사람인지 확인
    validateSubmission: async (name, month) => {
        if (!SERVER_CONFIG.useServer) return { valid: true }; // 서버 없으면 패스

        try {
            // 1. 등록된 인원인지 확인
            const wRes = await fetch(`${SERVER_CONFIG.databaseURL}/workers.json`);
            const serverData = await wRes.json() || [];
            const workers = Array.isArray(serverData) ? serverData : Object.values(serverData);

            // 등록된 이름이 하나라도 있으면 체크 시작 (아직 명단이 없으면 모두 허용)
            if (workers.length > 0) {
                const isRegistered = workers.some(w => w.name === name);
                if (!isRegistered) {
                    return { valid: false, message: `'${name}'님은 등록된 직원이 아닙니다.\n관리자에게 문의해주세요.` };
                }
            }

            // 2. 이미 제출했는지 확인 (중복 체크)
            const fiscalYear = FiscalYearUtil.getYearFromDate(`${month}-01`);
            const rRes = await fetch(`${SERVER_CONFIG.databaseURL}/records/${fiscalYear}.json`);
            const recordsMap = await rRes.json() || {};
            const records = Object.values(recordsMap);

            // 해당 이름으로, 해당 월(YYYY-MM)에 시작하는 데이터가 있는지 확인
            const isDuplicate = records.some(r => r.name === name && r.date.startsWith(month));

            if (isDuplicate) {
                return { valid: false, message: `이미 ${month}월 출근부를 제출하셨습니다.\n수정이 필요하면 관리자에게 요청하세요.` };
            }

            return { valid: true };

        } catch (e) {
            console.error(e);
            return { valid: true }; // 에러 나면 일단 허용 (네트워크 문제 등)
        }
    },

    save: async (data) => {
        const current = AttendanceDB.getAll();
        current.push(data);
        localStorage.setItem(DB_KEY, JSON.stringify(current));

        if (SERVER_CONFIG.useServer && SERVER_CONFIG.databaseURL) {
            const fiscalYear = FiscalYearUtil.getYearFromDate(data.date);
            await fetch(`${SERVER_CONFIG.databaseURL}/records/${fiscalYear}.json`, {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }
    },

    saveBulk: async (newDataArray, skipServer = false) => {
        const current = AttendanceDB.getAll();
        const updated = [...current, ...newDataArray];
        localStorage.setItem(DB_KEY, JSON.stringify(updated));

        if (!skipServer && SERVER_CONFIG.useServer && SERVER_CONFIG.databaseURL) {
            for (const data of newDataArray) {
                const fiscalYear = FiscalYearUtil.getYearFromDate(data.date);
                await fetch(`${SERVER_CONFIG.databaseURL}/records/${fiscalYear}.json`, {
                    method: 'POST',
                    body: JSON.stringify(data)
                });
            }
        }
    },

    // 서버에서 데이터를 긁어와서 내 컴퓨터와 합치는 기능
    syncWithServer: async (fiscalYear = null) => {
        if (!SERVER_CONFIG.useServer || !SERVER_CONFIG.databaseURL) return { success: false, count: 0 };
        const fy = fiscalYear || FiscalYearUtil.getCurrentYear();

        try {
            const response = await fetch(`${SERVER_CONFIG.databaseURL}/records/${fy}.json`);
            const serverData = await response.json();
            if (!serverData) return { success: true, count: 0 };

            const current = AttendanceDB.getAll();
            const currentIds = new Set(current.map(r => r.id));

            const newRecords = [];
            Object.values(serverData).forEach(record => {
                if (!currentIds.has(record.id)) {
                    newRecords.push(record);
                }
            });

            if (newRecords.length > 0) {
                await AttendanceDB.saveBulk(newRecords, true);
            }
            return { success: true, count: newRecords.length };
        } catch (e) {
            console.error('서버 동기화 실패:', e);
            return { success: false, count: 0 };
        }
    },

    clear: async (fiscalYear = null) => {
        localStorage.removeItem(DB_KEY);
        if (SERVER_CONFIG.useServer) {
            try {
                const fy = fiscalYear || FiscalYearUtil.getCurrentYear();
                await fetch(`${SERVER_CONFIG.databaseURL}/records/${fy}.json`, { method: 'DELETE' });
            } catch (e) {
                console.error('서버 데이터 초기화 실패:', e);
                alert('서버 데이터 초기화에 실패했습니다.');
            }
        }
    },

    // 특정 직원의 특정 월 출근 기록 삭제
    deleteWorkerMonth: async (name, month) => {
        // 1. 로컬 삭제
        const current = AttendanceDB.getAll();
        const filtered = current.filter(r => !(r.name === name && r.date && r.date.startsWith(month)));
        localStorage.setItem(DB_KEY, JSON.stringify(filtered));

        // 2. Firebase 삭제: 회기년도 전체 읽기 → 해당 기록 제거 → PUT 덮어쓰기
        if (SERVER_CONFIG.useServer && SERVER_CONFIG.databaseURL) {
            const fy = FiscalYearUtil.getYearFromDate(month + '-01');
            const res = await fetch(`${SERVER_CONFIG.databaseURL}/records/${fy}.json`);
            const serverData = await res.json();
            if (serverData) {
                const updated = {};
                Object.entries(serverData).forEach(([key, record]) => {
                    if (!(record.name === name && record.date && record.date.startsWith(month))) {
                        updated[key] = record;
                    }
                });
                await fetch(`${SERVER_CONFIG.databaseURL}/records/${fy}.json`, {
                    method: 'PUT',
                    body: JSON.stringify(Object.keys(updated).length > 0 ? updated : null)
                });
            }
        }
    },

    clearWorkers: async () => {
        localStorage.removeItem(WORKERS_KEY);
        if (SERVER_CONFIG.useServer) {
            try {
                await fetch(`${SERVER_CONFIG.databaseURL}/workers.json`, { method: 'DELETE' });
            } catch (e) {
                console.error('서버 인원 초기화 실패:', e);
                alert('서버 인원 정보 초기화에 실패했습니다.');
            }
        }
    },

    getPassword: () => localStorage.getItem('admin_password') || '1234',
    savePassword: (pw) => {
        localStorage.setItem('admin_password', pw);
        AttendanceDB.saveSettingsToServer();
    },

    // FCM Token 관리
    saveFCMToken: async (workerName, token) => {
        if (!SERVER_CONFIG.useServer) return;
        try {
            await fetch(`${SERVER_CONFIG.databaseURL}/fcmTokens/${encodeURIComponent(workerName)}.json`, {
                method: 'PUT',
                body: JSON.stringify(token)
            });
        } catch (error) {
            console.error('FCM token save error:', error);
        }
    },

    getFCMToken: async (workerName) => {
        if (!SERVER_CONFIG.useServer) return null;
        try {
            const response = await fetch(`${SERVER_CONFIG.databaseURL}/fcmTokens/${encodeURIComponent(workerName)}.json`);
            return await response.json();
        } catch (error) {
            console.error('FCM token get error:', error);
            return null;
        }
    },

    // 알림 관리
    saveNotification: async (workerName, notification) => {
        if (!SERVER_CONFIG.useServer) return;
        try {
            const notificationId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            await fetch(`${SERVER_CONFIG.databaseURL}/notifications/${encodeURIComponent(workerName)}/${notificationId}.json`, {
                method: 'PUT',
                body: JSON.stringify({
                    ...notification,
                    id: notificationId,
                    timestamp: new Date().toISOString(),
                    read: false
                })
            });
        } catch (error) {
            console.error('Notification save error:', error);
        }
    },

    getNotifications: async (workerName) => {
        if (!SERVER_CONFIG.useServer) return [];
        try {
            const response = await fetch(`${SERVER_CONFIG.databaseURL}/notifications/${encodeURIComponent(workerName)}.json`);
            const data = await response.json();
            return data ? Object.values(data) : [];
        } catch (error) {
            console.error('Notification get error:', error);
            return [];
        }
    },

    markNotificationAsRead: async (workerName, notificationId) => {
        if (!SERVER_CONFIG.useServer) return;
        try {
            await fetch(`${SERVER_CONFIG.databaseURL}/notifications/${encodeURIComponent(workerName)}/${notificationId}/read.json`, {
                method: 'PUT',
                body: JSON.stringify(true)
            });
        } catch (error) {
            console.error('Mark notification as read error:', error);
        }
    },

    deleteAllNotifications: async (workerName) => {
        if (!SERVER_CONFIG.useServer) return;
        try {
            await fetch(`${SERVER_CONFIG.databaseURL}/notifications/${encodeURIComponent(workerName)}.json`, {
                method: 'DELETE'
            });
        } catch (error) {
            console.error('Delete all notifications error:', error);
        }
    },

    getAppTitle: () => localStorage.getItem('app_title') || '프리미엄 근태 관리',
    saveAppTitle: (title) => {
        const value = title || '프리미엄 근태 관리';
        localStorage.setItem('app_title', value);
        AttendanceDB.saveSettingsToServer();
    },

    getAppLogo: () => localStorage.getItem('app_logo') || null,
    saveAppLogo: (logoData) => {
        localStorage.setItem('app_logo', logoData || '');
        AttendanceDB.saveSettingsToServer();
    },

    getAutoLogoutTime: () => parseInt(localStorage.getItem('auto_logout_time')) || 10,
    saveAutoLogoutTime: (minutes) => {
        localStorage.setItem('auto_logout_time', minutes);
        AttendanceDB.saveSettingsToServer();
    },

    getDeadline: () => localStorage.getItem('submission_deadline') || '매월 5일',
    saveDeadline: (deadline) => {
        localStorage.setItem('submission_deadline', deadline);
        AttendanceDB.saveSettingsToServer();
    },

    // --- 방학 설정 관련 추가 (v1.7) ---
    getVacations: () => {
        const defaults = { sStart: '', sEnd: '', wStart: '', wEnd: '', pStart: '', pEnd: '' };
        try {
            return JSON.parse(localStorage.getItem('vacation_settings')) || defaults;
        } catch (e) { return defaults; }
    },
    saveVacations: (vacations) => {
        localStorage.setItem('vacation_settings', JSON.stringify(vacations));
        AttendanceDB.saveSettingsToServer();
    },

    // --- 방학 중 출근일 설정 관련 추가 (v1.8.6) ---
    getVacationWorkingDays: () => {
        try {
            return JSON.parse(localStorage.getItem('vacation_working_days') || '[]');
        } catch (e) { return []; }
    },
    saveVacationWorkingDays: (days) => {
        localStorage.setItem('vacation_working_days', JSON.stringify(days));
        AttendanceDB.saveSettingsToServer();
    },

    isInVacation: (dateStr) => {
        const v = AttendanceDB.getVacations();
        if (v.sStart && v.sEnd && dateStr >= v.sStart && dateStr <= v.sEnd) return true;
        if (v.wStart && v.wEnd && dateStr >= v.wStart && dateStr <= v.wEnd) return true;
        if (v.pStart && v.pEnd && dateStr >= v.pStart && dateStr <= v.pEnd) return true;
        return false;
    },

    saveSettingsToServer: async () => {
        if (!SERVER_CONFIG.useServer || !SERVER_CONFIG.databaseURL) return;
        const settings = {
            admin_password: AttendanceDB.getPassword(),
            app_title: AttendanceDB.getAppTitle(),
            app_logo: AttendanceDB.getAppLogo(),
            auto_logout_time: AttendanceDB.getAutoLogoutTime(),
            submission_deadline: AttendanceDB.getDeadline(),
            vacations: AttendanceDB.getVacations(), // 방학 설정 포함
            vacation_working_days: AttendanceDB.getVacationWorkingDays(), // 방학 중 출근일 포함
            app_notice: AttendanceDB.getNotice() // [v2.2.0] 공지사항 포함
        };
        try {
            await fetch(`${SERVER_CONFIG.databaseURL}/settings.json`, {
                method: 'PUT',
                body: JSON.stringify(settings)
            });
        } catch (e) {
            console.error('설정 서버 저장 실패:', e);
        }
    },

    syncSettingsWithServer: async () => {
        if (!SERVER_CONFIG.useServer || !SERVER_CONFIG.databaseURL) return;
        try {
            const response = await fetch(`${SERVER_CONFIG.databaseURL}/settings.json`);
            const s = await response.json();
            if (s) {
                if (s.admin_password) localStorage.setItem('admin_password', s.admin_password);
                if (s.app_title) localStorage.setItem('app_title', s.app_title);
                if (s.app_logo) localStorage.setItem('app_logo', s.app_logo);
                if (s.auto_logout_time) localStorage.setItem('auto_logout_time', s.auto_logout_time);
                if (s.submission_deadline) localStorage.setItem('submission_deadline', s.submission_deadline);
                if (s.vacations) localStorage.setItem('vacation_settings', JSON.stringify(s.vacations)); // 방학 설정 동기화
                if (s.vacation_working_days) localStorage.setItem('vacation_working_days', JSON.stringify(s.vacation_working_days)); // 방학 중 출근일 동기화
                if (s.app_notice) localStorage.setItem('app_notice', s.app_notice); // [v2.2.0] 공지사항 동기화
            }
        } catch (e) {
            console.error('설정 서버 동기화 실패:', e);
        }
    },

    getStats: () => {
        const data = AttendanceDB.getAll();
        const today = new Date().toISOString().split('T')[0];
        return {
            total: data.length,
            today: data.filter(d => d.date === today).length,
            uniqueWorkers: new Set(data.map(d => d.name)).size
        };
    },

    // [v1.8.9] 소리 설정 관리
    getSoundEnabled: () => {
        return localStorage.getItem('sound_enabled') !== 'false'; // 기본값 true
    },
    saveSoundEnabled: (enabled) => {
        localStorage.setItem('sound_enabled', enabled);
    },

    // --- [v2.2.0] 공지사항 관리 ---
    getNotice: () => localStorage.getItem('app_notice') || '',
    saveNotice: (notice) => {
        localStorage.setItem('app_notice', notice);
        AttendanceDB.saveSettingsToServer();
    }
};

var HolidayUtil = {
    // 양력 고정 휴일
    fixedHolidays: {
        '01-01': '신정',
        '03-01': '삼일절',
        '05-05': '어린이날',
        '06-06': '현충일',
        '08-15': '광복절',
        '10-03': '개천절',
        '10-09': '한글날',
        '12-25': '성탄절'
    },

    // 음력 및 변동 휴일
    dynamicHolidays: {
        // 2025년
        '2025-01-28': '설날', '2025-01-29': '설날', '2025-01-30': '설날',
        '2025-03-03': '대체공휴일',
        '2025-05-06': '대체공휴일',
        '2025-10-05': '추석', '2025-10-06': '추석', '2025-10-07': '추석', '2025-10-08': '대체공휴일',

        // 2026년
        '2026-02-16': '설날', '2026-02-17': '설날', '2026-02-18': '설날',
        '2026-03-02': '대체공휴일',
        '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일',
        '2026-08-17': '대체공휴일',
        '2026-09-24': '추석', '2026-09-25': '추석', '2026-09-26': '추석',
        '2026-10-05': '대체공휴일',

        // 2027년
        '2027-02-06': '설날', '2027-02-07': '설날', '2027-02-08': '설날', '2027-02-09': '대체공휴일',
        '2027-05-13': '부처님오신날',
        '2027-08-16': '대체공휴일',
        '2027-09-14': '추석', '2027-09-15': '추석', '2027-09-16': '추석',
        '2027-10-04': '대체공휴일',

        // 2028년
        '2028-01-26': '설날', '2028-01-27': '설날', '2028-01-28': '설날',
        '2028-05-02': '부처님오신날',
        '2028-10-02': '추석', '2028-10-03': '추석', '2028-10-04': '추석', '2028-10-05': '대체공휴일',

        // 2029년
        '2029-02-12': '대체공휴일', '2029-02-13': '설날', '2029-02-14': '설날', '2029-02-15': '설날',
        '2029-09-21': '추석', '2029-09-22': '추석', '2029-09-23': '추석', '2029-09-24': '대체공휴일',

        // 2030년
        '2030-02-02': '설날', '2030-02-03': '설날', '2030-02-04': '설날', '2030-02-05': '대체공휴일',
        '2030-09-11': '추석', '2030-09-12': '추석', '2030-09-13': '추석'
    },

    // 사용자 정의 휴일 { 'YYYY-MM-DD': '명칭' }
    customHolidays: {},

    init: async () => {
        // 1. 로컬 로드
        let local = JSON.parse(localStorage.getItem('custom_holidays') || '{}');

        // [마이그레이션] 기존 배열 데이터(Set -> Array)가 있다면 객체로 변환
        if (Array.isArray(local)) {
            const converted = {};
            local.forEach(d => converted[d] = '지정 휴일');
            local = converted;
            localStorage.setItem('custom_holidays', JSON.stringify(local));
        }
        HolidayUtil.customHolidays = local;

        // 2. 서버 로드 (서버 데이터를 신뢰하여 완전 교체)
        if (SERVER_CONFIG.useServer) {
            try {
                const res = await fetch(`${SERVER_CONFIG.databaseURL}/holidays.json`);
                const serverData = await res.json();
                // serverData가 null이면 서버에 휴일이 없음 → 빈 객체로 초기화
                var incoming = serverData || {};
                if (Array.isArray(incoming)) {
                    var converted = {};
                    incoming.forEach(d => converted[d] = '지정 휴일');
                    incoming = converted;
                }

                // 서버 데이터로 완전 교체 (서버가 진실의 원천)
                HolidayUtil.customHolidays = incoming;

                // 로컬 업데이트
                localStorage.setItem('custom_holidays', JSON.stringify(incoming));
            } catch (e) {
                console.error('휴일 데이터 동기화 실패', e);
            }
        }
    },

    saveCustom: async () => {
        const data = HolidayUtil.customHolidays; // Object
        localStorage.setItem('custom_holidays', JSON.stringify(data));

        if (SERVER_CONFIG.useServer) {
            try {
                // 객체 형태 그대로 저장
                await fetch(`${SERVER_CONFIG.databaseURL}/holidays.json`, {
                    method: 'PUT',
                    body: JSON.stringify(data)
                });
            } catch (e) {
                console.error('휴일 서버 저장 실패', e);
            }
        }
    },

    // 휴일 설정 (추가/수정/삭제)
    setCustom: async (dateStr, name) => {
        if (!name) {
            // 이름 없으면 삭제
            delete HolidayUtil.customHolidays[dateStr];
        } else {
            // 추가 또는 수정
            HolidayUtil.customHolidays[dateStr] = name;
        }
        await HolidayUtil.saveCustom();
    },

    getHolidayName: (dateStr) => {
        // 1. 변동/음력 (설날, 추석 등)
        if (HolidayUtil.dynamicHolidays[dateStr]) return HolidayUtil.dynamicHolidays[dateStr];
        // 2. 고정 (신정, 삼일절 등)
        const md = dateStr.substring(5);
        if (HolidayUtil.fixedHolidays[md]) return HolidayUtil.fixedHolidays[md];
        // 3. 커스텀 (사용자 지정)
        if (HolidayUtil.customHolidays[dateStr]) return HolidayUtil.customHolidays[dateStr];

        return null;
    },

    isHoliday: (dateStr) => {
        return !!HolidayUtil.getHolidayName(dateStr);
    }
};

// 앱 시작 시 휴일 데이터 로드
HolidayUtil.init();

// --- [v1.8.9] 오디오 알림 유틸리티 (Web Audio API 기반) ---
var AudioUtil = {
    ctx: null,

    init: () => {
        if (!AudioUtil.ctx) {
            AudioUtil.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },

    play: (freq, type = 'sine', duration = 0.2, vol = 0.1) => {
        if (!AttendanceDB.getSoundEnabled()) return;
        try {
            AudioUtil.init();
            const osc = AudioUtil.ctx.createOscillator();
            const gain = AudioUtil.ctx.createGain();

            osc.type = type;
            osc.frequency.setValueAtTime(freq, AudioUtil.ctx.currentTime);

            gain.gain.setValueAtTime(vol, AudioUtil.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, AudioUtil.ctx.currentTime + duration);

            osc.connect(gain);
            gain.connect(AudioUtil.ctx.destination);

            osc.start();
            osc.stop(AudioUtil.ctx.currentTime + duration);
        } catch (e) { console.warn('Audio play failed', e); }
    },

    // 성공 알림 (청아한 소리)
    playSuccess: () => {
        AudioUtil.play(880, 'sine', 0.3, 0.1); // A5
        setTimeout(() => AudioUtil.play(1108.73, 'sine', 0.4, 0.1), 100); // C#6
    },

    // 오류 알림 (둔탁한 경고음)
    playError: () => {
        AudioUtil.play(220, 'square', 0.2, 0.05); // A3
    },

    // 정보 알림 (부드러운 알림)
    playInfo: () => {
        AudioUtil.play(440, 'sine', 0.2, 0.1); // A4
    }
};

// --- [v1.9.0] Excel 처리 유틸리티 (xlsx 라이브러리 필요) ---
var ExcelUtil = {
    // 1. 직원 명단 Excel 내보내기 (다운로드)
    exportWorkers: () => {
        try {
            const workers = AttendanceDB.getWorkers();
            if (workers.length === 0) return alert('내보낼 인원이 없습니다.');

            // 데이터 가공 (ID 제외 등)
            const exportData = workers.map(w => ({
                '성명': w.name,
                '전화번호': w.phone,
                '근무형태': w.workType,
                '주소': w.address,
                '상세주소': w.addressDetail || '',
                '비고': w.note || '',
                '계약시작일': w.contractStartDate || '',
                '계약종료일': w.contractEndDate || '',
                '출근시간': w.workTime || '',
                '퇴근시간': w.endTime || ''
            }));

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(exportData);
            XLSX.utils.book_append_sheet(wb, ws, "인원명단");

            const now = new Date().toISOString().split('T')[0];
            XLSX.writeFile(wb, `명단_${now}.xlsx`);
            AudioUtil.playSuccess();
        } catch (e) {
            console.error('Excel Export Error:', e);
            AudioUtil.playError();
            alert('Excel 파일 생성 중 오류가 발생했습니다.');
        }
    },

    // 2. 직원 명단 Excel 가져오기 (업로드)
    importWorkers: (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const sheet = workbook.Sheets[sheetName];
                    const json = XLSX.utils.sheet_to_json(sheet);

                    if (json.length === 0) {
                        alert('가져올 데이터가 없습니다.');
                        return resolve(0);
                    }

                    const newWorkers = json.map(row => {
                        const workType = row['근무형태'] || row['구분'] || '상시근무';
                        const isRegular = (workType === '상시(방학비근무)' || workType === '상시근무');

                        return {
                            id: Date.now() + Math.random(),
                            name: String(row['성명'] || row['이름'] || '').trim(),
                            phone: String(row['전화번호'] || row['연락처'] || '').trim(),
                            type: workType,
                            workType: workType,
                            address: row['주소'] || '',
                            addressDetail: row['상세주소'] || '',
                            note: row['비고'] || '',
                            contractStartDate: isRegular ? '' : (row['계약시작일'] || ''),
                            contractEndDate: isRegular ? '' : (row['계약종료일'] || ''),
                            workTime: isRegular ? '' : (row['출근시간'] || ''),
                            endTime: isRegular ? '' : (row['퇴근시간'] || ''),
                            workDays: isRegular ? [] : [1, 2, 3, 4, 5] // 기본 월~금
                        };
                    }).filter(w => w.name);

                    if (confirm(`${newWorkers.length}명의 인원 정보를 새로 등록하시겠습니까?\n(기존 명단에 추가됩니다)`)) {
                        const current = AttendanceDB.getWorkers();
                        const updated = [...current, ...newWorkers];
                        localStorage.setItem(WORKERS_KEY, JSON.stringify(updated));

                        if (SERVER_CONFIG.useServer) {
                            await fetch(`${SERVER_CONFIG.databaseURL}/workers.json`, {
                                method: 'PUT',
                                body: JSON.stringify(updated)
                            });
                        }
                        AudioUtil.playSuccess();
                        resolve(newWorkers.length);
                    } else {
                        resolve(0);
                    }
                } catch (e) {
                    console.error('Excel Import Error:', e);
                    AudioUtil.playError();
                    alert('Excel 파일 분석 중 오류가 발생했습니다.');
                    reject(e);
                }
            };
            reader.readAsArrayBuffer(file);
        });
    },

    // 3. [v2.0.0] 전체 출근 기록 Excel 내보내기 (백업용)
    exportAllData: () => {
        try {
            const data = AttendanceDB.getAll();
            if (data.length === 0) return alert('내보낼 데이터가 없습니다.');

            // 날짜 내림차순 정렬
            data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            const exportData = data.map(r => {
                const dateObj = new Date(r.date);
                return {
                    '성명': r.name,
                    '날짜': r.date,
                    '연도': dateObj.getFullYear(),
                    '월': dateObj.getMonth() + 1,
                    '일': dateObj.getDate(),
                    '제출일시': new Date(r.timestamp).toLocaleString(),
                    '요일': ['일', '월', '화', '수', '목', '금', '토'][dateObj.getDay()]
                };
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(exportData);

            // 컬럼 너비 자동 조정
            const wscols = [
                { wch: 10 }, { wch: 12 }, { wch: 6 }, { wch: 4 }, { wch: 4 }, { wch: 22 }, { wch: 4 }
            ];
            ws['!cols'] = wscols;

            XLSX.utils.book_append_sheet(wb, ws, "전체출근기록");

            const now = new Date().toISOString().split('T')[0];
            XLSX.writeFile(wb, `출근부_전체백업_${now}.xlsx`);
            AudioUtil.playSuccess();
        } catch (e) {
            console.error('Full Data Export Error:', e);
            AudioUtil.playError();
            alert('백업 파일 생성 중 오류가 발생했습니다.');
        }
    }
};
var AutoBackupSystem = {
    // 회기 변경 감지 및 알림
    checkSeasonChange: () => {
        const lastCheck = localStorage.getItem('last_backup_check_date');
        const today = new Date().toISOString().split('T')[0];

        // 하루에 한 번만 체크
        if (lastCheck === today) return null;

        const currentFiscalYear = FiscalYearUtil.getCurrentYear();
        const storedFiscalYear = parseInt(localStorage.getItem('current_fiscal_year') || '0');

        // 최초 실행이거나, 저장된 회기년도가 현재와 다르면 (해가 바뀌었으면)
        if (storedFiscalYear !== 0 && storedFiscalYear < currentFiscalYear) {
            return {
                type: 'SEASON_CHANGE',
                prevYear: storedFiscalYear,
                newYear: currentFiscalYear,
                message: isMobile()
                    ? `[${currentFiscalYear}년도]가 시작되었습니다.\n지난 해(${storedFiscalYear}년) 데이터를 백업하고\n앱을 최적화하시겠습니까?`
                    : `새로운 회기년도(${currentFiscalYear}년)가 시작되었습니다.\n\n[데이터 최적화 권장]\n지난 ${storedFiscalYear}년도 데이터를 엑셀로 백업 후,\n앱 내 저장소를 비워 속도를 향상시킬 수 있습니다.\n\n지금 진행하시겠습니까?`
            };
        }

        // 현재 회기년도 갱신
        localStorage.setItem('current_fiscal_year', currentFiscalYear);
        localStorage.setItem('last_backup_check_date', today);
        return null;
    },

    // 아카이빙 실행 (엑셀 저장 -> 로컬 초기화 -> 현재 연도 설정)
    performArchive: async () => {
        try {
            // 1. 엑셀 백업
            await new Promise(resolve => setTimeout(resolve, 500)); // UI 렌더링 대기
            ExcelUtil.exportAllData(); // 전체 데이터 내보내기 (함수 추가 필요)

            // 2. 중요 데이터 보존 (직원 명단, 설정 등)
            const workers = localStorage.getItem(WORKERS_KEY);
            const settings = {
                pw: localStorage.getItem('admin_password'),
                title: localStorage.getItem('app_title'),
                logo: localStorage.getItem('app_logo'),
                logout: localStorage.getItem('auto_logout_time'),
                deadline: localStorage.getItem('submission_deadline'),
                vacations: localStorage.getItem('vacation_settings'),
                vacationWork: localStorage.getItem('vacation_working_days'),
                notice: localStorage.getItem('app_notice')
            };

            // 3. 로컬 데이터 초기화 (출근 기록만 날림)
            // localStorage.clear()는 모든 설정을 날려버리므로 위험합니다.
            // 대신 출근 기록 키만 삭제합니다.
            localStorage.removeItem(DB_KEY);

            // 4. 회기 설정 갱신
            localStorage.setItem('current_fiscal_year', FiscalYearUtil.getCurrentYear());
            localStorage.setItem('last_backup_check_date', new Date().toISOString().split('T')[0]);

            return true;
        } catch (e) {
            console.error('Archive failed', e);
            throw e;
        }
    },

    // Password management
    getPassword: () => {
        const pwd = localStorage.getItem(PASSWORD_KEY);
        return pwd || DEFAULT_PASSWORD; // Return default if not set
    },

    savePassword: (newPassword) => {
        localStorage.setItem(PASSWORD_KEY, newPassword);
    },

    // App settings
    getAppTitle: () => localStorage.getItem('app_title') || 'AttendanceMaster',
    saveAppTitle: (title) => localStorage.setItem('app_title', title),

    getAppLogo: () => localStorage.getItem('app_logo') || '',
    saveAppLogo: (logo) => localStorage.setItem('app_logo', logo),

    getAutoLogoutTime: () => parseInt(localStorage.getItem('auto_logout_time') || '60'),
    saveAutoLogoutTime: (minutes) => localStorage.setItem('auto_logout_time', minutes.toString()),

    getDeadline: () => localStorage.getItem('submission_deadline') || '매월 5일',
    saveDeadline: (deadline) => localStorage.setItem('submission_deadline', deadline),

    getNotice: () => localStorage.getItem('app_notice') || '',
    saveNotice: (notice) => localStorage.setItem('app_notice', notice),

    getSoundEnabled: () => localStorage.getItem('sound_enabled') !== 'false',
    saveSoundEnabled: (enabled) => localStorage.setItem('sound_enabled', enabled.toString())
};

function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// ==========================================
// V2 NEW FEATURES (Deadline, History, Realtime)
// ==========================================

function showToast(msg) {
    const toast = document.getElementById('systemToast');
    if (!toast) return;
    document.getElementById('toastMsg').innerText = msg;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 1. Deadline Banner Logic (Worker)
window.renderDeadlineBanner = function(workerName) {
    const bannerArea = document.getElementById('deadlineBannerArea');
    if (!bannerArea) return;
    
    // Get current month
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const yyyyMm = `${year}-${month}`;
    
    // Check if submitted
    const records = AttendanceDB.getAll();
    const submitted = records.some(r => r.name === workerName && r.date.startsWith(yyyyMm));

    let bannerHtml = '';
    
    if (submitted) {
        bannerHtml = `
            <div class="deadline-banner deadline-ok fade-in">
                <div class="deadline-icon">✅</div>
                <div class="deadline-text">
                    <strong>이번 달 출근부 제출 완료</strong>
                    <span>정상적으로 접수되었습니다.</span>
                </div>
            </div>`;
    } else {
        const nextMonth = new Date(year, now.getMonth() + 1, 5);
        const diffTime = nextMonth - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays <= 5) {
            bannerHtml = `
                <div class="deadline-banner deadline-urgent fade-in">
                    <div class="deadline-icon">🚨</div>
                    <div class="deadline-text">
                        <strong>제출 마감 임박!</strong>
                        <span>이번 달 출근부를 서둘러 제출해주세요.</span>
                    </div>
                    <div class="deadline-badge badge-red">D-${diffDays}</div>
                </div>`;
        } else {
            bannerHtml = `
                <div class="deadline-banner deadline-warn fade-in">
                    <div class="deadline-icon">⚠️</div>
                    <div class="deadline-text">
                        <strong>출근부 미제출 상태</strong>
                        <span>잊지 말고 제출을 완료해주세요.</span>
                    </div>
                    <div class="deadline-badge badge-yellow">D-${diffDays}</div>
                </div>`;
        }
    }
    
    bannerArea.innerHTML = bannerHtml;
    bannerArea.style.display = 'block';
};

// 2. My Attendance History (Worker)
window.openHistorySheet = function() {
    const panel = document.getElementById('historyPanel');
    const content = document.getElementById('historyContentArea');
    const workerName = document.getElementById('workerName').value;
    
    if (!workerName) {
        showToast('먼저 로그인해주세요.');
        return;
    }
    
    const records = AttendanceDB.getAll().filter(r => r.name === workerName);
    
    // Group records by month
    const grouped = {};
    records.forEach(r => {
        const month = r.date.substring(0, 7); // YYYY-MM
        if (!grouped[month]) grouped[month] = [];
        grouped[month].push(r);
    });
    
    const months = Object.keys(grouped).sort((a,b) => b.localeCompare(a));
    
    if (months.length === 0) {
        content.innerHTML = '<div style="text-align:center; padding: 2rem 0; color:var(--text-muted);">제출 기록이 없습니다.</div>';
    } else {
        let html = '';
        months.forEach(m => {
            const arr = grouped[m];
            const [y, mo] = m.split('-');
            const totalDays = arr.reduce((sum, r) => sum + (r.workDays ? r.workDays.length : 0), 0);
            
            html += `
                <div class="month-card" onclick="toggleMiniCal('${m}', '${workerName}')">
                    <div class="month-icon">📅</div>
                    <div class="info">
                        <div class="month-label">${y}년 ${parseInt(mo)}월</div>
                        <div class="days-count">${totalDays}<span>일 출근</span></div>
                    </div>
                    <div class="month-chip chip-done">제출 완료</div>
                </div>
                <div id="miniCal_${m}" style="display:none; margin-bottom: 1rem; padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 12px;"></div>
            `;
        });
        content.innerHTML = html;
    }
    
    panel.classList.add('open');
};

window.toggleMiniCal = function(yyyyMm, workerName) {
    const el = document.getElementById('miniCal_' + yyyyMm);
    if (el.style.display === 'block') {
        el.style.display = 'none';
        return;
    }
    
    // Generate Mini Calendar
    const [year, month] = yyyyMm.split('-');
    const records = AttendanceDB.getAll().filter(r => r.name === workerName && r.date.startsWith(yyyyMm));
    
    // Collect all worked days
    const workedDays = new Set();
    records.forEach(r => {
        if (r.workDays) {
            r.workDays.forEach(d => workedDays.add(d));
        } else if (r.date) {
            workedDays.add(parseInt(r.date.split('-')[2]));
        }
    });
    
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayStr = `${yyyyMm}-01`;
    const firstDayIndex = new Date(firstDayStr).getDay();
    
    let calHtml = '<div class="mini-cal"><div class="mini-cal-head">일</div><div class="mini-cal-head">월</div><div class="mini-cal-head">화</div><div class="mini-cal-head">수</div><div class="mini-cal-head">목</div><div class="mini-cal-head">금</div><div class="mini-cal-head">토</div>';
    
    for (let i = 0; i < firstDayIndex; i++) {
        calHtml += '<div class="mini-cal-day off"></div>';
    }
    
    for (let d = 1; d <= daysInMonth; d++) {
        const currentStr = `${yyyyMm}-${String(d).padStart(2, '0')}`;
        const isHoliday = HolidayUtil.isHoliday(currentStr);
        const isWorked = workedDays.has(d);
        const dayIdx = new Date(currentStr).getDay();
        
        let classes = 'mini-cal-day';
        if (isWorked) classes += ' worked';
        else if (isHoliday) classes += ' holiday';
        else if (dayIdx === 0) classes += ' sun';
        else if (dayIdx === 6) classes += ' sat';
        else classes += ' off';
        
        calHtml += `<div class="${classes}">${d}</div>`;
    }
    calHtml += '</div>';
    
    el.innerHTML = calHtml;
    el.style.display = 'block';
};

// 3. Realtime Status (Admin)
window.renderRealtimeStatus = async function() {
    const ringCircle = document.getElementById('rtRingCircle');
    const ringNum = document.getElementById('rtRingNum');
    const ringTotal = document.getElementById('rtRingTotal');
    const ringDesc = document.getElementById('rtRingDesc');
    const doneGrid = document.getElementById('rtDoneGrid');
    const pendingGrid = document.getElementById('rtPendingGrid');
    const doneCount = document.getElementById('rtDoneCount');
    const pendingCount = document.getElementById('rtPendingCount');
    const alertBtn = document.getElementById('rtAlertBtn');
    
    if (!ringCircle) return; // Only in admin
    
    const workers = AttendanceDB.getWorkers();
    
    const now = new Date();
    const yyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    const records = AttendanceDB.getAll().filter(r => r.date.startsWith(yyyyMm));
    const submittedNames = new Set(records.map(r => r.name));
    
    const submittedWorkers = [];
    const pendingWorkers = [];
    
    workers.forEach(w => {
        if (submittedNames.has(w.name)) submittedWorkers.push(w);
        else pendingWorkers.push(w);
    });
    
    const total = workers.length;
    const subm = submittedWorkers.length;
    const percent = total > 0 ? Math.round((subm / total) * 100) : 0;
    
    // Update Ring
    const circumference = 364.4; // 2 * pi * 58
    const offset = circumference - (percent / 100) * circumference;
    ringCircle.style.strokeDashoffset = offset;
    
    ringNum.innerText = percent + '%';
    ringTotal.innerText = '/ ' + total + '명 제출';
    ringDesc.innerText = '전체 인원의 ' + percent + '% 제출 완료';
    
    doneCount.innerText = '(' + subm + '명)';
    pendingCount.innerText = '(' + (total - subm) + '명)';
    
    if (total - subm > 0) {
        alertBtn.style.display = 'flex';
    } else {
        alertBtn.style.display = 'none';
    }
    
    // Render Grids
    doneGrid.innerHTML = submittedWorkers.map(w => `
        <div class="worker-chip">
            <div class="avatar avatar-submitted">${w.name.charAt(0)}</div>
            <div class="name">${w.name}</div>
            <div class="status-dot dot-green"></div>
        </div>
    `).join('');
    
    pendingGrid.innerHTML = pendingWorkers.map(w => `
        <div class="worker-chip">
            <div class="avatar avatar-pending">${w.name.charAt(0)}</div>
            <div class="name">${w.name}</div>
            <div class="status-dot dot-red"></div>
        </div>
    `).join('');
};

window.notifyUnsubmittedApp = async function() {
    const btn = document.getElementById('rtAlertBtn');
    if (!btn || btn.disabled) return;
    
    const now = new Date();
    const yyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    const workers = AttendanceDB.getWorkers();
    const records = AttendanceDB.getAll().filter(r => r.date.startsWith(yyyyMm));
    const submittedNames = new Set(records.map(r => r.name));
    
    const pendingWorkers = workers.filter(w => !submittedNames.has(w.name));
    
    if (pendingWorkers.length === 0) {
        alert("알림을 보낼 미제출자가 없습니다.");
        return;
    }
    
    if (!confirm('미제출한 ' + pendingWorkers.length + '명에게 제출 알림을 발송하시겠습니까?')) return;
    
    btn.disabled = true;
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i class="spin-animation" data-lucide="loader-2" style="width:16px;"></i> 전송 중...';
    lucide.createIcons();
    
    let successCount = 0;
    
    for (const w of pendingWorkers) {
        const tokenData = await AttendanceDB.getFCMToken(w.name);
        if (tokenData && tokenData.token) {
            await AttendanceDB.saveNotification(w.name, {
                title: "출근부 제출 마감 임박",
                body: "이번 달 출근부를 서둘러 제출해주세요.",
                type: "warning"
            });
            successCount++;
        }
    }
    
    btn.disabled = false;
    btn.innerHTML = oldHtml;
    lucide.createIcons();
    
    alert(successCount + '명에게 알림 발송을 요청했습니다.\\n(FCM 토큰이 없는 사용자는 제외됨)');
};

// DOMContentLoaded observer to initialize realtime status when switching tabs
document.addEventListener('DOMContentLoaded', () => {
    // If we're in admin.html, override the showSection to render Realtime if needed
    if (typeof showSection === 'function') {
        const origShowSection = showSection;
        window.showSection = function(id, el) {
            origShowSection(id, el);
            if (id === 'realtimeView') {
                renderRealtimeStatus();
            }
        };
    }
});
