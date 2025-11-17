<!doctype html>
<html lang="ka">
 <head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fit House Gym Management System</title>
  
  <!-- Firebase v9+ Modular SDK -->
  <script type="module">
    import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
    import { getFirestore, collection, addDoc, setDoc, doc, onSnapshot, query } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

    // Firebase Config (თქვენი!)
    const firebaseConfig = {
      apiKey: "AIzaSyA1HOc9IvnfougHBMHRnQwktfOrS72Ttt8",
      authDomain: "fit-house-gym-d3595.firebaseapp.com",
      projectId: "fit-house-gym-d3595",
      storageBucket: "fit-house-gym-d3595.firebasestorage.app",
      messagingSenderId: "548276737406",
      appId: "1:548276737406:web:12286429916b8c751fcf2f",
      measurementId: "G-F4Y4CLVNFH"
    };

    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    // Global variables
    let members = [];
    let selectedSubscription = null;
    let currentRecordCount = 0;

    // =============== FIRESTORE OPERATIONS ===============
    async function loadMembers() {
        const q = query(collection(db, "members"));
        onSnapshot(q, (snapshot) => {
            members = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            currentRecordCount = members.length;
            updateAll();
        });
    }

    async function createMember(member) {
        try {
            const docRef = await addDoc(collection(db, "members"), member);
            showToast("წევრი დარეგისტრირდა!");
            return { isOk: true };
        } catch (e) {
            showToast("შეცდომა: " + e.message, 'error');
            return { isOk: false };
        }
    }

    async function updateMember(updatedMember) {
        try {
            await setDoc(doc(db, "members", updatedMember.id), updatedMember);
            return { isOk: true };
        } catch (e) {
            showToast("განახლება ვერ მოხერხდა", 'error');
            return { isOk: false };
        }
    }

    // =============== APP INIT ===============
    window.addEventListener('DOMContentLoaded', () => {
        loadMembers();
        setupEventListeners();
    });

    function setupEventListeners() {
        document.querySelectorAll('.subscription-card').forEach(card => {
            card.addEventListener('click', function() {
                document.querySelectorAll('.subscription-card').forEach(c => c.classList.remove('selected'));
                this.classList.add('selected');
                selectedSubscription = {
                    type: this.dataset.type,
                    price: parseInt(this.dataset.price)
                };
                document.getElementById('customSubscriptionFields').style.display = 
                    this.dataset.type === 'other' ? 'block' : 'none';
            });
        });

        document.getElementById('registrationForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            if (currentRecordCount >= 999) {
                showToast("მაქსიმალური წევრების რაოდენობა: 999", 'error');
                return;
            }
            if (!selectedSubscription) {
                showToast("აირჩიეთ აბონემენტი", 'error');
                return;
            }

            const btn = document.getElementById('registerBtn');
            const btnText = btn.querySelector('.btn-text');
            const spinner = btn.querySelector('.spinner');
            btn.disabled = true;
            btnText.style.display = 'none';
            spinner.style.display = 'block';

            try {
                const startDate = new Date();
                let endDate = new Date();
                let remainingVisits = null;
                let price = selectedSubscription.price;
                let type = selectedSubscription.type;

                if (type === '12visits') {
                    endDate.setDate(startDate.getDate() + 30);
                    remainingVisits = 12;
                } else if (type === 'morning') {
                    endDate.setDate(startDate.getDate() + 30);
                } else if (type === 'unlimited') {
                    endDate.setDate(startDate.getDate() + 60);
                } else if (type === 'other') {
                    const customPrice = document.getElementById('customPrice').value;
                    const customDuration = document.getElementById('customDuration').value;
                    const customVisits = document.getElementById('customVisits').value;
                    const customDesc = document.getElementById('customDescription').value;
                    if (!customPrice || !customDuration) {
                        showToast("ფასი და ვადა სავალდებულოა", 'error');
                        return;
                    }
                    price = parseInt(customPrice);
                    endDate.setDate(startDate.getDate() + parseInt(customDuration));
                    remainingVisits = customVisits ? parseInt(customVisits) : null;
                    type = customDesc || 'სხვა';
                }

                const member = {
                    firstName: document.getElementById('firstName').value,
                    lastName: document.getElementById('lastName').value,
                    phone: document.getElementById('phone').value,
                    birthDate: document.getElementById('birthDate').value,
                    email: document.getElementById('email').value,
                    personalId: document.getElementById('personalId').value,
                    subscriptionType: type,
                    subscriptionPrice: price,
                    subscriptionStartDate: startDate.toISOString(),
                    subscriptionEndDate: endDate.toISOString(),
                    remainingVisits: remainingVisits,
                    totalVisits: 0,
                    status: 'active',
                    lastVisit: null,
                    createdAt: new Date().toISOString()
                };

                await createMember(member);
                this.reset();
                selectedSubscription = null;
                document.querySelectorAll('.subscription-card').forEach(c => c.classList.remove('selected'));
                document.getElementById('customSubscriptionFields').style.display = 'none';
            } catch (e) {
                showToast("რეგისტრაციის შეცდომა", 'error');
            } finally {
                btn.disabled = false;
                btnText.style.display = 'inline';
                spinner.style.display = 'none';
            }
        });

        document.getElementById('searchInput').addEventListener('input', e => updateSearchResults(e.target.value));
        document.getElementById('checkinSearch').addEventListener('input', e => {
            const term = e.target.value.trim();
            if (term.length > 2) searchAndCheckAccess(term);
            else document.getElementById('checkinResult').innerHTML = '';
        });
    }

    // =============== UI UPDATES ===============
    function updateAll() {
        updateDashboard();
        updateExpiredList();
        const searchVal = document.getElementById('searchInput').value;
        if (searchVal) updateSearchResults(searchVal);
    }

    function updateDashboard() {
        const today = new Date().toDateString();
        const todayVisits = members.filter(m => m.lastVisit && new Date(m.lastVisit).toDateString() === today).length;
        const active = members.filter(m => m.status === 'active').length;
        const expired = members.filter(m => ['expired', 'blocked'].includes(m.status)).length;
        const paused = members.filter(m => m.status === 'paused').length;

        const threeDaysLater = new Date(); threeDaysLater.setDate(threeDaysLater.getDate() + 3);
        const expiringSoon = members.filter(m => 
            m.status === 'active' && 
            new Date(m.subscriptionEndDate) <= threeDaysLater && 
            new Date(m.subscriptionEndDate) > new Date()
        );

        document.getElementById('todayVisits').textContent = todayVisits;
        document.getElementById('activeMembers').textContent = active;
        document.getElementById('expiredMembers').textContent = expired;
        document.getElementById('expiringMembers').textContent = expiringSoon.length;
        document.getElementById('pausedMembers').textContent = paused;

        document.getElementById('expiringList').innerHTML = expiringSoon.length > 0 ? `
            <h3 class="mt-4">მომდევნო 3 დღეში ვადაგასული:</h3>
            ${expiringSoon.map(m => `
                <div class="member-card p-3 mb-2">
                    <strong>${m.firstName} ${m.lastName}</strong> — ვადა: ${formatDate(m.subscriptionEndDate)}
                </div>
            `).join('')}
        ` : '';
    }

    function updateSearchResults(term = '') {
        const container = document.getElementById('searchResults');
        if (!term) {
            container.innerHTML = '<p class="text-gray-500">ძიება...</p>';
            return;
        }
        const filtered = members.filter(m =>
            m.personalId.includes(term) ||
            m.firstName.toLowerCase().includes(term.toLowerCase()) ||
            m.lastName.toLowerCase().includes(term.toLowerCase())
        );
        container.innerHTML = filtered.length === 0
            ? '<p class="text-red-600">ვერ მოიძებნა</p>'
            : filtered.map(createMemberCard).join('');
    }

    async function searchAndCheckAccess(term) {
        const matches = members.filter(m =>
            m.personalId.includes(term) ||
            m.firstName.toLowerCase().includes(term.toLowerCase()) ||
            m.lastName.toLowerCase().includes(term.toLowerCase())
        );
        const container = document.getElementById('checkinResult');
        if (matches.length === 0) {
            container.innerHTML = '<div class="member-card p-4 text-red-600 font-bold">წევრი ვერ მოიძებნა</div>';
        } else if (matches.length === 1) {
            await checkMemberAccess(matches[0]);
        } else {
            container.innerHTML = `<div class="member-card p-4">
                <h3 class="font-bold mb-2">აირჩიეთ წევრი:</h3>
                ${matches.map(m => `
                    <div class="p-2 border rounded mb-2 cursor-pointer hover:bg-gray-100" 
                         onclick="checkMemberAccess(members.find(x => x.id === '${m.id}'))">
                        <strong>${m.firstName} ${m.lastName}</strong> — ${m.personalId}
                    </div>
                `).join('')}
            </div>`;
        }
    }

    async function checkMemberAccess(member) {
        const now = new Date();
        const end = new Date(member.subscriptionEndDate);
        const hour = now.getHours();
        let allowed = true;
        let msg = 'შესვლა ნებადართულია';

        if (member.status !== 'active') {
            allowed = false;
            msg = member.status === 'paused' ? 'შეჩერებულია' : 'ვადაგასული';
        } else if (now > end) {
            allowed = false;
            msg = 'ვადა გასულია';
            await updateMember({ ...member, status: 'expired' });
        } else if (member.subscriptionType === '12visits' && member.remainingVisits <= 0) {
            allowed = false;
            msg = 'ვიზიტები ამოწურულია';
            await updateMember({ ...member, status: 'expired' });
        } else if (member.subscriptionType === 'morning' && (hour < 9 || hour >= 16)) {
            allowed = false;
            msg = 'მხოლოდ 09:00–16:00';
        }

        document.getElementById('checkinResult').innerHTML = `
            <div class="member-card p-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
                    <div><strong>პირადი:</strong> ${member.personalId}</div>
                    <div><strong>აბონემენტი:</strong> ${getSubscriptionName(member.subscriptionType)}</div>
                    <div><strong>სტატუსი:</strong> 
                        <span class="status-badge ${allowed ? 'status-active' : 'status-expired'}">${msg}</span>
                    </div>
                    ${member.remainingVisits != null ? `<div><strong>ვიზიტები:</strong> ${member.remainingVisits}</div>` : ''}
                    <div><strong>ვადა:</strong> ${formatDate(member.subscriptionEndDate)}</div>
                </div>
                ${allowed ? `<button class="btn btn-success mt-3" onclick="processCheckIn('${member.id}')">დადასტურება</button>` : ''}
            </div>`;
    }

    async function processCheckIn(id) {
        const member = members.find(m => m.id === id);
        if (!member) return;
        const updated = { ...member };
        updated.lastVisit = new Date().toISOString();
        updated.totalVisits = (updated.totalVisits || 0) + 1;
        if (updated.subscriptionType === '12visits' && updated.remainingVisits > 0) {
            updated.remainingVisits -= 1;
            if (updated.remainingVisits === 0) updated.status = 'expired';
        }
        await updateMember(updated);
        showToast("შესვლა დაფიქსირდა!");
        document.getElementById('checkinSearch').value = '';
        document.getElementById('checkinResult').innerHTML = '';
    }

    function updateExpiredList() {
        const expired = members.filter(m => m.status === 'expired');
        document.getElementById('expiredList').innerHTML = expired.length === 0
            ? '<p class="text-gray-500">ვადაგასული არ არის</p>'
            : expired.map(m => {
                const daysOver = Math.floor((new Date() - new Date(m.subscriptionEndDate)) / 86400000);
                const reason = m.subscriptionType === '12visits' && m.remainingVisits === 0
                    ? 'ვიზიტები ამოწურულია'
                    : `ვადა გასულია ${daysOver} დღით`;
                return `
                    <div class="member-card p-4 mb-3">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                            <div><strong>${m.firstName} ${m.lastName}</strong></div>
                            <div><strong>პირადი:</strong> ${m.personalId}</div>
                            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(m.subscriptionType)}</div>
                            <div><strong>მიზეზი:</strong> ${reason}</div>
                            <div><strong>ბოლო ვიზიტი:</strong> ${m.lastVisit ? formatDate(m.lastVisit) : 'არა'}</div>
                        </div>
                        <button class="btn btn-warning mt-3" onclick="renewMembership('${m.id}')">განახლება</button>
                    </div>`;
            }).join('');
    }

    async function renewMembership(id) {
        const member = members.find(m => m.id === id);
        if (!member) return;
        const start = new Date();
        const end = new Date();
        let visits = null;
        if (member.subscriptionType === '12visits') { end.setDate(start.getDate() + 30); visits = 12; }
        else if (member.subscriptionType === 'morning') end.setDate(start.getDate() + 30);
        else if (member.subscriptionType === 'unlimited') end.setDate(start.getDate() + 60);
        await updateMember({
            ...member,
            subscriptionStartDate: start.toISOString(),
            subscriptionEndDate: end.toISOString(),
            remainingVisits: visits,
            status: 'active'
        });
        showToast("აბონემენტი განახლდა!");
    }

    function createMemberCard(m) {
        const daysLeft = Math.ceil((new Date(m.subscriptionEndDate) - new Date()) / 86400000);
        return `
            <div class="member-card p-4 mb-3">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    <div><strong>სახელი:</strong> ${m.firstName} ${m.lastName}</div>
                    <div><strong>პირადი:</strong> ${m.personalId}</div>
                    <div><strong>ტელეფონი:</strong> ${m.phone}</div>
                    <div><strong>აბონემენტი:</strong> ${getSubscriptionName(m.subscriptionType)}</div>
                    <div><strong>დღეები:</strong> ${daysLeft > 0 ? daysLeft : 'გასული'}</div>
                    ${m.remainingVisits != null ? `<div><strong>ვიზიტები:</strong> ${m.remainingVisits}</div>` : ''}
                    <div><strong>სულ:</strong> ${m.totalVisits}</div>
                    <div><strong>სტატუსი:</strong> <span class="status-badge ${getStatusClass(m.status)}">${getStatusText(m.status)}</span></div>
                </div>
                <div class="flex gap-2 mt-3 flex-wrap">
                    <button class="btn btn-warning text-sm" onclick="showRenewalOptions('${m.id}')">განახლება</button>
                    <button class="btn text-sm" onclick="showEditForm('${m.id}')" style="background:#4299e1">რედაქტირება</button>
                    ${m.status === 'active' ? `<button class="btn text-sm" onclick="pauseMembership('${m.id}')" style="background:#ed8936">შეჩერება</button>` : 
                     m.status === 'paused' ? `<button class="btn btn-success text-sm" onclick="resumeMembership('${m.id}')">აქტივაცია</button>` : ''}
                </div>
            </div>`;
    }

    function getSubscriptionName(t) {
        const map = { '12visits': '12 ვარჯიში', 'morning': 'დილის', 'unlimited': 'ულიმიტო', 'other': 'სხვა' };
        return map[t] || t;
    }
    function getStatusClass(s) { return { active: 'status-active', expired: 'status-expired', paused: 'status-paused' }[s] || 'status-expired'; }
    function getStatusText(s) { return { active: 'აქტიური', expired: 'ვადაგასული', paused: 'შეჩერებული' }[s] || s; }
    function formatDate(d) { return new Date(d).toLocaleDateString('ka-GE'); }

    function showToast(msg, type = 'success') {
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.classList.add('show'), 100);
        setTimeout(() => {
            t.classList.remove('show');
            setTimeout(() => document.body.removeChild(t), 300);
        }, 3000);
    }

    // Export functions
    window.exportToExcel = function() {
        const data = members.map(m => ({
            სახელი: m.firstName,
            გვარი: m.lastName,
            პირადი: m.personalId,
            აბონემენტი: getSubscriptionName(m.subscriptionType),
            ფასი: m.subscriptionPrice + '₾',
            დასრულება: formatDate(m.subscriptionEndDate),
            სტატუსი: getStatusText(m.status)
        }));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "წევრები");
        XLSX.writeFile(wb, `Gym_${new Date().toISOString().split('T')[0]}.xlsx`);
        showToast("Excel ჩამოიტვირთა!");
    };

    window.exportToPDF = function() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.text("Fit House Gym", 20, 20);
        doc.text(`თარიღი: ${new Date().toLocaleDateString('ka-GE')}`, 20, 30);
        let y = 50;
        members.filter(m => m.status === 'active').forEach((m, i) => {
            if (y > 270) { doc.addPage(); y = 20; }
            doc.text(`${i+1}. ${m.firstName} ${m.lastName} — ${formatDate(m.subscriptionEndDate)}`, 20, y);
            y += 10;
        });
        doc.save(`Gym_Report_${new Date().toISOString().split('T')[0]}.pdf`);
        showToast("PDF ჩამოიტვირთა!");
    };

    // Tab navigation
    window.showTab = function(tab) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.getElementById(tab).classList.add('active');
        event.target.classList.add('active');
    };

    // Placeholder functions for renewal/edit
    window.showRenewalOptions = id => alert('განახლების ფუნქცია (ID: ' + id + ')');
    window.showEditForm = id => alert('რედაქტირება (ID: ' + id + ')');
    window.pauseMembership = id => updateMember({ ...members.find(m => m.id === id), status: 'paused' }).then(() => showToast('შეჩერებული'));
    window.resumeMembership = id => updateMember({ ...members.find(m => m.id === id), status: 'active' }).then(() => showToast('აქტივირებული'));
  </script>

  <!-- External Libraries -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>

  <style>
    /* [იგივე CSS რაც თქვენს ორიგინალურ კოდში — არ შეცვლილა] */
    body { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(10px); border-radius: 20px; padding: 30px; margin-bottom: 30px; text-align: center; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1); }
    .gym-title { font-size: 2.5rem; font-weight: bold; color: #2d3748; margin-bottom: 10px; }
    .contact-info { color: #718096; font-size: 1.1rem; }
    .nav-tabs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 30px; justify-content: center; }
    .nav-tab { background: rgba(255, 255, 255, 0.9); border: none; padding: 15px 25px; border-radius: 15px; cursor: pointer; font-weight: 600; color: #4a5568; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); }
    .nav-tab:hover { background: rgba(255, 255, 255, 1); transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15); }
    .nav-tab.active { background: #4299e1; color: white; transform: translateY(-2px); }
    .tab-content { display: none; background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(10px); border-radius: 20px; padding: 30px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1); }
    .tab-content.active { display: block; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .form-group { margin-bottom: 20px; }
    .form-label { display: block; margin-bottom: 8px; font-weight: 600; color: #2d3748; }
    .form-input { width: 100%; padding: 12px 16px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 16px; transition: all 0.3s ease; box-sizing: border-box; }
    .form-input:focus { outline: none; border-color: #4299e1; box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.1); }
    .btn { background: linear-gradient(135deg, #4299e1, #3182ce); color: white; border: none; padding: 12px 24px; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 16px; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(66, 153, 225, 0.3); }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(66, 153, 225, 0.4); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .btn-success { background: linear-gradient(135deg, #48bb78, #38a169); box-shadow: 0 4px 15px rgba(72, 187, 120, 0.3); }
    .btn-warning { background: linear-gradient(135deg, #ed8936, #dd6b20); box-shadow: 0 4px 15px rgba(237, 137, 54, 0.3); }
    .subscription-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .subscription-card { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 25px; border-radius: 20px; text-align: center; cursor: pointer; transition: all 0.3s ease; border: 3px solid transparent; }
    .subscription-card:hover { transform: translateY(-5px); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2); }
    .subscription-card.selected { border-color: #ffd700; box-shadow: 0 0 20px rgba(255, 215, 0, 0.5); }
    .member-card { background: white; border-radius: 15px; padding: 20px; margin-bottom: 15px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); }
    .status-badge { display: inline-block; padding: 6px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; }
    .status-active { background: #c6f6d5; color: #22543d; }
    .status-expired { background: #fed7d7; color: #742a2a; }
    .status-paused { background: #fed7aa; color: #9a3412; }
    .dashboard-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .stat-card { background: linear-gradient(135deg, #4299e1, #3182ce); color: white; padding: 25px; border-radius: 20px; text-align: center; box-shadow: 0 8px 25px rgba(66, 153, 225, 0.3); }
    .search-input { width: 100%; padding: 15px 20px; border: 2px solid #e2e8f0; border-radius: 15px; font-size: 18px; }
    .spinner { border: 3px solid #f3f3f3; border-top: 3px solid #4299e1; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 0 auto; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .toast { position: fixed; top: 20px; right: 20px; background: #48bb78; color: white; padding: 15px 20px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2); z-index: 1000; transform: translateX(400px); transition: transform 0.3s ease; }
    .toast.show { transform: translateX(0); }
    .toast.error { background: #f56565; }
    @media (max-width: 768px) { .form-grid, .subscription-cards, .dashboard-stats { grid-template-columns: 1fr; } }
  </style>
 </head>
 <body>
  <div class="container">
   <div class="header">
    <h1 class="gym-title" id="gymName">Fit House Gym</h1>
    <p class="contact-info" id="contactInfo">Phone: +995 XXX XXX XXX</p>
   </div>
   <div class="nav-tabs">
    <button class="nav-tab active" onclick="showTab('dashboard')">დეშბორდი</button>
    <button class="nav-tab" onclick="showTab('register')">რეგისტრაცია</button>
    <button class="nav-tab" onclick="showTab('search')">ძიება</button>
    <button class="nav-tab" onclick="showTab('checkin')">შესვლა</button>
    <button class="nav-tab" onclick="showTab('expired')">ვადაგასული</button>
    <button class="nav-tab" onclick="showTab('export')">ექსპორტი</button>
   </div>

   <!-- [იგივე HTML სტრუქტურა რაც თქვენს კოდში — არ შეცვლილა] -->
   <!-- Dashboard, Register, Search, Checkin, Expired, Export -->
   <div id="dashboard" class="tab-content active">
    <h2>დეშბორდი</h2>
    <div class="dashboard-stats">
     <div class="stat-card"><div class="stat-number" id="todayVisits">0</div><div class="stat-label">დღევანდელი შესვლები</div></div>
     <div class="stat-card"><div class="stat-number" id="activeMembers">0</div><div class="stat-label">აქტიური</div></div>
     <div class="stat-card"><div class="stat-number" id="expiredMembers">0</div><div class="stat-label">ვადაგასული</div></div>
     <div class="stat-card"><div class="stat-number" id="expiringMembers">0</div><div class="stat-label">3 დღეში</div></div>
     <div class="stat-card" style="background: linear-gradient(135deg, #ed8936, #dd6b20);"><div class="stat-number" id="pausedMembers">0</div><div class="stat-label">შეჩერებული</div></div>
    </div>
    <div id="expiringList"></div>
   </div>

   <div id="register" class="tab-content">
    <h2>რეგისტრაცია</h2>
    <form id="registrationForm">
     <div class="form-grid">
      <div class="form-group"><label class="form-label" for="firstName">სახელი *</label><input type="text" id="firstName" class="form-input" required></div>
      <div class="form-group"><label class="form-label" for="lastName">გვარი *</label><input type="text" id="lastName" class="form-input" required></div>
      <div class="form-group"><label class="form-label" for="phone">ტელეფონი *</label><input type="tel" id="phone" class="form-input" required></div>
      <div class="form-group"><label class="form-label" for="birthDate">დაბადება *</label><input type="date" id="birthDate" class="form-input" required></div>
      <div class="form-group"><label class="form-label" for="email">ელ.ფოსტა</label><input type="email" id="email" class="form-input"></div>
      <div class="form-group"><label class="form-label" for="personalId">პირადი *</label><input type="text" id="personalId" class="form-input" required></div>
     </div>
     <h3>აბონემენტი</h3>
     <div class="subscription-cards">
      <div class="subscription-card" data-type="12visits" data-price="70"><div class="subscription-title">12 ვარჯიში</div><div class="subscription-price">70₾</div><div class="subscription-details">30 დღე<br>12 შესვლა</div></div>
      <div class="subscription-card" data-type="morning" data-price="90"><div class="subscription-title">დილის</div><div class="subscription-price">90₾</div><div class="subscription-details">09:00–16:00<br>30 დღე</div></div>
      <div class="subscription-card" data-type="unlimited" data-price="110"><div class="subscription-title">ულიმიტო</div><div class="subscription-price">110₾</div><div class="subscription-details">60 დღე</div></div>
      <div class="subscription-card" data-type="other" data-price="0"><div class="subscription-title">სხვა</div><div class="subscription-price">0₾</div><div class="subscription-details">თავისუფალი</div></div>
     </div>
     <div id="customSubscriptionFields" style="display:none; margin-top:20px; padding:20px; background:#f7fafc; border-radius:12px;">
      <h4>დეტალები</h4>
      <div class="form-grid">
       <div class="form-group"><label class="form-label" for="customPrice">ფასი *</label><input type="number" id="customPrice" class="form-input" min="0"></div>
       <div class="form-group"><label class="form-label" for="customDuration">ვადა *</label><input type="number" id="customDuration" class="form-input" min="1"></div>
       <div class="form-group"><label class="form-label" for="customVisits">ვიზიტები</label><input type="number" id="customVisits" class="form-input" min="1" placeholder="ცარიელი = ულიმიტო"></div>
       <div class="form-group"><label class="form-label" for="customDescription">აღწერა</label><input type="text" id="customDescription" class="form-input"></div>
      </div>
     </div>
     <button type="submit" class="btn btn-success" id="registerBtn"><span class="btn-text">რეგისტრაცია</span><div class="spinner" style="display:none;"></div></button>
    </form>
   </div>

   <div id="search" class="tab-content"><h2>ძიება</h2><div class="search-container"><input type="text" id="searchInput" class="search-input" placeholder="პირადი, სახელი..."></div><div id="searchResults"></div></div>
   <div id="checkin" class="tab-content"><h2>შესვლა</h2><div class="search-container"><input type="text" id="checkinSearch" class="search-input" placeholder="ძიება..."></div><div id="checkinResult"></div></div>
   <div id="expired" class="tab-content"><h2>ვადაგასული</h2><div id="expiredList"></div></div>
   <div id="export" class="tab-content"><h2>ექსპორტი</h2><div class="export-buttons"><button class="btn" onclick="exportToExcel()">Excel</button><button class="btn" onclick="exportToPDF()">PDF</button></div></div>
  </div>
 </body>
</html>
