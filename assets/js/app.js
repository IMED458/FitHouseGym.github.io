import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
    import { initializeFirestore, collection, addDoc, setDoc, doc, onSnapshot, query, deleteDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

    // TODO: გადაიტანე .env ფაილში production-ზე
    const ENV = window.__ENV__ || {};
    const firebaseConfig = {
      apiKey: ENV.FIREBASE_API_KEY || "AIzaSyA1HOc9IvnfougHBMHRnQwktfOrS72Ttt8",
      authDomain: ENV.FIREBASE_AUTH_DOMAIN || "fit-house-gym-d3595.firebaseapp.com",
      projectId: ENV.FIREBASE_PROJECT_ID || "fit-house-gym-d3595",
      storageBucket: ENV.FIREBASE_STORAGE_BUCKET || "fit-house-gym-d3595.firebasestorage.app",
      messagingSenderId: ENV.FIREBASE_MESSAGING_SENDER_ID || "548276737406",
      appId: ENV.FIREBASE_APP_ID || "1:548276737406:web:12286429916b8c751fcf2f",
      measurementId: ENV.FIREBASE_MEASUREMENT_ID || "G-F4Y4CLVNFH"
    };

    // EmailJS Configuration
    const EMAILJS_SERVICE_ID = ENV.EMAILJS_SERVICE_ID || 'service_q9x0cyo';
    const EMAILJS_TEMPLATE_ID = ENV.EMAILJS_TEMPLATE_ID || 'template_ea0xdjl';
    const EMAILJS_PUBLIC_KEY = ENV.EMAILJS_PUBLIC_KEY || 'eTWiK52sjfnLBVW9C';

    const app = initializeApp(firebaseConfig);
    const db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
      useFetchStreams: false
    });
    const STAFF_PASSWORD_HASH = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";
    const ADMIN_PASSWORD_HASH = "25f43b1486ad95a1398e3eeb3d83bc4010015fcc9bedb35b432e00298d5021f7";
    let isAuthenticated = false;
    let currentUserRole = null;
    let currentUser = null;
    let notificationsSchedulerStarted = false;
    let expandedSearchMemberId = null;
    let financeReconcileTimer = null;
    let membersLoadedOnce = false;
    let usersLoadedOnce = false;
    let transactionsLoadedOnce = false;
    let activityLogsLoadedOnce = false;
    let transactionsRefreshTimer = null;
    let transactionsPollingStarted = false;
    let usersStreamStarted = false;
    let activityLogsStreamStarted = false;
    let dataStreamsStarted = false;
    let forcePasswordResetPending = false;
    window.members = [];
    window.users = [];
    window.products = [];
    window.transactions = [];
    window.activityLogs = [];
    window.trainers = [];
    let trainersStreamStarted = false;
    let trainersLoadedOnce = false;
    window.selectedSubscription = null;
    window.editingProductId = null;
    window.productSaleCart = [];
    window.productCartPaymentMethod = 'TBC';
    window.isCartCheckoutRunning = false;
    window.pendingMembershipPaymentContext = null;
    window.subscriptionPlans = [];
    window.productCatalogFilter = 'all';
    window.activeProductCartItemId = null;
    window.productCartQuantityBuffer = '';
    const restRateLimitUntil = {};
    let subscriptionPlansSeedAttempted = false;
    const DEFAULT_LOCAL_USERS = [
      {
        id: 'local_admin_default',
        firstName: 'მთავარი',
        lastName: 'ადმინისტრატორი',
        username: 'admin',
        passwordHash: ADMIN_PASSWORD_HASH,
        role: 'admin',
        status: 'active',
        isSystemDefault: true
      },
      {
        id: 'local_operator_default',
        firstName: 'მთავარი',
        lastName: 'ოპერატორი',
        username: 'operator',
        passwordHash: STAFF_PASSWORD_HASH,
        role: 'operator',
        status: 'active',
        isSystemDefault: true
      }
    ];
    const DEFAULT_SUBSCRIPTION_PLANS = [
      { id: 'local_12visits', name:'12 ვარჯიში', type:'12visits', price:70, durationDays:30, remainingVisits:12, active:true, order:1 },
      { id: 'local_morning', name:'დილის ულიმიტო', type:'morning', price:90, durationDays:30, remainingVisits:null, active:true, order:2 },
      { id: 'local_unlimited', name:'ულიმიტო', type:'unlimited', price:110, durationDays:30, remainingVisits:null, active:true, order:3 },
      { id: 'local_single_visit', name:'ერთჯერადი ვიზიტი', type:'single_visit', price:15, durationDays:1, remainingVisits:1, active:true, order:4 }
    ];

    // ── QR Check-in globals ─────────────────────────────────────────────────
    let gymQrToken = null;
    let gymQrDocId = 'gym_qr_config';
    let checkInListenerUnsubscribe = null;
    let lastSeenCheckInId = null;
    const QR_CHECKIN_COLLECTION = 'check_ins';
    const GYM_SETTINGS_COLLECTION = 'gym_settings';
    const PUBLIC_CHECKIN_OVERLAY_ID = 'publicCheckinOverlay';
    // Rate-limit: track last scan time per user session
    const publicCheckinRateMap = {};
    const PUBLIC_CHECKIN_RATE_LIMIT_MS = 30000; // 30s between attempts

    // EmailJS ინიციალიზაცია
    (function() {
      emailjs.init(EMAILJS_PUBLIC_KEY);
    })();

    function formatDate(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }

    function formatDateTime(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      const date = formatDate(iso);
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `${date} ${time}`;
    }

    function formatCurrency(value) {
      return `${Number(value || 0).toFixed(2)}₾`;
    }

    function getPaymentMethodLabel(method) {
      const map = {
        TBC: 'TBC',
        BOG: 'BOG',
        CASH: 'CASH',
        TRANSFER: 'გადარიცხვა',
        FLITT: 'Flitt (ონლაინ)'
      };
      return map[method] || method || '—';
    }

    function isDirectImageUrl(url) {
      return /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(String(url || '').trim());
    }

    function buildPagePreviewUrl(url) {
      return `https://image.thum.io/get/width/900/crop/700/noanimate/${String(url || '').trim()}`;
    }

    async function extractPageImageUrl(pageUrl) {
      const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(pageUrl)}`);
      if (!response.ok) throw new Error('image lookup failed');
      const html = await response.text();
      const parser = new DOMParser();
      const page = parser.parseFromString(html, 'text/html');
      const candidates = [
        page.querySelector('meta[property="og:image"]')?.getAttribute('content'),
        page.querySelector('meta[name="twitter:image"]')?.getAttribute('content'),
        page.querySelector('link[rel="image_src"]')?.getAttribute('href'),
        page.querySelector('img[src]')?.getAttribute('src')
      ].filter(Boolean);

      if (!candidates.length) return null;
      return new URL(candidates[0], pageUrl).toString();
    }

    function prependTransactionLocally(transaction) {
      if (!transaction?.id) return;
      window.transactions = [
        transaction,
        ...window.transactions.filter((item) => item.id !== transaction.id)
      ];
      updateAll();
    }

    function upsertLocalProduct(product) {
      if (!product?.id) return;
      const existing = window.products.find((item) => item.id === product.id);
      const merged = existing ? { ...existing, ...product } : product;
      window.products = [
        merged,
        ...window.products.filter((item) => item.id !== product.id)
      ].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ka'));
      updateAll();
    }

    async function resolveProductImageInBackground(productId, sourceUrl, currentImageUrl) {
      if (!productId || !sourceUrl || isDirectImageUrl(sourceUrl)) return;
      try {
        const extracted = await extractPageImageUrl(sourceUrl);
        if (!extracted || extracted === currentImageUrl) return;
        await saveProductRecord({
          id: productId,
          imageUrl: extracted,
          sourceUrl,
          updatedAt: new Date().toISOString()
        }, { silent: true });
      } catch (e) {
        console.warn('background image resolution failed', e);
      }
    }

    function getCartItemQuantity(productId) {
      return Number(window.productSaleCart.find((item) => item.productId === productId)?.quantity || 0);
    }

    function getDetailedCartItems() {
      return window.productSaleCart
        .map((item) => {
          const product = window.products.find((entry) => entry.id === item.productId);
          if (!product) return null;
          const quantity = Math.max(1, Number(item.quantity || 1));
          return {
            ...item,
            product,
            quantity,
            availableStock: Number(product.stock || 0),
            lineTotal: Number(product.price || 0) * quantity
          };
        })
        .filter(Boolean);
    }

    function syncProductCart() {
      window.productSaleCart = getDetailedCartItems()
        .map((item) => {
          if (item.availableStock <= 0) return null;
          return {
            productId: item.productId,
            quantity: Math.min(item.quantity, item.availableStock)
          };
        })
        .filter(Boolean);
    }

    function normalizeProductCode(value) {
      return String(value || '').trim().toUpperCase();
    }

    function isAdmin() {
      return currentUserRole === 'admin';
    }

    function getRoleLabel(role = currentUserRole) {
      return role === 'admin' ? 'ადმინისტრატორი' : 'ოპერატორი';
    }

    function normalizeUsername(value) {
      return String(value || '').trim().toLowerCase();
    }

    function normalizePersonalId(value) {
      return String(value || '').trim();
    }

    function isValidEmail(value) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
    }

    function generateTemporaryPassword(length = 8) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
    }

    function getCurrentUserDisplayName(user = currentUser) {
      if (!user) return '';
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      return fullName || user.username || '';
    }

    function getActorMetadata() {
      return {
        actorUserId: currentUser?.id || null,
        actorUsername: currentUser?.username || null,
        actorFirstName: currentUser?.firstName || null,
        actorLastName: currentUser?.lastName || null,
        actorFullName: getCurrentUserDisplayName() || null,
        actorRole: currentUserRole || currentUser?.role || 'system',
        createdByRole: currentUserRole || currentUser?.role || 'system'
      };
    }

    function verifyCurrentUserPasswordHash(hash) {
      if (!currentUser?.passwordHash) {
        return hash === STAFF_PASSWORD_HASH || hash === ADMIN_PASSWORD_HASH;
      }
      return hash === currentUser.passwordHash;
    }

    function applyRoleVisibility() {
      document.body.classList.toggle('admin-mode', isAuthenticated && isAdmin());
      document.querySelectorAll('[data-admin-only]').forEach((el) => {
        el.classList.toggle('role-hidden', !isAdmin());
      });
      const badge = document.getElementById('roleBadge');
      if (badge) {
        badge.textContent = isAuthenticated ? getRoleLabel() : '';
        badge.classList.toggle('admin-role', isAdmin());
      }
      const currentUserDisplay = document.getElementById('currentUserDisplay');
      if (currentUserDisplay) {
        currentUserDisplay.textContent = isAuthenticated ? getCurrentUserDisplayName() : '';
      }

      if (!isAdmin() && document.getElementById('finance')?.classList.contains('active')) {
        window.showTab('dashboard');
      }
      if (!isAdmin() && (document.getElementById('stats')?.classList.contains('active') || document.getElementById('users')?.classList.contains('active'))) {
        window.showTab('dashboard');
      }
    }

    function isSameCalendarDay(first, second) {
      const a = new Date(first);
      const b = new Date(second);
      return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
    }

    function isSameCalendarMonth(first, second) {
      const a = new Date(first);
      const b = new Date(second);
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
    }

    function getSortedTransactions() {
      return [...window.transactions].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }

    function getSortedActivityLogs() {
      return [...window.activityLogs].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }

    function formatTimeAgo(iso) {
      if (!iso) return '—';
      const diffMs = Date.now() - new Date(iso).getTime();
      const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
      if (diffMinutes < 1) return 'ახლახან';
      if (diffMinutes < 60) return `${diffMinutes} წუთის წინ`;
      const diffHours = Math.floor(diffMinutes / 60);
      if (diffHours < 24) return `${diffHours} საათის წინ`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 30) return `${diffDays} დღის წინ`;
      const diffMonths = Math.floor(diffDays / 30);
      if (diffMonths < 12) return `${diffMonths} თვის წინ`;
      return `${Math.floor(diffMonths / 12)} წლის წინ`;
    }

    function safeUiUpdate(label, fn) {
      try {
        fn();
      } catch (e) {
        console.error(`[UI_UPDATE:${label}]`, e);
      }
    }

    function getFirestoreCollectionUrl(collectionName, pageToken = '') {
      const url = new URL(`https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/${collectionName}`);
      url.searchParams.set('key', firebaseConfig.apiKey);
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      return url.toString();
    }

    function parseFirestoreValue(value) {
      if (!value || typeof value !== 'object') return null;
      if ('stringValue' in value) return value.stringValue;
      if ('integerValue' in value) return Number(value.integerValue);
      if ('doubleValue' in value) return Number(value.doubleValue);
      if ('booleanValue' in value) return value.booleanValue;
      if ('nullValue' in value) return null;
      if ('timestampValue' in value) return value.timestampValue;
      if ('referenceValue' in value) return value.referenceValue;
      if ('mapValue' in value) {
        return Object.fromEntries(
          Object.entries(value.mapValue.fields || {}).map(([key, innerValue]) => [key, parseFirestoreValue(innerValue)])
        );
      }
      if ('arrayValue' in value) {
        return (value.arrayValue.values || []).map(parseFirestoreValue);
      }
      return null;
    }

    function parseFirestoreDocument(documentData) {
      const id = String(documentData.name || '').split('/').pop();
      const fields = Object.entries(documentData.fields || {}).reduce((acc, [key, value]) => {
        acc[key] = parseFirestoreValue(value);
        return acc;
      }, {});
      return { id, ...fields };
    }

    function isRestRateLimited(key) {
      return Number(restRateLimitUntil[key] || 0) > Date.now();
    }

    function markRestRateLimited(key, ms = 60000) {
      restRateLimitUntil[key] = Date.now() + ms;
    }

    async function fetchCollectionViaRest(collectionName) {
      if (isRestRateLimited(collectionName)) {
        throw new Error(`${collectionName} fetch skipped during cooldown`);
      }
      const items = [];
      let pageToken = '';
      do {
        const response = await fetch(getFirestoreCollectionUrl(collectionName, pageToken), { cache: 'no-store' });
        if (!response.ok) {
          if (response.status === 429) {
            markRestRateLimited(collectionName);
          }
          throw new Error(`${collectionName} fetch failed with status ${response.status}`);
        }
        const data = await response.json();
        (data.documents || []).forEach((documentData) => {
          items.push(parseFirestoreDocument(documentData));
        });
        pageToken = data.nextPageToken || '';
      } while (pageToken);
      return items;
    }

    async function hydrateMembersFromRest() {
      try {
        window.members = await fetchCollectionViaRest('members');
        membersLoadedOnce = true;
        updateAll();
        checkUrlQrParam();
        queueTodayMembershipTransactionReconcile();
      } catch (e) {
        console.warn('members rest hydrate failed', e);
      }
    }

    async function hydrateProductsFromRest() {
      try {
        window.products = await fetchProductsViaRest();
        updateAll();
      } catch (e) {
        console.warn('products rest hydrate failed', e);
      }
    }

    async function fetchProductsViaRest() {
      return (await fetchCollectionViaRest('products'))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ka'));
    }

    async function fetchTransactionsViaRest() {
      return (await fetchCollectionViaRest('transactions'))
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }

    async function hydrateTransactionsFromRest() {
      try {
        window.transactions = await fetchTransactionsViaRest();
        transactionsLoadedOnce = true;
        updateAll();
        queueTodayMembershipTransactionReconcile();
      } catch (e) {
        console.warn('transactions rest hydrate failed', e);
      }
    }

    async function fetchUsersViaRest() {
      return (await fetchCollectionViaRest('users'))
        .sort((a, b) => String(a.firstName || a.username || '').localeCompare(String(b.firstName || b.username || ''), 'ka'));
    }

    async function fetchActivityLogsViaRest() {
      return (await fetchCollectionViaRest('activity_logs'))
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }

    async function hydrateUsersFromRest() {
      try {
        window.users = await fetchUsersViaRest();
        usersLoadedOnce = true;
        if (currentUser?.id) {
          const refreshedCurrentUser = window.users.find((item) => item.id === currentUser.id);
          if (refreshedCurrentUser) {
            currentUser = refreshedCurrentUser;
            currentUserRole = refreshedCurrentUser.role === 'admin' ? 'admin' : 'operator';
          }
        }
        safeUiUpdate('users', updateUsersTab);
        safeUiUpdate('settings', updateSettingsTab);
        safeUiUpdate('stats', updateStatsTab);
        applyRoleVisibility();
      } catch (e) {
        console.warn('users rest hydrate failed', e);
      }
    }

    async function fetchTrainersViaRest() {
      return (await fetchCollectionViaRest('trainers'))
        .sort((a, b) => String(a.firstName || '').localeCompare(String(b.firstName || ''), 'ka'));
    }

    async function hydrateTrainersFromRest() {
      try {
        window.trainers = await fetchTrainersViaRest();
        trainersLoadedOnce = true;
        safeUiUpdate('trainers', updateTrainersTab);
      } catch (e) {
        console.warn('trainers rest hydrate failed', e);
      }
    }

    function loadTrainers() {
      hydrateTrainersFromRest();
      if (trainersStreamStarted) return;
      trainersStreamStarted = true;
      const q = query(collection(db, "trainers"));
      onSnapshot(q, (snapshot) => {
        window.trainers = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.firstName || '').localeCompare(String(b.firstName || ''), 'ka'));
        trainersLoadedOnce = true;
        safeUiUpdate('trainers', updateTrainersTab);
      }, (error) => {
        console.warn('trainers snapshot failed, using rest fallback', error);
        hydrateTrainersFromRest();
      });
    }

    async function hydrateActivityLogsFromRest() {
      try {
        window.activityLogs = await fetchActivityLogsViaRest();
        activityLogsLoadedOnce = true;
        safeUiUpdate('dashboard', updateDashboard);
        safeUiUpdate('stats', updateStatsTab);
      } catch (e) {
        console.warn('activity logs rest hydrate failed', e);
      }
    }

    async function ensureDefaultUsers() {
      let existingUsers = [];
      try {
        existingUsers = await fetchUsersViaRest();
      } catch (e) {
        const message = String(e?.message || '');
        if (message.includes('429') || message.includes('403') || message.includes('cooldown')) {
          window.users = DEFAULT_LOCAL_USERS.map((item) => ({ ...item }));
          usersLoadedOnce = true;
          return window.users;
        }
        throw e;
      }
      if (existingUsers.length > 0) {
        window.users = existingUsers;
        usersLoadedOnce = true;
        return existingUsers;
      }

      const nowIso = new Date().toISOString();
      const defaults = [
        {
          firstName: 'მთავარი',
          lastName: 'ადმინისტრატორი',
          username: 'admin',
          passwordHash: ADMIN_PASSWORD_HASH,
          role: 'admin',
          status: 'active',
          createdAt: nowIso,
          updatedAt: nowIso,
          isSystemDefault: true
        },
        {
          firstName: 'მთავარი',
          lastName: 'ოპერატორი',
          username: 'operator',
          passwordHash: STAFF_PASSWORD_HASH,
          role: 'operator',
          status: 'active',
          createdAt: nowIso,
          updatedAt: nowIso,
          isSystemDefault: true
        }
      ];

      for (const item of defaults) {
        await addDoc(collection(db, "users"), item);
      }

      let createdUsers = [];
      try {
        createdUsers = await fetchUsersViaRest();
      } catch (e) {
        createdUsers = defaults.map((item, index) => ({ id: `seeded_local_${index}`, ...item }));
      }
      window.users = createdUsers;
      usersLoadedOnce = true;
      return createdUsers;
    }

    function scheduleTransactionsRefresh(delay = 350) {
      if (transactionsRefreshTimer) clearTimeout(transactionsRefreshTimer);
      transactionsRefreshTimer = setTimeout(() => {
        hydrateTransactionsFromRest();
      }, delay);
    }

    window.refreshFinancialData = async function() {
      await Promise.all([
        hydrateUsersFromRest(),
        hydrateMembersFromRest(),
        hydrateProductsFromRest(),
        hydrateTransactionsFromRest()
      ]);
      showToast('მონაცემები განახლდა');
    };

    function startOfDay(date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    }

    function addMonthsPreserveDay(date, months = 1) {
      const source = new Date(date);
      const day = source.getDate();
      const target = new Date(source);
      target.setDate(1);
      target.setMonth(target.getMonth() + months);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(day, lastDay));
      return target;
    }

    function toDateInputValue(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    function dateInputToISOEndOfDay(dateStr) {
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
    }

    function setToEndOfDay(date) {
      const d = new Date(date);
      d.setHours(23, 59, 59, 999);
      return d;
    }

    function isExpired(endDateIso) {
      return new Date() > new Date(endDateIso);
    }

    function getEffectiveStatus(member) {
      if (!member) return 'expired';
      if (member.status === 'active') {
        const visitsExhausted = member.remainingVisits !== null && member.remainingVisits <= 0;
        if (isExpired(member.subscriptionEndDate) || visitsExhausted) return 'expired';
      }
      return member.status;
    }

    async function sha256Hex(text) {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    function startExpiringNotificationsScheduler() {
      if (notificationsSchedulerStarted) return;
      notificationsSchedulerStarted = true;
      setInterval(() => {
        checkAndSendExpiringNotifications();
      }, 3600000);

      setTimeout(() => {
        checkAndSendExpiringNotifications();
      }, 5000);
    }

    function queueTodayMembershipTransactionReconcile() {
      if (!isAuthenticated || !membersLoadedOnce || !transactionsLoadedOnce) return;
      if (financeReconcileTimer) clearTimeout(financeReconcileTimer);
      financeReconcileTimer = setTimeout(() => {
        reconcileTodayMembershipTransactions();
      }, 1200);
    }

    async function reconcileTodayMembershipTransactions() {
      if (!window.members.length) return;
      const today = new Date();
      const missingTransactions = [];

      for (const member of window.members) {
        const createdToday = member.createdAt && isSameCalendarDay(member.createdAt, today);
        const startedToday = member.subscriptionStartDate && isSameCalendarDay(member.subscriptionStartDate, today);

        if (createdToday) {
          const suppressionKey = getMembershipFinanceSuppressionKey('membership_registration', today.toISOString());
          if ((member.financeTransactionSuppressions || []).includes(suppressionKey)) {
            continue;
          }
          const hasRegistrationTx = window.transactions.some((tx) =>
            tx.type === 'membership_registration' &&
            tx.memberId === member.id &&
            isSameCalendarDay(tx.createdAt, today)
          );
          if (!hasRegistrationTx) {
            missingTransactions.push({ type: 'membership_registration', member });
          }
          continue;
        }

        if (startedToday) {
          const suppressionKey = getMembershipFinanceSuppressionKey('membership_renewal', today.toISOString());
          if ((member.financeTransactionSuppressions || []).includes(suppressionKey)) {
            continue;
          }
          const hasRenewalTx = window.transactions.some((tx) =>
            tx.type === 'membership_renewal' &&
            tx.memberId === member.id &&
            isSameCalendarDay(tx.createdAt, today)
          );
          if (!hasRenewalTx) {
            missingTransactions.push({ type: 'membership_renewal', member });
          }
        }
      }

      if (missingTransactions.length === 0) return;

      let restoredCount = 0;
      for (const item of missingTransactions) {
        const saved = await recordMembershipTransaction(item.type, item.member);
        if (saved) restoredCount++;
      }

      if (restoredCount > 0) {
        showToast(`ფინანსებში აღდგა ${restoredCount} დღევანდელი ჩანაწერი`);
      }
    }

    function getFinancialSummary() {
      const now = new Date();
      const transactions = getSortedTransactions();
      const todayTransactions = transactions.filter((tx) => isSameCalendarDay(tx.createdAt, now));
      const monthTransactions = transactions.filter((tx) => isSameCalendarMonth(tx.createdAt, now));
      const todayMembershipTransactions = todayTransactions.filter((tx) => tx.category === 'membership');
      const todayProductTransactions = todayTransactions.filter((tx) => tx.type === 'product_sale');
      const monthMembershipTransactions = monthTransactions.filter((tx) => tx.category === 'membership');
      const monthProductTransactions = monthTransactions.filter((tx) => tx.type === 'product_sale');

      const sumAmount = (list, filterFn = null) => list
        .filter((tx) => !filterFn || filterFn(tx))
        .reduce((total, tx) => total + Number(tx.amount || 0), 0);

      const monthProductUnits = monthProductTransactions
        .reduce((total, tx) => total + Number(tx.quantity || 0), 0);

      return {
        todayMembership: sumAmount(todayMembershipTransactions),
        todayProducts: sumAmount(todayProductTransactions),
        todayTotal: sumAmount(todayTransactions),
        monthMembership: sumAmount(monthMembershipTransactions),
        monthProducts: sumAmount(monthProductTransactions),
        monthTotal: sumAmount(monthTransactions),
        todayRegistrationCount: todayMembershipTransactions.filter((tx) => tx.type === 'membership_registration').length,
        todayRenewalCount: todayMembershipTransactions.filter((tx) => tx.type === 'membership_renewal').length,
        todayProductSalesCount: todayProductTransactions.length,
        todayProductUnits: todayProductTransactions.reduce((total, tx) => total + Number(tx.quantity || 0), 0),
        monthMembershipCount: monthMembershipTransactions.length,
        monthProductSalesCount: monthProductTransactions.length,
        monthProductUnits,
        todayMembershipTransactions,
        todayProductTransactions,
        monthMembershipTransactions,
        monthProductTransactions,
        recentTransactions: transactions.slice(0, 30),
        recentProductSales: transactions.filter((tx) => tx.type === 'product_sale').slice(0, 12)
      };
    }

    async function recordTransaction(transaction, options = {}) {
      let payload = null;
      let docRef = null;
      try {
        payload = {
          ...getActorMetadata(),
          ...transaction,
          amount: Number(transaction.amount || 0),
          createdAt: transaction.createdAt || new Date().toISOString(),
          createdByRole: transaction.createdByRole || currentUserRole || currentUser?.role || 'system'
        };
        docRef = await addDoc(collection(db, "transactions"), payload);
      } catch (e) {
        console.error('transaction write failed', e);
        try {
          const restTransactions = await fetchTransactionsViaRest();
          const recoveredTransaction = restTransactions.find((item) =>
            item.type === payload?.type &&
            item.category === payload?.category &&
            String(item.description || '') === String(payload?.description || '') &&
            Number(item.amount || 0) === Number(payload?.amount || 0) &&
            String(item.createdAt || '') === String(payload?.createdAt || '')
          );
          if (recoveredTransaction) {
            window.transactions = restTransactions;
            updateAll();
            console.warn('transaction recovered from firestore after SDK error', recoveredTransaction.id);
            return true;
          }
        } catch (recoveryError) {
          console.error('transaction recovery failed', recoveryError);
        }
        if (!options.silent) {
          showToast('ფინანსური ჩანაწერის შენახვა ვერ მოხერხდა', 'error');
        }
        return false;
      }
      try {
        prependTransactionLocally({ id: docRef.id, ...payload });
      } catch (e) {
        console.error('local transaction update failed', e);
      }
      scheduleTransactionsRefresh();
      return true;
    }

    async function recordMembershipTransaction(actionType, member, options = {}) {
      return recordTransaction({
        type: actionType,
        category: 'membership',
        amount: Number(member.subscriptionPrice || 0),
        memberId: member.id,
        memberName: `${member.firstName || ''} ${member.lastName || ''}`.trim(),
        personalId: member.personalId || '',
        subscriptionType: member.subscriptionType,
        subscriptionName: getSubscriptionName(member.subscriptionType),
        paymentMethod: options.paymentMethod || member.lastMembershipPaymentMethod || 'CASH',
        note: options.note || null,
        actorUserId: options.actorUserId || member.lastMembershipHandledByUserId || member.createdByUserId || null,
        actorUsername: options.actorUsername || member.lastMembershipHandledByUsername || member.createdByUsername || null,
        actorFullName: options.actorFullName || member.lastMembershipHandledByFullName || member.createdByFullName || null,
        actorRole: options.actorRole || member.lastMembershipHandledByRole || currentUserRole || currentUser?.role || 'system',
        description: actionType === 'membership_registration'
          ? `ახალი აბონემენტი: ${getSubscriptionName(member.subscriptionType)}`
          : `აბონემენტის განახლება: ${getSubscriptionName(member.subscriptionType)}`
      });
    }

    function buildTransactionDeleteAction(tx) {
      if (!tx?.id) return '';
      return `
        <button type="button" class="transaction-delete-btn" data-admin-only onclick="window.deleteTransactionEntry('${tx.id}')">
          <i class="fas fa-trash"></i>
          <span>წაშლა</span>
        </button>
      `;
    }

    function buildTransactionRowHtml({ title, meta, amount, tx }) {
      return `
        <div class="transaction-row">
          <div class="transaction-main">
            <div class="transaction-title">${title}</div>
            <div class="transaction-meta">${meta}</div>
          </div>
          <div class="transaction-row-actions">
            <div class="transaction-amount">${amount}</div>
            ${buildTransactionDeleteAction(tx)}
          </div>
        </div>
      `;
    }

    function buildMemberDetailsHTML(member) {
      const effectiveStatus = getEffectiveStatus(member);
      const noteBanner = member.note ? `<div class="note-banner text-sm"><i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${member.note}</div>` : '';
      return `
        <div id="details-${member.id}" class="member-details-card animate-fadeIn">
          ${noteBanner}
          <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-6">
            <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
            <div><strong>პირადი:</strong> ${member.personalId}</div>
            <div><strong>ტელეფონი:</strong> ${member.phone || '—'}</div>
            <div><strong>Email:</strong> ${member.email || '—'}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(member.subscriptionType)}</div>
            <div><strong>ფასი:</strong> ${member.subscriptionPrice}₾</div>
            <div><strong>გააქტიურდა:</strong> ${formatDate(member.subscriptionStartDate)}</div>
            <div><strong>ვადა:</strong> ${formatDate(member.subscriptionEndDate)}</div>
            <div><strong>სტატუსი:</strong> <span class="status-badge ${getStatusClass(effectiveStatus)}">${getStatusText(effectiveStatus)}</span></div>
            <div><strong>დარჩენილი:</strong> ${member.remainingVisits != null ? member.remainingVisits : 'ულიმიტო'}</div>
            <div><strong>ბოლო ვიზიტი:</strong> ${member.lastVisit ? formatDate(member.lastVisit) : '—'}</div>
            ${member.createdByFullName ? `<div><strong>რეგისტრავტორი:</strong> <span style="color:#94a3b8;">${member.createdByFullName}${member.createdByUsername ? ' (@'+member.createdByUsername+')' : ''}</span></div>` : ''}
            ${member.lastMembershipHandledByFullName && member.lastMembershipHandledByFullName !== member.createdByFullName ? `<div><strong>ბოლო განახლება:</strong> <span style="color:#94a3b8;">${member.lastMembershipHandledByFullName}</span></div>` : ''}
            <div><strong>ტრენერი:</strong> ${member.trainerSessionIncluded ? (member.trainerSessionGifted ? `ერთჯერადი • საჩუქრად` : `ერთჯერადი • ${formatCurrency(member.trainerSessionPrice)}`) : 'არა'}</div>
          </div>
          ${member.trainerServiceEnabled && member.trainerId ? `
            <div style="margin-bottom:16px;padding:12px 16px;background:linear-gradient(135deg,rgba(239,68,68,0.12),rgba(220,38,38,0.06));border:1px solid rgba(239,68,68,0.3);border-radius:14px;display:flex;align-items:center;gap:10px;">
              ${(() => { const tr = getTrainerById(member.trainerId); return tr?.photoUrl ? `<img src="${tr.photoUrl}" style="width:42px;height:42px;border-radius:50%;object-fit:cover;border:2px solid #ef4444;" onerror="this.style.display='none'">` : `<div style="width:42px;height:42px;border-radius:50%;background:rgba(239,68,68,0.2);color:#ef4444;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1.1rem;">${(getTrainerById(member.trainerId)?.firstName||'T').charAt(0)}</div>`; })()}
              <div>
                <div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;color:#ef4444;margin-bottom:2px;"><i class="fas fa-dumbbell"></i> ტრენერის სერვისი</div>
                <div style="font-weight:800;color:#fff;font-size:0.95rem;">${getTrainerName(member.trainerId)}</div>
                ${(() => { const tr = getTrainerById(member.trainerId); return tr?.phone ? `<div style="color:#94a3b8;font-size:0.8rem;">${tr.phone}</div>` : ''; })()}
              </div>
            </div>
          ` : ''}
          <div class="flex flex-wrap gap-3 justify-center">
            <button class="btn btn-warning text-sm px-6 py-2" onclick="window.renewMembership('${member.id}')">განახლება</button>
            <button class="btn bg-blue-600 hover:bg-blue-700 text-sm px-6 py-2" onclick="window.showEditForm(event, '${member.id}')">რედაქტირება</button>
            <button class="btn bg-indigo-600 hover:bg-indigo-700 text-sm px-6 py-2" onclick="window.showMemberQr('${member.id}')"><i class="fas fa-qrcode"></i> QR</button>
            ${member.email ? `<button class="btn bg-cyan-600 hover:bg-cyan-700 text-sm px-6 py-2" onclick="window.sendMemberQrEmail('${member.id}')"><i class="fas fa-paper-plane"></i> კაბინეტი გაგზავნა</button>` : ''}
            ${member.email ? `<button class="btn bg-purple-600 hover:bg-purple-700 text-sm px-6 py-2" onclick="window.openIndividualMessageModal('${member.id}')"><i class="fas fa-envelope"></i> Email</button>` : ''}
            <button class="btn bg-teal-600 hover:bg-teal-700 text-sm px-6 py-2" onclick="window.resetMemberPassword('${member.id}', '${member.firstName} ${member.lastName}')"><i class="fas fa-key"></i> პაროლი</button>
            ${member.trainerServiceEnabled && member.trainerId ? `<button class="btn bg-orange-600 hover:bg-orange-700 text-sm px-6 py-2" onclick="window.removeTrainerFromMember('${member.id}')"><i class="fas fa-user-minus"></i> ტრენერი ამოხსნა</button>` : ''}
            <button class="btn bg-red-600 hover:bg-red-700 text-sm px-6 py-2" onclick="window.deleteMember('${member.id}')">წაშლა</button>
          </div>
        </div>
      `;
    }

    function renderProductCart() {
      const container = document.getElementById('productCartList');
      if (!container) return;

      syncProductCart();
      const items = getDetailedCartItems();
      if (!items.length) {
        window.activeProductCartItemId = null;
        window.productCartQuantityBuffer = '';
      } else if (!items.some((item) => item.productId === window.activeProductCartItemId)) {
        window.activeProductCartItemId = items[0].productId;
        window.productCartQuantityBuffer = String(items[0].quantity);
      }
      const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
      const totalAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
      const activeItem = items.find((item) => item.productId === window.activeProductCartItemId) || null;

      const unitsEl = document.getElementById('productCartUnits');
      const totalEl = document.getElementById('productCartTotal');
      const checkoutBtn = document.getElementById('checkoutProductCartBtn');
      const selectedLabelEl = document.getElementById('productCartSelectedLabel');
      const keypadDisplayEl = document.getElementById('productCartKeypadDisplay');
      if (unitsEl) unitsEl.textContent = String(totalUnits);
      if (totalEl) totalEl.textContent = formatCurrency(totalAmount);
      if (selectedLabelEl) selectedLabelEl.textContent = activeItem ? `${activeItem.product.name} × ${activeItem.quantity}` : '—';
      if (keypadDisplayEl) keypadDisplayEl.textContent = window.productCartQuantityBuffer || (activeItem ? String(activeItem.quantity) : '0');
      if (checkoutBtn) {
        checkoutBtn.disabled = window.isCartCheckoutRunning || items.length === 0;
        if (!window.isCartCheckoutRunning) {
          checkoutBtn.innerHTML = '<i class="fas fa-bag-shopping"></i> გაყიდვა';
        }
      }

      document.querySelectorAll('.product-payment-pill').forEach((pill) => {
        pill.classList.toggle('active', pill.dataset.paymentMethod === window.productCartPaymentMethod);
      });

      if (items.length === 0) {
        container.innerHTML = `
          <div class="product-cart-empty">
            <i class="fas fa-basket-shopping"></i>
            <p>ჯერ არაფერი აგირჩევია. მარჯვნივ პროდუქტზე დაჭერით დაამატე კალათაში.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="product-cart-table-head">
          <span>დასახელება</span>
          <span>ფასი</span>
          <span>რაოდ.</span>
          <span>ჯამი</span>
          <span></span>
        </div>
        <div class="product-cart-rows">
          ${items.map((item) => `
            <div class="product-cart-item ${item.productId === window.activeProductCartItemId ? 'selected' : ''}" onclick="window.selectProductCartItem('${item.productId}')">
              <div class="product-cart-item-main">
                <div class="product-cart-item-name">${item.product.name}</div>
                <div class="product-cart-item-code">${item.product.code}</div>
              </div>
              <div class="product-cart-item-price">${formatCurrency(item.product.price)}</div>
              <div class="product-cart-item-qty">
                <button type="button" class="cart-qty-btn" onclick="event.stopPropagation(); window.changeProductCartQuantity('${item.productId}', -1)">−</button>
                <span>${item.quantity}</span>
                <button type="button" class="cart-qty-btn" onclick="event.stopPropagation(); window.changeProductCartQuantity('${item.productId}', 1)">+</button>
              </div>
              <div class="product-cart-item-line-total">${formatCurrency(item.lineTotal)}</div>
              <button type="button" class="cart-remove-btn" onclick="event.stopPropagation(); window.removeProductFromCart('${item.productId}')">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          `).join('')}
        </div>
      `;
    }

    function renderInventoryRestockList() {
      const container = document.getElementById('inventoryRestockList');
      if (!container) return;

      const searchValue = (document.getElementById('inventoryRestockSearch')?.value || '').trim().toLowerCase();
      const filteredProducts = window.products.filter((product) => {
        if (!searchValue) return true;
        return String(product.name || '').toLowerCase().includes(searchValue) ||
          String(product.code || '').toLowerCase().includes(searchValue);
      });

      if (filteredProducts.length === 0) {
        container.innerHTML = '<p class="empty-state">მითითებული პროდუქტები ვერ მოიძებნა</p>';
        return;
      }

      container.innerHTML = filteredProducts.map((product) => `
        <div class="inventory-restock-row">
          <div class="inventory-restock-main">
            <div class="inventory-restock-name">${product.name}</div>
            <div class="inventory-restock-meta">კოდი: ${product.code || '—'} • მიმდინარე მარაგი: ${Number(product.stock || 0)}</div>
          </div>
          <div class="inventory-restock-controls">
            <input
              type="number"
              min="1"
              step="1"
              value="1"
              class="form-input inventory-restock-input"
              id="inventoryRestockQty_${product.id}"
            >
            <button class="btn bg-amber-600 hover:bg-amber-700 inventory-restock-btn" onclick="window.applyInventoryRestock('${product.id}')">
              <i class="fas fa-box-open"></i> შევსება
            </button>
          </div>
        </div>
      `).join('');
    }

    function renderDaySalesModal() {
      const summary = getFinancialSummary();
      const todaySales = summary.todayProductTransactions;
      const membershipTransactions = summary.todayMembershipTransactions;
      const allTransactions = [...membershipTransactions, ...todaySales];
      const cashAmount = allTransactions
        .filter((tx) => !tx.paymentMethod || tx.paymentMethod === 'CASH')
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      const tbcAmount = allTransactions
        .filter((tx) => tx.paymentMethod === 'TBC')
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      const bogAmount = allTransactions
        .filter((tx) => tx.paymentMethod === 'BOG')
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      const transferAmount = allTransactions
        .filter((tx) => tx.paymentMethod === 'TRANSFER')
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      const flittAmount = allTransactions
        .filter((tx) => tx.paymentMethod === 'FLITT')
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      // Flitt is a card payment, so it belongs in the card total — without this
      // online payments were counted in the day total but in no method bucket.
      const cardAmount = tbcAmount + bogAmount + flittAmount;

      const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
      };

      setText('daySalesCashAmount', formatCurrency(cashAmount));
      setText('daySalesCardAmount', formatCurrency(cardAmount));
      setText('daySalesTotalAmount', formatCurrency(summary.todayTotal));
      setText('daySalesMembershipAmount', formatCurrency(summary.todayMembership));
      setText('daySalesProductsAmount', formatCurrency(summary.todayProducts));
      setText('daySalesMembershipCount', String(summary.todayRegistrationCount + summary.todayRenewalCount));
      setText('daySalesProductSalesCount', String(summary.todayProductSalesCount));
      setText('daySalesUnits', String(summary.todayProductUnits));
      setText('daySalesTbcAmount', formatCurrency(tbcAmount));
      setText('daySalesBogAmount', formatCurrency(bogAmount));
      setText('daySalesTransferAmount', formatCurrency(transferAmount));
      setText('daySalesFlittAmount', formatCurrency(flittAmount));

      const membershipList = document.getElementById('daySalesMembershipList');
      const recentList = document.getElementById('daySalesRecentList');
      if (!recentList || !membershipList) return;
      if (membershipTransactions.length === 0) {
        membershipList.innerHTML = '<p class="empty-state">დღეს აბონემენტების გაყიდვა/განახლება არ დაფიქსირებულა</p>';
      } else {
        membershipList.innerHTML = membershipTransactions
          .slice()
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
          .map((tx) => buildTransactionRowHtml({
            title: tx.memberName || tx.subscriptionName || 'აბონემენტი',
            meta: `${tx.type === 'membership_registration' ? 'ახალი აბონემენტი' : 'განახლება'} • ${tx.subscriptionName || tx.subscriptionType || 'აბონემენტი'} • ${getPaymentMethodLabel(tx.paymentMethod)} • ${formatDateTime(tx.createdAt)}${tx.actorFullName ? ` • ${tx.actorFullName}` : ''}`,
            amount: formatCurrency(tx.amount),
            tx
          })).join('');
      }
      if (todaySales.length === 0) {
        recentList.innerHTML = '<p class="empty-state">დღეს ჯერ გაყიდვები არ დაფიქსირებულა</p>';
        return;
      }
      recentList.innerHTML = todaySales
        .slice()
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .map((tx) => buildTransactionRowHtml({
          title: tx.productName,
          meta: `${tx.quantity || 0} ცალი • ${getPaymentMethodLabel(tx.paymentMethod)} • ${formatDateTime(tx.createdAt)}${tx.actorFullName ? ` • ${tx.actorFullName}` : ''}`,
          amount: formatCurrency(tx.amount),
          tx
        })).join('');
    }

    function checkAuth() {
      if (!isAuthenticated) {
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
      } else {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
      }
      applyRoleVisibility();
    }

    window.showForgotPasswordInfo = function() {
      showToast('პაროლის აღდგენა ხდება ადმინისტრატორის პანელიდან', 'warning');
    };

    function shouldForcePasswordReset(user) {
      return Boolean(user?.mustChangePassword);
    }

    function openForcedPasswordResetModal(user) {
      forcePasswordResetPending = true;
      document.getElementById('forcePasswordResetName').textContent = getCurrentUserDisplayName(user);
      document.getElementById('forcePasswordCurrent').value = '';
      document.getElementById('forcePasswordNew').value = '';
      document.getElementById('forcePasswordConfirm').value = '';
      document.getElementById('forcePasswordResetModal').style.display = 'flex';
      showToast('გაანახლე პაროლი მუდმივ პაროლზე', 'warning');
    }

    window.login = async function() {
      const username = normalizeUsername(document.getElementById('loginUsername')?.value);
      const input = document.getElementById('adminPassword').value;
      if (!username || !input) {
        showToast('შეიყვანე იუზერი და პაროლი', 'error');
        return;
      }

      if (!usersLoadedOnce && window.users.length === 0) {
        try {
          await ensureDefaultUsers();
        } catch (e) {
          console.error('default users bootstrap failed', e);
          if (String(e?.message || '').includes('403')) {
            showToast('Firestore rules ბლოკავს users კოლექციას', 'error');
          } else {
            showToast('იუზერების ჩატვირთვა ვერ მოხერხდა', 'error');
          }
          return;
        }
      }

      const inputHash = await sha256Hex(input);
      const matchedUser = window.users.find((item) =>
        (normalizeUsername(item.username) === username || normalizeUsername(item.personalId) === username) &&
        item.passwordHash === inputHash &&
        (item.status || 'active') === 'active'
      );

      if (!matchedUser) {
        showToast("იუზერი ან პაროლი არასწორია!", "error");
        return;
      }

      isAuthenticated = true;
      currentUser = matchedUser;
      currentUserRole = matchedUser.role === 'admin' ? 'admin' : 'operator';
      checkAuth();
      if (!dataStreamsStarted) {
        loadUsers();
        loadMembers();
        loadProducts();
        loadTransactions();
        loadActivityLogs();
        loadTrainers();
        dataStreamsStarted = true;
      } else {
        updateAll();
        safeUiUpdate('users', updateUsersTab);
        safeUiUpdate('settings', updateSettingsTab);
        safeUiUpdate('stats', updateStatsTab);
      }
      recordUserActivity('login', matchedUser);
      startExpiringNotificationsScheduler();
      startCheckInListenerPolling();
      showToast(`ავტორიზაცია წარმატებით განხორციელდა! (${getRoleLabel()})`, "success");
      if (shouldForcePasswordReset(matchedUser)) {
        openForcedPasswordResetModal(matchedUser);
      }
    };

    window.logout = function() {
      isAuthenticated = false;
      currentUserRole = null;
      currentUser = null;
      forcePasswordResetPending = false;
      expandedSearchMemberId = null;
      window.selectedSubscription = null;
      window.productSaleCart = [];
      window.pendingMembershipPaymentContext = null;
      window.productCartPaymentMethod = 'TBC';
      document.getElementById('loginUsername').value = '';
      document.getElementById('adminPassword').value = '';
      document.querySelectorAll('.modal').forEach((modal) => {
        modal.style.display = 'none';
      });
      document.querySelectorAll('.edit-form').forEach((form) => form.remove());
      document.getElementById('checkinResult')?.replaceChildren();
      document.getElementById('searchResults')?.replaceChildren();
      if (document.getElementById('checkinSearch')) document.getElementById('checkinSearch').value = '';
      if (document.getElementById('searchInput')) document.getElementById('searchInput').value = '';
      if (document.getElementById('productSearchInput')) document.getElementById('productSearchInput').value = '';
      if (document.getElementById('userSearchInput')) document.getElementById('userSearchInput').value = '';
      if (checkInPollingInterval) { clearInterval(checkInPollingInterval); checkInPollingInterval = null; }
      document.getElementById('checkinPopup').style.display = 'none';
      window.showTab('dashboard');
      checkAuth();
      showToast('სესიიდან გამოხვედი');
    };

    // ფინანსების გასუფთავება (პაროლით დაცული)
    window.openClearFinancesModal = function() {
      if (!isAdmin()) {
        showToast('ეს ფუნქცია მხოლოდ ადმინისტრატორისთვისაა', 'error');
        return;
      }
      const modal = document.createElement('div');
      modal.id = 'clearFinancesModal';
      modal.className = 'fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50';
      modal.innerHTML = `
        <div class="bg-slate-800 p-8 rounded-2xl border-2 border-red-500 max-w-md w-full text-center">
          <div class="text-5xl mb-4">🗑️</div>
          <h3 class="text-2xl font-bold text-red-400 mb-2">ფინანსების გასუფთავება</h3>
          <p class="text-slate-300 mb-2 text-sm">ეს ოპერაცია წაშლის ფინანსურ ჩანაწერებს Firebase-დან.</p>
          <p class="text-yellow-400 mb-5 text-sm font-bold">⚠️ წაშლა შეუქცევადია!</p>
          <div class="mb-4">
            <label class="text-slate-300 text-sm block mb-2">რა გასუფთავდეს?</label>
            <div class="flex gap-3 justify-center mb-4">
              <label class="flex items-center gap-2 cursor-pointer bg-slate-700 px-4 py-2 rounded-lg border border-slate-600 hover:border-red-500">
                <input type="radio" name="clearScope" value="month" checked class="accent-red-500">
                <span class="text-sm">მიმდინარე თვე</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer bg-slate-700 px-4 py-2 rounded-lg border border-slate-600 hover:border-red-500">
                <input type="radio" name="clearScope" value="all" class="accent-red-500">
                <span class="text-sm">ყველა ჩანაწერი</span>
              </label>
            </div>
          </div>
          <div class="mb-5">
            <label class="text-slate-300 text-sm block mb-2">ადმინის პაროლი დასადასტურებლად</label>
            <input type="password" id="clearFinancesPassword" placeholder="მიმდინარე პაროლი" class="form-input" autofocus>
          </div>
          <div class="flex gap-3 justify-center">
            <button class="btn bg-red-600 hover:bg-red-700 px-6 py-3 font-bold" onclick="window.confirmClearFinances()">
              <i class="fas fa-trash-alt mr-2"></i>გასუფთავება
            </button>
            <button class="btn bg-gray-600 hover:bg-gray-700 px-6 py-3" onclick="document.getElementById('clearFinancesModal').remove()">გაუქმება</button>
          </div>
          <div id="clearFinancesProgress" class="mt-4 text-sm text-slate-400 hidden"></div>
        </div>
      `;
      modal.querySelector('#clearFinancesPassword').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); window.confirmClearFinances(); }
      });
      document.body.appendChild(modal);
      setTimeout(() => modal.querySelector('#clearFinancesPassword').focus(), 100);
    };

    window.confirmClearFinances = async function() {
      const pass = document.getElementById('clearFinancesPassword')?.value || '';
      const passHash = await sha256Hex(pass);
      if (!isAdmin() || !verifyCurrentUserPasswordHash(passHash)) {
        showToast('ადმინის პაროლი არასწორია!', 'error');
        const inp = document.getElementById('clearFinancesPassword');
        if (inp) { inp.value = ''; inp.focus(); }
        return;
      }

      const scope = document.querySelector('input[name="clearScope"]:checked')?.value || 'month';
      const scopeLabel = scope === 'all' ? 'ყველა ჩანაწერი' : 'მიმდინარე თვის ჩანაწერები';
      const confirmed = confirm(`დარწმუნებული ხართ?\n\nწაიშლება: ${scopeLabel}\n\nეს ოპერაცია შეუქცევადია!`);
      if (!confirmed) return;

      const progressEl = document.getElementById('clearFinancesProgress');
      if (progressEl) {
        progressEl.classList.remove('hidden');
        progressEl.textContent = 'მიმდინარეობს წაშლა...';
      }

      try {
        const allTransactions = await fetchCollectionViaRest('transactions');
        const now = new Date();
        let toDelete;

        if (scope === 'all') {
          toDelete = allTransactions;
        } else {
          toDelete = allTransactions.filter(tx => isSameCalendarMonth(tx.createdAt, now));
        }

        if (toDelete.length === 0) {
          showToast('წასაშლელი ჩანაწერები ვერ მოიძებნა', 'error');
          document.getElementById('clearFinancesModal')?.remove();
          return;
        }

        let deleted = 0;
        for (const tx of toDelete) {
          try {
            await deleteDoc(doc(db, 'transactions', tx.id));
            deleted++;
            if (progressEl) progressEl.textContent = `წაიშალა ${deleted}/${toDelete.length}...`;
          } catch (e) {
            console.error('delete tx failed', tx.id, e);
          }
        }

        if (scope === 'all') {
          window.transactions = [];
        } else {
          window.transactions = window.transactions.filter(tx => !isSameCalendarMonth(tx.createdAt, now));
        }

        updateAll();
        document.getElementById('clearFinancesModal')?.remove();
        showToast(`✅ წაიშალა ${deleted} ჩანაწერი (${scopeLabel})`, 'success');

        if (document.getElementById('finance')?.classList.contains('active')) {
          updateFinanceTab();
        }
      } catch (e) {
        console.error('clearFinances failed', e);
        showToast('გასუფთავება ვერ მოხერხდა', 'error');
        document.getElementById('clearFinancesModal')?.remove();
      }
    };

    // ფუნქცია ემეილის გასაგზავნად
    window.sendEmail = async function(toEmail, toName, subject, message, extraParams = {}) {
      try {
        const templateParams = {
          to_email: toEmail,
          to_name: toName,
          subject: subject,
          message: message,
          from_name: 'Fit House Gym',
          reply_to: 'noreply@fithousegym.local',
          ...extraParams
        };

        await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams);
        return true;
      } catch (error) {
        console.error('Email error:', error);
        showToast(`მეილი ვერ გაიგზავნა${error?.text ? `: ${error.text}` : ''}`, 'error');
        return false;
      }
    };

    // ავტომატური შეტყობინება ახალი რეგისტრაციისთვის
    async function sendWelcomeEmail(member) {
      if (!member.email) return;
      
      const subject = '🎉 კეთილი იყოს თქვენი მობრძანება Fit House Gym-ში!';
      const startDate = formatDate(member.subscriptionStartDate);
      const endDate = formatDate(member.subscriptionEndDate);
      const subType = getSubscriptionName(member.subscriptionType);
      const qrImageUrl = member.id
        ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(member.id)}`
        : '';
      const memberPortalUrl = 'https://fithouse.imed.com.ge/member';
      const message = `გამარჯობა ${member.firstName}!


კეთილი იყოს თქვენი მობრძანება Fit House Gym-ის ოჯახში! 🎉

თქვენი აბონემენტი წარმატებით გააქტიურდა.

📋 აბონემენტის დეტალები:

🎫 ტიპი: ${subType}
💰 ფასი: ${member.subscriptionPrice}₾
📅 გააქტიურების თარიღი: ${startDate}
⏰ ვადის გასვლის თარიღი: ${endDate}
${member.remainingVisits != null ? `🔢 ვიზიტების რაოდენობა: ${member.remainingVisits}` : '♾️ ვიზიტები: ულიმიტო'}

━━━━━━━━━━━━━━━━━━━━━━━━
📱 თქვენი პირადი კაბინეტი
━━━━━━━━━━━━━━━━━━━━━━━━

${memberPortalUrl}

პირად კაბინეტში შედით და ნახავთ:
✔ აბონემენტის დეტალებს
✔ ვიზიტების ისტორიას
✔ გადახდებს
✔ QR სკანირება — შესასვლელად

შესვლა:
📧 მეილი: ${member.email}
🔒 პაროლი: თქვენი პირადი ნომერი

━━━━━━━━━━━━━━━━━━━━━━━━

📍 მისამართი: თელავი, საქართველო
📞 ტელეფონი: +995 511 77 63 37

გელოდებით ჯიმში! 🔥`;
      const htmlMessage = `<div style="text-align:center;padding:16px 0;"><a href="${memberPortalUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#dc2626,#e11d48);color:white;text-decoration:none;border-radius:12px;font-weight:800;font-size:1rem;">პირად კაბინეტში შესვლა →</a><p style="color:#64748b;font-size:0.8rem;margin-top:8px;">${memberPortalUrl}</p></div>`;

      await sendEmail(member.email, member.firstName, subject, message, {
        qr_image_url: qrImageUrl,
        html_message: htmlMessage,
        qr_url: qrImageUrl
      });
    }

    window.sendMemberQrEmail = async function(memberId) {
      const member = window.members.find(m => m.id === memberId);
      if (!member) {
        showToast('წევრი ვერ მოიძებნა', 'error');
        return;
      }
      if (!member.email) {
        showToast('ამ წევრს Email არ აქვს', 'error');
        return;
      }

      const portalUrl = 'https://fithouse.imed.com.ge/member';
      const subject = '📱 თქვენი პირადი კაბინეტი — Fit House Gym';
      const message = `გამარჯობა ${member.firstName}!

📱 პირადი კაბინეტის ლინკი:
${portalUrl}

შესვლა:
📧 მეილი: ${member.email}
🔒 პაროლი: თქვენი პირადი ნომერი

კაბინეტში ნახავთ:
✔ აბონემენტის დეტალებს
✔ ვიზიტების ისტორიას
✔ გადახდებს
✔ QR სკანირება — შესასვლელად

📍 Fit House Gym | +995 511 77 63 37`;
      const htmlMessage = `<div style="text-align:center;padding:16px 0;">
        <a href="${portalUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#dc2626,#e11d48);color:white;text-decoration:none;border-radius:12px;font-weight:800;font-size:1rem;">პირად კაბინეტში შესვლა →</a>
        <p style="color:#64748b;font-size:0.8rem;margin-top:8px;">${portalUrl}</p>
        <p style="color:#94a3b8;font-size:0.85rem;margin-top:16px;">📧 მეილი: ${member.email}<br>🔒 პაროლი: თქვენი პირადი ნომერი</p>
      </div>`;

      const sent = await sendEmail(member.email, member.firstName, subject, message, {
        html_message: htmlMessage
      });

      if (sent) showToast(`ლინკი გაიგზავნა: ${member.firstName} ${member.lastName}`);
      else showToast('გაგზავნა ვერ მოხერხდა', 'error');
    };

    window.sendQrToActiveMembers = async function() {
      const targets = window.members.filter(
        m => m.email && String(m.email).trim() && getEffectiveStatus(m) === 'active'
      );
      if (targets.length === 0) {
        showToast('აქტიური წევრები Email-ით ვერ მოიძებნა', 'error');
        return;
      }
      const ok = confirm(`გაიგზავნოს კაბინეტის ლინკი ${targets.length} აქტიურ მომხმარებელთან?`);
      if (!ok) return;

      const portalUrl = 'https://fithouse.imed.com.ge/member';
      const subject = '📱 თქვენი პირადი კაბინეტი — Fit House Gym';
      let success = 0;
      let failed = 0;
      for (const member of targets) {
        const message = `გამარჯობა ${member.firstName || ''}!

📱 პირადი კაბინეტის ლინკი:
${portalUrl}

შესვლა:
📧 მეილი: ${member.email}
🔒 პაროლი: თქვენი პირადი ნომერი

კაბინეტში ნახავთ:
✔ აბონემენტის დეტალებს
✔ ვიზიტების ისტორიას
✔ გადახდებს
✔ QR სკანირება — შესასვლელად

📍 Fit House Gym | +995 511 77 63 37`;
        const htmlMessage = `<div style="text-align:center;padding:16px 0;">
          <a href="${portalUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#dc2626,#e11d48);color:white;text-decoration:none;border-radius:12px;font-weight:800;font-size:1rem;">პირად კაბინეტში შესვლა →</a>
          <p style="color:#64748b;font-size:0.8rem;margin-top:8px;">${portalUrl}</p>
          <p style="color:#94a3b8;font-size:0.85rem;margin-top:16px;">📧 მეილი: ${member.email}<br>🔒 პაროლი: თქვენი პირადი ნომერი</p>
        </div>`;

        const sent = await sendEmail(member.email, member.firstName || 'მომხმარებელი', subject, message, {
          html_message: htmlMessage
        });

        if (sent) success++;
        else failed++;
        await new Promise(resolve => setTimeout(resolve, 450));
      }

      showToast(`კაბინეტის ლინკი გაიგზავნა: ${success} წარმატებით, ${failed} შეცდომით`);
    };

    window.resetMemberPassword = async function(memberId, memberName) {
      const newPass = prompt(`პაროლის შეცვლა — ${memberName}\n\nახალი პაროლი:`);
      if (newPass === null) return; // cancelled
      if (!newPass.trim()) { showToast('პაროლი ცარიელი არ უნდა იყოს', 'error'); return; }
      const confirm2 = prompt(`დაადასტურეთ ახალი პაროლი — ${memberName}\n\nგაიმეორეთ პაროლი:`);
      if (confirm2 === null) return;
      if (newPass.trim() !== confirm2.trim()) { showToast('პაროლები არ ემთხვევა', 'error'); return; }
      try {
        await updateMemberFields(memberId, { password: newPass.trim() });
        showToast(`✅ პაროლი განახლდა: ${memberName}`);
      } catch(e) {
        console.error(e);
        showToast('პაროლის შეცვლა ვერ მოხერხდა', 'error');
      }
    };

    // ავტომატური შეტყობინება განახლებისთვის
    async function sendRenewalEmail(member) {
      if (!member.email) return;
      
      const subject = '✅ აბონემენტი წარმატებით განახლდა!';
      const renewDate = formatDate(member.subscriptionStartDate || new Date().toISOString());
      const endDate = formatDate(member.subscriptionEndDate);
      const subType = getSubscriptionName(member.subscriptionType);
      
      const memberPortalUrl = 'https://fithouse.imed.com.ge/member';
      const message = `გამარჯობა ${member.firstName}!

თქვენი Fit House Gym-ის აბონემენტი წარმატებით განახლდა! ✅

📋 განახლებული აბონემენტის დეტალები:

🎫 ტიპი: ${subType}
💰 ფასი: ${member.subscriptionPrice}₾
📅 განახლების თარიღი: ${renewDate}
⏰ ვადის გასვლის თარიღი: ${endDate}
${member.remainingVisits != null ? `🔢 ვიზიტების რაოდენობა: ${member.remainingVisits}` : '♾️ ვიზიტები: ულიმიტო'}

━━━━━━━━━━━━━━━━━━━━━━━━
📱 პირადი კაბინეტი
━━━━━━━━━━━━━━━━━━━━━━━━

${memberPortalUrl}

შესვლა:
📧 მეილი: ${member.email}
🔒 პაროლი: თქვენი პირადი ნომერი

გელოდებით ჯიმში! 🔥`;

      await sendEmail(member.email, member.firstName, subject, message);
    }

    // ავტომატური შეტყობინება 3 დღეში ვადაგასულებისთვის
    async function checkAndSendExpiringNotifications() {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      const threeDaysLater = new Date();
      threeDaysLater.setDate(now.getDate() + 3);
      threeDaysLater.setHours(23, 59, 59, 999);
      
      for (const member of window.members) {
        if (member.status !== 'active' || !member.email) continue;
        
        if (member.expiringEmailSent) continue;
        
        const endDate = new Date(member.subscriptionEndDate);
        endDate.setHours(0, 0, 0, 0);
        
        if (endDate >= now && endDate <= threeDaysLater) {
          const daysLeft = Math.ceil((endDate - now) / 86400000);
          const subject = '💪 ⏰ თქვენი Fit House Gym-ის აბონემენტი მალე იწურება';
          
          const message = `გახსენებთ, რომ თქვენი Fit House Gym-ის აბონემენტის ვადა იწურება ${daysLeft} დღეში ⏳

📅 ვადის გასვლის თარიღი: ${formatDate(member.subscriptionEndDate)}

არ გააჩერო პროგრესი — განაახლე აბონემენტი და გააგრძელე ვარჯიში ჩვენთან!

აბონემენტის განახლება შეგიძლია:
📍 პირდაპირ ჯიმში
📞 ტელეფონით: +995 511 77 63 37

ჩვენ ყოველთვის აქ ვართ შენი მიზნების მხარდასაჭერად 💥

გელოდებით Fit House Gym-ში!`;

          const sent = await sendEmail(member.email, member.firstName, subject, message);
          
          if (sent) {
            await updateMemberFields(member.id, { expiringEmailSent: true });
            console.log('Expiring notification sent to:', member.firstName, member.lastName);
          }
        }
      }
    }

    window.openBulkMessageModal = function() {
      document.getElementById('bulkMessageModal').style.display = 'flex';
      document.getElementById('bulkSubject').value = '';
      document.getElementById('bulkMessage').value = '';
    };

    window.closeBulkMessageModal = function() {
      document.getElementById('bulkMessageModal').style.display = 'none';
      document.getElementById('bulkSubject').value = '';
      document.getElementById('bulkMessage').value = '';
      document.querySelectorAll('input[name="recipientStatus"]').forEach(cb => cb.checked = false);
      document.getElementById('expiringOnly').checked = false;
      document.getElementById('expiringTemplate').checked = false;
      document.getElementById('gymClosedTemplate').checked = false;
    };

    window.loadExpiringTemplate = function() {
      if (document.getElementById('expiringTemplate').checked) {
        document.getElementById('bulkSubject').value = '💪 ⏰ თქვენი Fit House Gym-ის აბონემენტი მალე იწურება';
        document.getElementById('bulkMessage').value = `შეგახსენებთ, რომ თქვენი Fit House Gym-ის აბონემენტის ვადა მალე იწურება ⏳

არ გააჩერო პროგრესი — განაახლე აბონემენტი და გააგრძელე ვარჯიში ჩვენთან!

ჩვენ ყოველთვის მზად ვართ შენი მიზნების მხარდასაჭერად 💥

გელოდებით Fit House Gym-ში!`;
        document.getElementById('expiringOnly').checked = true;
        document.getElementById('gymClosedTemplate').checked = false;
      }
    };

    window.loadGymClosedTemplate = function() {
      if (document.getElementById('gymClosedTemplate').checked) {
        const today = new Date();
        const dateStr = `${today.getDate()} ${['იანვარს', 'თებერვალს', 'მარტს', 'აპრილს', 'მაისს', 'ივნისს', 'ივლისს', 'აგვისტოს', 'სექტემბერს', 'ოქტომბერს', 'ნოემბერს', 'დეკემბერს'][today.getMonth()]}`;
        
        document.getElementById('bulkSubject').value = '⚠️ სპორტდარბაზი დღეს დახურულია';
        document.getElementById('bulkMessage').value = `გაცნობებთ, რომ  ${dateStr} სპორტდარბაზი არ იმუშავებს ტექნიკური შეფერხების გამო.

ბოდიშს გიხდით აღნიშნული დისკომფორტისთვის!

მადლობა ერთგულებისთვის 💪`;
        document.getElementById('expiringOnly').checked = false;
        document.getElementById('expiringTemplate').checked = false;
        document.querySelectorAll('input[name="recipientStatus"]').forEach(cb => cb.checked = true);
      }
    };

    window.sendBulkMessage = async function() {
      const subject = document.getElementById('bulkSubject').value.trim();
      const message = document.getElementById('bulkMessage').value.trim();
      
      if (!subject || !message) {
        showToast('სათაური და შეტყობინება სავალდებულოა!', 'error');
        return;
      }
      
      const selectedStatuses = Array.from(document.querySelectorAll('input[name="recipientStatus"]:checked')).map(cb => cb.value);
      
      let recipients = [];
      
      if (selectedStatuses.length === 0) {
        recipients = window.members.filter(m => m.email);
      } else {
        recipients = window.members.filter(m => m.email && selectedStatuses.includes(getEffectiveStatus(m)));
      }
      
      if (document.getElementById('expiringOnly').checked) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        
        const threeDaysLater = new Date();
        threeDaysLater.setDate(now.getDate() + 3);
        threeDaysLater.setHours(23, 59, 59, 999);
        
        recipients = recipients.filter(m => {
          if (m.status !== 'active') return false;
          const endDate = new Date(m.subscriptionEndDate);
          endDate.setHours(0, 0, 0, 0);
          return endDate >= now && endDate <= threeDaysLater;
        });
      }
      
      if (recipients.length === 0) {
        showToast('მიმღები ვერ მოიძებნა!', 'error');
        return;
      }
      
      const confirmMsg = `გაიგზავნება ${recipients.length} შეტყობინება. გაგრძელება?`;
      if (!confirm(confirmMsg)) return;
      
      const btn = document.getElementById('sendBulkBtn');
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> გაგზავნა...';
      
      let successCount = 0;
      for (const member of recipients) {
        const personalizedMessage = message.replace(/{name}/g, member.firstName);
        const sent = await sendEmail(member.email, member.firstName, subject, personalizedMessage);
        if (sent) successCount++;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> გაგზავნა';
      closeBulkMessageModal();
      showToast(`✅ გაიგზავნა ${successCount}/${recipients.length} შეტყობინება`);
    };

    window.openIndividualMessageModal = function(memberId) {
      const member = window.members.find(m => m.id === memberId);
      if (!member) return;
      
      if (!member.email) {
        showToast('ამ წევრს არ აქვს ემეილი!', 'error');
        return;
      }
      
      document.getElementById('individualMemberId').value = memberId;
      document.getElementById('individualMemberName').textContent = `${member.firstName} ${member.lastName}`;
      document.getElementById('individualMemberEmail').textContent = member.email;
      
      document.getElementById('individualSubject').value = '';
      document.getElementById('individualMessage').value = '';
      
      document.getElementById('individualMessageModal').style.display = 'flex';
    };

    window.closeIndividualMessageModal = function() {
      document.getElementById('individualMessageModal').style.display = 'none';
      document.getElementById('individualSubject').value = '';
      document.getElementById('individualMessage').value = '';
    };

    window.sendIndividualMessage = async function() {
      const memberId = document.getElementById('individualMemberId').value;
      const member = window.members.find(m => m.id === memberId);
      
      if (!member) {
        showToast('წევრი ვერ მოიძებნა!', 'error');
        return;
      }
      
      const subject = document.getElementById('individualSubject').value.trim();
      const message = document.getElementById('individualMessage').value.trim();
      
      if (!subject || !message) {
        showToast('სათაური და შეტყობინება სავალდებულოა!', 'error');
        return;
      }
      
      const btn = document.getElementById('sendIndividualBtn');
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> გაგზავნა...';
      
      const personalizedMessage = message.replace(/{name}/g, member.firstName);
      const sent = await sendEmail(member.email, member.firstName, subject, personalizedMessage);
      
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> გაგზავნა';
      
      if (sent) {
        closeIndividualMessageModal();
        showToast(`✅ შეტყობინება გაიგზავნა: ${member.firstName} ${member.lastName}`);
      } else {
        showToast('შეტყობინება ვერ გაიგზავნა!', 'error');
      }
    };

    window.deleteMember = function(id) {
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50';
      modal.innerHTML = `
        <div class="bg-slate-800 p-8 rounded-2xl border-2 border-red-500 max-w-sm w-full text-center">
          <h3 class="text-2xl font-bold text-red-400 mb-4">წაშლა</h3>
          <p class="mb-6">დარწმუნებული ხართ?</p>
          <input type="password" id="deletePassword" placeholder="პაროლი" class="form-input mb-6">
          <div class="flex gap-4 justify-center">
            <button class="btn bg-red-600 hover:bg-red-700 px-8 py-3" onclick="confirmDelete('${id}', this.closest('.fixed'))">წაშლა</button>
            <button class="btn bg-gray-600 hover:bg-gray-700 px-8 py-3" onclick="this.closest('.fixed').remove()">გაუქმება</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    };

    window.confirmDelete = async function(id, modal) {
      const pass = document.getElementById('deletePassword').value;
      const passHash = await sha256Hex(pass);
      if (!verifyCurrentUserPasswordHash(passHash)) {
        showToast("პაროლი არასწორია!", "error");
        return;
      }
      try {
        await deleteDoc(doc(db, "members", id));
        showToast("წევრი წაიშალა!");
        modal.remove();
        const details = document.getElementById(`details-${id}`);
        if (details) details.remove();
      } catch (e) {
        showToast("შეცდომა", "error");
      }
    };

    function loadMembers() {
      hydrateMembersFromRest();
      const q = query(collection(db, "members"));
      onSnapshot(q, (snapshot) => {
        window.members = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        membersLoadedOnce = true;
        updateAll();
        checkUrlQrParam();
        queueTodayMembershipTransactionReconcile();
      }, (error) => {
        console.warn('members snapshot failed, using rest fallback', error);
        hydrateMembersFromRest();
      });
    }

    function loadProducts() {
      hydrateProductsFromRest();
      const q = query(collection(db, "products"));
      onSnapshot(q, (snapshot) => {
        window.products = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ka'));
        updateAll();
      }, (error) => {
        console.warn('products snapshot failed, using rest fallback', error);
        hydrateProductsFromRest();
      });
    }

    function loadTransactions() {
      hydrateTransactionsFromRest();
      if (transactionsPollingStarted) return;
      transactionsPollingStarted = true;
      const q = query(collection(db, "transactions"));
      onSnapshot(q, (snapshot) => {
        window.transactions = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        transactionsLoadedOnce = true;
        updateAll();
        queueTodayMembershipTransactionReconcile();
      }, (error) => {
        console.warn('transactions snapshot failed, using rest fallback', error);
        setInterval(() => {
          if (isAuthenticated) hydrateTransactionsFromRest();
        }, 15000);
      });
    }

    function loadUsers() {
      hydrateUsersFromRest();
      if (usersStreamStarted) return;
      usersStreamStarted = true;
      const q = query(collection(db, "users"));
      onSnapshot(q, (snapshot) => {
        window.users = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.firstName || a.username || '').localeCompare(String(b.firstName || b.username || ''), 'ka'));
        usersLoadedOnce = true;
        if (currentUser?.id) {
          const refreshedCurrentUser = window.users.find((item) => item.id === currentUser.id);
          if (refreshedCurrentUser) {
            currentUser = refreshedCurrentUser;
            currentUserRole = refreshedCurrentUser.role === 'admin' ? 'admin' : 'operator';
          }
        }
        safeUiUpdate('users', updateUsersTab);
        safeUiUpdate('settings', updateSettingsTab);
        safeUiUpdate('stats', updateStatsTab);
        applyRoleVisibility();
      }, (error) => {
        console.warn('users snapshot failed, using rest fallback', error);
        hydrateUsersFromRest();
      });
    }

    function loadActivityLogs() {
      hydrateActivityLogsFromRest();
      if (activityLogsStreamStarted) return;
      activityLogsStreamStarted = true;
      const q = query(collection(db, "activity_logs"));
      onSnapshot(q, (snapshot) => {
        window.activityLogs = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        activityLogsLoadedOnce = true;
        safeUiUpdate('dashboard', updateDashboard);
        safeUiUpdate('stats', updateStatsTab);
      }, (error) => {
        console.warn('activity logs snapshot failed, using rest fallback', error);
        hydrateActivityLogsFromRest();
      });
    }

    async function recordUserActivity(type, user, meta = {}) {
      if (!user) return false;
      const payload = {
        type,
        actorUserId: user.id || null,
        actorUsername: user.username || null,
        actorFirstName: user.firstName || null,
        actorLastName: user.lastName || null,
        actorFullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'უცნობი',
        actorRole: user.role || 'operator',
        description: type === 'login' ? 'პროგრამაში შევიდა' : 'აქტივობა',
        createdAt: new Date().toISOString(),
        ...meta
      };
      try {
        const docRef = await addDoc(collection(db, "activity_logs"), payload);
        window.activityLogs = [{ id: docRef.id, ...payload }, ...window.activityLogs].slice(0, 50);
        safeUiUpdate('dashboard', updateDashboard);
        safeUiUpdate('stats', updateStatsTab);
        return true;
      } catch (e) {
        console.warn('activity log write failed', e);
        return false;
      }
    }

    async function createMember(m, options = {}) {
      try { 
        const memberPayload = {
          ...m,
          createdByUserId: m.createdByUserId || currentUser?.id || null,
          createdByFullName: m.createdByFullName || getCurrentUserDisplayName() || null,
          createdByUsername: m.createdByUsername || currentUser?.username || null,
          createdByRole: m.createdByRole || currentUserRole || null,
          lastMembershipPaymentMethod: options.paymentMethod || m.lastMembershipPaymentMethod || 'CASH',
          lastMembershipPaymentNote: options.note || m.lastMembershipPaymentNote || null,
          lastMembershipHandledByUserId: currentUser?.id || null,
          lastMembershipHandledByUsername: currentUser?.username || null,
          lastMembershipHandledByFullName: getCurrentUserDisplayName() || null,
          lastMembershipHandledByRole: currentUserRole || null,
          lastMembershipHandledAt: new Date().toISOString()
        };
        const docRef = await addDoc(collection(db, "members"), memberPayload);
        const memberWithId = { ...memberPayload, id: docRef.id };
        const membershipTransactionSaved = await recordMembershipTransaction('membership_registration', memberWithId, options);
        await logDateAudit(
          'create_member',
          memberWithId,
          { startDate: null, endDate: null },
          { startDate: memberPayload.subscriptionStartDate, endDate: memberPayload.subscriptionEndDate },
          { source: 'registration_form' }
        );
        showToast("დარეგისტრირდა!");
        if (!membershipTransactionSaved) {
          showToast('ფინანსური ჩანაწერი მოგვიანებით აღდგება', 'warning');
        }
        
        if (memberPayload.email) {
          // მხოლოდ ერთი წერილი: welcome + QR იმავე წერილში
          setTimeout(() => sendWelcomeEmail(memberWithId), 1000);
        }
        return true;
      }
      catch (e) { 
        console.error(e);
        showToast("შეცდომა", 'error'); 
        return false;
      }
    }

    async function updateMember(m) {
      try { 
        await setDoc(doc(db, "members", m.id), m, { merge: true }); 
        return true;
      }
      catch (e) { 
        console.error(e); 
        showToast('წევრის შენახვა ვერ მოხერხდა', 'error');
        return false;
      }
    }

    async function updateMemberFields(id, fields) {
      try {
        await setDoc(doc(db, "members", id), fields, { merge: true });
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    }

    async function saveProductRecord(product, options = {}) {
      let savedId = product.id || null;
      let payload = null;
      try {
        const { id, ...restPayload } = product;
        payload = restPayload;
        if (id) {
          await setDoc(doc(db, "products", id), payload, { merge: true });
        } else {
          const docRef = await addDoc(collection(db, "products"), payload);
          savedId = docRef.id;
        }
      } catch (e) {
        console.error('product save failed', e);
        try {
          const restProducts = await fetchProductsViaRest();
          const recoveredProduct = product.id
            ? restProducts.find((item) => item.id === product.id)
            : restProducts.find((item) =>
                normalizeProductCode(item.code) === normalizeProductCode(payload?.code) &&
                String(item.name || '').trim() === String(payload?.name || '').trim() &&
                Number(item.price || 0) === Number(payload?.price || 0)
              );

          if (recoveredProduct) {
            window.products = restProducts;
            updateAll();
            console.warn('product save recovered from firestore after SDK error', recoveredProduct.id);
            return { ok: true, id: recoveredProduct.id, product: recoveredProduct, recovered: true };
          }
        } catch (recoveryError) {
          console.error('product save recovery failed', recoveryError);
        }
        if (!options.silent) {
          showToast('პროდუქტის შენახვა ვერ მოხერხდა', 'error');
        }
        return { ok: false, id: null, product: null };
      }
      const savedProduct = { id: savedId, ...payload };
      try {
        upsertLocalProduct(savedProduct);
      } catch (e) {
        console.error('local product update failed', e);
      }
      return { ok: true, id: savedId, product: savedProduct };
    }

    function dateKey(iso) {
      if (!iso) return '';
      return toDateInputValue(iso);
    }

    function getMembershipFinanceSuppressionKey(type, isoDate) {
      return `${type}:${dateKey(isoDate)}`;
    }

    function hasDateChanged(beforeDates, afterDates) {
      return dateKey(beforeDates?.startDate) !== dateKey(afterDates?.startDate) ||
        dateKey(beforeDates?.endDate) !== dateKey(afterDates?.endDate);
    }

    async function logDateAudit(action, member, beforeDates, afterDates, meta = {}) {
      const payload = {
        action,
        memberId: member?.id || null,
        memberName: `${member?.firstName || ''} ${member?.lastName || ''}`.trim(),
        personalId: member?.personalId || null,
        beforeStartDate: beforeDates?.startDate || null,
        beforeEndDate: beforeDates?.endDate || null,
        afterStartDate: afterDates?.startDate || null,
        afterEndDate: afterDates?.endDate || null,
        changedAt: new Date().toISOString(),
        meta
      };

      console.info('[DATE_AUDIT]', payload);
      try {
        await addDoc(collection(db, "member_date_history"), payload);
      } catch (e) {
        console.error('date audit write failed', e);
      }
    }

    function getMonthKey(iso) {
      if (!iso) return '';
      const date = new Date(iso);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    function formatMonthKey(key) {
      if (!key) return '—';
      const [year, month] = String(key).split('-').map(Number);
      return new Intl.DateTimeFormat('ka-GE', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
    }

    function buildAdminTable(headers, rows, emptyText = 'მონაცემები არ არის') {
      if (!rows.length) {
        return `<div class="empty-state">${emptyText}</div>`;
      }
      return `
        <table class="admin-table">
          <thead>
            <tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows.join('')}
          </tbody>
        </table>
      `;
    }

    function getFinanceArchiveRows() {
      const grouped = {};
      getSortedTransactions().forEach((tx) => {
        const monthKey = getMonthKey(tx.createdAt);
        if (!monthKey) return;
        if (!grouped[monthKey]) {
          grouped[monthKey] = {
            monthKey,
            membershipAmount: 0,
            membershipCount: 0,
            productAmount: 0,
            productCount: 0,
            productUnits: 0,
            totalAmount: 0
          };
        }
        const row = grouped[monthKey];
        row.totalAmount += Number(tx.amount || 0);
        if (tx.category === 'membership') {
          row.membershipAmount += Number(tx.amount || 0);
          row.membershipCount += 1;
        }
        if (tx.type === 'product_sale') {
          row.productAmount += Number(tx.amount || 0);
          row.productCount += 1;
          row.productUnits += Number(tx.quantity || 0);
        }
      });

      return Object.values(grouped).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
    }

    function getOperatorMonthlyStats() {
      const membershipTransactions = getSortedTransactions().filter((tx) => tx.category === 'membership');
      const months = {};
      const operators = {};

      membershipTransactions.forEach((tx) => {
        const monthKey = getMonthKey(tx.createdAt);
        const actorKey = tx.actorUserId || tx.actorUsername || tx.actorFullName || 'unknown';
        const actorName = tx.actorFullName || tx.actorUsername || 'უცნობი';

        if (!months[monthKey]) months[monthKey] = {};
        if (!months[monthKey][actorKey]) {
          months[monthKey][actorKey] = {
            actorKey,
            actorName,
            count: 0,
            renewals: 0,
            registrations: 0,
            amount: 0
          };
        }
        if (!operators[actorKey]) {
          operators[actorKey] = {
            actorKey,
            actorName,
            count: 0,
            renewals: 0,
            registrations: 0,
            amount: 0
          };
        }

        const monthRow = months[monthKey][actorKey];
        const operatorRow = operators[actorKey];
        [monthRow, operatorRow].forEach((row) => {
          row.count += 1;
          row.amount += Number(tx.amount || 0);
          if (tx.type === 'membership_renewal') row.renewals += 1;
          if (tx.type === 'membership_registration') row.registrations += 1;
        });
      });

      const monthlyLeaders = Object.entries(months)
        .map(([monthKey, actorsMap]) => {
          const actors = Object.values(actorsMap).sort((a, b) => (b.count - a.count) || (b.amount - a.amount));
          return {
            monthKey,
            leader: actors[0] || null,
            actors
          };
        })
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey));

      const operatorsAggregate = Object.values(operators).sort((a, b) => (b.count - a.count) || (b.amount - a.amount));
      return { monthlyLeaders, operatorsAggregate };
    }

    function getLoyalMembersMonthlyStats() {
      const membershipTransactions = getSortedTransactions().filter((tx) =>
        tx.category === 'membership' && tx.memberId
      );
      const months = {};

      membershipTransactions.forEach((tx) => {
        const monthKey = getMonthKey(tx.createdAt);
        const member = window.members.find((item) => item.id === tx.memberId);
        const memberKey = tx.memberId;
        const memberName = tx.memberName || (member ? `${member.firstName || ''} ${member.lastName || ''}`.trim() : 'უცნობი');

        if (!months[monthKey]) months[monthKey] = {};
        if (!months[monthKey][memberKey]) {
          months[monthKey][memberKey] = {
            memberId: memberKey,
            memberName,
            renewals: 0,
            registrations: 0,
            amount: 0,
            visits: Number(member?.totalVisits || 0),
            activeStatus: getEffectiveStatus(member || {}) || 'expired'
          };
        }

        const row = months[monthKey][memberKey];
        row.amount += Number(tx.amount || 0);
        row.visits = Number(member?.totalVisits || row.visits || 0);
        row.activeStatus = member ? getEffectiveStatus(member) : row.activeStatus;
        if (tx.type === 'membership_renewal') row.renewals += 1;
        if (tx.type === 'membership_registration') row.registrations += 1;
      });

      return Object.entries(months)
        .map(([monthKey, membersMap]) => {
          const members = Object.values(membersMap)
            .map((item) => ({
              ...item,
              loyaltyScore: (item.renewals * 4) + (item.registrations * 2) + (Math.min(item.visits, 300) * 0.05)
            }))
            .sort((a, b) => (b.loyaltyScore - a.loyaltyScore) || (b.visits - a.visits) || (b.amount - a.amount));
          return {
            monthKey,
            leader: members[0] || null,
            members
          };
        })
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
    }

    function getNameInitials(name) {
      const words = String(name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);
      if (!words.length) return '—';
      return words.map((word) => word.charAt(0).toUpperCase()).join('');
    }

    function renderStatsRevenueBars(rows) {
      if (!rows.length) {
        return '<div class="empty-state">თვიური მონაცემები ჯერ არ არის</div>';
      }
      const chartRows = [...rows].slice(0, 6).reverse();
      const maxTotal = Math.max(...chartRows.map((row) => Number(row.totalAmount || 0)), 1);
      return `
        <div class="stats-bars-grid">
          ${chartRows.map((row) => {
            const total = Number(row.totalAmount || 0);
            const membershipAmount = Number(row.membershipAmount || 0);
            const productAmount = Number(row.productAmount || 0);
            const totalHeight = Math.max(18, Math.round((total / maxTotal) * 220));
            const membershipHeight = total > 0 ? Math.max(10, Math.round((membershipAmount / total) * totalHeight)) : 0;
            const productHeight = Math.max(6, totalHeight - membershipHeight);
            return `
              <div class="stats-bar-item">
                <div class="stats-bar-value">${formatCurrency(total)}</div>
                <div class="stats-bar-column">
                  <div class="stats-bar-fill stats-bar-fill-product" style="height:${productHeight}px"></div>
                  <div class="stats-bar-fill stats-bar-fill-membership" style="height:${membershipHeight}px"></div>
                </div>
                <div class="stats-bar-label">${formatMonthKey(row.monthKey)}</div>
                <div class="stats-bar-meta">${row.membershipCount} აბო • ${row.productCount} გაყიდვა</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    function renderStatsOperatorBoard(items) {
      if (!items.length) {
        return '<div class="empty-state">ოპერატორების მონაცემები ჯერ არ არის</div>';
      }
      const boardItems = items.slice(0, 5);
      const maxCount = Math.max(...boardItems.map((item) => Number(item.count || 0)), 1);
      return `
        <div class="stats-board-list">
          ${boardItems.map((item, index) => {
            const progress = Math.max(10, Math.round((Number(item.count || 0) / maxCount) * 100));
            return `
              <div class="stats-board-item">
                <div class="stats-board-rank">#${index + 1}</div>
                <div class="stats-board-avatar">${getNameInitials(item.actorName)}</div>
                <div class="stats-board-main">
                  <div class="stats-board-top">
                    <strong>${item.actorName}</strong>
                    <span>${formatCurrency(item.amount)}</span>
                  </div>
                  <div class="stats-board-meta">${item.count} აბონემენტი • ${item.renewals} განახლება</div>
                  <div class="stats-board-progress">
                    <span style="width:${progress}%"></span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    function renderStatsMonthlyLeaders(monthlyLeaders) {
      if (!monthlyLeaders.length) {
        return '<div class="empty-state">თვიური ლიდერები ჯერ არ არის</div>';
      }
      return `
        <div class="stats-leader-list">
          ${monthlyLeaders.slice(0, 6).map((item) => `
            <div class="stats-leader-item">
              <div class="stats-leader-month">${formatMonthKey(item.monthKey)}</div>
              <div class="stats-leader-main">
                <div class="stats-leader-name">${item.leader?.actorName || '—'}</div>
                <div class="stats-leader-badges">
                  <span class="stats-badge"><i class="fas fa-id-card"></i> ${item.leader?.count || 0}</span>
                  <span class="stats-badge"><i class="fas fa-rotate"></i> ${item.leader?.renewals || 0}</span>
                  <span class="stats-badge stats-badge-strong"><i class="fas fa-sack-dollar"></i> ${formatCurrency(item.leader?.amount || 0)}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    function renderStatsArchiveCards(rows) {
      if (!rows.length) {
        return '<div class="empty-state">თვიური არქივი ჯერ არ არის</div>';
      }
      const maxTotal = Math.max(...rows.map((row) => Number(row.totalAmount || 0)), 1);
      return `
        <div class="stats-archive-grid">
          ${rows.slice(0, 8).map((row) => {
            const progress = Math.max(8, Math.round((Number(row.totalAmount || 0) / maxTotal) * 100));
            return `
              <div class="stats-archive-card">
                <div class="stats-archive-head">
                  <strong>${formatMonthKey(row.monthKey)}</strong>
                  <span>${formatCurrency(row.totalAmount)}</span>
                </div>
                <div class="stats-archive-progress"><span style="width:${progress}%"></span></div>
                <div class="stats-archive-meta">
                  <div><span>აბონემენტი</span><strong>${formatCurrency(row.membershipAmount)} · ${row.membershipCount}</strong></div>
                  <div><span>პროდუქტი</span><strong>${formatCurrency(row.productAmount)} · ${row.productUnits} ც</strong></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    function renderStatsOperatorRank(items) {
      if (!items.length) {
        return '<div class="empty-state">ოპერატორების სტატისტიკა ჯერ არ არის</div>';
      }
      return `
        <div class="stats-rank-grid">
          ${items.map((item, index) => `
            <div class="stats-rank-card">
              <div class="stats-rank-top">
                <div class="stats-rank-badge">#${index + 1}</div>
                <div class="stats-rank-avatar">${getNameInitials(item.actorName)}</div>
                <div class="stats-rank-name-block">
                  <div class="stats-rank-name">${item.actorName}</div>
                  <div class="stats-rank-sub">${item.registrations} ახალი • ${item.renewals} განახლება</div>
                </div>
                <div class="stats-rank-amount">${formatCurrency(item.amount)}</div>
              </div>
              <div class="stats-rank-footer">
                <span><i class="fas fa-id-card"></i> ${item.count} აბონემენტი</span>
                <span><i class="fas fa-coins"></i> საშუალო ${formatCurrency(item.count ? item.amount / item.count : 0)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    function renderStatsLoyalMembers(monthlyMembers) {
      if (!monthlyMembers.length) {
        return '<div class="empty-state">ერთგული მომხმარებლების სტატისტიკა ჯერ არ არის</div>';
      }
      return `
        <div class="stats-loyal-grid">
          ${monthlyMembers.slice(0, 6).map((item) => {
            const leader = item.leader;
            if (!leader) return '';
            return `
              <div class="stats-loyal-card">
                <div class="stats-loyal-head">
                  <strong>${formatMonthKey(item.monthKey)}</strong>
                  <span class="status-badge ${leader.activeStatus === 'active' ? 'status-active' : 'status-expired'}">
                    ${leader.activeStatus === 'active' ? 'აქტიური' : 'ვადაგასული'}
                  </span>
                </div>
                <div class="stats-loyal-name-row">
                  <div class="stats-loyal-avatar">${getNameInitials(leader.memberName)}</div>
                  <div class="stats-loyal-main">
                    <div class="stats-loyal-name">${leader.memberName}</div>
                    <div class="stats-loyal-sub">ID: ${leader.memberId}</div>
                  </div>
                  <strong>${leader.loyaltyScore.toFixed(1)}</strong>
                </div>
                <div class="stats-loyal-badges">
                  <span class="stats-badge"><i class="fas fa-repeat"></i> ${leader.renewals} განახლება</span>
                  <span class="stats-badge"><i class="fas fa-user-plus"></i> ${leader.registrations} რეგისტრაცია</span>
                  <span class="stats-badge"><i class="fas fa-dumbbell"></i> ${leader.visits} ვიზიტი</span>
                  <span class="stats-badge stats-badge-strong"><i class="fas fa-sack-dollar"></i> ${formatCurrency(leader.amount)}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    function getRecentSignups(limit = 4) {
      return getSortedActivityLogs()
        .filter((item) => item.type === 'login')
        .slice(0, limit);
    }

    function renderRecentSignupsList(targetId = 'dashboardRecentSignups', limit = 4) {
      const container = document.getElementById(targetId);
      if (!container) return;

      const signups = getRecentSignups(limit);
      if (!signups.length) {
        container.innerHTML = '<div class="empty-state">ავტორიზაციის ლოგები ჯერ არ არის</div>';
        return;
      }

      container.innerHTML = signups.map((log) => `
        <div class="dashboard-signup-item">
          <div class="dashboard-signup-avatar">${getNameInitials(log.actorFullName)}</div>
          <div class="dashboard-signup-main">
            <div class="dashboard-signup-top">
              <strong>${log.actorFullName || log.actorUsername || 'უცნობი'}</strong>
              <span>${formatTimeAgo(log.createdAt)}</span>
            </div>
            <div class="dashboard-signup-meta">${getRoleLabel(log.actorRole)} • ${log.description || 'პროგრამაში შევიდა'} • ${formatDateTime(log.createdAt)}</div>
          </div>
        </div>
      `).join('');
    }

    function renderDashboardRecentTransactions() {
      const container = document.getElementById('dashboardRecentTransactions');
      if (!container) return;

      const recentTransactions = getSortedTransactions().slice(0, 5);
      if (!recentTransactions.length) {
        container.innerHTML = '<div class="empty-state">ტრანზაქციები ჯერ არ არის</div>';
        return;
      }

      container.innerHTML = recentTransactions.map((tx) => buildTransactionRowHtml({
        title: tx.description || (tx.category === 'membership' ? 'აბონემენტი' : 'პროდუქტი'),
        meta: `${formatDateTime(tx.createdAt)} • ${tx.category === 'membership' ? 'აბონემენტი' : 'პროდუქტი'}${tx.paymentMethod ? ` • ${getPaymentMethodLabel(tx.paymentMethod)}` : ''}${tx.actorFullName ? ` • ${tx.actorFullName}` : ''}`,
        amount: formatCurrency(tx.amount),
        tx
      })).join('');
    }

    function renderDashboardQuickBreakdown() {
      const container = document.getElementById('dashboardQuickBreakdown');
      if (!container) return;

      const summary = getFinancialSummary();
      const archiveRows = getFinanceArchiveRows();
      const bestMonth = [...archiveRows].sort((a, b) => b.totalAmount - a.totalAmount)[0] || null;

      container.innerHTML = `
        <div class="dashboard-quick-card">
          <span>დღეს აბონემენტები</span>
          <strong>${summary.todayRegistrationCount + summary.todayRenewalCount}</strong>
          <small>${formatCurrency(summary.todayMembership)}</small>
        </div>
        <div class="dashboard-quick-card">
          <span>დღეს პროდუქტები</span>
          <strong>${summary.todayProductSalesCount}</strong>
          <small>${formatCurrency(summary.todayProducts)}</small>
        </div>
        <div class="dashboard-quick-card">
          <span>ამ თვეში სულ</span>
          <strong>${formatCurrency(summary.monthTotal)}</strong>
          <small>${summary.monthMembershipCount} აბონემენტი • ${summary.monthProductUnits} ცალი</small>
        </div>
        <div class="dashboard-quick-card">
          <span>საუკეთესო თვე</span>
          <strong>${bestMonth ? formatMonthKey(bestMonth.monthKey) : '—'}</strong>
          <small>${bestMonth ? formatCurrency(bestMonth.totalAmount) : '0.00₾'}</small>
        </div>
      `;
    }

    function updateUsersTab() {
      const container = document.getElementById('usersTable');
      if (!container) return;

      const searchValue = normalizeUsername(document.getElementById('userSearchInput')?.value);
      const users = window.users.filter((user) => {
        if (!searchValue) return true;
        return normalizeUsername(`${user.firstName || ''} ${user.lastName || ''}`).includes(searchValue) ||
          normalizeUsername(user.username).includes(searchValue);
      });

      const rows = users.map((user) => `
        <tr>
          <td>${user.firstName || '—'} ${user.lastName || ''}</td>
          <td>${user.username || '—'}</td>
          <td>${user.personalId || '—'}</td>
          <td>${user.email || '—'}</td>
          <td><span class="status-badge ${user.role === 'admin' ? 'status-active' : 'status-paused'}">${getRoleLabel(user.role)}</span></td>
          <td><span class="status-badge ${user.status === 'disabled' ? 'status-expired' : 'status-active'}">${user.status === 'disabled' ? 'გამორთული' : 'აქტიური'}</span></td>
          <td>${formatDateTime(user.updatedAt || user.createdAt)}</td>
          <td>
            <div class="admin-action-row">
              <button class="btn bg-blue-600 hover:bg-blue-700 compact-btn" onclick="window.openUserForm('${user.id}')"><i class="fas fa-pen"></i> რედაქტირება</button>
              <button class="btn bg-amber-600 hover:bg-amber-700 compact-btn" onclick="window.openResetUserPasswordModal('${user.id}')"><i class="fas fa-key"></i> პაროლი</button>
            </div>
          </td>
        </tr>
      `);

      container.innerHTML = buildAdminTable(
        ['სახელი / გვარი', 'იუზერი', 'პირადი ნომერი', 'Email', 'როლი', 'სტატუსი', 'განახლდა', 'ქმედება'],
        rows,
        'იუზერები ჯერ არ არის'
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TRAINERS MODULE
    // ═══════════════════════════════════════════════════════════════════════

    const TRAINER_SPECIALIZATIONS = ['CrossFit', 'Bodybuilding', 'Cardio', 'Yoga', 'Pilates', 'Functional', 'Powerlifting', 'Boxing', 'სხვა'];

    function getActiveTrainers() {
      return (window.trainers || []).filter((t) => (t.status || 'active') !== 'disabled');
    }

    function getTrainerById(id) {
      return (window.trainers || []).find((t) => t.id === id) || null;
    }

    function getTrainerName(id) {
      const t = getTrainerById(id);
      return t ? `${t.firstName || ''} ${t.lastName || ''}`.trim() : '';
    }

    function getTrainerClientCount(trainerId) {
      return (window.members || []).filter((m) =>
        m.trainerId === trainerId && m.trainerServiceEnabled && getEffectiveStatus(m) === 'active'
      ).length;
    }

    function buildTrainerOptions(selectedId) {
      const active = getActiveTrainers();
      const opts = active.map((t) =>
        `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${t.firstName} ${t.lastName}${t.specialization ? ' — ' + t.specialization : ''}</option>`
      ).join('');
      return `<option value="">— აირჩიეთ ტრენერი —</option>${opts}`;
    }

    window.toggleRegTrainer = function() {
      const checked = document.getElementById('regTrainerService').checked;
      const wrap = document.getElementById('regTrainerSelectWrap');
      const section = document.getElementById('trainerServiceSection');
      const track = document.getElementById('regTrainerToggleTrack');
      const thumb = document.getElementById('regTrainerToggleThumb');
      wrap.style.display = checked ? 'block' : 'none';
      if (section) section.style.borderColor = checked ? 'rgba(239,68,68,0.6)' : 'rgba(239,68,68,0.3)';
      if (track) { track.style.background = checked ? '#ef4444' : '#1e293b'; track.style.borderColor = checked ? '#ef4444' : '#334155'; }
      if (thumb) { thumb.style.transform = checked ? 'translateX(24px)' : 'none'; thumb.style.background = checked ? '#fff' : '#64748b'; }
      if (checked) {
        document.getElementById('regTrainerId').innerHTML = buildTrainerOptions('');
      }
    };

    window.toggleRegisterTrainerSession = function() {
      const checked = Boolean(document.getElementById('regTrainerSessionIncluded')?.checked);
      const wrap = document.getElementById('regTrainerSessionWrap');
      const track = document.getElementById('regTrainerSessionTrack');
      const thumb = document.getElementById('regTrainerSessionThumb');
      if (wrap) wrap.style.display = checked ? 'block' : 'none';
      if (track) {
        track.style.background = checked ? '#2563eb' : '#1e293b';
        track.style.borderColor = checked ? '#3b82f6' : '#334155';
      }
      if (thumb) {
        thumb.style.transform = checked ? 'translateX(24px)' : 'none';
        thumb.style.background = checked ? '#fff' : '#64748b';
      }
      if (!checked) {
        const price = document.getElementById('regTrainerSessionPrice');
        const gift = document.getElementById('regTrainerSessionGift');
        if (price) price.value = '';
        if (gift) gift.checked = false;
      }
    };

    window.toggleEditTrainer = function(id) {
      const checked = document.getElementById(`e_trainerService_${id}`).checked;
      const wrap = document.getElementById(`e_trainerSelectWrap_${id}`);
      wrap.style.display = checked ? 'block' : 'none';
    };

    function updateTrainersTab() {
      const container = document.getElementById('trainersTable');
      if (!container) return;

      const searchValue = normalizeUsername(document.getElementById('trainerSearchInput')?.value);
      let trainers = (window.trainers || []).map((t) => ({
        ...t,
        clientCount: getTrainerClientCount(t.id)
      }));
      trainers.sort((a, b) => b.clientCount - a.clientCount);

      const filtered = trainers.filter((t) => {
        if (!searchValue) return true;
        return normalizeUsername(`${t.firstName || ''} ${t.lastName || ''}`).includes(searchValue) ||
          normalizeUsername(t.username).includes(searchValue) ||
          normalizeUsername(t.specialization).includes(searchValue);
      });

      const rows = filtered.map((t, idx) => {
        const rank = idx + 1;
        const rankBadge = rank <= 3
          ? `<span class="status-badge status-active" style="font-weight:800;">#${rank}</span>`
          : `<span style="color:#94a3b8;font-weight:700;">#${rank}</span>`;
        const photo = t.photoUrl
          ? `<img src="${t.photoUrl}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'">`
          : `<div style="width:36px;height:36px;border-radius:50%;background:rgba(239,68,68,0.15);color:#ef4444;display:flex;align-items:center;justify-content:center;font-weight:800;">${(t.firstName || '?').charAt(0)}</div>`;
        return `
          <tr>
            <td>${rankBadge}</td>
            <td><div style="display:flex;align-items:center;gap:10px;">${photo}<span>${t.firstName || '—'} ${t.lastName || ''}</span></div></td>
            <td><strong>${t.clientCount}</strong> კლიენტი</td>
            <td>${t.phone || '—'}</td>
            <td>${t.username || '—'}</td>
            <td><span class="status-badge ${t.status === 'disabled' ? 'status-expired' : 'status-active'}">${t.status === 'disabled' ? 'არააქტიური' : 'აქტიური'}</span></td>
            <td>
              <div class="admin-action-row">
                ${isAdmin() ? `<button class="btn bg-blue-600 hover:bg-blue-700 compact-btn" onclick="window.openTrainerForm('${t.id}')"><i class="fas fa-pen"></i> რედაქტ.</button>` : ''}
                ${isAdmin() ? `<button class="btn bg-red-600 hover:bg-red-700 compact-btn" onclick="window.deleteTrainer('${t.id}')"><i class="fas fa-trash"></i> წაშლა</button>` : ''}
                ${!isAdmin() ? `<span style="color:#64748b;font-size:0.82rem;">— მხოლოდ ნახვა —</span>` : ''}
              </div>
            </td>
          </tr>
        `;
      });

      container.innerHTML = buildAdminTable(
        ['რენქი', 'სახელი / გვარი', 'კლიენტები', 'ტელეფონი', 'იუზერი', 'სტატუსი', 'ქმედება'],
        rows,
        'ტრენერები ჯერ არ არის'
      );
    }

    async function saveTrainerRecord(trainer) {
      try {
        const { id, ...payload } = trainer;
        if (id) {
          await setDoc(doc(db, "trainers", id), payload, { merge: true });
          return { ok: true, id };
        }
        const docRef = await addDoc(collection(db, "trainers"), payload);
        return { ok: true, id: docRef.id };
      } catch (e) {
        console.error('trainer save failed', e);
        showToast('ტრენერის შენახვა ვერ მოხერხდა', 'error');
        return { ok: false };
      }
    }

    window.openTrainerForm = function(trainerId = '') {
      const t = trainerId ? getTrainerById(trainerId) : null;
      document.getElementById('trainerFormTitle').textContent = t ? 'ტრენერის რედაქტირება' : 'ტრენერის დამატება';
      document.getElementById('trainerFormId').value = t?.id || '';
      document.getElementById('trainerFirstName').value = t?.firstName || '';
      document.getElementById('trainerLastName').value = t?.lastName || '';
      document.getElementById('trainerPhone').value = t?.phone || '';
      document.getElementById('trainerUsername').value = t?.username || '';
      document.getElementById('trainerPassword').value = '';
      document.getElementById('trainerPhotoUrl').value = t?.photoUrl || '';
      document.getElementById('trainerStatus').value = t?.status || 'active';
      document.getElementById('trainerFormModal').style.display = 'flex';
    };

    window.closeTrainerForm = function() {
      document.getElementById('trainerFormModal').style.display = 'none';
    };

    window.saveTrainer = async function() {
      const id = document.getElementById('trainerFormId').value;
      const firstName = document.getElementById('trainerFirstName').value.trim();
      const lastName = document.getElementById('trainerLastName').value.trim();
      const phone = document.getElementById('trainerPhone').value.trim();
      const username = normalizeUsername(document.getElementById('trainerUsername').value);
      const password = document.getElementById('trainerPassword').value;
      const photoUrl = document.getElementById('trainerPhotoUrl').value.trim() || null;
      const status = document.getElementById('trainerStatus').value === 'disabled' ? 'disabled' : 'active';

      if (!firstName || !lastName || !username) {
        showToast('სახელი, გვარი და იუზერი სავალდებულოა', 'error');
        return;
      }
      if (!id && !password) {
        showToast('ახალ ტრენერზე პაროლი სავალდებულოა', 'error');
        return;
      }
      const usernameTaken = (window.trainers || []).some((t) =>
        normalizeUsername(t.username) === username && t.id !== id);
      if (usernameTaken) {
        showToast('ეს იუზერი უკვე არსებობს', 'error');
        return;
      }

      const existing = id ? getTrainerById(id) : null;
      const nowIso = new Date().toISOString();
      const passwordHash = password ? await sha256Hex(password) : existing?.passwordHash || null;
      const payload = {
        firstName, lastName, phone, username, passwordHash,
        photoUrl, status, role: 'trainer',
        updatedAt: nowIso,
        createdAt: existing?.createdAt || nowIso
      };
      if (id) payload.id = id;

      const saved = await saveTrainerRecord(payload);
      if (!saved.ok) return;
      logDateAudit('trainer_save', { id: saved.id, firstName, lastName, personalId: username }, null, null, { action: id ? 'edit' : 'create' });
      showToast(id ? 'ტრენერი განახლდა' : 'ტრენერი დაემატა');
      window.closeTrainerForm();
      hydrateTrainersFromRest();
    };

    window.deleteTrainer = async function(trainerId) {
      const t = getTrainerById(trainerId);
      if (!t) return;
      if (!confirm(`წავშალოთ ტრენერი ${t.firstName} ${t.lastName}?`)) return;
      try {
        await deleteDoc(doc(db, "trainers", trainerId));
        // Unassign from members
        const assigned = (window.members || []).filter((m) => m.trainerId === trainerId);
        for (const m of assigned) {
          await updateMemberFields(m.id, { trainerId: null, trainerServiceEnabled: false });
        }
        showToast('ტრენერი წაიშალა');
        hydrateTrainersFromRest();
      } catch (e) {
        console.error('trainer delete failed', e);
        showToast('წაშლა ვერ მოხერხდა', 'error');
      }
    };

    function updateSettingsTab() {
      const profile = document.getElementById('settingsProfileCard');
      if (!profile) return;
      if (!currentUser) {
        profile.innerHTML = '<div class="empty-state">ანგარიში არ არის არჩეული</div>';
        return;
      }
      profile.innerHTML = `
        <div class="settings-profile-name">${getCurrentUserDisplayName()}</div>
        <div class="settings-profile-meta">იუზერი: ${currentUser.username || '—'}</div>
        <div class="settings-profile-meta">როლი: ${getRoleLabel(currentUser.role)}</div>
        <div class="settings-profile-meta">სტატუსი: ${(currentUser.status || 'active') === 'disabled' ? 'გამორთული' : 'აქტიური'}</div>
      `;
      const plansPanel = document.getElementById('subscriptionPlansPanel');
      if (plansPanel) {
        plansPanel.style.display = isAdmin() ? 'block' : 'none';
        if (isAdmin()) {
          renderSubscriptionPlansTable();
        }
      }
    }

    function updateStatsTab() {
      const topOperatorEl = document.getElementById('statsTopOperatorName');
      if (!topOperatorEl) return;

      const summary = getFinancialSummary();
      const archiveRows = getFinanceArchiveRows();
      const { monthlyLeaders, operatorsAggregate } = getOperatorMonthlyStats();
      const loyalMembers = getLoyalMembersMonthlyStats();
      const currentMonthKey = getMonthKey(new Date().toISOString());
      const currentMonthLeader = monthlyLeaders.find((item) => item.monthKey === currentMonthKey)?.leader || null;
      const bestMonth = [...archiveRows].sort((a, b) => b.totalAmount - a.totalAmount)[0] || null;

      document.getElementById('statsTopOperatorName').textContent = currentMonthLeader?.actorName || '—';
      document.getElementById('statsTopOperatorMeta').textContent = currentMonthLeader
        ? `${currentMonthLeader.count} აბონემენტი • ${currentMonthLeader.registrations} ახალი • ${currentMonthLeader.renewals} განახლება • ${formatCurrency(currentMonthLeader.amount)}`
        : 'მონაცემები ჯერ არ არის';
      document.getElementById('statsMonthMembershipCount').textContent = String(summary.monthMembershipCount);
      document.getElementById('statsMonthMembershipAmount').textContent = formatCurrency(summary.monthMembership);
      document.getElementById('statsMonthProductCount').textContent = String(summary.monthProductSalesCount);
      document.getElementById('statsMonthProductAmount').textContent = formatCurrency(summary.monthProducts);
      document.getElementById('statsBestMonthName').textContent = bestMonth ? formatMonthKey(bestMonth.monthKey) : '—';
      document.getElementById('statsBestMonthTotal').textContent = bestMonth ? formatCurrency(bestMonth.totalAmount) : '0.00₾';

      const statsRevenueBars = document.getElementById('statsRevenueBars');
      if (statsRevenueBars) {
        statsRevenueBars.innerHTML = renderStatsRevenueBars(archiveRows);
      }

      const statsOperatorsBoard = document.getElementById('statsOperatorsBoard');
      if (statsOperatorsBoard) {
        statsOperatorsBoard.innerHTML = renderStatsOperatorBoard(operatorsAggregate);
      }

      const monthlyLeadersTable = document.getElementById('statsMonthlyLeadersTable');
      if (monthlyLeadersTable) {
        monthlyLeadersTable.innerHTML = renderStatsMonthlyLeaders(monthlyLeaders);
      }

      const loyalMembersTable = document.getElementById('statsLoyalMembersTable');
      if (loyalMembersTable) {
        loyalMembersTable.innerHTML = renderStatsLoyalMembers(loyalMembers);
      }

      const operatorsTable = document.getElementById('statsOperatorsTable');
      if (operatorsTable) {
        operatorsTable.innerHTML = renderStatsOperatorRank(operatorsAggregate);
      }

      const monthlyArchiveTable = document.getElementById('statsMonthlyArchiveTable');
      if (monthlyArchiveTable) {
        monthlyArchiveTable.innerHTML = renderStatsArchiveCards(archiveRows);
      }

      renderRecentSignupsList('statsRecentSignupsList', 4);
    }

    async function saveUserRecord(user) {
      try {
        const { id, ...payload } = user;
        if (id) {
          await setDoc(doc(db, "users", id), payload, { merge: true });
          return { ok: true, id, user: { id, ...payload } };
        }
        const docRef = await addDoc(collection(db, "users"), payload);
        return { ok: true, id: docRef.id, user: { id: docRef.id, ...payload } };
      } catch (e) {
        console.error('user save failed', e);
        showToast('იუზერის შენახვა ვერ მოხერხდა', 'error');
        return { ok: false, id: null, user: null };
      }
    }

    window.openUserForm = function(userId = '') {
      const user = userId ? window.users.find((item) => item.id === userId) : null;
      document.getElementById('userFormTitle').textContent = user ? 'იუზერის რედაქტირება' : 'იუზერის დამატება';
      document.getElementById('userFormId').value = user?.id || '';
      document.getElementById('userFirstName').value = user?.firstName || '';
      document.getElementById('userLastName').value = user?.lastName || '';
      document.getElementById('userUsername').value = user?.username || '';
      document.getElementById('userPersonalId').value = user?.personalId || '';
      document.getElementById('userEmail').value = user?.email || '';
      document.getElementById('userRole').value = user?.role || 'operator';
      document.getElementById('userPassword').value = '';
      document.getElementById('userStatus').value = user?.status || 'active';
      document.getElementById('userFormModal').style.display = 'flex';
    };

    window.closeUserForm = function() {
      document.getElementById('userFormModal').style.display = 'none';
      document.getElementById('userFormId').value = '';
      document.getElementById('userFirstName').value = '';
      document.getElementById('userLastName').value = '';
      document.getElementById('userUsername').value = '';
      document.getElementById('userPersonalId').value = '';
      document.getElementById('userEmail').value = '';
      document.getElementById('userPassword').value = '';
      document.getElementById('userRole').value = 'operator';
      document.getElementById('userStatus').value = 'active';
    };

    window.saveUser = async function() {
      const id = document.getElementById('userFormId').value;
      const firstName = document.getElementById('userFirstName').value.trim();
      const lastName = document.getElementById('userLastName').value.trim();
      const username = normalizeUsername(document.getElementById('userUsername').value);
      const personalId = normalizePersonalId(document.getElementById('userPersonalId').value);
      const email = document.getElementById('userEmail').value.trim();
      const password = document.getElementById('userPassword').value;
      const role = document.getElementById('userRole').value === 'admin' ? 'admin' : 'operator';
      const status = document.getElementById('userStatus').value === 'disabled' ? 'disabled' : 'active';

      if (!firstName || !lastName || !username || !personalId || !email) {
        showToast('სახელი, გვარი, იუზერი, პირადი ნომერი და Email სავალდებულოა', 'error');
        return;
      }
      if (!isValidEmail(email)) {
        showToast('Email არასწორია', 'error');
        return;
      }
      if (!id && !password) {
        showToast('ახალ იუზერზე პაროლი სავალდებულოა', 'error');
        return;
      }

      const usernameTaken = window.users.some((item) =>
        normalizeUsername(item.username) === username &&
        item.id !== id
      );
      if (usernameTaken) {
        showToast('ეს იუზერი უკვე არსებობს', 'error');
        return;
      }
      const personalIdTaken = window.users.some((item) =>
        normalizePersonalId(item.personalId) === personalId &&
        item.id !== id
      );
      if (personalIdTaken) {
        showToast('ეს პირადი ნომერი უკვე გამოყენებულია', 'error');
        return;
      }

      const existingUser = id ? window.users.find((item) => item.id === id) : null;
      const nowIso = new Date().toISOString();
      const passwordHash = password ? await sha256Hex(password) : existingUser?.passwordHash || null;
      const payload = {
        firstName,
        lastName,
        username,
        personalId,
        email,
        passwordHash,
        role,
        status,
        mustChangePassword: password ? true : (existingUser?.mustChangePassword || false),
        updatedAt: nowIso,
        createdAt: existingUser?.createdAt || nowIso
      };
      if (existingUser?.isSystemDefault) payload.isSystemDefault = true;
      if (id) payload.id = id;

      const saved = await saveUserRecord(payload);
      if (!saved.ok) return;

      if (password) {
        const sent = await sendEmail(
          email,
          `${firstName} ${lastName}`.trim(),
          'Gym Manager - ერთჯერადი პაროლი',
          `გამარჯობა ${firstName},

თქვენთვის შეიქმნა ერთჯერადი პაროლი Gym Manager-ში ავტორიზაციისთვის.

ერთჯერადი პაროლი: ${password}
იუზერი: ${username}
პირადი ნომერი: ${personalId}

გთხოვთ, სისტემაში შესვლისთანავე შეცვალოთ ის მუდმივ პაროლზე.`,
          {
            temporary_password: password,
            username,
            personal_id: personalId
          }
        );
        if (!sent) return;
      }

      showToast(id ? 'იუზერი განახლდა' : 'იუზერი დაემატა');
      window.closeUserForm();
      hydrateUsersFromRest();
    };

    window.openResetUserPasswordModal = function(userId) {
      const user = window.users.find((item) => item.id === userId);
      if (!user) return;
      const temporaryPassword = generateTemporaryPassword(8);
      document.getElementById('resetUserId').value = user.id;
      document.getElementById('resetUserName').textContent = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      document.getElementById('resetUserUsername').textContent = `იუზერი: ${user.username || '—'}`;
      document.getElementById('resetUserEmail').textContent = `Email: ${user.email || '—'}`;
      document.getElementById('resetUserPassword').value = temporaryPassword;
      document.getElementById('resetUserPasswordInfo').textContent = 'ერთჯერადი პაროლი ჯერ არ გაგზავნილა. გადაამოწმე და შემდეგ გააგზავნე მეილზე.';
      document.getElementById('resetUserPasswordModal').style.display = 'flex';
    };

    window.closeResetUserPasswordModal = function() {
      document.getElementById('resetUserPasswordModal').style.display = 'none';
      document.getElementById('resetUserId').value = '';
      document.getElementById('resetUserPassword').value = '';
      document.getElementById('resetUserEmail').textContent = '';
      document.getElementById('resetUserPasswordInfo').textContent = 'ეს პაროლი გამოჩნდება აქ და გაიგზავნება მომხმარებლის მეილზე.';
    };

    window.resetUserPassword = async function() {
      const id = document.getElementById('resetUserId').value;
      const password = document.getElementById('resetUserPassword').value;
      const user = window.users.find((item) => item.id === id);
      if (!id || !password) {
        showToast('ახალი პაროლი სავალდებულოა', 'error');
        return;
      }
      if (!user?.email || !isValidEmail(user.email)) {
        showToast('მომხმარებელს სწორი Email არ აქვს', 'error');
        return;
      }
      const passwordHash = await sha256Hex(password);
      const sent = await sendEmail(
        user.email,
        getCurrentUserDisplayName(user),
        'Gym Manager - ერთჯერადი პაროლი',
        `გამარჯობა ${user.firstName || ''},

თქვენთვის შეიქმნა ერთჯერადი პაროლი Gym Manager-ში ავტორიზაციისთვის.

ერთჯერადი პაროლი: ${password}

გთხოვთ, სისტემაში შესვლისთანავე შეცვალოთ ის მუდმივ პაროლზე.`,
        {
          temporary_password: password,
          username: user.username || '',
          personal_id: user.personalId || ''
        }
      );
      if (!sent) {
        showToast('მეილზე გაგზავნა ვერ მოხერხდა', 'error');
        return;
      }
      const saved = await saveUserRecord({
        id,
        passwordHash,
        mustChangePassword: true,
        temporaryPasswordIssuedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      if (!saved.ok) return;
      document.getElementById('resetUserPasswordInfo').textContent = `ერთჯერადი პაროლი გაიგზავნა: ${user.email}`;
      showToast('ერთჯერადი პაროლი გაიგზავნა');
      window.closeResetUserPasswordModal();
      hydrateUsersFromRest();
    };

    window.changeCurrentUserPassword = async function() {
      if (!currentUser) return;
      const currentPassword = document.getElementById('currentPassword').value;
      const newPassword = document.getElementById('newPassword').value;
      const confirmPassword = document.getElementById('confirmPassword').value;

      if (!currentPassword || !newPassword || !confirmPassword) {
        showToast('ყველა ველი სავალდებულოა', 'error');
        return;
      }
      if (newPassword !== confirmPassword) {
        showToast('ახალი პაროლები არ ემთხვევა', 'error');
        return;
      }
      const currentHash = await sha256Hex(currentPassword);
      if (currentHash !== currentUser.passwordHash) {
        showToast('მიმდინარე პაროლი არასწორია', 'error');
        return;
      }

      const saved = await saveUserRecord({
        id: currentUser.id,
        passwordHash: await sha256Hex(newPassword),
        mustChangePassword: false,
        updatedAt: new Date().toISOString()
      });
      if (!saved.ok) return;
      currentUser = { ...currentUser, passwordHash: await sha256Hex(newPassword), mustChangePassword: false };
      document.getElementById('passwordChangeForm')?.reset();
      showPasswordSuccessOverlay();
      hydrateUsersFromRest();
    };

    window.completeForcedPasswordReset = async function() {
      if (!currentUser) return;
      const currentPassword = document.getElementById('forcePasswordCurrent').value;
      const newPassword = document.getElementById('forcePasswordNew').value;
      const confirmPassword = document.getElementById('forcePasswordConfirm').value;

      if (!currentPassword || !newPassword || !confirmPassword) {
        showToast('ყველა ველი სავალდებულოა', 'error');
        return;
      }
      if (newPassword !== confirmPassword) {
        showToast('ახალი პაროლები არ ემთხვევა', 'error');
        return;
      }
      const currentHash = await sha256Hex(currentPassword);
      if (currentHash !== currentUser.passwordHash) {
        showToast('ერთჯერადი პაროლი არასწორია', 'error');
        return;
      }

      const newHash = await sha256Hex(newPassword);
      const saved = await saveUserRecord({
        id: currentUser.id,
        passwordHash: newHash,
        mustChangePassword: false,
        passwordUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      if (!saved.ok) return;

      currentUser = {
        ...currentUser,
        passwordHash: newHash,
        mustChangePassword: false,
        passwordUpdatedAt: new Date().toISOString()
      };
      forcePasswordResetPending = false;
      document.getElementById('forcePasswordResetModal').style.display = 'none';
      document.getElementById('forcePasswordCurrent').value = '';
      document.getElementById('forcePasswordNew').value = '';
      document.getElementById('forcePasswordConfirm').value = '';
      showToast('მუდმივი პაროლი წარმატებით განახლდა');
      hydrateUsersFromRest();
    };

    // ======= QR კოდის ფუნქციები =======

    function getMemberQrPayload(memberId) {
      return `FH_MEMBER:${memberId}`;
    }

    function getMemberQrImageUrl(memberId) {
      const payload = getMemberQrPayload(memberId);
      return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=8&data=${encodeURIComponent(payload)}`;
    }

    window.showMemberQr = function(memberId) {
      const member = window.members.find(m => m.id === memberId);
      if (!member) return;
      document.getElementById('qrViewName').textContent = `${member.firstName} ${member.lastName}`;
      document.getElementById('qrViewId').textContent = `პირადი: ${member.personalId}`;
      const container = document.getElementById('qrViewCode');
      container.innerHTML = '';
      // QR-ში ვინახავთ მხოლოდ შიდა payload-ს (არასოდეს URL)
      new QRCode(container, {
        text: getMemberQrPayload(member.id),
        width: 200,
        height: 200,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
      document.getElementById('qrViewModal').style.display = 'flex';
    };

    let html5QrScanner = null;

    window.openQrScanner = function() {
      document.getElementById('qrScannerModal').style.display = 'flex';
      document.getElementById('qr-scan-result').innerHTML = '';
      setTimeout(() => {
        html5QrScanner = new Html5Qrcode('qr-reader');
        html5QrScanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            await html5QrScanner.stop();
            html5QrScanner = null;
            handleQrScan(decodedText);
          },
          () => {}
        ).catch(err => {
          document.getElementById('qr-scan-result').innerHTML = `<div style="color:#f87171;text-align:center;padding:16px;">კამერა ვერ გაიხსნა.<br><small>${err}</small></div>`;
        });
      }, 200);
    };

    window.closeQrScanner = async function() {
      if (html5QrScanner) {
        try { await html5QrScanner.stop(); } catch(e) {}
        html5QrScanner = null;
      }
      document.getElementById('qrScannerModal').style.display = 'none';
      const reader = document.getElementById('qr-reader');
      if (reader) reader.innerHTML = '';
      document.getElementById('qr-scan-result').innerHTML = '';
    };

    async function handleQrScan(decodedText) {
      // QR-ში ინახება მხოლოდ შიდა payload (FH_MEMBER:<id>) ან fallback member.id
      let memberId = decodedText.trim();
      if (memberId.startsWith('FH_MEMBER:')) {
        memberId = memberId.slice('FH_MEMBER:'.length);
      }

      const member = window.members.find(m => m.id === memberId);

      // წევრი ვერ მოიძებნა
      if (!member) {
        document.getElementById('qrScannerModal').style.display = 'flex';
        document.getElementById('qr-scan-result').innerHTML = `
          <div style="text-align:center;padding:16px;">
            <div style="color:#f87171;font-size:1.1rem;font-weight:700;margin-bottom:8px;">❌ წევრი ვერ მოიძებნა</div>
            <div style="color:#9ca3af;font-size:0.9rem;margin-bottom:12px;">QR კოდი სისტემაში არ არსებობს</div>
            <button class="btn bg-indigo-600 hover:bg-indigo-700" onclick="window.openQrScanner()">ხელახლა სკანი</button>
          </div>`;
        return;
      }

      // სკანერი იხურება
      await window.closeQrScanner();
      window.showTab('checkin');

      const now = new Date();
      const hour = now.getHours();
      const el = document.getElementById('checkinResult');
      const noteBanner = member.note
        ? `<div class="note-banner text-sm"><i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${member.note}</div>`
        : '';

      // შესვლის შემაფერხებელი პირობები
      if (member.status !== 'active') {
        el.innerHTML = `<div class="member-card p-6">${noteBanner}
          <div class="grid grid-cols-2 gap-4 text-sm mb-4">
            <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
            <div><strong>პირადი:</strong> ${member.personalId}</div>
          </div>
          <div class="text-center text-2xl font-bold text-red-400 py-4">❌ შეჩერებულია</div>
        </div>`;
        showToast("არააქტიურია", 'error');
        return;
      }
      if (isExpired(member.subscriptionEndDate)) {
        await updateMemberFields(member.id, { status: 'expired' });
        el.innerHTML = `<div class="member-card p-6">${noteBanner}
          <div class="grid grid-cols-2 gap-4 text-sm mb-4">
            <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
            <div><strong>ვადა:</strong> ${formatDate(member.subscriptionEndDate)}</div>
          </div>
          <div class="text-center text-2xl font-bold text-red-400 py-4">❌ ვადა გასულია</div>
        </div>`;
        showToast("ვადა გასულია!", 'error');
        return;
      }
      if (member.remainingVisits !== null && member.remainingVisits <= 0) {
        await updateMemberFields(member.id, { status: 'expired' });
        el.innerHTML = `<div class="member-card p-6">${noteBanner}
          <div class="grid grid-cols-2 gap-4 text-sm mb-4">
            <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
            <div><strong>დარჩენილი:</strong> 0</div>
          </div>
          <div class="text-center text-2xl font-bold text-red-400 py-4">❌ ვიზიტები ამოწურულია</div>
        </div>`;
        showToast("ვიზიტები ამოწურულია", 'error');
        return;
      }
      if (member.subscriptionType === 'morning' && (hour < 9 || hour >= 16)) {
        el.innerHTML = `<div class="member-card p-6">${noteBanner}
          <div class="grid grid-cols-2 gap-4 text-sm mb-4">
            <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(member.subscriptionType)}</div>
          </div>
          <div class="text-center text-2xl font-bold text-red-400 py-4">❌ მხოლოდ 09:00–16:00</div>
        </div>`;
        showToast("მხოლოდ 09:00–16:00", 'error');
        return;
      }

      // ✅ შესვლა დაშვებულია — processCheckIn-ის იგივე ლოგიკა
      let updated = { ...member };
      updated.lastVisit = now.toISOString();
      updated.totalVisits = (updated.totalVisits || 0) + 1;
      if (member.remainingVisits !== null) {
        updated.remainingVisits = member.remainingVisits - 1;
        if (updated.remainingVisits <= 0) updated.status = 'expired';
      }
      const saved = await updateMember(updated);
      if (!saved) return;
      logMemberVisit(member, 'approved', '', 'admin_qr');

      const remainingText = updated.remainingVisits != null
        ? `<div><strong>დარჩენილი ვიზიტი:</strong> ${updated.remainingVisits}</div>`
        : '';
      el.innerHTML = `<div class="member-card p-6">${noteBanner}
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-6">
          <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
          <div><strong>პირადი:</strong> ${member.personalId}</div>
          <div><strong>აბონემენტი:</strong> ${getSubscriptionName(member.subscriptionType)}</div>
          <div><strong>ვადა:</strong> ${formatDate(member.subscriptionEndDate)}</div>
          ${remainingText}
        </div>
        <div class="text-center text-2xl font-bold text-green-400 py-4">✅ შესვლა დაფიქსირდა!</div>
      </div>`;
      showToast(`✅ ${member.firstName} ${member.lastName} — შესვლა დაფიქსირდა!`);
    }

    function checkUrlQrParam() {}

    async function logMemberVisit(member, result, reason, source) {
      if (!member?.id) return;
      try {
        const { collection: col, addDoc: aDoc } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
        await aDoc(col(db, 'check_ins'), {
          memberId: member.id,
          memberName: `${member.firstName || ''} ${member.lastName || ''}`.trim(),
          phone: member.phone || '—',
          personalId: member.personalId || '—',
          subscriptionStatus: getEffectiveStatus(member),
          subscriptionType: member.subscriptionType || '—',
          result,
          reason: reason || '',
          qrToken: '',
          checkInTime: new Date().toISOString(),
          source,
          loggedBy: getCurrentUserDisplayName() || 'admin'
        });
      } catch(_) {}
    }

    // ═══════════════════════════════════════════════════════════════════════
    // QR CODE — ADMIN MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    function isMainAdmin() {
      return isAdmin();
    }

    function generateUUID() {
      return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
    }

    async function loadGymQrToken() {
      try {
        const { getDoc, doc: firestoreDoc } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
        const snap = await getDoc(firestoreDoc(db, GYM_SETTINGS_COLLECTION, gymQrDocId));
        if (snap.exists()) {
          gymQrToken = snap.data().token || null;
        }
      } catch (e) {
        // try REST fallback
        try {
          const pid = firebaseConfig.projectId;
          const url = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${GYM_SETTINGS_COLLECTION}/${gymQrDocId}`;
          const r = await fetch(url);
          if (r.ok) {
            const d = await r.json();
            gymQrToken = d.fields?.token?.stringValue || null;
          }
        } catch (_) {}
      }
    }

    async function saveGymQrToken(token, meta) {
      const payload = {
        token,
        generatedAt: new Date().toISOString(),
        generatedByUserId: currentUser?.id || null,
        generatedByName: getCurrentUserDisplayName(),
        isActive: true,
        ...meta
      };
      try {
        const { setDoc, doc: firestoreDoc } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
        await setDoc(firestoreDoc(db, GYM_SETTINGS_COLLECTION, gymQrDocId), payload);
      } catch (e) {
        console.error('saveGymQrToken error', e);
        throw e;
      }
    }

    window.generateGymQr = async function() {
      if (!isMainAdmin()) {
        showToast('QR კოდის გენერირება მხოლოდ ადმინისტრატორისთვის!', 'error');
        return;
      }
      const btn = document.getElementById('generateQrBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'გენერირება...'; }
      try {
        const newToken = generateUUID();
        await saveGymQrToken(newToken, {});
        gymQrToken = newToken;
        showToast('QR კოდი წარმატებით დაგენერირდა!', 'success');
        updateQrTab();
      } catch (e) {
        showToast('შეცდომა QR-ის გენერირებისას', 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'ხელახლა გენერირება'; }
      }
    };

    function getCheckinQrUrl() {
      const base = window.location.origin + '/member';
      return `${base}?checkin=${gymQrToken}`;
    }

    function updateQrTab() {
      const el = document.getElementById('qrManageContent');
      if (!el) return;

      const qrUrl = gymQrToken ? getCheckinQrUrl() : null;
      const qrImgUrl = qrUrl
        ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(qrUrl)}`
        : null;

      el.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;" class="qr-manage-grid">

          <div class="section-panel">
            <h3 class="panel-title">საერთო QR კოდი</h3>
            ${gymQrToken ? `
              <div style="text-align:center;padding:16px;">
                <img src="${qrImgUrl}" alt="QR" style="border-radius:12px;max-width:100%;margin-bottom:12px;" onerror="this.src='https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=error'">
                <div style="font-size:0.75rem;color:#94a3b8;word-break:break-all;margin-bottom:16px;">${qrUrl}</div>
                <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
                  <button id="generateQrBtn" class="btn bg-amber-600 hover:bg-amber-700" onclick="window.generateGymQr()">
                    <i class="fas fa-redo"></i> ხელახლა გენერირება
                  </button>
                  <a href="${qrImgUrl}" download="fithousegym-qr.png" class="btn bg-slate-600 hover:bg-slate-700">
                    <i class="fas fa-download"></i> გადმოწერა
                  </a>
                </div>
                <p style="color:#64748b;font-size:0.8rem;margin-top:12px;">⚠️ ხელახლა გენერირება ძველ QR-ს გააუქმებს</p>
              </div>
            ` : `
              <div style="text-align:center;padding:32px;">
                <i class="fas fa-qrcode" style="font-size:4rem;color:#475569;margin-bottom:16px;display:block;"></i>
                <p style="color:#94a3b8;margin-bottom:20px;">QR კოდი ჯერ არ არის დაგენერირებული</p>
                <button id="generateQrBtn" class="btn btn-success" onclick="window.generateGymQr()">
                  <i class="fas fa-qrcode"></i> QR კოდის გენერირება
                </button>
              </div>
            `}
          </div>

          <div class="section-panel">
            <h3 class="panel-title">გამოყენების ინსტრუქცია</h3>
            <ul style="color:#94a3b8;font-size:0.9rem;line-height:2;padding-left:16px;">
              <li>დაბეჭდეთ QR კოდი და განათავსეთ შესასვლელთან</li>
              <li>წევრი სკანირებს QR კოდს ტელეფონით</li>
              <li>სისტემა ამოწმებს აბონემენტის სტატუსს</li>
              <li>შედეგი გამოჩნდება ეკრანზე</li>
              <li>ადმინი/ოპერატორი იღებს real-time შეტყობინებას</li>
            </ul>
            <div style="margin-top:16px;padding:12px;background:var(--bg);border-radius:8px;font-size:0.8rem;color:#64748b;">
              <strong>შენიშვნა:</strong> QR კოდი არ შეიცავს პირად მონაცემებს. წევრის იდენტიფიკაცია ხდება პირადი ნომრით ან ტელეფონით.
            </div>
          </div>

        </div>

        <div class="section-panel">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
            <h3 class="panel-title" style="margin:0;">Check-in ისტორია</h3>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <select id="checkinFilterResult" onchange="window.refreshCheckInHistory()" style="background:#1e293b;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:6px 10px;font-size:0.82rem;">
                <option value="">ყველა</option>
                <option value="approved">✅ დადასტურებული</option>
                <option value="denied">❌ უარყოფილი</option>
              </select>
              <input type="date" id="checkinFilterDate" onchange="window.refreshCheckInHistory()" style="background:#1e293b;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:6px 10px;font-size:0.82rem;">
              <button class="btn bg-slate-600 hover:bg-slate-700" onclick="document.getElementById('checkinFilterResult').value='';document.getElementById('checkinFilterDate').value='';window.refreshCheckInHistory();" style="padding:6px 10px;font-size:0.82rem;">
                <i class="fas fa-times"></i> გასუფთავება
              </button>
              <button class="btn bg-slate-600 hover:bg-slate-700" onclick="window.refreshCheckInHistory()" style="padding:6px 10px;font-size:0.82rem;">
                <i class="fas fa-sync"></i>
              </button>
            </div>
          </div>
          <div id="checkInHistoryTable" style="height:420px;overflow-y:auto;border:1px solid #1e293b;border-radius:12px;"></div>
        </div>
      `;

      loadCheckInHistory();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CHECK-IN HISTORY
    // ═══════════════════════════════════════════════════════════════════════

    async function loadCheckInHistory() {
      const el = document.getElementById('checkInHistoryTable');
      if (!el) return;
      el.innerHTML = '<div style="color:#94a3b8;padding:20px;text-align:center;"><i class="fas fa-spinner fa-spin"></i> იტვირთება...</div>';
      const filterResult = document.getElementById('checkinFilterResult')?.value || '';
      const filterDate = document.getElementById('checkinFilterDate')?.value || '';
      try {
        const pid = firebaseConfig.projectId;
        const url = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${QR_CHECKIN_COLLECTION}?orderBy=checkInTime%20desc&pageSize=200`;
        const r = await fetch(url);
        if (!r.ok) { el.innerHTML = '<div style="color:#94a3b8;padding:16px;">ისტორია ვერ ჩაიტვირთა</div>'; return; }
        const data = await r.json();
        const docs = (data.documents || []).map(d => {
          const f = d.fields || {};
          return {
            id: d.name?.split('/').pop(),
            memberId: f.memberId?.stringValue || '',
            memberName: f.memberName?.stringValue || '—',
            phone: f.phone?.stringValue || '—',
            personalId: f.personalId?.stringValue || '—',
            subscriptionStatus: f.subscriptionStatus?.stringValue || '—',
            result: f.result?.stringValue || '—',
            reason: f.reason?.stringValue || '',
            checkInTime: f.checkInTime?.stringValue || '',
            qrToken: f.qrToken?.stringValue || ''
          };
        });
        // Apply filters
        let filtered = docs;
        if (filterResult) filtered = filtered.filter(d => d.result === filterResult);
        if (filterDate) filtered = filtered.filter(d => d.checkInTime.startsWith(filterDate));

        if (filtered.length === 0) {
          el.innerHTML = `<div style="color:#94a3b8;padding:32px;text-align:center;"><i class="fas fa-inbox" style="font-size:2rem;display:block;margin-bottom:10px;opacity:0.4;"></i>${docs.length === 0 ? 'სკანირების ისტორია ცარიელია' : 'ფილტრით ჩანაწერი ვერ მოიძებნა'}</div>`;
          return;
        }
        el.innerHTML = `
          <div style="overflow-x:auto;">
            <div style="padding:8px 12px;background:#0f172a;border-bottom:1px solid #1e293b;font-size:0.75rem;color:#64748b;display:flex;justify-content:space-between;">
              <span>სულ: <strong style="color:#e2e8f0;">${filtered.length}</strong> ჩანაწერი</span>
              <span>✅ ${filtered.filter(d=>d.result==='approved').length} &nbsp; ❌ ${filtered.filter(d=>d.result!=='approved').length}</span>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
              <thead>
                <tr style="border-bottom:1px solid #1e293b;background:#0f172a;position:sticky;top:0;z-index:1;">
                  <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;">წევრი</th>
                  <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;">პირადი</th>
                  <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;">ტელეფონი</th>
                  <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;">შედეგი</th>
                  <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;">თარიღი</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map(d => `
                  <tr style="border-bottom:1px solid #0f172a;transition:background 0.1s;" onmouseover="this.style.background='#0f172a'" onmouseout="this.style.background=''">
                    <td style="padding:10px 12px;color:#e2e8f0;font-weight:600;">${d.memberName}</td>
                    <td style="padding:10px 12px;color:#94a3b8;font-size:0.8rem;">${d.personalId}</td>
                    <td style="padding:10px 12px;color:#94a3b8;font-size:0.8rem;">${d.phone}</td>
                    <td style="padding:10px 12px;">
                      ${d.result === 'approved'
                        ? '<span style="color:#4ade80;font-weight:700;font-size:0.82rem;">✅ დადასტურდა</span>'
                        : `<span style="color:#f87171;font-weight:700;font-size:0.82rem;">❌ უარყოფილია</span>${d.reason ? `<br><span style="font-size:0.72rem;color:#64748b;">${d.reason}</span>` : ''}`
                      }
                    </td>
                    <td style="padding:10px 12px;color:#64748b;font-size:0.78rem;white-space:nowrap;">${formatDateTime(d.checkInTime)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      } catch (e) {
        el.innerHTML = '<div style="color:#f87171;padding:16px;text-align:center;"><i class="fas fa-exclamation-circle"></i> შეცდომა ისტორიის ჩატვირთვისას</div>';
      }
    }

    window.refreshCheckInHistory = function() {
      loadCheckInHistory();
    };

    // ═══════════════════════════════════════════════════════════════════════
    // REAL-TIME CHECK-IN POPUP (for admin/operator)
    // ═══════════════════════════════════════════════════════════════════════

    function startCheckInListener() {
      if (checkInListenerUnsubscribe) return;
      try {
        const { collection: col, query: fsQuery, orderBy, limit, onSnapshot: fsOnSnapshot, where } = window._fsSDK || {};
        if (!col) { startCheckInListenerPolling(); return; }
        const q = fsQuery(col(db, QR_CHECKIN_COLLECTION), orderBy('checkInTime', 'desc'), limit(1));
        checkInListenerUnsubscribe = fsOnSnapshot(q, snapshot => {
          snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
              const d = change.doc.data();
              if (lastSeenCheckInId !== change.doc.id) {
                lastSeenCheckInId = change.doc.id;
                showCheckInPopup(d);
                if (document.getElementById('qrmanage')?.classList.contains('active')) {
                  loadCheckInHistory();
                }
              }
            }
          });
        }, () => { startCheckInListenerPolling(); });
      } catch (e) {
        startCheckInListenerPolling();
      }
    }

    let checkInPollingInterval = null;
    let checkInPollingLastTime = null;

    function startCheckInListenerPolling() {
      if (checkInPollingInterval) return;
      checkInPollingInterval = setInterval(async () => {
        if (!isAuthenticated) return;
        try {
          const pid = firebaseConfig.projectId;
          const url = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${QR_CHECKIN_COLLECTION}?orderBy=checkInTime%20desc&pageSize=1`;
          const r = await fetch(url);
          if (!r.ok) return;
          const data = await r.json();
          const docs = data.documents || [];
          if (docs.length === 0) return;
          const latest = docs[0];
          const id = latest.name?.split('/').pop();
          if (id && id !== lastSeenCheckInId) {
            const f = latest.fields || {};
            lastSeenCheckInId = id;
            showCheckInPopup({
              memberName: f.memberName?.stringValue || '—',
              personalId: f.personalId?.stringValue || '—',
              phone: f.phone?.stringValue || '—',
              subscriptionStatus: f.subscriptionStatus?.stringValue || '—',
              result: f.result?.stringValue || '—',
              reason: f.reason?.stringValue || '',
              checkInTime: f.checkInTime?.stringValue || ''
            });
            if (document.getElementById('qrmanage')?.classList.contains('active')) {
              loadCheckInHistory();
            }
          }
        } catch (_) {}
      }, 4000);
    }

    function showCheckInPopup(data) {
      const popup = document.getElementById('checkinPopup');
      const body = document.getElementById('checkinPopupBody');
      if (!popup || !body) return;
      const approved = data.result === 'approved';
      body.innerHTML = `
        <div style="text-align:center;margin-bottom:12px;">
          <div style="font-size:2rem;font-weight:900;color:${approved ? '#4ade80' : '#f87171'};">
            ${approved ? 'დადასტურებულია ✅' : 'უარყოფილია ❌'}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.82rem;margin-bottom:8px;">
          <div><span style="color:#64748b;">წევრი:</span><br><strong style="color:#e2e8f0;">${data.memberName}</strong></div>
          <div><span style="color:#64748b;">პირადი:</span><br><strong style="color:#e2e8f0;">${data.personalId}</strong></div>
          <div><span style="color:#64748b;">ტელეფონი:</span><br><strong style="color:#e2e8f0;">${data.phone}</strong></div>
          <div><span style="color:#64748b;">აბონემენტი:</span><br><strong style="color:#e2e8f0;">${data.subscriptionStatus}</strong></div>
        </div>
        ${!approved && data.reason ? `<div style="color:#f87171;font-size:0.8rem;margin-bottom:8px;">მიზეზი: ${data.reason}</div>` : ''}
        <div style="color:#475569;font-size:0.75rem;">${formatDateTime(data.checkInTime)}</div>
      `;
      popup.style.display = 'block';
      if (popup._autoHide) clearTimeout(popup._autoHide);
      popup._autoHide = setTimeout(() => { popup.style.display = 'none'; }, 15000);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC MEMBER CHECK-IN (via QR scan URL ?checkin=TOKEN)
    // ═══════════════════════════════════════════════════════════════════════

    function checkPublicCheckinParam() {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('checkin');
      if (!token) return;
      // Show public overlay, hide main app
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('mainApp').style.display = 'none';
      const overlay = document.getElementById(PUBLIC_CHECKIN_OVERLAY_ID);
      if (overlay) {
        overlay.style.display = 'block';
        overlay.dataset.token = token;
      }
    }

    window.submitPublicCheckIn = async function() {
      const overlay = document.getElementById(PUBLIC_CHECKIN_OVERLAY_ID);
      const token = overlay?.dataset.token;
      if (!token) { showPublicCheckinResult('denied', 'invalid_qr', null); return; }

      const input = document.getElementById('publicCheckinId')?.value?.trim();
      if (!input) {
        document.getElementById('publicCheckinResult').innerHTML =
          '<div style="color:#f87171;text-align:center;padding:8px;">შეიყვანეთ პირადი ნომერი ან ტელეფონი</div>';
        return;
      }

      // Rate limit by input value
      const now = Date.now();
      if (publicCheckinRateMap[input] && (now - publicCheckinRateMap[input]) < PUBLIC_CHECKIN_RATE_LIMIT_MS) {
        const remaining = Math.ceil((PUBLIC_CHECKIN_RATE_LIMIT_MS - (now - publicCheckinRateMap[input])) / 1000);
        document.getElementById('publicCheckinResult').innerHTML =
          `<div style="color:#f59e0b;text-align:center;padding:8px;">გთხოვთ დაიცადოთ ${remaining} წამი</div>`;
        return;
      }
      publicCheckinRateMap[input] = now;

      const btn = overlay.querySelector('button');
      if (btn) { btn.disabled = true; btn.textContent = 'მოწმდება...'; }

      try {
        // Validate QR token against Firestore
        await loadGymQrToken();
        if (!gymQrToken || gymQrToken !== token) {
          await logPublicCheckIn(null, null, token, 'denied', 'invalid_qr');
          showPublicCheckinResult('denied', 'invalid_qr', null);
          return;
        }

        // Find member by personalId or phone
        await hydrateMembersFromRest();
        const member = window.members.find(m =>
          (m.personalId && m.personalId.trim() === input) ||
          (m.phone && m.phone.trim() === input) ||
          (m.phone && m.phone.replace(/\s/g,'') === input.replace(/\s/g,''))
        );

        if (!member) {
          await logPublicCheckIn(null, { personalId: input, phone: input }, token, 'denied', 'no_subscription');
          showPublicCheckinResult('denied', 'no_subscription', null);
          return;
        }

        const effectiveStatus = getEffectiveStatus(member);
        let result = 'denied';
        let reason = '';

        if (effectiveStatus === 'active') {
          const hour = new Date().getHours();
          if (member.subscriptionType === 'morning' && (hour < 9 || hour >= 16)) {
            reason = 'inactive_subscription';
          } else {
            result = 'approved';
          }
        } else if (effectiveStatus === 'expired') {
          const hasEnd = member.subscriptionEndDate && isExpired(member.subscriptionEndDate);
          const noVisits = member.remainingVisits !== null && member.remainingVisits <= 0;
          reason = (hasEnd || noVisits) ? 'expired_subscription' : 'inactive_subscription';
        } else {
          reason = 'inactive_subscription';
        }

        if (result === 'approved') {
          // Update member visit count (same as handleQrScan)
          const checkNow = new Date().toISOString();
          const updated = { ...member, lastVisit: checkNow, totalVisits: (member.totalVisits || 0) + 1 };
          if (member.remainingVisits !== null) {
            updated.remainingVisits = member.remainingVisits - 1;
            if (updated.remainingVisits <= 0) updated.status = 'expired';
          }
          await updateMember(updated);
        }

        const checkInDoc = await logPublicCheckIn(member.id, member, token, result, reason);
        showPublicCheckinResult(result, reason, member);

      } catch (e) {
        console.error('publicCheckIn error', e);
        document.getElementById('publicCheckinResult').innerHTML =
          '<div style="color:#f87171;text-align:center;padding:8px;">შეცდომა. სცადეთ ხელახლა.</div>';
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'შესვლის დადასტურება'; }
      }
    };

    async function logPublicCheckIn(memberId, member, qrToken, result, reason) {
      const doc = {
        memberId: memberId || '',
        memberName: member ? `${member.firstName || ''} ${member.lastName || ''}`.trim() : '—',
        phone: member?.phone || '—',
        personalId: member?.personalId || (member?.phone || '—'),
        subscriptionStatus: member ? getEffectiveStatus(member) : 'unknown',
        subscriptionType: member?.subscriptionType || '—',
        result,
        reason: reason || '',
        qrToken: qrToken || '',
        checkInTime: new Date().toISOString()
      };
      try {
        const { collection: col, addDoc } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
        await addDoc(col(db, QR_CHECKIN_COLLECTION), doc);
      } catch (e) {
        // REST fallback
        try {
          const pid = firebaseConfig.projectId;
          const url = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${QR_CHECKIN_COLLECTION}`;
          const body = { fields: Object.fromEntries(Object.entries(doc).map(([k,v]) => [k, {stringValue: String(v)}])) };
          await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
        } catch (_) {}
      }
      return doc;
    }

    function showPublicCheckinResult(result, reason, member) {
      const resEl = document.getElementById('publicCheckinResult');
      const formEl = document.getElementById('publicCheckinForm');
      if (!resEl) return;
      if (formEl) formEl.style.display = 'none';

      const approved = result === 'approved';
      const reasonTexts = {
        expired_subscription: 'აბონემენტი ვადაგასულია',
        no_subscription: 'აბონემენტი ვერ მოიძებნა',
        inactive_subscription: 'აბონემენტი არ არის აქტიური',
        invalid_qr: 'QR კოდი არასწორია',
        unauthenticated_user: 'ავტორიზაცია საჭიროა'
      };

      resEl.innerHTML = `
        <div style="text-align:center;padding:32px;background:var(--surface,#1e293b);border-radius:16px;border:2px solid ${approved ? '#4ade80' : '#f87171'};">
          <div style="font-size:3rem;font-weight:900;color:${approved ? '#4ade80' : '#f87171'};margin-bottom:8px;">
            ${approved ? 'დადასტურებულია ✅' : 'უარყოფილია ❌'}
          </div>
          ${member ? `<div style="color:#e2e8f0;font-size:1.1rem;margin-bottom:4px;">${member.firstName} ${member.lastName}</div>` : ''}
          ${!approved && reason ? `<div style="color:#f87171;font-size:0.9rem;margin-top:8px;">${reasonTexts[reason] || reason}</div>` : ''}
          <button class="btn bg-slate-600 hover:bg-slate-700" style="margin-top:20px;" onclick="
            document.getElementById('publicCheckinForm').style.display='';
            document.getElementById('publicCheckinResult').innerHTML='';
            document.getElementById('publicCheckinId').value='';
          ">ხელახლა</button>
        </div>
      `;
    }

    window.toggleDrawer = function() {
      const nav = document.getElementById('main-nav');
      const bd = document.getElementById('nav-backdrop');
      const icon = document.getElementById('hamburger-icon');
      const isOpen = nav?.classList.contains('drawer-open');
      nav?.classList.toggle('drawer-open', !isOpen);
      bd?.classList.toggle('open', !isOpen);
      if (icon) icon.className = isOpen ? 'fas fa-bars' : 'fas fa-times';
    };

    window.closeDrawer = function() {
      document.getElementById('main-nav')?.classList.remove('drawer-open');
      document.getElementById('nav-backdrop')?.classList.remove('open');
      const icon = document.getElementById('hamburger-icon');
      if (icon) icon.className = 'fas fa-bars';
    };

    window.showTab = function(tab) {
      closeDrawer();
      if ((tab === 'finance' || tab === 'stats' || tab === 'users' || tab === 'qrmanage') && !isAdmin()) {
        showToast('ეს სექცია მხოლოდ ადმინისტრატორისთვის არის ხელმისაწვდომი', 'error');
        tab = 'dashboard';
      }
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.getElementById(tab).classList.add('active');
      const activeButton = document.querySelector(`[onclick="showTab('${tab}')"]`);
      if (activeButton) activeButton.classList.add('active');
      if (tab === 'search') {
        document.getElementById('searchResults').innerHTML = '';
        updateSearchMemberList();
      }
      if (tab === 'products') {
        hydrateTransactionsFromRest();
        hydrateProductsFromRest();
        updateProductsTab();
      }
      if (tab === 'finance') {
        hydrateTransactionsFromRest();
        hydrateMembersFromRest();
        updateFinanceTab();
      }
      if (tab === 'stats') {
        hydrateTransactionsFromRest();
        hydrateUsersFromRest();
        updateStatsTab();
      }
      if (tab === 'users') {
        hydrateUsersFromRest();
        updateUsersTab();
      }
      if (tab === 'settings') {
        updateSettingsTab();
      }
      if (tab === 'qrmanage') {
        loadGymQrToken().then(() => updateQrTab());
      }
      if (tab === 'trainers') {
        hydrateTrainersFromRest();
        hydrateMembersFromRest();
        updateTrainersTab();
      }
      if (tab === 'dashboard') {
        document.getElementById('expiringSoonSection').style.display = 'none';
        document.getElementById('todayVisitsSection').style.display = 'none';
      }
    };

    window.toggleExpiringSoon = function() {
      document.getElementById('todayVisitsSection').style.display = 'none';
      const section = document.getElementById('expiringSoonSection');
      if (section.style.display === 'block') {
        section.style.display = 'none';
      } else {
        section.style.display = 'block';
        showExpiringSoon();
      }
    };

    window.toggleTodayVisits = function() {
      document.getElementById('expiringSoonSection').style.display = 'none';
      const section = document.getElementById('todayVisitsSection');
      if (section.style.display === 'block') {
        section.style.display = 'none';
      } else {
        section.style.display = 'block';
        showTodayVisits();
      }
    };

    window.toggleMemberDetails = function(id) {
      const member = window.members.find(m => m.id === id);
      if (!member) return;
      const detailsDiv = document.getElementById(`details-${id}`);
      if (detailsDiv) {
        expandedSearchMemberId = null;
        detailsDiv.remove();
        return;
      }
      expandedSearchMemberId = id;
      const detailsHTML = buildMemberDetailsHTML(member);
      const card = document.querySelector(`[data-member-id="${id}"]`);
      if (card) card.insertAdjacentHTML('afterend', detailsHTML);
    };

    window.processCheckIn = async function(id) {
      const m = window.members.find(x => x.id === id);
      if (!m || m.status !== 'active') { 
        showToast("არააქტიურია", 'error'); 
        return; 
      }
      const now = new Date(), hour = now.getHours();
      if (isExpired(m.subscriptionEndDate)) { 
        await updateMemberFields(m.id, { status: 'expired' }); 
        showToast("ვადა გასულია!", 'error'); 
        return; 
      }
      if (m.subscriptionType === 'morning' && (hour < 9 || hour >= 16)) { 
        showToast("მხოლოდ 09:00–16:00", 'error'); 
        return; 
      }
      let updated = { ...m };
      updated.lastVisit = now.toISOString();
      updated.totalVisits = (updated.totalVisits || 0) + 1;
      if (m.remainingVisits !== null) {
        updated.remainingVisits = m.remainingVisits - 1;
        if (updated.remainingVisits <= 0) updated.status = 'expired';
      }
      await updateMember(updated);
      logMemberVisit(m, 'approved', '', 'admin_manual');
      showToast("შესვლა დაფიქსირდა!");
      document.getElementById('checkinSearch').value = '';
      document.getElementById('checkinResult').innerHTML = '';
    };

    window.checkMemberAccess = async function(member) {
      const now = new Date(), hour = now.getHours();
      let allowed = true, msg = 'ნებადართული';
      if (member.status !== 'active') { 
        allowed = false; 
        msg = 'შეჩერებულია'; 
      }
      else if (isExpired(member.subscriptionEndDate)) { 
        allowed = false; 
        msg = 'ვადა გასულია'; 
        await updateMemberFields(member.id, { status: 'expired' }); 
      }
      else if (member.remainingVisits !== null && member.remainingVisits <= 0) { 
        allowed = false; 
        msg = 'ვიზიტები ამოწურულია'; 
        await updateMemberFields(member.id, { status: 'expired' }); 
      }
      else if (member.subscriptionType === 'morning' && (hour < 9 || hour >= 16)) { 
        allowed = false; 
        msg = 'მხოლოდ 09:00–16:00'; 
      }
      const noteBanner = member.note ? `<div class="note-banner text-sm"><i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${member.note}</div>` : '';
      document.getElementById('checkinResult').innerHTML = `
        <div class="member-card p-6">
          ${noteBanner}
          <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-6">
            <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
            <div><strong>პირადი:</strong> ${member.personalId}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(member.subscriptionType)}</div>
            <div><strong>სტატუსი:</strong> <span class="status-badge ${allowed?'status-active':'status-expired'} text-xs px-3 py-1">${msg}</span></div>
            ${member.remainingVisits != null ? `<div><strong>დარჩენილი:</strong> ${member.remainingVisits}</div>` : ''}
            <div><strong>ვადა:</strong> ${formatDate(member.subscriptionEndDate)}</div>
          </div>
          ${allowed ? `<button class="btn btn-success w-full text-lg py-4" onclick="processCheckIn('${member.id}')">შესვლა</button>` : ''}
        </div>`;
    };

    function isStandardMembershipType(type) {
      if (window.subscriptionPlans?.length) {
        return window.subscriptionPlans.some(p => p.type === type);
      }
      return ['12visits', 'morning', 'unlimited', 'single_visit'].includes(type);
    }

    function getTrainerServiceSelection() {
      const included = Boolean(document.getElementById('membershipTrainerIncluded')?.checked);
      const gifted = Boolean(document.getElementById('membershipTrainerGift')?.checked);
      const price = included ? Math.max(0, Number(document.getElementById('membershipTrainerPrice')?.value || 0)) : 0;
      return {
        included,
        gifted,
        price,
        charge: included && !gifted ? price : 0
      };
    }

    function getMembershipDurationDays(startDateIso, endDateIso) {
      const start = new Date(startDateIso || new Date());
      const end = new Date(endDateIso || new Date());
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      return Math.max(1, Math.round((end - start) / 86400000));
    }

    function getMembershipPaymentSelection() {
      const typeEl = document.getElementById('membershipPaymentSubscriptionType');
      if (!typeEl) return null;

      const selectedType = typeEl.value;
      const start = new Date();
      let resolvedType = selectedType;
      let displayName = getSubscriptionName(selectedType);
      let price = 0;
      let end = setToEndOfDay(addMonthsPreserveDay(start, 1));
      let visits = null;

      if (selectedType !== 'other') {
        const plan = window.subscriptionPlans?.find(p => p.type === selectedType);
        if (plan) {
          price = plan.price;
          visits = plan.remainingVisits;
          displayName = plan.name;
          if (plan.durationDays === 1) {
            end = setToEndOfDay(start);
          } else {
            end = setToEndOfDay(addMonthsPreserveDay(start, Math.round(plan.durationDays / 30)));
          }
        } else if (selectedType === '12visits') {
          price = 70; visits = 12;
        } else if (selectedType === 'morning') {
          price = 90;
        } else if (selectedType === 'unlimited') {
          price = 110;
        } else if (selectedType === 'single_visit') {
          price = 15; visits = 1; end = setToEndOfDay(start);
        }
      }
      if (selectedType === 'other') {
        const description = document.getElementById('membershipPaymentCustomDescription').value.trim();
        const customPrice = Number(document.getElementById('membershipPaymentCustomPrice').value || 0);
        const customDuration = Number(document.getElementById('membershipPaymentCustomDuration').value || 0);
        const visitsValue = document.getElementById('membershipPaymentCustomVisits').value;

        if (!description || !customPrice || !customDuration) {
          return {
            valid: false,
            reason: 'შეავსე აღწერა, ფასი და ვადა'
          };
        }

        resolvedType = description;
        displayName = description;
        price = customPrice;
        end = new Date(start);
        end.setDate(end.getDate() + customDuration);
        end = setToEndOfDay(end);
        visits = visitsValue === '' ? null : parseInt(visitsValue, 10);
      }

      return {
        valid: true,
        selectedType,
        subscriptionType: resolvedType,
        subscriptionPrice: price,
        subscriptionStartDate: start.toISOString(),
        subscriptionEndDate: end.toISOString(),
        remainingVisits: Number.isNaN(visits) ? null : visits,
        displayName
      };
    }

    function resetMembershipPaymentSelectionFields() {
      const _defType = window.subscriptionPlans?.[0]?.type || '12visits';
      document.getElementById('membershipPaymentSubscriptionType')?.value !== undefined && (document.getElementById('membershipPaymentSubscriptionType').value = _defType);
      document.getElementById('membershipPaymentCustomDescription')?.value !== undefined && (document.getElementById('membershipPaymentCustomDescription').value = '');
      document.getElementById('membershipPaymentCustomPrice')?.value !== undefined && (document.getElementById('membershipPaymentCustomPrice').value = '');
      document.getElementById('membershipPaymentCustomDuration')?.value !== undefined && (document.getElementById('membershipPaymentCustomDuration').value = '');
      document.getElementById('membershipPaymentCustomVisits')?.value !== undefined && (document.getElementById('membershipPaymentCustomVisits').value = '');
      document.getElementById('membershipTrainerIncluded')?.checked !== undefined && (document.getElementById('membershipTrainerIncluded').checked = false);
      document.getElementById('membershipTrainerGift')?.checked !== undefined && (document.getElementById('membershipTrainerGift').checked = false);
      document.getElementById('membershipTrainerPrice')?.value !== undefined && (document.getElementById('membershipTrainerPrice').value = '');
      const subscriptionTypeField = document.getElementById('membershipPaymentSubscriptionTypeField');
      const customFields = document.getElementById('membershipPaymentCustomFields');
      const trainerFields = document.getElementById('membershipTrainerFields');
      if (subscriptionTypeField) subscriptionTypeField.style.display = 'none';
      if (customFields) customFields.style.display = 'none';
      if (trainerFields) trainerFields.style.display = 'none';
    }

    window.updateMembershipPaymentSelection = function() {
      const context = window.pendingMembershipPaymentContext;
      const isRenew = context?.mode === 'renew';
      const subscriptionField = document.getElementById('membershipPaymentSubscriptionTypeField');
      const customFields = document.getElementById('membershipPaymentCustomFields');
      const trainerFields = document.getElementById('membershipTrainerFields');

      if (!isRenew) {
        if (subscriptionField) subscriptionField.style.display = 'none';
        if (customFields) customFields.style.display = 'none';
      }

      const selectedType = document.getElementById('membershipPaymentSubscriptionType').value;
      if (customFields) customFields.style.display = selectedType === 'other' ? 'block' : 'none';
      if (trainerFields) trainerFields.style.display = document.getElementById('membershipTrainerIncluded')?.checked ? 'block' : 'none';

      const selection = getMembershipPaymentSelection();
      if (!selection?.valid) {
        document.getElementById('membershipPaymentMeta').textContent = selection?.reason || context.meta || '';
        document.getElementById('membershipPaymentAmount').textContent = 'თანხა: —';
        return;
      }

      const trainerSelection = getTrainerServiceSelection();
      const trainerMeta = trainerSelection.included
        ? ` • ტრენერი ${trainerSelection.gifted ? 'საჩუქრად' : formatCurrency(trainerSelection.price)}`
        : '';

      document.getElementById('membershipPaymentMeta').textContent =
        `${selection.displayName} • ვადა ${formatDate(selection.subscriptionEndDate)}${trainerMeta}`;
      document.getElementById('membershipPaymentAmount').textContent =
        `თანხა: ${formatCurrency(selection.subscriptionPrice + trainerSelection.charge)}`;
    };

    function buildMembershipRenewalPayload(member, paymentMethod, note, selection, trainerSelection) {
      return {
        ...member,
        subscriptionType: selection.subscriptionType,
        subscriptionPrice: selection.subscriptionPrice + trainerSelection.charge,
        baseSubscriptionPrice: selection.subscriptionPrice,
        subscriptionStartDate: selection.subscriptionStartDate,
        subscriptionEndDate: selection.subscriptionEndDate,
        remainingVisits: selection.remainingVisits,
        status: 'active',
        expiringEmailSent: false,
        trainerSessionIncluded: trainerSelection.included,
        trainerSessionGifted: trainerSelection.included ? trainerSelection.gifted : false,
        trainerSessionPrice: trainerSelection.included ? trainerSelection.price : 0,
        lastMembershipPaymentMethod: paymentMethod,
        lastMembershipPaymentNote: note || null,
        lastMembershipHandledByUserId: currentUser?.id || null,
        lastMembershipHandledByUsername: currentUser?.username || null,
        lastMembershipHandledByFullName: getCurrentUserDisplayName() || null,
        lastMembershipHandledByRole: currentUserRole || null,
        lastMembershipHandledAt: new Date().toISOString()
      };
    }

    window.openMembershipPaymentModal = function(context) {
      window.pendingMembershipPaymentContext = context;
      const isRenew = context.mode === 'renew';
      const member = isRenew ? window.members.find((item) => item.id === context.memberId) : null;
      document.getElementById('membershipPaymentTitle').textContent =
        isRenew ? 'აბონემენტის განახლება' : 'აბონემენტის გააქტიურება';
      document.getElementById('membershipPaymentName').textContent = context.memberName;
      document.getElementById('membershipPaymentMeta').textContent = context.meta;
      document.getElementById('membershipPaymentAmount').textContent = `თანხა: ${formatCurrency(context.amount)}`;
      document.getElementById('membershipPaymentMethod').value = 'CASH';
      document.getElementById('membershipPaymentNote').value = '';
      resetMembershipPaymentSelectionFields();

      const renewSel = document.getElementById('membershipPaymentSubscriptionType');
      if (renewSel) renewSel.innerHTML = buildSubscriptionOptions('');

      if (context.member?.trainerSessionIncluded) {
        document.getElementById('membershipTrainerIncluded').checked = true;
        document.getElementById('membershipTrainerGift').checked = Boolean(context.member.trainerSessionGifted);
        document.getElementById('membershipTrainerPrice').value = Number(context.member.trainerSessionPrice || 0) || '';
      }

      if (isRenew) {
        const subscriptionField = document.getElementById('membershipPaymentSubscriptionTypeField');
        if (subscriptionField) subscriptionField.style.display = 'block';
        if (member) {
          const isStandardType = isStandardMembershipType(member.subscriptionType);
          document.getElementById('membershipPaymentSubscriptionType').value = isStandardType ? member.subscriptionType : 'other';
          if (!isStandardType) {
            document.getElementById('membershipPaymentCustomDescription').value = member.subscriptionType || '';
            document.getElementById('membershipPaymentCustomPrice').value = Number(member.baseSubscriptionPrice || member.subscriptionPrice || 0) || '';
            document.getElementById('membershipPaymentCustomDuration').value =
              getMembershipDurationDays(member.subscriptionStartDate, member.subscriptionEndDate);
            document.getElementById('membershipPaymentCustomVisits').value =
              member.remainingVisits == null ? '' : member.remainingVisits;
          }
          if (member.trainerSessionIncluded) {
            document.getElementById('membershipTrainerIncluded').checked = true;
            document.getElementById('membershipTrainerGift').checked = Boolean(member.trainerSessionGifted);
            document.getElementById('membershipTrainerPrice').value = Number(member.trainerSessionPrice || 0) || '';
          }
        }
      }

      window.updateMembershipPaymentSelection();

      const btn = document.getElementById('confirmMembershipPaymentBtn');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> დადასტურება';
      }
      document.getElementById('membershipPaymentModal').style.display = 'flex';
    };

    window.closeMembershipPaymentModal = function() {
      document.getElementById('membershipPaymentModal').style.display = 'none';
      document.getElementById('membershipPaymentMethod').value = 'CASH';
      document.getElementById('membershipPaymentNote').value = '';
      resetMembershipPaymentSelectionFields();
      const btn = document.getElementById('confirmMembershipPaymentBtn');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> დადასტურება';
      }
      window.pendingMembershipPaymentContext = null;
    };

    window.confirmMembershipPayment = async function() {
      const context = window.pendingMembershipPaymentContext;
      if (!context) return;

      const paymentMethod = document.getElementById('membershipPaymentMethod').value;
      const note = document.getElementById('membershipPaymentNote').value.trim() || null;
      const btn = document.getElementById('confirmMembershipPaymentBtn');
      if (btn?.disabled) return;
      if (!paymentMethod) {
        showToast('აირჩიე გადახდის მეთოდი', 'error');
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div>';
      }

      try {
        if (context.mode === 'register') {
          const trainerSelection = getTrainerServiceSelection();
          const registerMember = {
            ...context.member,
            subscriptionPrice: Number(context.member.baseSubscriptionPrice || context.member.subscriptionPrice || 0) + trainerSelection.charge,
            trainerSessionIncluded: trainerSelection.included,
            trainerSessionGifted: trainerSelection.included ? trainerSelection.gifted : false,
            trainerSessionPrice: trainerSelection.included ? trainerSelection.price : 0
          };
          const saved = await createMember(registerMember, { paymentMethod, note });
          if (!saved) throw new Error('membership registration failed');
          document.getElementById('registrationForm')?.reset();
          window.selectedSubscription = null;
          document.querySelectorAll('.subscription-card').forEach((card) => card.classList.remove('selected'));
          document.getElementById('customSubscriptionFields').style.display = 'none';
          const regTrainerWrap = document.getElementById('regTrainerSelectWrap');
          if (regTrainerWrap) regTrainerWrap.style.display = 'none';
          const regTrainerService = document.getElementById('regTrainerService');
          if (regTrainerService) regTrainerService.checked = false;
          window.toggleRegTrainer();
          const regTrainerSessionIncluded = document.getElementById('regTrainerSessionIncluded');
          if (regTrainerSessionIncluded) regTrainerSessionIncluded.checked = false;
          window.toggleRegisterTrainerSession();
          showToast("რეგისტრაცია წარმატებით დასრულდა!");
        } else if (context.mode === 'renew') {
          const existingMember = window.members.find((item) => item.id === context.memberId);
          if (!existingMember) throw new Error('member not found');
          const selection = getMembershipPaymentSelection();
          const trainerSelection = getTrainerServiceSelection();
          if (!selection?.valid) {
            showToast(selection?.reason || 'შეავსე აბონემენტის მონაცემები', 'error');
            if (btn) {
              btn.disabled = false;
              btn.innerHTML = '<i class="fas fa-check"></i> დადასტურება';
            }
            return;
          }
          const updated = buildMembershipRenewalPayload(existingMember, paymentMethod, note, selection, trainerSelection);
          const saved = await updateMember(updated);
          if (!saved) throw new Error('membership renewal failed');
          const membershipTransactionSaved = await recordMembershipTransaction('membership_renewal', updated, { paymentMethod, note });
          await logDateAudit(
            'renew_membership',
            updated,
            { startDate: existingMember.subscriptionStartDate, endDate: existingMember.subscriptionEndDate },
            { startDate: updated.subscriptionStartDate, endDate: updated.subscriptionEndDate },
            { source: 'renew_button' }
          );
          showToast("განახლდა!");
          if (!membershipTransactionSaved) {
            showToast('ფინანსური ჩანაწერი მოგვიანებით აღდგება', 'warning');
          }
          if (updated.email) {
            setTimeout(() => {
              sendRenewalEmail(updated);
            }, 1000);
          }
        }

        window.closeMembershipPaymentModal();
      } catch (e) {
        console.error('membership payment confirm failed', e);
        showToast('ოპერაცია ვერ დასრულდა', 'error');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-check"></i> დადასტურება';
        }
      }
    };

    window.renewMembership = async function(id) {
      const m = window.members.find(x => x.id === id);
      if (!m) return;
      window.openMembershipPaymentModal({
        mode: 'renew',
        memberId: m.id,
        memberName: `${m.firstName} ${m.lastName}`,
        meta: `${getSubscriptionName(m.subscriptionType)} • ${formatDate(m.subscriptionEndDate)}`,
        amount: Number(m.subscriptionPrice || 0)
      });
    };

    window.showEditForm = function(e, id) {
      if (e) e.stopPropagation();
      document.querySelectorAll('.edit-form').forEach(f => f.remove());
      const m = window.members.find(x => x.id === id);
      if (!m) return;
      const effectiveStatus = getEffectiveStatus(m);
      const div = document.createElement('div');
      div.className = 'edit-form edit-modal';
      const startDate = m.subscriptionStartDate ? toDateInputValue(m.subscriptionStartDate) : toDateInputValue(new Date().toISOString());
      const endDate = m.subscriptionEndDate ? toDateInputValue(m.subscriptionEndDate) : toDateInputValue(new Date().toISOString());
      div.innerHTML = `
        <div class="edit-modal-card">
          <div class="edit-modal-header">
            <h4 class="edit-modal-title">რედაქტირება — ${m.firstName} ${m.lastName}</h4>
            <button class="edit-modal-close" type="button" onclick="this.closest('.edit-form').remove()">×</button>
          </div>
          <div class="edit-context">
            რედაქტირდება წევრი: <strong>${m.firstName} ${m.lastName}</strong> • პირადი: <strong>${m.personalId}</strong>
          </div>
          <div class="edit-grid">
            <div class="edit-field">
              <label class="edit-field-label" for="e_fn_${id}">სახელი</label>
              <input type="text" value="${m.firstName}" id="e_fn_${id}" class="form-input" placeholder="სახელი">
            </div>
            <div class="edit-field">
              <label class="edit-field-label" for="e_ln_${id}">გვარი</label>
              <input type="text" value="${m.lastName}" id="e_ln_${id}" class="form-input" placeholder="გვარი">
            </div>
            <div class="edit-field">
              <label class="edit-field-label" for="e_email_${id}">ელ-ფოსტა</label>
              <input type="email" value="${m.email || ''}" id="e_email_${id}" class="form-input" placeholder="Email">
            </div>
            <div class="edit-field">
              <label class="edit-field-label" for="e_ph_${id}">ტელეფონი</label>
              <input type="tel" value="${m.phone || ''}" id="e_ph_${id}" class="form-input" placeholder="ტელეფონი">
            </div>
            <div class="edit-field">
              <label class="edit-field-label" for="e_pid_${id}">პირადი ნომერი</label>
              <input type="text" value="${m.personalId}" id="e_pid_${id}" class="form-input" placeholder="პირადი">
            </div>
            <div class="edit-field" style="grid-column:1/-1;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:14px;">
              <label class="edit-field-label" style="color:#ef4444;"><i class="fas fa-dumbbell"></i> ტრენერის სერვისი</label>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 0;">
                <input type="checkbox" id="e_trainerService_${id}" ${m.trainerServiceEnabled ? 'checked' : ''} onchange="window.toggleEditTrainer('${id}')" style="width:18px;height:18px;cursor:pointer;accent-color:#ef4444;">
                <span style="font-weight:700;">ტრენერი ჰყავს</span>
              </label>
              <div id="e_trainerSelectWrap_${id}" style="display:${m.trainerServiceEnabled ? 'block' : 'none'};margin-top:4px;">
                <select id="e_trainerId_${id}" class="form-input">${buildTrainerOptions(m.trainerId || '')}</select>
              </div>
            </div>
            <div class="edit-field">
              <label class="edit-field-label" for="e_subtype_${id}">აბონემენტის ტიპი</label>
              <select id="e_subtype_${id}" class="form-input" onchange="window.autoFillSubscription('${id}')">
                ${buildSubscriptionOptions(m.subscriptionType)}
              </select>
            </div>
            <div class="edit-field">
              <label class="edit-field-label" for="e_price_${id}">ფასი (₾)</label>
              <input type="number" value="${m.subscriptionPrice||0}" id="e_price_${id}" class="form-input" placeholder="ფასი">
            </div>
            <div class="edit-field">
              <label class="edit-field-label" for="e_startdate_${id}">გააქტიურების თარიღი</label>
              <input type="date" value="${startDate}" id="e_startdate_${id}" class="form-input">
            </div>
            <div class="edit-field">
              <label class="edit-field-label" for="e_enddate_${id}">ვადის გასვლის თარიღი</label>
              <input type="date" value="${endDate}" id="e_enddate_${id}" class="form-input">
            </div>
            <div class="edit-field">
              <label class="edit-field-label" for="e_visits_${id}">დარჩენილი ვიზიტები</label>
              <input type="number" value="${m.remainingVisits == null ? '' : m.remainingVisits}" id="e_visits_${id}" class="form-input" placeholder="ვიზიტები">
            </div>
            <div class="edit-field">
              <label class="edit-field-label" for="e_status_${id}">სტატუსი</label>
              <select id="e_status_${id}" class="form-input">
                <option value="active" ${effectiveStatus==='active'?'selected':''}>აქტიური</option>
                <option value="expired" ${effectiveStatus==='expired'?'selected':''}>ვადაგასული</option>
                <option value="paused" ${effectiveStatus==='paused'?'selected':''}>შეჩერებული</option>
              </select>
            </div>
            <div class="edit-field">
              <label class="edit-field-label" for="e_note_${id}">შენიშვნა</label>
              <textarea id="e_note_${id}" class="form-input edit-note-input" placeholder="შენიშვნა">${m.note || ''}</textarea>
            </div>
          </div>
          <div class="edit-actions">
            <button class="btn btn-success px-8 py-3" onclick="window.saveEdit('${id}')">შენახვა</button>
            <button class="btn bg-red-600 hover:bg-red-700 px-8 py-3" onclick="this.closest('.edit-form').remove()">გაუქმება</button>
          </div>
        </div>`;
      div.addEventListener('click', (ev) => {
        if (ev.target === div) div.remove();
      });
      document.body.appendChild(div);
      const firstInput = div.querySelector(`#e_fn_${id}`);
      if (firstInput) {
        firstInput.focus();
      }
    };

    window.autoFillSubscription = function(id) {
      const type = document.getElementById(`e_subtype_${id}`).value;
      const plan = window.subscriptionPlans?.find(p => p.type === type);
      if (plan) {
        document.getElementById(`e_price_${id}`).value = plan.price;
        document.getElementById(`e_visits_${id}`).value = plan.remainingVisits ?? '';
      } else if (type === '12visits') {
        document.getElementById(`e_price_${id}`).value = 70;
        document.getElementById(`e_visits_${id}`).value = 12;
      } else if (type === 'single_visit') {
        document.getElementById(`e_price_${id}`).value = 15;
        document.getElementById(`e_visits_${id}`).value = 1;
      } else if (type === 'morning') {
        document.getElementById(`e_price_${id}`).value = 90;
        document.getElementById(`e_visits_${id}`).value = '';
      } else if (type === 'unlimited') {
        document.getElementById(`e_price_${id}`).value = 110;
        document.getElementById(`e_visits_${id}`).value = '';
      }
      // თარიღი აღარ შეიცვლება ავტომატურად - მომხმარებელი თვითონ შეცვლის
    };

    window.saveEdit = async function(id) {
      const m = window.members.find(x => x.id === id);
      if (!m) return;
      const startDate = document.getElementById(`e_startdate_${id}`).value;
      const endDate = document.getElementById(`e_enddate_${id}`).value;
      if (!startDate || !endDate) {
        showToast("გააქტიურების და ვადის თარიღი სავალდებულოა!", 'error');
        return; 
      }
      const updated = {
        ...m,
        firstName: document.getElementById(`e_fn_${id}`).value.trim(),
        lastName: document.getElementById(`e_ln_${id}`).value.trim(),
        email: document.getElementById(`e_email_${id}`).value.trim() || null,
        phone: document.getElementById(`e_ph_${id}`).value.trim(),
        personalId: document.getElementById(`e_pid_${id}`).value.trim(),
        note: document.getElementById(`e_note_${id}`).value.trim() || null,
        subscriptionType: document.getElementById(`e_subtype_${id}`).value,
        subscriptionPrice: parseFloat(document.getElementById(`e_price_${id}`).value) || 0,
        subscriptionStartDate: dateInputToISOEndOfDay(startDate),
        subscriptionEndDate: dateInputToISOEndOfDay(endDate),
        remainingVisits: document.getElementById(`e_visits_${id}`).value === '' ? null : parseInt(document.getElementById(`e_visits_${id}`).value),
        status: document.getElementById(`e_status_${id}`).value,
        trainerServiceEnabled: document.getElementById(`e_trainerService_${id}`)?.checked || false,
        trainerId: (document.getElementById(`e_trainerService_${id}`)?.checked && document.getElementById(`e_trainerId_${id}`)?.value) || null
      };
      const saved = await updateMember(updated);
      if (!saved) return;
      if (hasDateChanged(
        { startDate: m.subscriptionStartDate, endDate: m.subscriptionEndDate },
        { startDate: updated.subscriptionStartDate, endDate: updated.subscriptionEndDate }
      )) {
        await logDateAudit(
          'edit_membership_dates',
          updated,
          { startDate: m.subscriptionStartDate, endDate: m.subscriptionEndDate },
          { startDate: updated.subscriptionStartDate, endDate: updated.subscriptionEndDate },
          { source: 'edit_modal_save' }
        );
      }
      showToast("შენახულია!");
      document.querySelectorAll('.edit-form').forEach(f => f.remove());
      updateAll();
    };

    function buildProductCardHTML(product) {
      const stock = Number(product.stock || 0);
      const canSell = stock > 0;
      const cartQuantity = getCartItemQuantity(product.id);
      const manageButtons = [
        isAdmin() ? `<button class="btn bg-blue-600 hover:bg-blue-700" onclick="event.stopPropagation(); window.openProductForm('${product.id}')"><i class="fas fa-pen"></i> რედაქტირება</button>` : '',
        isAdmin() ? `<button class="btn bg-red-600 hover:bg-red-700" onclick="event.stopPropagation(); window.deleteProduct('${product.id}')"><i class="fas fa-trash"></i> წაშლა</button>` : ''
      ].filter(Boolean).join('');
      const imageHtml = product.imageUrl
        ? `<img src="${product.imageUrl}" alt="${product.name}" class="product-card-image" onerror="this.parentElement.innerHTML='<div class=&quot;product-photo-fallback&quot;><i class=&quot;fas fa-bottle-water&quot;></i></div>'">`
        : `<div class="product-photo-fallback"><i class="fas fa-bottle-water"></i></div>`;
      const cardClick = canSell ? `onclick="window.addProductToCart('${product.id}')"` : '';
      const cardClickableClass = canSell ? 'product-card-clickable' : '';

      return `
        <div class="product-card ${canSell ? '' : 'product-card-empty'} ${cardClickableClass}" ${cardClick}>
          ${cartQuantity > 0 ? `<div class="product-card-cart-badge">${cartQuantity}</div>` : ''}
          <div class="product-card-media">${imageHtml}</div>
          <div class="product-card-body">
            <div class="product-card-head">
              <div>
                <div class="product-card-title">${product.name}</div>
                <div class="product-card-code">კოდი: ${product.code}</div>
              </div>
              <span class="status-badge ${canSell ? 'status-active' : 'status-expired'}">${canSell ? 'მარაგშია' : 'ამოიწურა'}</span>
            </div>
            <div class="product-card-price">${formatCurrency(product.price)}</div>
            <div class="product-card-meta">მარაგი: ${stock}</div>
            <div class="product-card-actions">
              <button class="btn btn-success product-card-select-btn" ${canSell ? '' : 'disabled'} onclick="event.stopPropagation(); window.addProductToCart('${product.id}')">
                <i class="fas fa-plus"></i> ${cartQuantity > 0 ? 'კალათაში დამატება' : 'კალათაში'}
              </button>
            </div>
            ${manageButtons ? `<div class="product-card-actions product-card-manage">${manageButtons}</div>` : ''}
          </div>
        </div>
      `;
    }

    function renderRecentProductSales(targetId = 'recentProductSales') {
      const container = document.getElementById(targetId);
      if (!container) return;
      const sales = getFinancialSummary().recentProductSales;
      if (sales.length === 0) {
        container.innerHTML = '<p class="empty-state">ჯერ არცერთი პროდუქტი არ გაყიდულა</p>';
        return;
      }
      container.innerHTML = sales.map((sale) => buildTransactionRowHtml({
        title: sale.productName,
        meta: `${sale.quantity} ცალი • ${getPaymentMethodLabel(sale.paymentMethod)} • ${formatDateTime(sale.createdAt)}${sale.actorFullName ? ` • ${sale.actorFullName}` : ''}`,
        amount: isAdmin() ? formatCurrency(sale.amount) : `${sale.quantity} ცალი`,
        tx: sale
      })).join('');
    }

    function updateProductsTab() {
      const grid = document.getElementById('productsGrid');
      if (!grid) return;
      const productsTab = document.getElementById('products');
      if (productsTab) {
        productsTab.classList.toggle('operator-products-shell', !isAdmin());
      }

      const searchValue = (document.getElementById('productSearchInput')?.value || '').trim().toLowerCase();
      const filteredProducts = window.products.filter((product) => {
        const matchesSearch = !searchValue ||
          String(product.name || '').toLowerCase().includes(searchValue) ||
          String(product.code || '').toLowerCase().includes(searchValue);
        const stock = Number(product.stock || 0);
        const matchesFilter = window.productCatalogFilter === 'all'
          ? true
          : window.productCatalogFilter === 'in_stock'
            ? stock > 0
            : stock > 0 && stock <= 5;
        return matchesSearch && matchesFilter;
      });

      const todayProductUnits = window.transactions
        .filter((tx) => tx.type === 'product_sale' && isSameCalendarDay(tx.createdAt, new Date()))
        .reduce((total, tx) => total + Number(tx.quantity || 0), 0);

      const productsCountEl = document.getElementById('productsCount');
      const todayUnitsEl = document.getElementById('todayProductUnits');
      if (productsCountEl) productsCountEl.textContent = window.products.length;
      if (todayUnitsEl) todayUnitsEl.textContent = todayProductUnits;
      document.querySelectorAll('.product-filter-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.filter === window.productCatalogFilter);
      });

      if (filteredProducts.length === 0) {
        grid.innerHTML = `<p class="empty-state">${window.products.length === 0 ? 'პროდუქტები ჯერ არ დამატებულა' : 'მითითებული პროდუქტები ვერ მოიძებნა'}</p>`;
      } else {
        grid.innerHTML = filteredProducts.map(buildProductCardHTML).join('');
      }

      renderProductCart();
      renderInventoryRestockList();
      renderRecentProductSales('recentProductSales');
      if (document.getElementById('daySalesModal')?.style.display === 'flex') {
        renderDaySalesModal();
      }
    }

    window.setProductCatalogFilter = function(filter) {
      window.productCatalogFilter = filter || 'all';
      updateProductsTab();
    };

    function renderFinanceBreakdown(summary) {
      const container = document.getElementById('financeBreakdownList');
      if (!container) return;

      const monthlyTopProductsMap = {};
      window.transactions
        .filter((tx) => tx.type === 'product_sale' && isSameCalendarMonth(tx.createdAt, new Date()))
        .forEach((tx) => {
          const key = tx.productId || tx.productCode || tx.productName;
          if (!monthlyTopProductsMap[key]) {
            monthlyTopProductsMap[key] = { name: tx.productName, quantity: 0, amount: 0 };
          }
          monthlyTopProductsMap[key].quantity += Number(tx.quantity || 0);
          monthlyTopProductsMap[key].amount += Number(tx.amount || 0);
        });

      const topProducts = Object.values(monthlyTopProductsMap)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);

      container.innerHTML = `
        <div class="finance-breakdown-row"><span>ამ თვეში აბონემენტები</span><strong>${summary.monthMembershipCount}</strong></div>
        <div class="finance-breakdown-row"><span>პროდუქტის გაყიდვები</span><strong>${summary.monthProductSalesCount}</strong></div>
        <div class="finance-breakdown-row"><span>გაყიდული ერთეულები</span><strong>${summary.monthProductUnits}</strong></div>
        ${topProducts.length > 0 ? `<div class="finance-breakdown-title">ტოპ პროდუქტები ამ თვეში</div>` : ''}
        ${topProducts.map((product) => `
          <div class="finance-breakdown-row">
            <span>${product.name} (${product.quantity} ც.)</span>
            <strong>${formatCurrency(product.amount)}</strong>
          </div>
        `).join('')}
      `;
    }

    function updateFinanceTab() {
      const summary = getFinancialSummary();
      const currencyIds = {
        todayMembershipRevenue: summary.todayMembership,
        todayProductRevenue: summary.todayProducts,
        todayTotalRevenue: summary.todayTotal,
        monthMembershipRevenue: summary.monthMembership,
        monthProductRevenue: summary.monthProducts,
        monthTotalRevenue: summary.monthTotal
      };
      const countIds = {
        todayRegistrationsCount: summary.todayRegistrationCount,
        todayRenewalsCount: summary.todayRenewalCount,
        todayProductSalesCount: summary.todayProductSalesCount,
        todayProductUnitsFinance: summary.todayProductUnits
      };

      Object.entries(currencyIds).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = formatCurrency(value);
      });
      Object.entries(countIds).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
      });

      const transactionsList = document.getElementById('financeTransactionsList');
      if (transactionsList) {
        const recentTransactions = summary.recentTransactions.slice(0, 5);
        if (recentTransactions.length === 0) {
          transactionsList.innerHTML = '<p class="empty-state">ტრანზაქციები ჯერ არ არის</p>';
        } else {
          transactionsList.innerHTML = recentTransactions.map((tx) => buildTransactionRowHtml({
            title: tx.description || (tx.category === 'membership' ? 'აბონემენტი' : 'პროდუქტი'),
            meta: `${formatDateTime(tx.createdAt)} • ${tx.category === 'membership' ? 'აბონემენტი' : 'პროდუქტი'}${tx.paymentMethod ? ` • ${getPaymentMethodLabel(tx.paymentMethod)}` : ''}${tx.actorFullName ? ` • ${tx.actorFullName}` : ''}`,
            amount: formatCurrency(tx.amount),
            tx
          })).join('');
        }
      }

      const todayBreakdownList = document.getElementById('financeTodayBreakdownList');
      if (todayBreakdownList) {
        const paymentTotals = [...summary.todayMembershipTransactions, ...summary.todayProductTransactions].reduce((acc, tx) => {
          const method = tx.paymentMethod || 'CASH';
          acc[method] = (acc[method] || 0) + Number(tx.amount || 0);
          return acc;
        }, {});
        todayBreakdownList.innerHTML = `
          <div class="finance-breakdown-row"><span>ახალი აბონემენტები</span><strong>${summary.todayRegistrationCount}</strong></div>
          <div class="finance-breakdown-row"><span>განახლებული აბონემენტები</span><strong>${summary.todayRenewalCount}</strong></div>
          <div class="finance-breakdown-row"><span>პროდუქტის გაყიდვები</span><strong>${summary.todayProductSalesCount}</strong></div>
          <div class="finance-breakdown-row"><span>გაყიდული ერთეულები</span><strong>${summary.todayProductUnits}</strong></div>
          <div class="finance-breakdown-row"><span>TBC</span><strong>${formatCurrency(paymentTotals.TBC || 0)}</strong></div>
          <div class="finance-breakdown-row"><span>BOG</span><strong>${formatCurrency(paymentTotals.BOG || 0)}</strong></div>
          <div class="finance-breakdown-row"><span>CASH</span><strong>${formatCurrency(paymentTotals.CASH || 0)}</strong></div>
          <div class="finance-breakdown-row"><span>გადარიცხვა</span><strong>${formatCurrency(paymentTotals.TRANSFER || 0)}</strong></div>
        `;
      }

      renderFinanceBreakdown(summary);
      renderRecentProductSales('financeRecentSalesList');
      const archiveTable = document.getElementById('financeArchiveTable');
      if (archiveTable) {
        archiveTable.innerHTML = buildAdminTable(
          ['თვე', 'აბონემენტი', 'პროდუქტი', 'ერთეული', 'სულ'],
          getFinanceArchiveRows().map((row) => `
            <tr>
              <td>${formatMonthKey(row.monthKey)}</td>
              <td>${formatCurrency(row.membershipAmount)} (${row.membershipCount})</td>
              <td>${formatCurrency(row.productAmount)} (${row.productCount})</td>
              <td>${row.productUnits}</td>
              <td>${formatCurrency(row.totalAmount)}</td>
            </tr>
          `),
          'ფინანსური არქივი ჯერ არ არის'
        );
      }

      // ფინანსების გასუფთავების ღილაკი (admin only)
      const financeTab = document.getElementById('finance');
      if (financeTab && isAdmin()) {
        if (!document.getElementById('clearFinancesBtn')) {
          const clearBtn = document.createElement('button');
          clearBtn.id = 'clearFinancesBtn';
          clearBtn.className = 'btn text-sm px-4 py-2';
          clearBtn.style.cssText = 'background:rgba(239,68,68,0.12);border:1.5px solid rgba(239,68,68,0.4);color:#fca5a5;border-radius:10px;cursor:pointer;display:flex;align-items:center;gap:6px;margin-top:10px;';
          clearBtn.innerHTML = '<i class="fas fa-trash-alt"></i> ფინანსების გასუფთავება';
          clearBtn.onclick = window.openClearFinancesModal;
          // ჩავსვათ finance tab-ის ბოლოში
          const financeActions = financeTab.querySelector('.finance-actions') || financeTab;
          financeActions.appendChild(clearBtn);
        }
      }
    }

    function buildDailyClosureData() {
      const now = new Date();
      const summary = getFinancialSummary();
      const membershipTransactions = summary.todayMembershipTransactions;
      const productTransactions = summary.todayProductTransactions;

      const subscriptionMap = {};
      membershipTransactions.forEach((tx) => {
        const key = tx.subscriptionName || tx.subscriptionType || 'აბონემენტი';
        if (!subscriptionMap[key]) {
          subscriptionMap[key] = { name: key, count: 0, amount: 0 };
        }
        subscriptionMap[key].count += 1;
        subscriptionMap[key].amount += Number(tx.amount || 0);
      });

      const productMap = {};
      productTransactions.forEach((tx) => {
        const key = tx.productId || tx.productCode || tx.productName;
        if (!productMap[key]) {
          productMap[key] = { name: tx.productName || 'პროდუქტი', quantity: 0, amount: 0 };
        }
        productMap[key].quantity += Number(tx.quantity || 0);
        productMap[key].amount += Number(tx.amount || 0);
      });

      return {
        generatedAt: now.toISOString(),
        printedByFullName: getCurrentUserDisplayName() || 'უცნობი იუზერი',
        summary,
        membershipTransactions,
        productTransactions,
        subscriptionRows: Object.values(subscriptionMap).sort((a, b) => b.amount - a.amount),
        productRows: Object.values(productMap).sort((a, b) => b.amount - a.amount)
      };
    }

    function buildDailyClosureReportElement(data) {
      const wrapper = document.createElement('div');
      wrapper.className = 'daily-closure-report';
      wrapper.innerHTML = `
        <style>
          .daily-closure-report {
            font-family: 'DejaVu Sans', 'Noto Sans Georgian', Arial, sans-serif;
            color: #111827;
            background: #ffffff;
            padding: 28px;
            width: 100%;
          }
          .daily-closure-title {
            font-size: 28px;
            font-weight: 800;
            margin-bottom: 6px;
            color: #1d4ed8;
          }
          .daily-closure-subtitle {
            font-size: 13px;
            color: #6b7280;
            margin-bottom: 20px;
          }
          .daily-closure-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 22px;
          }
          .daily-closure-card {
            border: 1px solid #dbeafe;
            border-radius: 14px;
            padding: 14px;
            background: #f8fbff;
          }
          .daily-closure-card-label {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 6px;
          }
          .daily-closure-card-value {
            font-size: 20px;
            font-weight: 800;
            color: #0f172a;
          }
          .daily-closure-section {
            margin-top: 20px;
          }
          .daily-closure-section h3 {
            font-size: 18px;
            margin: 0 0 12px;
            color: #0f172a;
          }
          .daily-closure-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
          }
          .daily-closure-table th,
          .daily-closure-table td {
            border: 1px solid #e5e7eb;
            padding: 8px 10px;
            text-align: left;
            font-size: 12px;
            vertical-align: top;
          }
          .daily-closure-table th {
            background: #eff6ff;
            color: #1e3a8a;
            font-weight: 800;
          }
          .daily-closure-empty {
            font-size: 13px;
            color: #6b7280;
            margin-bottom: 12px;
          }
        </style>
        <div class="daily-closure-title">დღის დახურვის რეპორტი</div>
        <div class="daily-closure-subtitle">
          თარიღი: ${formatDate(data.generatedAt)} • დრო: ${formatDateTime(data.generatedAt)}
        </div>
        <div class="daily-closure-grid">
          <div class="daily-closure-card">
            <div class="daily-closure-card-label">დღეს აბონემენტებიდან</div>
            <div class="daily-closure-card-value">${formatCurrency(data.summary.todayMembership)}</div>
          </div>
          <div class="daily-closure-card">
            <div class="daily-closure-card-label">დღეს პროდუქტებიდან</div>
            <div class="daily-closure-card-value">${formatCurrency(data.summary.todayProducts)}</div>
          </div>
          <div class="daily-closure-card">
            <div class="daily-closure-card-label">დღის ჯამური შემოსავალი</div>
            <div class="daily-closure-card-value">${formatCurrency(data.summary.todayTotal)}</div>
          </div>
          <div class="daily-closure-card">
            <div class="daily-closure-card-label">ახალი აბონემენტები</div>
            <div class="daily-closure-card-value">${data.summary.todayRegistrationCount}</div>
          </div>
          <div class="daily-closure-card">
            <div class="daily-closure-card-label">განახლებები</div>
            <div class="daily-closure-card-value">${data.summary.todayRenewalCount}</div>
          </div>
          <div class="daily-closure-card">
            <div class="daily-closure-card-label">გაყიდული ერთეულები</div>
            <div class="daily-closure-card-value">${data.summary.todayProductUnits}</div>
          </div>
        </div>

        <div class="daily-closure-section">
          <h3>დღევანდელი აბონემენტები და განახლებები</h3>
          ${data.membershipTransactions.length === 0 ? '<div class="daily-closure-empty">დღეს აბონემენტების ჩანაწერი არ არის.</div>' : `
            <table class="daily-closure-table">
              <thead>
                <tr>
                  <th>დრო</th>
                  <th>მომხმარებელი</th>
                  <th>ოპერაცია</th>
                  <th>აბონემენტი</th>
                  <th>ოპერატორი</th>
                  <th>გადახდა</th>
                  <th>თანხა</th>
                </tr>
              </thead>
              <tbody>
                ${data.membershipTransactions.map((tx) => `
                  <tr>
                    <td>${formatDateTime(tx.createdAt)}</td>
                    <td>${tx.memberName || '—'}</td>
                    <td>${tx.type === 'membership_registration' ? 'რეგისტრაცია' : 'განახლება'}</td>
                    <td>${tx.subscriptionName || getSubscriptionName(tx.subscriptionType)}</td>
                    <td>${tx.actorFullName || '—'}</td>
                    <td>${getPaymentMethodLabel(tx.paymentMethod)}</td>
                    <td>${formatCurrency(tx.amount)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>

        <div class="daily-closure-section">
          <h3>აბონემენტების ჭრილი</h3>
          ${data.subscriptionRows.length === 0 ? '<div class="daily-closure-empty">დღეს აბონემენტები არ გაყიდულა.</div>' : `
            <table class="daily-closure-table">
              <thead>
                <tr>
                  <th>აბონემენტი</th>
                  <th>რაოდენობა</th>
                  <th>შემოსავალი</th>
                </tr>
              </thead>
              <tbody>
                ${data.subscriptionRows.map((row) => `
                  <tr>
                    <td>${row.name}</td>
                    <td>${row.count}</td>
                    <td>${formatCurrency(row.amount)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>

        <div class="daily-closure-section">
          <h3>დღევანდელი პროდუქტის გაყიდვები</h3>
          ${data.productTransactions.length === 0 ? '<div class="daily-closure-empty">დღეს პროდუქტი არ გაყიდულა.</div>' : `
            <table class="daily-closure-table">
              <thead>
                <tr>
                  <th>დრო</th>
                  <th>პროდუქტი</th>
                  <th>რაოდენობა</th>
                  <th>ოპერატორი</th>
                  <th>გადახდა</th>
                  <th>თანხა</th>
                </tr>
              </thead>
              <tbody>
                ${data.productTransactions.map((tx) => `
                  <tr>
                    <td>${formatDateTime(tx.createdAt)}</td>
                    <td>${tx.productName || '—'}</td>
                    <td>${tx.quantity || 0}</td>
                    <td>${tx.actorFullName || '—'}</td>
                    <td>${getPaymentMethodLabel(tx.paymentMethod)}</td>
                    <td>${formatCurrency(tx.amount)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>

        <div class="daily-closure-section">
          <h3>პროდუქტების ჭრილი</h3>
          ${data.productRows.length === 0 ? '<div class="daily-closure-empty">დღეს გაყიდული პროდუქტები არ არის.</div>' : `
            <table class="daily-closure-table">
              <thead>
                <tr>
                  <th>პროდუქტი</th>
                  <th>ერთეული</th>
                  <th>შემოსავალი</th>
                </tr>
              </thead>
              <tbody>
                ${data.productRows.map((row) => `
                  <tr>
                    <td>${row.name}</td>
                    <td>${row.quantity}</td>
                    <td>${formatCurrency(row.amount)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>

        <div class="daily-closure-summary-total">
          🏆 დღის სულ შემოსავალი: ${formatCurrency(data.summary.todayTotal)} &nbsp;|&nbsp;
          📋 აბონემენტი: ${data.summary.todayRegistrationCount + data.summary.todayRenewalCount} (${formatCurrency(data.summary.todayMembership)}) &nbsp;|&nbsp;
          🛍️ პროდუქტი: ${data.summary.todayProductUnits} ც. (${formatCurrency(data.summary.todayProducts)})
        </div>
        <div style="margin-top:18px;font-size:12px;color:#475569;text-align:right;">
          დაბეჭდა: <strong>${data.printedByFullName}</strong> • ${formatDateTime(data.generatedAt)}
        </div>
      `;
      return wrapper;
    }

    async function ensureHtml2PdfLibrary() {
      if (window.html2pdf) return window.html2pdf;
      const sources = [
        'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
        'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js'
      ];
      for (const src of sources) {
        try {
          await new Promise((resolve, reject) => {
            const existing = Array.from(document.querySelectorAll('script')).find((s) => s.src === src);
            if (existing) {
              if (window.html2pdf) return resolve();
              existing.addEventListener('load', resolve, { once: true });
              existing.addEventListener('error', reject, { once: true });
              return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
          if (window.html2pdf) return window.html2pdf;
        } catch (e) {
          console.warn('html2pdf load failed', src, e);
        }
      }
      return null;
    }

    function openDailyClosurePrintPreview(reportElement, title) {
      try {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;';
        document.body.appendChild(iframe);
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.open();
        doc.write(`<!DOCTYPE html><html lang="ka">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font-family: Arial, sans-serif; background: #fff; color: #111; font-size: 13px; }
  @media print { body { padding: 8px; } @page { margin: 10mm; } }
  .daily-closure-report { font-family: Arial, sans-serif; color: #111827; background: #ffffff; padding: 20px; width: 100%; }
  .daily-closure-title { font-size: 24px; font-weight: 800; margin-bottom: 4px; color: #1d4ed8; }
  .daily-closure-subtitle { font-size: 12px; color: #6b7280; margin-bottom: 18px; }
  .daily-closure-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 20px; }
  .daily-closure-card { border: 1px solid #dbeafe; border-radius: 10px; padding: 12px; background: #f8fbff; }
  .daily-closure-card-label { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
  .daily-closure-card-value { font-size: 18px; font-weight: 800; color: #0f172a; }
  .daily-closure-section { margin-top: 18px; }
  .daily-closure-section h3 { font-size: 15px; margin: 0 0 10px; color: #0f172a; border-bottom: 2px solid #dbeafe; padding-bottom: 4px; }
  .daily-closure-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .daily-closure-table th, .daily-closure-table td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; font-size: 11px; vertical-align: top; }
  .daily-closure-table th { background: #eff6ff; color: #1e3a8a; font-weight: 800; }
  .daily-closure-table tr:nth-child(even) td { background: #f9fafb; }
  .daily-closure-empty { font-size: 12px; color: #6b7280; margin-bottom: 10px; font-style: italic; }
  .daily-closure-summary-total { background: #1d4ed8; color: #fff; padding: 12px 16px; border-radius: 8px; font-size: 16px; font-weight: 800; text-align: center; margin-top: 20px; }
</style>
</head>
<body>${reportElement.outerHTML}</body>
</html>`);
        doc.close();
        setTimeout(() => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch(printErr) {
            console.error('iframe print failed', printErr);
          }
          setTimeout(() => {
            try { iframe.remove(); } catch(e) {}
          }, 6000);
        }, 900);
        return true;
      } catch(e) {
        console.error('print preview failed', e);
        return false;
      }
    }

    window.exportDailyClosurePdf = async function() {
      // ოპერატორსაც შეუძლია დღის ანგარიშის ბეჭდვა

      showToast('მონაცემები იტვირთება...');
      await hydrateTransactionsFromRest();
      await hydrateMembersFromRest();

      const data = buildDailyClosureData();
      const reportElement = buildDailyClosureReportElement(data);
      const filename = `FitHouse-DayClose-${toDateInputValue(data.generatedAt)}`;
      const title = `Fit House — დღის დახურვა ${formatDate(data.generatedAt)}`;

      // პირველი ცდა: iframe print (ყოველთვის მუშაობს, ინარჩუნებს ყველა მონაცემს)
      const printOk = openDailyClosurePrintPreview(reportElement, title);
      if (printOk) {
        showToast('ანგარიში გაიხსნა ბეჭდვისთვის (PDF-ად შეინახეთ ბრაუზერიდან)');
        return;
      }

      // fallback: html2pdf თუ ხელმისაწვდომია
      const html2pdfLib = await ensureHtml2PdfLibrary();
      if (html2pdfLib) {
        const clone = reportElement.cloneNode(true);
        clone.style.cssText = 'position:absolute;left:0;top:0;width:800px;background:#fff;padding:20px;z-index:-9999;';
        document.body.appendChild(clone);
        // დაველოდოთ render-ს
        await new Promise(r => setTimeout(r, 500));
        try {
          const worker = html2pdfLib().set({
            margin: [8, 8, 8, 8],
            filename: filename + '.pdf',
            image: { type: 'jpeg', quality: 0.97 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
          }).from(clone);
          await worker.toPdf();
          const pdf = await worker.get('pdf');
          pdf.save(filename + '.pdf');
          clone.remove();
          showToast('დღის დახურვის PDF ჩამოიტვირთა');
          return;
        } catch (e) {
          console.error('html2pdf failed', e);
          clone.remove();
        }
      }

      showToast('PDF-ის გენერაცია ვერ მოხერხდა — სცადეთ ბრაუზერის ბეჭდვა', 'error');
    };

    window.deleteTransactionEntry = async function(transactionId) {
      if (!isAdmin()) {
        showToast('ტრანზაქციების წაშლა მხოლოდ ადმინისტრატორისთვის არის ხელმისაწვდომი', 'error');
        return;
      }

      const tx = window.transactions.find((item) => item.id === transactionId);
      if (!tx) {
        showToast('ტრანზაქცია ვერ მოიძებნა', 'error');
        return;
      }

      const isProductSale = tx.type === 'product_sale';
      const confirmText = isProductSale
        ? `წაიშალოს გაყიდვა?\n\nპროდუქტი: ${tx.productName || '—'}\nრაოდენობა: ${tx.quantity || 0}\nთანხა: ${formatCurrency(tx.amount)}\n\nმარაგი ავტომატურად დაბრუნდება უკან.`
        : `წაიშალოს აბონემენტის ეს ფინანსური ჩანაწერი?\n\n${tx.memberName || tx.description || 'აბონემენტი'}\nთანხა: ${formatCurrency(tx.amount)}\n\nწაიშლება მხოლოდ ფინანსური ტრანზაქცია. წევრის მონაცემები უცვლელი დარჩება.`;

      if (!confirm(confirmText)) return;

      let rollbackProduct = null;
      let rollbackMemberSuppression = null;
      try {
        if (isProductSale && tx.productId) {
          const product = window.products.find((item) => item.id === tx.productId) ||
            (await fetchProductsViaRest()).find((item) => item.id === tx.productId);

          if (product) {
            rollbackProduct = {
              id: product.id,
              previousStock: Number(product.stock || 0)
            };
            const restoredStock = Number(product.stock || 0) + Number(tx.quantity || 0);
            const stockSaved = await saveProductRecord({
              id: product.id,
              stock: restoredStock,
              updatedAt: new Date().toISOString()
            }, { silent: true });

            if (!stockSaved.ok) {
              throw new Error('product stock rollback failed');
            }
          }
        } else if ((tx.type === 'membership_registration' || tx.type === 'membership_renewal') && tx.memberId) {
          const member = window.members.find((item) => item.id === tx.memberId);
          if (member && isSameCalendarDay(tx.createdAt, new Date())) {
            const currentSuppressions = Array.isArray(member.financeTransactionSuppressions)
              ? member.financeTransactionSuppressions
              : [];
            const suppressionKey = getMembershipFinanceSuppressionKey(tx.type, tx.createdAt);
            if (!currentSuppressions.includes(suppressionKey)) {
              const nextSuppressions = [...currentSuppressions, suppressionKey];
              const saved = await updateMemberFields(member.id, {
                financeTransactionSuppressions: nextSuppressions
              });
              if (!saved) {
                throw new Error('membership suppression save failed');
              }
              rollbackMemberSuppression = {
                memberId: member.id,
                previousSuppressions: currentSuppressions
              };
              window.members = window.members.map((item) =>
                item.id === member.id
                  ? { ...item, financeTransactionSuppressions: nextSuppressions }
                  : item
              );
            }
          }
        }

        await deleteDoc(doc(db, 'transactions', transactionId));
        window.transactions = window.transactions.filter((item) => item.id !== transactionId);
        updateAll();
        scheduleTransactionsRefresh();
        showToast(isProductSale ? 'გაყიდვა წაიშალა და მარაგი დაბრუნდა' : 'აბონემენტის ფინანსური ჩანაწერი წაიშალა');
      } catch (e) {
        console.error('transaction delete failed', e);

        if (rollbackProduct?.id) {
          try {
            await saveProductRecord({
              id: rollbackProduct.id,
              stock: rollbackProduct.previousStock,
              updatedAt: new Date().toISOString()
            }, { silent: true });
          } catch (rollbackError) {
            console.error('product rollback restore failed', rollbackError);
          }
        }

        if (rollbackMemberSuppression?.memberId) {
          try {
            await updateMemberFields(rollbackMemberSuppression.memberId, {
              financeTransactionSuppressions: rollbackMemberSuppression.previousSuppressions
            });
            window.members = window.members.map((item) =>
              item.id === rollbackMemberSuppression.memberId
                ? { ...item, financeTransactionSuppressions: rollbackMemberSuppression.previousSuppressions }
                : item
            );
          } catch (rollbackSuppressionError) {
            console.error('membership suppression rollback failed', rollbackSuppressionError);
          }
        }

        try {
          const restTransactions = await fetchTransactionsViaRest();
          const stillExists = restTransactions.some((item) => item.id === transactionId);
          if (!stillExists) {
            window.transactions = restTransactions;
            updateAll();
            showToast(isProductSale ? 'გაყიდვა წაიშალა' : 'ფინანსური ჩანაწერი წაიშალა');
            return;
          }
        } catch (recoveryError) {
          console.error('transaction delete recovery failed', recoveryError);
        }

        showToast('ტრანზაქციის წაშლა ვერ მოხერხდა', 'error');
      }
    };

    window.openProductForm = function(productId = '') {
      if (!isAdmin()) {
        showToast('პროდუქტის მართვა მხოლოდ ადმინისტრატორისთვის არის ხელმისაწვდომი', 'error');
        return;
      }
      const modal = document.getElementById('productFormModal');
      const product = productId ? window.products.find((item) => item.id === productId) : null;
      window.editingProductId = product?.id || null;
      document.getElementById('productFormTitle').textContent = product ? 'პროდუქტის რედაქტირება' : 'პროდუქტის დამატება';
      document.getElementById('productFormId').value = product?.id || '';
      document.getElementById('productCode').value = product?.code || '';
      document.getElementById('productName').value = product?.name || '';
      document.getElementById('productPrice').value = product?.price ?? '';
      document.getElementById('productStock').value = product?.stock ?? 0;
      document.getElementById('productImageUrl').value = product?.sourceUrl || product?.imageUrl || '';
      const saveBtn = document.getElementById('saveProductBtn');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save"></i> შენახვა';
      }
      modal.style.display = 'flex';
    };

    window.closeProductForm = function() {
      document.getElementById('productFormModal').style.display = 'none';
      document.getElementById('productFormId').value = '';
      document.getElementById('productCode').value = '';
      document.getElementById('productName').value = '';
      document.getElementById('productPrice').value = '';
      document.getElementById('productStock').value = '0';
      document.getElementById('productImageUrl').value = '';
      const saveBtn = document.getElementById('saveProductBtn');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save"></i> შენახვა';
      }
      window.editingProductId = null;
    };

    window.deleteProduct = async function(productId) {
      if (!isAdmin()) {
        showToast('პროდუქტის წაშლა მხოლოდ ადმინისტრატორისთვის არის ხელმისაწვდომი', 'error');
        return;
      }
      const product = window.products.find((item) => item.id === productId);
      if (!product) {
        showToast('პროდუქტი ვერ მოიძებნა', 'error');
        return;
      }
      const confirmed = confirm(`წაიშალოს პროდუქტი "${product.name}"?`);
      if (!confirmed) return;

      try {
        await deleteDoc(doc(db, "products", productId));
        window.products = window.products.filter((item) => item.id !== productId);
        updateAll();
        showToast('პროდუქტი წაიშალა');
      } catch (e) {
        console.error('product delete failed', e);
        showToast('პროდუქტის წაშლა ვერ მოხერხდა', 'error');
      }
    };

    window.saveProduct = async function() {
      if (!isAdmin()) {
        showToast('პროდუქტის დამატება მხოლოდ ადმინისტრატორისთვის არის ხელმისაწვდომი', 'error');
        return;
      }
      const saveBtn = document.getElementById('saveProductBtn');
      if (saveBtn?.disabled) return;

      const id = document.getElementById('productFormId').value.trim();
      const existingProduct = id ? window.products.find((item) => item.id === id) : null;
      const code = normalizeProductCode(document.getElementById('productCode').value);
      const name = document.getElementById('productName').value.trim();
      const price = Number(document.getElementById('productPrice').value || 0);
      const stock = Math.max(0, parseInt(document.getElementById('productStock').value || '0', 10));
      const rawImageUrl = document.getElementById('productImageUrl').value.trim() || null;

      if (!code || !name || price <= 0) {
        showToast('კოდი, სახელი და ფასი სავალდებულოა', 'error');
        return;
      }

      const duplicate = window.products.find((product) => normalizeProductCode(product.code) === code && product.id !== id);
      if (duplicate) {
        showToast('ასეთი კოდით პროდუქტი უკვე არსებობს', 'error');
        return;
      }

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<div class="spinner"></div>';
      }

      let imageUrl = null;
      const unchangedImageSource = existingProduct && rawImageUrl &&
        rawImageUrl === (existingProduct.sourceUrl || existingProduct.imageUrl);
      if (!rawImageUrl) {
        imageUrl = null;
      } else if (unchangedImageSource) {
        imageUrl = existingProduct.imageUrl || rawImageUrl;
      } else if (isDirectImageUrl(rawImageUrl)) {
        imageUrl = rawImageUrl;
      } else {
        imageUrl = buildPagePreviewUrl(rawImageUrl);
      }

      const nowIso = new Date().toISOString();
      const payload = {
        code,
        name,
        price,
        stock,
        imageUrl,
        sourceUrl: rawImageUrl,
        updatedAt: nowIso
      };
      if (!id) {
        payload.createdAt = nowIso;
      } else {
        payload.id = id;
      }

      const saved = await saveProductRecord(payload);
      if (!saved.ok) {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i class="fas fa-save"></i> შენახვა';
        }
        return;
      }

      if (rawImageUrl && !isDirectImageUrl(rawImageUrl) && !unchangedImageSource) {
        resolveProductImageInBackground(saved.id, rawImageUrl, imageUrl);
      }

      showToast(id ? 'პროდუქტი განახლდა' : 'პროდუქტი დაემატა');
      window.closeProductForm();
    };

    window.openProductSaleModal = function(productId) {
      const product = window.products.find((item) => item.id === productId);
      if (!product) {
        showToast('პროდუქტი ვერ მოიძებნა', 'error');
        return;
      }
      if (Number(product.stock || 0) <= 0) {
        showToast('პროდუქტი მარაგში აღარ არის', 'error');
        return;
      }
      document.getElementById('saleProductId').value = product.id;
      document.getElementById('saleProductName').textContent = product.name;
      document.getElementById('saleProductCode').textContent = `კოდი: ${product.code}`;
      document.getElementById('saleProductStock').textContent = `მარაგი: ${product.stock}`;
      document.getElementById('saleProductPrice').textContent = `ფასი: ${formatCurrency(product.price)}`;
      document.getElementById('saleQuantity').value = 1;
      document.getElementById('saleQuantity').max = Math.max(1, Number(product.stock || 0));
      document.getElementById('salePaymentMethod').value = 'TBC';
      document.getElementById('saleNote').value = '';
      const saleBtn = document.getElementById('recordProductSaleBtn');
      if (saleBtn) {
        saleBtn.disabled = false;
        saleBtn.innerHTML = '<i class="fas fa-cash-register"></i> გაყიდვის დაფიქსირება';
      }
      document.getElementById('productSaleModal').style.display = 'flex';
      window.updateProductSaleTotal();
    };

    window.addProductToCart = function(productId) {
      const product = window.products.find((item) => item.id === productId);
      if (!product) {
        showToast('პროდუქტი ვერ მოიძებნა', 'error');
        return;
      }
      const currentQuantity = getCartItemQuantity(productId);
      if (Number(product.stock || 0) <= currentQuantity) {
        showToast('ამ პროდუქტზე მეტი მარაგში აღარ არის', 'error');
        return;
      }
      if (currentQuantity > 0) {
        window.productSaleCart = window.productSaleCart.map((item) =>
          item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item
        );
      } else {
        window.productSaleCart = [...window.productSaleCart, { productId, quantity: 1 }];
      }
      const nextItem = window.productSaleCart.find((item) => item.productId === productId);
      window.activeProductCartItemId = productId;
      window.productCartQuantityBuffer = String(nextItem?.quantity || 1);
      renderProductCart();
      updateProductsTab();
    };

    window.changeProductCartQuantity = function(productId, delta) {
      const product = window.products.find((item) => item.id === productId);
      if (!product) return;
      window.productSaleCart = window.productSaleCart
        .map((item) => {
          if (item.productId !== productId) return item;
          const nextQuantity = item.quantity + delta;
          if (nextQuantity <= 0) return null;
          return {
            ...item,
            quantity: Math.min(nextQuantity, Number(product.stock || 0))
          };
        })
        .filter(Boolean);
      const nextItem = window.productSaleCart.find((item) => item.productId === productId);
      window.activeProductCartItemId = nextItem ? productId : (window.productSaleCart[0]?.productId || null);
      window.productCartQuantityBuffer = nextItem ? String(nextItem.quantity) : '';
      renderProductCart();
      updateProductsTab();
    };

    window.removeProductFromCart = function(productId) {
      window.productSaleCart = window.productSaleCart.filter((item) => item.productId !== productId);
      if (window.activeProductCartItemId === productId) {
        window.activeProductCartItemId = window.productSaleCart[0]?.productId || null;
        const nextItem = window.productSaleCart.find((item) => item.productId === window.activeProductCartItemId);
        window.productCartQuantityBuffer = nextItem ? String(nextItem.quantity) : '';
      }
      renderProductCart();
      updateProductsTab();
    };

    window.clearProductCart = function() {
      window.productSaleCart = [];
      window.activeProductCartItemId = null;
      window.productCartQuantityBuffer = '';
      const noteInput = document.getElementById('productCartNote');
      if (noteInput) noteInput.value = '';
      renderProductCart();
      updateProductsTab();
    };

    window.selectCartPaymentMethod = function(method) {
      window.productCartPaymentMethod = method;
      renderProductCart();
    };

    window.selectProductCartItem = function(productId) {
      const item = window.productSaleCart.find((entry) => entry.productId === productId);
      if (!item) return;
      window.activeProductCartItemId = productId;
      window.productCartQuantityBuffer = String(item.quantity || 1);
      renderProductCart();
    };

    window.productCartKeypadPress = function(digit) {
      if (!window.activeProductCartItemId) {
        const first = window.productSaleCart[0];
        if (!first) return;
        window.activeProductCartItemId = first.productId;
      }
      const nextBuffer = `${window.productCartQuantityBuffer || ''}${digit}`.replace(/^0+(?=\d)/, '');
      window.productCartQuantityBuffer = nextBuffer.slice(0, 3);
      window.productCartApplyKeypadQuantity();
    };

    window.productCartKeypadBackspace = function() {
      if (!window.activeProductCartItemId) return;
      window.productCartQuantityBuffer = String(window.productCartQuantityBuffer || '').slice(0, -1);
      window.productCartApplyKeypadQuantity(true);
    };

    window.productCartKeypadClear = function() {
      if (!window.activeProductCartItemId) return;
      window.productCartQuantityBuffer = '';
      renderProductCart();
    };

    window.productCartApplyKeypadQuantity = function(allowEmpty = false) {
      if (!window.activeProductCartItemId) return;
      const cartItem = window.productSaleCart.find((item) => item.productId === window.activeProductCartItemId);
      const product = window.products.find((item) => item.id === window.activeProductCartItemId);
      if (!cartItem || !product) return;
      const parsed = Number(window.productCartQuantityBuffer || 0);
      if (!parsed && allowEmpty) {
        renderProductCart();
        return;
      }
      const nextQuantity = Math.max(1, Math.min(parsed || cartItem.quantity || 1, Number(product.stock || 0)));
      window.productSaleCart = window.productSaleCart.map((item) =>
        item.productId === window.activeProductCartItemId ? { ...item, quantity: nextQuantity } : item
      );
      window.productCartQuantityBuffer = String(nextQuantity);
      renderProductCart();
      updateProductsTab();
    };

    window.changeActiveProductCartQuantity = function(delta) {
      if (!window.activeProductCartItemId) return;
      window.changeProductCartQuantity(window.activeProductCartItemId, delta);
    };

    window.closeProductSaleModal = function() {
      document.getElementById('productSaleModal').style.display = 'none';
      document.getElementById('saleProductId').value = '';
      document.getElementById('saleQuantity').value = '1';
      document.getElementById('salePaymentMethod').value = 'TBC';
      document.getElementById('saleNote').value = '';
      document.getElementById('saleTotalAmount').textContent = formatCurrency(0);
      const saleBtn = document.getElementById('recordProductSaleBtn');
      if (saleBtn) {
        saleBtn.disabled = false;
        saleBtn.innerHTML = '<i class="fas fa-cash-register"></i> გაყიდვის დაფიქსირება';
      }
    };

    window.openProductRestockModal = function(productId) {
      const product = window.products.find((item) => item.id === productId);
      if (!product) {
        showToast('პროდუქტი ვერ მოიძებნა', 'error');
        return;
      }
      document.getElementById('restockProductId').value = product.id;
      document.getElementById('restockProductName').textContent = product.name;
      document.getElementById('restockProductCode').textContent = `კოდი: ${product.code}`;
      document.getElementById('restockCurrentStock').textContent = `მიმდინარე მარაგი: ${Number(product.stock || 0)}`;
      document.getElementById('restockQuantity').value = '1';
      const restockBtn = document.getElementById('recordProductRestockBtn');
      if (restockBtn) {
        restockBtn.disabled = false;
        restockBtn.innerHTML = '<i class="fas fa-box-open"></i> მარაგის შევსება';
      }
      document.getElementById('productRestockModal').style.display = 'flex';
    };

    window.closeProductRestockModal = function() {
      document.getElementById('productRestockModal').style.display = 'none';
      document.getElementById('restockProductId').value = '';
      document.getElementById('restockQuantity').value = '1';
      const restockBtn = document.getElementById('recordProductRestockBtn');
      if (restockBtn) {
        restockBtn.disabled = false;
        restockBtn.innerHTML = '<i class="fas fa-box-open"></i> მარაგის შევსება';
      }
    };

    window.openInventoryRestockModal = function() {
      renderInventoryRestockList();
      document.getElementById('inventoryRestockSearch').value = '';
      document.getElementById('inventoryRestockModal').style.display = 'flex';
      setTimeout(() => {
        document.getElementById('inventoryRestockSearch')?.focus();
      }, 50);
    };

    window.closeInventoryRestockModal = function() {
      document.getElementById('inventoryRestockModal').style.display = 'none';
      document.getElementById('inventoryRestockSearch').value = '';
    };

    window.applyInventoryRestock = async function(productId) {
      const product = window.products.find((item) => item.id === productId);
      const qtyInput = document.getElementById(`inventoryRestockQty_${productId}`);
      const actionBtn = qtyInput?.closest('.inventory-restock-controls')?.querySelector('.inventory-restock-btn');
      const quantity = parseInt(qtyInput?.value || '0', 10);

      if (!product) {
        showToast('პროდუქტი ვერ მოიძებნა', 'error');
        return;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        showToast('შეიყვანე დასამატებელი რაოდენობა', 'error');
        qtyInput?.focus();
        return;
      }

      if (actionBtn) {
        actionBtn.disabled = true;
        actionBtn.innerHTML = '<div class="spinner"></div>';
      }

      const nowIso = new Date().toISOString();
      const nextStock = Number(product.stock || 0) + quantity;

      try {
        const saved = await saveProductRecord({
          id: product.id,
          stock: nextStock,
          updatedAt: nowIso
        }, { silent: true });
        if (!saved.ok) {
          throw new Error('inventory restock save failed');
        }
        if (qtyInput) qtyInput.value = '1';
        renderInventoryRestockList();
        updateProductsTab();
        showToast(`მარაგი განახლდა: ${product.name} (+${quantity})`);
      } catch (e) {
        console.error('inventory restock failed', e);
        showToast('მარაგის შევსება ვერ მოხერხდა', 'error');
      } finally {
        const refreshedBtn = document.getElementById(`inventoryRestockQty_${productId}`)?.closest('.inventory-restock-controls')?.querySelector('.inventory-restock-btn');
        if (refreshedBtn) {
          refreshedBtn.disabled = false;
          refreshedBtn.innerHTML = '<i class="fas fa-box-open"></i> შევსება';
        }
      }
    };

    window.recordProductRestock = async function() {
      const restockBtn = document.getElementById('recordProductRestockBtn');
      if (restockBtn?.disabled) return;
      const productId = document.getElementById('restockProductId').value;
      const product = window.products.find((item) => item.id === productId);
      const quantity = parseInt(document.getElementById('restockQuantity').value || '0', 10);

      if (!product) {
        showToast('პროდუქტი ვერ მოიძებნა', 'error');
        return;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        showToast('შეიყვანე დასამატებელი რაოდენობა', 'error');
        return;
      }

      if (restockBtn) {
        restockBtn.disabled = true;
        restockBtn.innerHTML = '<div class="spinner"></div>';
      }

      const nowIso = new Date().toISOString();
      const nextStock = Number(product.stock || 0) + quantity;

      try {
        const saved = await saveProductRecord({
          id: product.id,
          stock: nextStock,
          updatedAt: nowIso
        }, { silent: true });
        if (!saved.ok) {
          throw new Error('product restock save failed');
        }
        showToast(`მარაგი განახლდა: ${product.name} (+${quantity})`);
        window.closeProductRestockModal();
      } catch (e) {
        console.error('product restock failed', e);
        showToast('მარაგის შევსება ვერ მოხერხდა', 'error');
        if (restockBtn) {
          restockBtn.disabled = false;
          restockBtn.innerHTML = '<i class="fas fa-box-open"></i> მარაგის შევსება';
        }
      }
    };

    window.updateProductSaleTotal = function() {
      const productId = document.getElementById('saleProductId').value;
      const product = window.products.find((item) => item.id === productId);
      const quantity = Math.max(1, parseInt(document.getElementById('saleQuantity').value || '1', 10));
      const total = product ? Number(product.price || 0) * quantity : 0;
      document.getElementById('saleTotalAmount').textContent = formatCurrency(total);
    };

    async function commitProductSaleLine(product, quantity, paymentMethod, note, saleBatchId = null) {
      const nowIso = new Date().toISOString();
      const nextStock = Number(product.stock || 0) - quantity;
      const totalAmount = Number(product.price || 0) * quantity;
      const transactionPayload = {
        type: 'product_sale',
        category: 'product',
        amount: totalAmount,
        quantity,
        unitPrice: Number(product.price || 0),
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        description: `პროდუქტის გაყიდვა: ${product.name}`,
        paymentMethod,
        note,
        saleBatchId,
        createdAt: nowIso,
        createdByRole: currentUserRole || 'system'
      };

      const [stockResult, txResult] = await Promise.allSettled([
        saveProductRecord({
          id: product.id,
          stock: nextStock,
          updatedAt: nowIso
        }, { silent: true }),
        recordTransaction(transactionPayload, { silent: true })
      ]);
      const stockSave = stockResult.status === 'fulfilled' ? stockResult.value : { ok: false };
      const txSaved = txResult.status === 'fulfilled' ? txResult.value : false;

      if (!txSaved) {
        if (stockSave.ok) {
          await saveProductRecord({
            id: product.id,
            stock: product.stock,
            updatedAt: new Date().toISOString()
          }, { silent: true });
        }
        return { ok: false };
      }

      return { ok: true, stockSaved: stockSave.ok };
    }

    window.recordProductSale = async function() {
      const saleBtn = document.getElementById('recordProductSaleBtn');
      if (saleBtn?.disabled) return;
      const productId = document.getElementById('saleProductId').value;
      const product = window.products.find((item) => item.id === productId);
      const quantity = Math.max(1, parseInt(document.getElementById('saleQuantity').value || '1', 10));
      const paymentMethod = document.getElementById('salePaymentMethod').value;
      const note = document.getElementById('saleNote').value.trim() || null;

      if (!product) {
        showToast('პროდუქტი ვერ მოიძებნა', 'error');
        return;
      }
      if (Number(product.stock || 0) < quantity) {
        showToast('მარაგში საკმარისი რაოდენობა არ არის', 'error');
        return;
      }

      if (!paymentMethod) {
        showToast('აირჩიე გადახდის მეთოდი', 'error');
        return;
      }

      if (saleBtn) {
        saleBtn.disabled = true;
        saleBtn.innerHTML = '<div class="spinner"></div>';
      }

      try {
        const result = await commitProductSaleLine(product, quantity, paymentMethod, note);
        if (!result.ok) {
          throw new Error('transaction save failed');
        }
        if (!result.stockSaved) {
          showToast('გაყიდვა ჩაიწერა, მარაგი ვერ განახლდა', 'warning');
        }

        showToast(`გაყიდვა დაფიქსირდა: ${product.name}`);
        window.closeProductSaleModal();
      } catch (e) {
        console.error('product sale failed', e);
        showToast('გაყიდვის დაფიქსირება ვერ მოხერხდა', 'error');
        if (saleBtn) {
          saleBtn.disabled = false;
          saleBtn.innerHTML = '<i class="fas fa-cash-register"></i> გაყიდვის დაფიქსირება';
        }
      }
    };

    window.checkoutProductCart = async function() {
      const checkoutBtn = document.getElementById('checkoutProductCartBtn');
      if (checkoutBtn?.disabled) return;

      syncProductCart();
      const items = getDetailedCartItems();
      const paymentMethod = window.productCartPaymentMethod || 'TBC';
      const note = document.getElementById('productCartNote')?.value.trim() || null;

      if (items.length === 0) {
        showToast('კალათა ცარიელია', 'error');
        return;
      }

      checkoutBtn.disabled = true;
      window.isCartCheckoutRunning = true;
      checkoutBtn.innerHTML = '<div class="spinner"></div>';

      const saleBatchId = `sale-batch-${Date.now()}`;
      let successCount = 0;
      let stockWarnings = 0;
      const failedNames = [];

      try {
        for (const item of items) {
          if (item.availableStock < item.quantity) {
            failedNames.push(item.product.name);
            continue;
          }

          const result = await commitProductSaleLine(item.product, item.quantity, paymentMethod, note, saleBatchId);
          if (result.ok) {
            successCount += 1;
            if (!result.stockSaved) stockWarnings += 1;
          } else {
            failedNames.push(item.product.name);
          }
        }

        if (successCount === 0) {
          throw new Error('cart sale failed');
        }

        window.productSaleCart = [];
        if (document.getElementById('productCartNote')) {
          document.getElementById('productCartNote').value = '';
        }
        renderProductCart();
        updateProductsTab();

        const message = failedNames.length > 0
          ? `გაიყიდა ${successCount}/${items.length}. ვერ დამუშავდა: ${failedNames.join(', ')}`
          : `გაყიდვა დასრულდა: ${successCount} პოზიცია`;
        showToast(message, failedNames.length > 0 || stockWarnings > 0 ? 'warning' : 'success');
      } catch (e) {
        console.error('cart checkout failed', e);
        showToast('კალათის გაყიდვა ვერ მოხერხდა', 'error');
      } finally {
        window.isCartCheckoutRunning = false;
        renderProductCart();
      }
    };

    window.openDaySalesModal = function() {
      renderDaySalesModal();
      document.getElementById('daySalesModal').style.display = 'flex';
    };

    window.closeDaySalesModal = function() {
      document.getElementById('daySalesModal').style.display = 'none';
    };

    window.exportToExcel = function() {
      const membersData = window.members.map(m => ({
        "სახელი": m.firstName, 
        "გვარი": m.lastName, 
        "Email": m.email || '',
        "პირადი": m.personalId,
        "ტელეფონი": m.phone || '', 
        "აბონემენტი": getSubscriptionName(m.subscriptionType),
        "ფასი": m.subscriptionPrice + "₾", 
        "გააქტიურდა": formatDate(m.subscriptionStartDate),
        "დასრულება": formatDate(m.subscriptionEndDate),
        "სტატუსი": getStatusText(m.status), 
        "დარჩენილი": m.remainingVisits != null ? m.remainingVisits : "ულიმიტო",
        "შენიშვნა": m.note || "", 
        "ბოლო ვიზიტი": m.lastVisit ? formatDate(m.lastVisit) : "—"
      }));
      const wb = XLSX.utils.book_new();
      const membersSheet = XLSX.utils.json_to_sheet(membersData);
      XLSX.utils.book_append_sheet(wb, membersSheet, "წევრები");

      if (isAdmin()) {
        const summary = getFinancialSummary();
        const productsData = window.products.map((product) => ({
          "კოდი": product.code,
          "პროდუქტი": product.name,
          "ფასი": formatCurrency(product.price),
          "მარაგი": Number(product.stock || 0),
          "ფოტო": product.imageUrl || ''
        }));
        const transactionsData = getSortedTransactions().map((tx) => ({
          "თარიღი": formatDateTime(tx.createdAt),
          "კატეგორია": tx.category === 'membership' ? 'აბონემენტი' : 'პროდუქტი',
          "ტიპი": tx.type,
          "აღწერა": tx.description || '',
          "გადახდა": getPaymentMethodLabel(tx.paymentMethod),
          "ოპერატორი": tx.actorFullName || tx.actorUsername || '',
          "თანხა": formatCurrency(tx.amount),
          "რაოდენობა": tx.quantity || '',
          "პროდუქტი": tx.productName || '',
          "წევრი": tx.memberName || ''
        }));
        const financeData = [
          { "მეტრიკა": "დღევანდელი აბონემენტები", "მნიშვნელობა": formatCurrency(summary.todayMembership) },
          { "მეტრიკა": "დღევანდელი პროდუქტები", "მნიშვნელობა": formatCurrency(summary.todayProducts) },
          { "მეტრიკა": "დღევანდელი ჯამი", "მნიშვნელობა": formatCurrency(summary.todayTotal) },
          { "მეტრიკა": "ამ თვის აბონემენტები", "მნიშვნელობა": formatCurrency(summary.monthMembership) },
          { "მეტრიკა": "ამ თვის პროდუქტები", "მნიშვნელობა": formatCurrency(summary.monthProducts) },
          { "მეტრიკა": "ამ თვის ჯამი", "მნიშვნელობა": formatCurrency(summary.monthTotal) },
          { "მეტრიკა": "ამ თვის აბონემენტების რაოდენობა", "მნიშვნელობა": summary.monthMembershipCount },
          { "მეტრიკა": "ამ თვის პროდუქტის გაყიდვები", "მნიშვნელობა": summary.monthProductSalesCount },
          { "მეტრიკა": "ამ თვის გაყიდული ერთეულები", "მნიშვნელობა": summary.monthProductUnits }
        ];

        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productsData), "პროდუქტები");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(transactionsData), "ტრანზაქციები");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(financeData), "ფინანსები");
      }

      XLSX.writeFile(wb, `FitHouse_${new Date().toISOString().slice(0,10)}.xlsx`);
      showToast("Excel ჩამოიტვირთა!");
    };

    function updateAll() {
      safeUiUpdate('dashboard', updateDashboard);
      safeUiUpdate('expired', updateExpiredList);
      safeUiUpdate('search', updateSearchMemberList);
      safeUiUpdate('expiringSoon', showExpiringSoon);
      safeUiUpdate('todayVisits', showTodayVisits);
      safeUiUpdate('products', updateProductsTab);
      safeUiUpdate('finance', updateFinanceTab);
      safeUiUpdate('stats', updateStatsTab);
      safeUiUpdate('users', updateUsersTab);
      safeUiUpdate('settings', updateSettingsTab);
    }

    function updateDashboard() {
      const todayKey = new Date().toDateString();
      const totalMembers = window.members.length;
      const todayVisits = window.members.filter(m => m.lastVisit && new Date(m.lastVisit).toDateString() === todayKey).length;
      const active = window.members.filter(m => m.status === 'active').length;
      const expired = window.members.filter(m => m.status === 'expired').length;
      const paused = window.members.filter(m => m.status === 'paused').length;
      const soon = new Date(); 
      soon.setDate(soon.getDate() + 3);
      const today = startOfDay(new Date());
      const soonDate = startOfDay(soon);
      const expiring = window.members.filter(m => {
        if (m.status !== 'active') return false;
        const end = startOfDay(m.subscriptionEndDate);
        return end >= today && end <= soonDate;
      }).length;
      document.getElementById('totalMembers').textContent = totalMembers;
      document.getElementById('todayVisits').textContent = todayVisits;
      document.getElementById('activeMembers').textContent = active;
      document.getElementById('expiredMembers').textContent = expired;
      document.getElementById('expiringMembers').textContent = expiring;
      document.getElementById('pausedMembers').textContent = paused;
      if (isAdmin()) {
        renderDashboardRecentTransactions();
        renderRecentSignupsList('dashboardRecentSignups', 4);
        renderDashboardQuickBreakdown();
      }
    }

    function updateExpiredList() {
      const list = window.members.filter(m => m.status === 'expired');
      document.getElementById('expiredList').innerHTML = list.length === 0 ? '<p class="text-center py-10 text-gray-500">ვადაგასული წევრები არ არის</p>' : list.map(m => {
        const noteBanner = m.note ? `<div class="note-banner text-sm"><i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${m.note}</div>` : '';
        return `<div class="member-card">${noteBanner}
          <div class="info-grid text-sm">
            <div><strong>სახელი:</strong> ${m.firstName} ${m.lastName}</div>
            <div><strong>პირადი:</strong> ${m.personalId}</div>
            <div><strong>Email:</strong> ${m.email || '—'}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(m.subscriptionType)}</div>
            <div><strong>ვადა გავიდა:</strong> <span class="text-red-400 font-bold">${formatDate(m.subscriptionEndDate)}</span></div>
          </div>
          <div class="mt-4 flex gap-3 justify-center text-sm">
            <button class="btn btn-warning px-5 py-2" onclick="window.renewMembership('${m.id}')">განახლება</button>
            <button class="btn bg-blue-600 hover:bg-blue-700 px-5 py-2" onclick="window.showEditForm(event, '${m.id}')">რედაქტირება</button>
            ${m.email ? `<button class="btn bg-cyan-600 hover:bg-cyan-700 px-5 py-2" onclick="window.sendMemberQrEmail('${m.id}')"><i class="fas fa-paper-plane"></i> პირ. კაბინეტის ლინკი</button>` : ''}
            ${m.email ? `<button class="btn bg-purple-600 hover:bg-purple-700 px-5 py-2" onclick="window.openIndividualMessageModal('${m.id}')"><i class="fas fa-envelope"></i> Email</button>` : ''}
            <button class="btn bg-teal-600 hover:bg-teal-700 px-5 py-2" onclick="window.resetMemberPassword('${m.id}', '${m.firstName} ${m.lastName}')"><i class="fas fa-key"></i> პაროლი</button>
            <button class="btn bg-red-600 hover:bg-red-700 px-5 py-2" onclick="window.deleteMember('${m.id}')">წაშლა</button>
          </div></div>`;
      }).join('');
    }

    function updateSearchMemberList() {
      const container = document.getElementById('searchResults');
      const val = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
      let filtered = window.members;
      if (val) filtered = window.members.filter(m => 
        m.personalId.includes(val) || 
        (m.firstName + ' ' + m.lastName).toLowerCase().includes(val) ||
        (m.email || '').toLowerCase().includes(val)
      );
      if (filtered.length === 0) {
        container.innerHTML = `<p class="text-center py-16 text-gray-500 text-xl">${val ? 'ვერ მოიძებნა' : 'ჯერ არ არის წევრები'}</p>`;
        return;
      }
      container.innerHTML = filtered.map(m => {
        const effectiveStatus = getEffectiveStatus(m);
        return `
        <div class="search-member-card" data-member-id="${m.id}" onclick="toggleMemberDetails('${m.id}')">
          <div class="search-card-content">
            <div class="search-card-info">
              <div class="search-name">${m.firstName} ${m.lastName}</div>
              <div class="search-id">პირადი: ${m.personalId}</div>
              <div class="search-id">Email: ${m.email || '—'}</div>
              <div class="search-sub">${getSubscriptionName(m.subscriptionType)}</div>
              <div class="search-id">სტატუსი: <span class="status-badge ${getStatusClass(effectiveStatus)}">${getStatusText(effectiveStatus)}</span></div>
              <div class="search-id">გააქტიურდა: ${formatDate(m.subscriptionStartDate)}</div>
              <div class="search-end">ვადა: ${formatDate(m.subscriptionEndDate)}</div>
              ${m.createdByFullName ? `<div class="search-id" style="color:#64748b;font-size:0.78rem;margin-top:2px;"><i class="fas fa-user-pen" style="font-size:0.72rem;opacity:0.7;"></i> ${m.createdByFullName}</div>` : ''}
              ${m.trainerServiceEnabled && m.trainerId ? `<div class="trainer-service-badge" style="margin-top:6px;"><i class="fas fa-dumbbell"></i> ${getTrainerName(m.trainerId) || 'ტრენერი'}</div>` : ''}
            </div>
            <div class="search-arrow">${document.getElementById(`details-${m.id}`) ? '−' : '+'}</div>
          </div>
        </div>
      `;
      }).join('');

      if (expandedSearchMemberId) {
        const expandedMember = filtered.find(m => m.id === expandedSearchMemberId);
        const card = document.querySelector(`[data-member-id="${expandedSearchMemberId}"]`);
        if (expandedMember && card && !document.getElementById(`details-${expandedSearchMemberId}`)) {
          card.insertAdjacentHTML('afterend', buildMemberDetailsHTML(expandedMember));
        }
      }
    }

    function showExpiringSoon() {
      const soon = new Date(); 
      soon.setDate(soon.getDate() + 3);
      const today = startOfDay(new Date());
      const soonDate = startOfDay(soon);
      const list = window.members.filter(m => {
        if (m.status !== 'active') return false;
        const end = startOfDay(m.subscriptionEndDate);
        return end >= today && end <= soonDate;
      }).sort((a,b) => new Date(a.subscriptionEndDate) - new Date(b.subscriptionEndDate));
      const container = document.getElementById('expiringSoonList');
      if (list.length === 0) { 
        container.innerHTML = '<p class="text-center py-10 text-gray-500">3 დღეში ვადაგასული წევრი ვერ მოიძებნა</p>'; 
        return; 
      }
      container.innerHTML = list.map(m => {
        const days = Math.ceil((startOfDay(m.subscriptionEndDate) - startOfDay(new Date())) / 86400000);
        const note = m.note ? `<div class="note-banner text-sm"><i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${m.note}</div>` : '';
        return `<div class="member-card text-sm">${note}
          <div class="grid grid-cols-2 gap-3">
            <div><strong>სახელი:</strong> ${m.firstName} ${m.lastName}</div>
            <div><strong>პირადი:</strong> ${m.personalId}</div>
            <div><strong>Email:</strong> ${m.email || '—'}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(m.subscriptionType)}</div>
            <div><strong>ვადა:</strong> <span class="text-orange-400 font-bold">${formatDate(m.subscriptionEndDate)} (${days} დღე)</span></div>
          </div>
          <div class="mt-4 flex gap-3 justify-center">
            <button class="btn btn-warning text-sm px-5 py-2" onclick="window.renewMembership('${m.id}')">განახლება</button>
            <button class="btn bg-blue-600 hover:bg-blue-700 text-sm px-5 py-2" onclick="window.showEditForm(event, '${m.id}')">რედაქტირება</button>
            ${m.email ? `<button class="btn bg-cyan-600 hover:bg-cyan-700 text-sm px-5 py-2" onclick="window.sendMemberQrEmail('${m.id}')"><i class="fas fa-paper-plane"></i> კაბინეტი გაგზავნა</button>` : ''}
            ${m.email ? `<button class="btn bg-purple-600 hover:bg-purple-700 text-sm px-5 py-2" onclick="window.openIndividualMessageModal('${m.id}')"><i class="fas fa-envelope"></i> Email</button>` : ''}
          </div></div>`;
      }).join('');
    }

    function showTodayVisits() {
      const container = document.getElementById('todayVisitsList');
      if (!container) return;

      const now = new Date();
      const list = window.members
        .filter((m) => m.lastVisit && isSameCalendarDay(m.lastVisit, now))
        .sort((a, b) => new Date(b.lastVisit) - new Date(a.lastVisit));

      if (list.length === 0) {
        container.innerHTML = '<p class="text-center py-10 text-gray-500">დღეს ჯერ არცერთი ვიზიტი არ დაფიქსირებულა</p>';
        return;
      }

      container.innerHTML = list.map((m) => {
        const note = m.note ? `<div class="note-banner text-sm"><i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${m.note}</div>` : '';
        const effectiveStatus = getEffectiveStatus(m);
        return `<div class="member-card text-sm">${note}
          <div class="grid grid-cols-2 gap-3">
            <div><strong>სახელი:</strong> ${m.firstName} ${m.lastName}</div>
            <div><strong>პირადი:</strong> ${m.personalId}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(m.subscriptionType)}</div>
            <div><strong>სტატუსი:</strong> <span class="status-badge ${getStatusClass(effectiveStatus)}">${getStatusText(effectiveStatus)}</span></div>
            <div><strong>შემოსვლის დრო:</strong> <span class="text-green-400 font-bold">${formatDateTime(m.lastVisit)}</span></div>
            <div><strong>ვადა:</strong> ${formatDate(m.subscriptionEndDate)}</div>
          </div>
          <div class="mt-4 flex gap-3 justify-center">
            <button class="btn bg-blue-600 hover:bg-blue-700 text-sm px-5 py-2" onclick="window.showEditForm(event, '${m.id}')">რედაქტირება</button>
            <button class="btn bg-indigo-600 hover:bg-indigo-700 text-sm px-5 py-2" onclick="window.showMemberQr('${m.id}')"><i class="fas fa-qrcode"></i> QR</button>
          </div>
        </div>`;
      }).join('');
    }

    function getSubscriptionName(t) {
      if (window.subscriptionPlans?.length) {
        const plan = window.subscriptionPlans.find(p => p.type === t);
        if (plan) return plan.name;
      }
      const map = {
        '12visits':'12 ვარჯიში',
        'single_visit':'ერთჯერადი ვიზიტი',
        'morning':'დილის ულიმიტო',
        'unlimited':'ულიმიტო',
        'other':'სხვა'
      };
      return map[t] || t;
    }
    
    // ── Subscription Plans ────────────────────────────────────────────────────

    function buildSubscriptionOptions(selectedType) {
      const plans = window.subscriptionPlans || [];
      let opts = plans.map(p => `<option value="${p.type}" ${p.type === selectedType ? 'selected' : ''}>${p.name} (${p.price}₾)</option>`).join('');
      opts += `<option value="other" ${selectedType === 'other' ? 'selected' : ''}>სხვა (მომხმარებლის ველი)</option>`;
      return opts;
    }

    function populateSubscriptionSelects(selectedType) {
      const opts = buildSubscriptionOptions(selectedType || '');
      const regSelect = document.getElementById('subscriptionType');
      if (regSelect) regSelect.innerHTML = opts;
      const renewSelect = document.getElementById('membershipPaymentSubscriptionType');
      if (renewSelect) renewSelect.innerHTML = opts;
    }

    async function loadSubscriptionPlansFromRest() {
      try {
        if (isRestRateLimited('subscription_plans')) {
          if (!window.subscriptionPlans.length) {
            window.subscriptionPlans = DEFAULT_SUBSCRIPTION_PLANS.map((item) => ({ ...item }));
          }
          populateSubscriptionSelects('');
          return;
        }
        const pid = 'fit-house-gym-d3595';
        const res = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/subscription_plans?pageSize=50`);
        if (!res.ok) {
          if (res.status === 429) {
            markRestRateLimited('subscription_plans');
            if (!window.subscriptionPlans.length) {
              window.subscriptionPlans = DEFAULT_SUBSCRIPTION_PLANS.map((item) => ({ ...item }));
            }
            populateSubscriptionSelects('');
            return;
          }
          throw new Error(`subscription_plans fetch failed with status ${res.status}`);
        }
        const json = await res.json();
        const docs = json.documents || [];
        window.subscriptionPlans = docs.map(d => {
          const f = d.fields || {};
          const id = d.name.split('/').pop();
          return {
            id,
            name: f.name?.stringValue || '',
            type: f.type?.stringValue || id,
            price: Number(f.price?.integerValue || f.price?.doubleValue || 0),
            durationDays: Number(f.durationDays?.integerValue || 30),
            remainingVisits: f.remainingVisits?.nullValue !== undefined ? null : Number(f.remainingVisits?.integerValue || 0),
            active: f.active?.booleanValue !== false,
            order: Number(f.order?.integerValue || 99)
          };
        }).filter(p => p.active).sort((a, b) => a.order - b.order);

        if (window.subscriptionPlans.length === 0) {
          if (!subscriptionPlansSeedAttempted) {
            subscriptionPlansSeedAttempted = true;
            await seedDefaultPlans();
          } else {
            window.subscriptionPlans = DEFAULT_SUBSCRIPTION_PLANS.map((item) => ({ ...item }));
          }
        }
        populateSubscriptionSelects('');
      } catch(e) {
        console.error('loadSubscriptionPlansFromRest error', e);
        if (!window.subscriptionPlans.length) {
          window.subscriptionPlans = DEFAULT_SUBSCRIPTION_PLANS.map((item) => ({ ...item }));
          populateSubscriptionSelects('');
        }
      }
    }

    async function seedDefaultPlans() {
      const defaults = DEFAULT_SUBSCRIPTION_PLANS;
      const pid = 'fit-house-gym-d3595';
      for (const p of defaults) {
        const body = { fields: {
          name: {stringValue: p.name},
          type: {stringValue: p.type},
          price: {integerValue: String(p.price)},
          durationDays: {integerValue: String(p.durationDays)},
          remainingVisits: p.remainingVisits === null ? {nullValue: null} : {integerValue: String(p.remainingVisits)},
          active: {booleanValue: true},
          order: {integerValue: String(p.order)}
        }};
        try {
          const response = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/subscription_plans`, {
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
          });
          if (response.status === 429) {
            markRestRateLimited('subscription_plans');
            break;
          }
        } catch(_) {
          break;
        }
      }
      if (!window.subscriptionPlans.length) {
        window.subscriptionPlans = DEFAULT_SUBSCRIPTION_PLANS.map((item) => ({ ...item }));
      }
      populateSubscriptionSelects('');
    }

    function renderSubscriptionPlansTable() {
      const el = document.getElementById('subscriptionPlansTable');
      if (!el) return;
      if (!window.subscriptionPlans?.length) {
        el.innerHTML = '<div style="color:#64748b;padding:16px;">პლანები ვერ მოიძებნა</div>';
        return;
      }
      el.innerHTML = `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
            <thead>
              <tr style="background:var(--surface,#1e293b);">
                <th style="padding:10px 14px;text-align:left;color:var(--text-light,#64748b);font-size:0.7rem;text-transform:uppercase;">სახელი</th>
                <th style="padding:10px 14px;text-align:left;color:var(--text-light,#64748b);font-size:0.7rem;text-transform:uppercase;">ტიპი</th>
                <th style="padding:10px 14px;text-align:left;color:var(--text-light,#64748b);font-size:0.7rem;text-transform:uppercase;">ფასი</th>
                <th style="padding:10px 14px;text-align:left;color:var(--text-light,#64748b);font-size:0.7rem;text-transform:uppercase;">ვადა</th>
                <th style="padding:10px 14px;text-align:left;color:var(--text-light,#64748b);font-size:0.7rem;text-transform:uppercase;">ვიზიტები</th>
                <th style="padding:10px 14px;text-align:left;color:var(--text-light,#64748b);font-size:0.7rem;text-transform:uppercase;">თანმ.</th>
                <th style="padding:10px 14px;"></th>
              </tr>
            </thead>
            <tbody>
              ${window.subscriptionPlans.map(p => `
                <tr style="border-top:1px solid var(--border,#334155);">
                  <td style="padding:10px 14px;color:var(--text,#f1f5f9);font-weight:700;">${p.name}</td>
                  <td style="padding:10px 14px;color:var(--text-light,#94a3b8);">${p.type}</td>
                  <td style="padding:10px 14px;color:#10b981;font-weight:700;">${p.price}₾</td>
                  <td style="padding:10px 14px;color:var(--text-light,#94a3b8);">${p.durationDays} დღე</td>
                  <td style="padding:10px 14px;color:var(--text-light,#94a3b8);">${p.remainingVisits === null ? 'ულიმიტო' : p.remainingVisits}</td>
                  <td style="padding:10px 14px;color:var(--text-light,#94a3b8);">${p.order}</td>
                  <td style="padding:10px 14px;text-align:right;display:flex;gap:6px;justify-content:flex-end;">
                    <button class="btn bg-blue-600 hover:bg-blue-700 compact-btn" onclick="window.openPlanForm('${p.id}')"><i class="fas fa-pen"></i></button>
                    <button class="btn bg-red-600 hover:bg-red-700 compact-btn" onclick="window.deletePlan('${p.id}')"><i class="fas fa-trash"></i></button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;
    }

    window.openPlanForm = function(planId) {
      if (!isAdmin()) return;
      const plan = planId ? window.subscriptionPlans?.find(p => p.id === planId) : null;
      document.getElementById('planFormTitle').textContent = plan ? 'პლანის რედაქტირება' : 'პლანის დამატება';
      document.getElementById('planFormId').value = plan?.id || '';
      document.getElementById('planName').value = plan?.name || '';
      document.getElementById('planType').value = plan?.type || '';
      document.getElementById('planPrice').value = plan?.price ?? '';
      document.getElementById('planDurationDays').value = plan?.durationDays ?? 30;
      document.getElementById('planRemainingVisits').value = plan?.remainingVisits ?? '';
      document.getElementById('planOrder').value = plan?.order ?? 1;
      document.getElementById('planFormModal').style.display = 'flex';
    };

    window.closePlanForm = function() {
      document.getElementById('planFormModal').style.display = 'none';
    };

    window.savePlan = async function() {
      if (!isAdmin()) return;
      const id = document.getElementById('planFormId').value;
      const name = document.getElementById('planName').value.trim();
      const type = document.getElementById('planType').value.trim();
      const price = Number(document.getElementById('planPrice').value);
      const durationDays = Number(document.getElementById('planDurationDays').value);
      const rvVal = document.getElementById('planRemainingVisits').value;
      const remainingVisits = rvVal === '' ? null : Number(rvVal);
      const order = Number(document.getElementById('planOrder').value) || 1;

      if (!name || !type || !price || !durationDays) {
        showToast('შეავსე სახელი, ტიპი, ფასი და ვადა', 'error');
        return;
      }

      const pid = 'fit-house-gym-d3595';
      const fields = {
        name: {stringValue: name},
        type: {stringValue: type},
        price: {integerValue: String(price)},
        durationDays: {integerValue: String(durationDays)},
        remainingVisits: remainingVisits === null ? {nullValue: null} : {integerValue: String(remainingVisits)},
        active: {booleanValue: true},
        order: {integerValue: String(order)}
      };

      try {
        if (id) {
          const updateMask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
          await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/subscription_plans/${id}?${updateMask}`, {
            method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({fields})
          });
        } else {
          await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/subscription_plans`, {
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({fields})
          });
        }
        window.closePlanForm();
        await loadSubscriptionPlansFromRest();
        renderSubscriptionPlansTable();
        populateSubscriptionSelects('');
        showToast(id ? 'პლანი განახლდა' : 'პლანი დაემატა');
      } catch(e) {
        console.error(e);
        showToast('შენახვა ვერ მოხერხდა', 'error');
      }
    };

    window.deletePlan = async function(planId) {
      if (!isAdmin()) return;
      const plan = window.subscriptionPlans?.find(p => p.id === planId);
      if (!confirm(`წავშალოთ პლანი "${plan?.name}"?`)) return;
      const pid = 'fit-house-gym-d3595';
      try {
        await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/subscription_plans/${planId}`, {
          method: 'DELETE'
        });
        await loadSubscriptionPlansFromRest();
        renderSubscriptionPlansTable();
        populateSubscriptionSelects('');
        showToast('პლანი წაიშალა');
      } catch(e) {
        showToast('წაშლა ვერ მოხერხდა', 'error');
      }
    };

    window.loadAndRenderPlans = async function() {
      await loadSubscriptionPlansFromRest();
      renderSubscriptionPlansTable();
    };

    function getStatusClass(s) {
      return {
        active:'status-active',
        expired:'status-expired',
        paused:'status-paused'
      }[s] || 'status-expired'; 
    }
    
    function getStatusText(s) { 
      return {
        active:'აქტიური',
        expired:'ვადაგასული',
        paused:'შეჩერებული'
      }[s] || s; 
    }

    function showPasswordSuccessOverlay() {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
      overlay.innerHTML = `
        <div style="background:#0f172a;border:1px solid rgba(16,185,129,0.4);border-radius:20px;padding:32px 40px;text-align:center;max-width:360px;animation:scaleIn 0.25s ease;">
          <div style="width:64px;height:64px;background:rgba(16,185,129,0.15);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;border:2px solid #10b981;">
            <i class="fas fa-check" style="color:#10b981;font-size:1.5rem;"></i>
          </div>
          <div style="font-size:1.2rem;font-weight:900;color:#f1f5f9;margin-bottom:8px;">პაროლი განახლდა!</div>
          <div style="color:#94a3b8;font-size:0.88rem;margin-bottom:20px;">პაროლი წარმატებით შეიცვალა.</div>
          <button onclick="this.closest('[style*=fixed]').remove()" style="padding:10px 28px;background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:10px;font-weight:800;cursor:pointer;">OK</button>
        </div>`;
      if (!document.getElementById('pw-anim-style')) {
        const s = document.createElement('style');
        s.id = 'pw-anim-style';
        s.textContent = '@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes scaleIn{from{opacity:0;transform:scale(0.85)}to{opacity:1;transform:scale(1)}}';
        document.head.appendChild(s);
      }
      document.body.appendChild(overlay);
      setTimeout(() => overlay.remove(), 2500);
    }

    function showToast(msg, type='success') {
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      t.innerHTML = msg;
      document.body.appendChild(t);
      setTimeout(() => t.classList.add('show'), 100);
      setTimeout(() => { 
        t.classList.remove('show'); 
        setTimeout(() => t.remove(), 300); 
      }, 3500);
    }

    window.toggleTheme = function() {
      const isLight = document.body.classList.toggle('light-mode');
      localStorage.setItem('gym-theme', isLight ? 'light' : 'dark');
      document.querySelector('.theme-toggle i').className = isLight ? 'fas fa-moon' : 'fas fa-sun';
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    window.removeTrainerFromMember = async function(memberId) {
      const m = window.members.find(x => x.id === memberId);
      if (!m) return;
      if (!confirm(`${m.firstName} ${m.lastName}-ს ამოვხსნათ ტრენერი?`)) return;
      const saved = await updateMemberFields(memberId, { trainerId: null, trainerServiceEnabled: false });
      if (saved !== false) { showToast('ტრენერი ამოხსნილია'); updateAll(); }
    };

    document.addEventListener('DOMContentLoaded', () => {
      loadSubscriptionPlansFromRest().then(() => populateSubscriptionSelects(''));
      checkPublicCheckinParam();
      checkAuth();
      applyRoleVisibility();
      document.getElementById('loginUsername')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          window.login();
        }
      });
      document.getElementById('adminPassword')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          window.login();
        }
      });
      if (localStorage.getItem('gym-theme') === 'light') {
        document.body.classList.add('light-mode');
        document.querySelector('.theme-toggle i').className = 'fas fa-moon';
      }
      document.querySelectorAll('.subscription-card').forEach(c => c.addEventListener('click', function() {
        document.querySelectorAll('.subscription-card').forEach(x => x.classList.remove('selected'));
        this.classList.add('selected');
        window.selectedSubscription = {
          type: this.dataset.type, 
          price: +this.dataset.price
        };
        document.getElementById('customSubscriptionFields').style.display = this.dataset.type === 'other' ? 'block' : 'none';
      }));
      
      document.getElementById('registrationForm').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = document.getElementById('registerBtn');
        if (btn.disabled) return;
        const email = document.getElementById('email').value.trim();
        if (!window.selectedSubscription) { 
          showToast("აირჩიეთ აბონემენტი", 'error'); 
          return; 
        }
        if (!email) {
          showToast("Email სავალდებულოა", 'error');
          return;
        }
        btn.disabled = true; 
        btn.innerHTML = '<div class="spinner"></div>';
        try {
          const start = new Date(); 
          let end = setToEndOfDay(addMonthsPreserveDay(start, 1)); 
          let visits = null; 
          let price = window.selectedSubscription.price; 
          let type = window.selectedSubscription.type;
          
          if (type === '12visits') { 
            visits = 12; 
          }
          else if (type === 'single_visit') {
            end = setToEndOfDay(start);
            visits = 1;
          }
          else if (type === 'other') {
            const cp = +document.getElementById('customPrice').value;
            const cd = +document.getElementById('customDuration').value;
            const cv = document.getElementById('customVisits').value ? +document.getElementById('customVisits').value : null;
            const desc = document.getElementById('customDescription').value.trim() || 'სხვა';
            if (!cp || !cd) { 
              showToast("ფასი და ვადა სავალდებულოა", 'error'); 
              btn.disabled = false;
              btn.innerHTML = 'რეგისტრაცია';
              return; 
            }
            price = cp; 
            end.setDate(start.getDate() + cd);
            end = setToEndOfDay(end);
            visits = cv; 
            type = desc;
          }
          
          const draftMember = {
            firstName: document.getElementById('firstName').value.trim(),
            lastName: document.getElementById('lastName').value.trim(),
            email,
            phone: document.getElementById('phone').value.trim(),
            birthDate: document.getElementById('birthDate').value,
            personalId: document.getElementById('personalId').value.trim(),
            note: document.getElementById('note').value.trim() || null,
            subscriptionType: type,
            subscriptionPrice: price,
            baseSubscriptionPrice: price,
            subscriptionStartDate: start.toISOString(),
            subscriptionEndDate: end.toISOString(),
            remainingVisits: visits,
            trainerSessionIncluded: document.getElementById('regTrainerSessionIncluded')?.checked || false,
            trainerSessionGifted: document.getElementById('regTrainerSessionIncluded')?.checked ? Boolean(document.getElementById('regTrainerSessionGift')?.checked) : false,
            trainerSessionPrice: document.getElementById('regTrainerSessionIncluded')?.checked ? Math.max(0, Number(document.getElementById('regTrainerSessionPrice')?.value || 0)) : 0,
            totalVisits: 0,
            status: 'active',
            lastVisit: null,
            trainerServiceEnabled: document.getElementById('regTrainerService')?.checked || false,
            trainerId: (document.getElementById('regTrainerService')?.checked && document.getElementById('regTrainerId')?.value) || null,
            createdAt: new Date().toISOString(),
            expiringEmailSent: false
          };

          window.openMembershipPaymentModal({
            mode: 'register',
            member: draftMember,
            memberName: `${draftMember.firstName} ${draftMember.lastName}`,
            meta: `${getSubscriptionName(draftMember.subscriptionType)} • ვადა ${formatDate(draftMember.subscriptionEndDate)}`,
            amount: Number(draftMember.subscriptionPrice || 0)
          });
        } finally {
          btn.disabled = false; 
          btn.innerHTML = 'რეგისტრაცია';
        }
      });
      
      document.getElementById('searchInput')?.addEventListener('input', updateSearchMemberList);
      document.getElementById('productSearchInput')?.addEventListener('input', updateProductsTab);
      document.getElementById('userSearchInput')?.addEventListener('input', updateUsersTab);
      document.getElementById('trainerSearchInput')?.addEventListener('input', updateTrainersTab);
      document.getElementById('saleQuantity')?.addEventListener('input', window.updateProductSaleTotal);
      document.getElementById('passwordChangeForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await window.changeCurrentUserPassword();
      });
      document.getElementById('productFormModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'productFormModal') window.closeProductForm();
      });
      document.getElementById('productSaleModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'productSaleModal') window.closeProductSaleModal();
      });
      document.getElementById('productRestockModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'productRestockModal') window.closeProductRestockModal();
      });
      document.getElementById('inventoryRestockModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'inventoryRestockModal') window.closeInventoryRestockModal();
      });
      document.getElementById('inventoryRestockSearch')?.addEventListener('input', renderInventoryRestockList);
      document.getElementById('daySalesModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'daySalesModal') window.closeDaySalesModal();
      });
      document.getElementById('membershipPaymentModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'membershipPaymentModal') window.closeMembershipPaymentModal();
      });
      document.getElementById('userFormModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'userFormModal') window.closeUserForm();
      });
      document.getElementById('resetUserPasswordModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'resetUserPasswordModal') window.closeResetUserPasswordModal();
      });
      document.getElementById('checkinSearch')?.addEventListener('input', e => {
        const v = e.target.value.trim();
        if (v.length >= 2) {
          const matches = window.members.filter(m => 
            m.personalId.includes(v) || 
            (m.firstName + ' ' + m.lastName).toLowerCase().includes(v.toLowerCase())
          );
          const el = document.getElementById('checkinResult');
          if (matches.length === 0) el.innerHTML = '<div class="member-card text-red-500 text-center py-10">ვერ მოიძებნა</div>';
          else if (matches.length === 1) checkMemberAccess(matches[0]);
          else el.innerHTML = `
            <div class="member-card">
              <h3 class="font-bold mb-6 text-center">აირჩიეთ წევრი</h3>
              <div class="checkin-pick-list">
                ${matches.map(m => {
                  const effectiveStatus = getEffectiveStatus(m);
                  return `
                    <button type="button" class="checkin-pick-card" onclick="checkMemberAccess(window.members.find(x=>x.id==='${m.id}'))">
                      <div class="checkin-pick-name">${m.firstName} ${m.lastName}</div>
                      <div class="checkin-pick-meta">პირადი: ${m.personalId}</div>
                      <div class="checkin-pick-meta">აბონემენტი: ${getSubscriptionName(m.subscriptionType)}</div>
                      <div class="checkin-pick-meta">ვადა: ${formatDate(m.subscriptionEndDate)}</div>
                      <div class="checkin-pick-meta">სტატუსი: <span class="status-badge ${getStatusClass(effectiveStatus)}">${getStatusText(effectiveStatus)}</span></div>
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        } else document.getElementById('checkinResult').innerHTML = '';
      });
    });
