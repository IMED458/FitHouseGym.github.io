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
    let transactionsRefreshTimer = null;
    let transactionsPollingStarted = false;
    let usersStreamStarted = false;
    let dataStreamsStarted = false;
    window.members = [];
    window.users = [];
    window.products = [];
    window.transactions = [];
    window.selectedSubscription = null;
    window.editingProductId = null;
    window.productSaleCart = [];
    window.productCartPaymentMethod = 'TBC';
    window.isCartCheckoutRunning = false;
    window.pendingMembershipPaymentContext = null;

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
        TRANSFER: 'გადარიცხვა'
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
