<html lang="ka">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Fit House Gym - მენეჯმენტი</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" crossorigin="anonymous" />
  <script type="module">
    import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
    import { getFirestore, collection, addDoc, setDoc, doc, onSnapshot, query, deleteDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

    const firebaseConfig = {
      apiKey: "AIzaSyA1HOc9IvnfougHBMHRnQwktfOrS72Ttt8",
      authDomain: "fit-house-gym-d3595.firebaseapp.com",
      projectId: "fit-house-gym-d3595",
      storageBucket: "fit-house-gym-d3595.firebasestorage.app",
      messagingSenderId: "548276737406",
      appId: "1:548276737406:web:12286429916b8c751fcf2f",
      measurementId: "G-F4Y4CLVNFH"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const ADMIN_PASSWORD = "1234";
    let isAuthenticated = false;
    window.members = [];
    window.selectedSubscription = null;

    function formatDate(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}.${month}.${year}`;
    }

    function checkAuth() {
      if (!isAuthenticated) {
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
      } else {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
      }
    }

    window.login = function() {
      const input = document.getElementById('adminPassword').value;
      if (input === ADMIN_PASSWORD) {
        isAuthenticated = true;
        checkAuth();
        loadMembers();
        showToast("ავტორიზაცია წარმატებით განხორციელდა!", "success");
      } else {
        showToast("პაროლი არასწორია!", "error");
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
      if (pass !== ADMIN_PASSWORD) {
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
      const q = query(collection(db, "members"));
      onSnapshot(q, (snapshot) => {
        window.members = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        updateAll();
      });
    }

    async function createMember(m) {
      try { await addDoc(collection(db, "members"), m); showToast("დარეგისტრირდა!"); }
      catch (e) { showToast("შეცდომა", 'error'); }
    }

    async function updateMember(m) {
      try { await setDoc(doc(db, "members", m.id), m, { merge: true }); }
      catch (e) { console.error(e); }
    }

    window.showTab = function(tab) {
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.getElementById(tab).classList.add('active');
      document.querySelector(`[onclick="showTab('${tab}')"]`).classList.add('active');
      if (tab === 'search') {
        document.getElementById('searchResults').innerHTML = '';
        updateSearchMemberList();
      }
      if (tab === 'dashboard') document.getElementById('expiringSoonSection').style.display = 'none';
    };

    window.toggleMemberDetails = function(id) {
      const member = window.members.find(m => m.id === id);
      if (!member) return;
      const detailsDiv = document.getElementById(`details-${id}`);
      if (detailsDiv) {
        detailsDiv.remove();
        return;
      }

      const noteBanner = member.note ? `<div class="note-banner text-sm"><i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${member.note}</div>` : '';

      const detailsHTML = `
        <div id="details-${id}" class="member-details-card animate-fadeIn">
          ${noteBanner}
          <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-6">
            <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
            <div><strong>პირადი:</strong> ${member.personalId}</div>
            <div><strong>ტელეფონი:</strong> ${member.phone || '—'}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(member.subscriptionType)}</div>
            <div><strong>ფასი:</strong> ${member.subscriptionPrice}₾</div>
            <div><strong>ვადა:</strong> ${formatDate(member.subscriptionEndDate)}</div>
            <div><strong>სტატუსი:</strong> <span class="status-badge ${getStatusClass(member.status)}">${getStatusText(member.status)}</span></div>
            <div><strong>დარჩენილი:</strong> ${member.remainingVisits != null ? member.remainingVisits : 'ულიმიტო'}</div>
            <div><strong>ბოლო ვიზიტი:</strong> ${member.lastVisit ? formatDate(member.lastVisit) : '—'}</div>
          </div>
          <div class="flex flex-wrap gap-3 justify-center">
            <button class="btn btn-warning text-sm px-6 py-2" onclick="renewMembership('${member.id}')">განახლება</button>
            <button class="btn bg-blue-600 hover:bg-blue-700 text-sm px-6 py-2" onclick="showEditForm(event, '${member.id}')">რედაქტირება</button>
            <button class="btn bg-red-600 hover:bg-red-700 text-sm px-6 py-2" onclick="deleteMember('${member.id}')">წაშლა</button>
          </div>
        </div>
      `;

      const card = document.querySelector(`[data-member-id="${id}"]`);
      card.insertAdjacentHTML('afterend', detailsHTML);
    };

    window.processCheckIn = async function(id) {
      const m = window.members.find(x => x.id === id);
      if (!m || m.status !== 'active') { showToast("არააქტიურია", 'error'); return; }
      const now = new Date(), end = new Date(m.subscriptionEndDate), hour = now.getHours();
      if (now > end) { await updateMember({...m, status: 'expired'}); showToast("ვადა გასულია!", 'error'); return; }
      if (m.subscriptionType === 'morning' && (hour < 9 || hour >= 16)) { showToast("მხოლოდ 09:00–16:00", 'error'); return; }
      let updated = { ...m };
      updated.lastVisit = now.toISOString();
      updated.totalVisits = (updated.totalVisits || 0) + 1;
      if (m.remainingVisits !== null) {
        updated.remainingVisits = m.remainingVisits - 1;
        if (updated.remainingVisits <= 0) updated.status = 'expired';
      }
      await updateMember(updated);
      showToast("შესვლა დაფიქსირდა!");
      document.getElementById('checkinSearch').value = '';
      document.getElementById('checkinResult').innerHTML = '';
    };

    window.checkMemberAccess = async function(member) {
      const now = new Date(), end = new Date(member.subscriptionEndDate), hour = now.getHours();
      let allowed = true, msg = 'ნებადართული';
      if (member.status !== 'active') { allowed = false; msg = 'შეჩერებულია'; }
      else if (now > end) { allowed = false; msg = 'ვადა გასულია'; await updateMember({...member, status:'expired'}); }
      else if (member.remainingVisits !== null && member.remainingVisits <= 0) { allowed = false; msg = 'ვიზიტები ამოწურულია'; await updateMember({...member, status:'expired'}); }
      else if (member.subscriptionType === 'morning' && (hour < 9 || hour >= 16)) { allowed = false; msg = 'მხოლოდ 09:00–16:00'; }

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

    window.renewMembership = async function(id) {
      const m = window.members.find(x => x.id === id);
      if (!m) return;
      const start = new Date(), end = new Date();
      let visits = null;
      if (m.subscriptionType === '12visits') { end.setDate(start.getDate() + 30); visits = 12; }
      else if (m.subscriptionType === 'morning') end.setDate(start.getDate() + 30);
      else if (m.subscriptionType === 'unlimited') end.setDate(start.getDate() + 30);
      await updateMember({ ...m, subscriptionEndDate: end.toISOString(), remainingVisits: visits, status: 'active' });
      showToast("განახლდა!");
    };

    window.showEditForm = function(e, id) {
      if (e) e.stopPropagation();
      document.querySelectorAll('.edit-form').forEach(f => f.remove());
      const m = window.members.find(x => x.id === id);
      if (!m) return;
      const div = document.createElement('div');
      div.className = 'edit-form';
      const endDate = m.subscriptionEndDate ? new Date(m.subscriptionEndDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      div.innerHTML = `
        <div class="bg-slate-800 p-8 rounded-2xl border-4 border-blue-500 mt-6 shadow-2xl">
          <h4 class="text-2xl font-bold mb-6 text-center text-blue-400">რედაქტირება — ${m.firstName} ${m.lastName}</h4>
          <div class="form-grid gap-4 text-sm">
            <input type="text" value="${m.firstName}" id="e_fn_${id}" class="form-input" placeholder="სახელი">
            <input type="text" value="${m.lastName}" id="e_ln_${id}" class="form-input" placeholder="გვარი">
            <input type="tel" value="${m.phone || ''}" id="e_ph_${id}" class="form-input" placeholder="ტელეფონი">
            <input type="text" value="${m.personalId}" id="e_pid_${id}" class="form-input" placeholder="პირადი">
            <textarea id="e_note_${id}" class="form-input" style="height:90px;">${m.note || ''}</textarea>
            <select id="e_subtype_${id}" class="form-input" onchange="autoFillSubscription('${id}')">
              <option value="12visits" ${m.subscriptionType==='12visits'?'selected':''}>12 ვარჯიში (70₾)</option>
              <option value="morning" ${m.subscriptionType==='morning'?'selected':''}>დილის (90₾)</option>
              <option value="unlimited" ${m.subscriptionType==='unlimited'?'selected':''}>ულიმიტო (110₾)</option>
              <option value="other" ${!['12visits','morning','unlimited'].includes(m.subscriptionType)?'selected':''}>სხვა</option>
            </select>
            <input type="number" value="${m.subscriptionPrice||0}" id="e_price_${id}" class="form-input" placeholder="ფასი">
            <input type="date" value="${endDate}" id="e_enddate_${id}" class="form-input">
            <input type="number" value="${m.remainingVisits == null ? '' : m.remainingVisits}" id="e_visits_${id}" class="form-input" placeholder="ვიზიტები">
            <select id="e_status_${id}" class="form-input">
              <option value="active" ${m.status==='active'?'selected':''}>აქტიური</option>
              <option value="expired" ${m.status==='expired'?'selected':''}>ვადაგასული</option>
              <option value="paused" ${m.status==='paused'?'selected':''}>შეჩერებული</option>
            </select>
          </div>
          <div class="mt-6 flex gap-4 justify-center">
            <button class="btn btn-success text-lg px-10 py-3" onclick="saveEdit('${id}')">შენახვა</button>
            <button class="btn bg-red-600 hover:bg-red-700 text-lg px-10 py-3" onclick="this.closest('.edit-form').remove()">გაუქმება</button>
          </div>
        </div>`;
      const container = document.getElementById(`details-${id}`) || document.querySelector(`[data-member-id="${id}"]`);
      container.after(div);
      autoFillSubscription(id);
    };

    window.autoFillSubscription = function(id) {
      const type = document.getElementById(`e_subtype_${id}`).value;
      const today = new Date(); let end = new Date();
      if (type === '12visits') { document.getElementById(`e_price_${id}`).value = 70; document.getElementById(`e_visits_${id}`).value = 12; end.setDate(today.getDate() + 30); }
      else if (type === 'morning') { document.getElementById(`e_price_${id}`).value = 90; document.getElementById(`e_visits_${id}`).value = ''; end.setDate(today.getDate() + 30); }
      else if (type === 'unlimited') { document.getElementById(`e_price_${id}`).value = 110; document.getElementById(`e_visits_${id}`).value = ''; end.setDate(today.getDate() + 30); }
      document.getElementById(`e_enddate_${id}`).value = end.toISOString().split('T')[0];
    };

    window.saveEdit = async function(id) {
      const m = window.members.find(x => x.id === id);
      if (!m) return;
      const endDate = document.getElementById(`e_enddate_${id}`).value;
      if (!endDate) { showToast("ვადა სავალდებულოა!", 'error'); return; }
      const updated = {
        ...m,
        firstName: document.getElementById(`e_fn_${id}`).value.trim(),
        lastName: document.getElementById(`e_ln_${id}`).value.trim(),
        phone: document.getElementById(`e_ph_${id}`).value.trim(),
        personalId: document.getElementById(`e_pid_${id}`).value.trim(),
        note: document.getElementById(`e_note_${id}`).value.trim() || null,
        subscriptionType: document.getElementById(`e_subtype_${id}`).value,
        subscriptionPrice: parseFloat(document.getElementById(`e_price_${id}`).value) || 0,
        subscriptionEndDate: new Date(endDate + 'T00:00:00').toISOString(),
        remainingVisits: document.getElementById(`e_visits_${id}`).value === '' ? null : parseInt(document.getElementById(`e_visits_${id}`).value),
        status: document.getElementById(`e_status_${id}`).value
      };
      await updateMember(updated);
      showToast("შენახულია!");
      document.querySelectorAll('.edit-form').forEach(f => f.remove());
      updateSearchMemberList();
    };

    window.exportToExcel = function() {
      const data = window.members.map(m => ({
        "სახელი": m.firstName, "გვარი": m.lastName, "პირადი": m.personalId,
        "ტელეფონი": m.phone || '', "აბონემენტი": getSubscriptionName(m.subscriptionType),
        "ფასი": m.subscriptionPrice + "₾", "დასრულება": formatDate(m.subscriptionEndDate),
        "სტატუსი": getStatusText(m.status), "დარჩენილი": m.remainingVisits != null ? m.remainingVisits : "ულიმიტო",
        "შენიშვნა": m.note || "", "ბოლო ვიზიტი": m.lastVisit ? formatDate(m.lastVisit) : "—"
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, "წევრები");
      XLSX.writeFile(wb, `FitHouse_${new Date().toISOString().slice(0,10)}.xlsx`);
      showToast("Excel ჩამოიტვირთა!");
    };

    function updateAll() {
      updateDashboard(); updateExpiredList(); updateSearchMemberList(); showExpiringSoon();
    }

    function updateDashboard() {
      const today = new Date().toDateString();
      const todayVisits = window.members.filter(m => m.lastVisit && new Date(m.lastVisit).toDateString() === today).length;
      const active = window.members.filter(m => m.status === 'active').length;
      const expired = window.members.filter(m => m.status === 'expired').length;
      const paused = window.members.filter(m => m.status === 'paused').length;
      const soon = new Date(); soon.setDate(soon.getDate() + 3);
      const expiring = window.members.filter(m => m.status === 'active' && new Date(m.subscriptionEndDate) <= soon && new Date(m.subscriptionEndDate) > new Date()).length;

      document.getElementById('todayVisits').textContent = todayVisits;
      document.getElementById('activeMembers').textContent = active;
      document.getElementById('expiredMembers').textContent = expired;
      document.getElementById('expiringMembers').textContent = expiring;
      document.getElementById('pausedMembers').textContent = paused;
    }

    function updateExpiredList() {
      const list = window.members.filter(m => m.status === 'expired');
      document.getElementById('expiredList').innerHTML = list.length === 0 ? '<p class="text-center py-10 text-gray-500">ვადაგასული წევრები არ არის</p>' : list.map(m => {
        const noteBanner = m.note ? `<div class="note-banner text-sm"><i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${m.note}</div>` : '';
        return `<div class="member-card">${noteBanner}
          <div class="info-grid text-sm"><div><strong>სახელი:</strong> ${m.firstName} ${m.lastName}</div><div><strong>პირადი:</strong> ${m.personalId}</div>
          <div><strong>აბონემენტი:</strong> ${getSubscriptionName(m.subscriptionType)}</div>
          <div><strong>ვადა გავიდა:</strong> <span class="text-red-400 font-bold">${formatDate(m.subscriptionEndDate)}</span></div></div>
          <div class="mt-4 flex gap-3 justify-center text-sm">
            <button class="btn btn-warning px-5 py-2" onclick="renewMembership('${m.id}')">განახლება</button>
            <button class="btn bg-blue-600 hover:bg-blue-700 px-5 py-2" onclick="showEditForm(event, '${m.id}')">რედაქტირება</button>
            <button class="btn bg-red-600 hover:bg-red-700 px-5 py-2" onclick="deleteMember('${m.id}')">წაშლა</button>
          </div></div>`;
      }).join('');
    }

    function updateSearchMemberList() {
      const container = document.getElementById('searchResults');
      const val = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
      let filtered = window.members;
      if (val) filtered = window.members.filter(m => m.personalId.includes(val) || (m.firstName + ' ' + m.lastName).toLowerCase().includes(val));
      if (filtered.length === 0) {
        container.innerHTML = `<p class="text-center py-16 text-gray-500 text-xl">${val ? 'ვერ მოიძებნა' : 'ჯერ არ არის წევრები'}</p>`;
        return;
      }
      container.innerHTML = filtered.map(m => `
        <div class="search-member-card" data-member-id="${m.id}" onclick="toggleMemberDetails('${m.id}')">
          <div class="search-card-content">
            <div class="search-card-info">
              <div class="search-name">${m.firstName} ${m.lastName}</div>
              <div class="search-id">პირადი: ${m.personalId}</div>
              <div class="search-sub">${getSubscriptionName(m.subscriptionType)}</div>
              <div class="search-end">ვადა: ${formatDate(m.subscriptionEndDate)}</div>
            </div>
            <div class="search-arrow">${document.getElementById(`details-${m.id}`) ? '−' : '+'}</div>
          </div>
        </div>
      `).join('');
    }

    function showExpiringSoon() {
      const soon = new Date(); soon.setDate(soon.getDate() + 3);
      const list = window.members.filter(m => m.status === 'active' && new Date(m.subscriptionEndDate) <= soon && new Date(m.subscriptionEndDate) >= new Date())
        .sort((a,b) => new Date(a.subscriptionEndDate) - new Date(b.subscriptionEndDate));
      const container = document.getElementById('expiringSoonList');
      if (list.length === 0) { container.innerHTML = '<p class="text-center py-10 text-gray-500">3 დღეში ვადაგასული არ არის</p>'; return; }
      container.innerHTML = list.map(m => {
        const days = Math.ceil((new Date(m.subscriptionEndDate) - new Date()) / 86400000);
        const note = Chance.note ? `<div class="note-banner text-sm"><i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${m.note}</div>` : '';
        return `<div class="member-card text-sm">${note}
          <div class="grid grid-cols-2 gap-3">
            <div><strong>სახელი:</strong> ${m.firstName} ${m.lastName}</div>
            <div><strong>პირადი:</strong> ${m.personalId}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(m.subscriptionType)}</div>
            <div><strong>ვადა:</strong> <span class="text-orange-400 font-bold">${formatDate(m.subscriptionEndDate)} (${days} დღე)</span></div>
          </div>
          <div class="mt-4 flex gap-3 justify-center">
            <button class="btn btn-warning text-sm px-5 py-2" onclick="renewMembership('${m.id}')">განახლება</button>
            <button class="btn bg-blue-600 hover:bg-blue-700 text-sm px-5 py-2" onclick="showEditForm(event, '${m.id}')">რედაქტირება</button>
          </div></div>`;
      }).join('');
    }

    function getSubscriptionName(t) { const map = {'12visits':'12 ვარჯიში','morning':'დილის','unlimited':'ულიმიტო','other':'სხვა'}; return map[t] || t; }
    function getStatusClass(s) { return {active:'status-active',expired:'status-expired',paused:'status-paused'}[s] || 'status-expired'; }
    function getStatusText(s) { return {active:'აქტიური',expired:'ვადაგასული',paused:'შეჩერებული'}[s] || s; }

    function showToast(msg, type='success') {
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      t.innerHTML = msg;
      document.body.appendChild(t);
      setTimeout(() => t.classList.add('show'), 100);
      setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
    }

    window.toggleTheme = function() {
      const isLight = document.body.classList.toggle('light-mode');
      localStorage.setItem('gym-theme', isLight ? 'light' : 'dark');
      document.querySelector('.theme-toggle i').className = isLight ? 'fas fa-moon' : 'fas fa-sun';
    };

    document.addEventListener('DOMContentLoaded', () => {
      checkAuth();
      if (localStorage.getItem('gym-theme') === 'light') {
        document.body.classList.add('light-mode');
        document.querySelector('.theme-toggle i').className = 'fas fa-moon';
      }

      document.querySelectorAll('.subscription-card').forEach(c => c.addEventListener('click', function() {
        document.querySelectorAll('.subscription-card').forEach(x => x.classList.remove('selected'));
        this.classList.add('selected');
        window.selectedSubscription = {type: this.dataset.type, price: +this.dataset.price};
        document.getElementById('customSubscriptionFields').style.display = this.dataset.type === 'other' ? 'block' : 'none';
      }));

      document.getElementById('registrationForm').addEventListener('submit', async e => {
        e.preventDefault();
        if (!window.selectedSubscription) { showToast("აირჩიეთ აბონემენტი", 'error'); return; }
        const btn = document.getElementById('registerBtn'); btn.disabled = true; btn.innerHTML = '<div class="spinner"></div>';
        try {
          const start = new Date(); let end = new Date(); let visits = null; let price = window.selectedSubscription.price; let type = window.selectedSubscription.type;
          if (type === '12visits') { end.setDate(start.getDate() + 30); visits = 12; }
          else if (type === 'morning') end.setDate(start.getDate() + 30);
          else if (type === 'unlimited') end.setDate(start.getDate() + 30);
          else if (type === 'other') {
            const cp = +document.getElementById('customPrice').value;
            const cd = +document.getElementById('customDuration').value;
            const cv = document.getElementById('customVisits').value ? +document.getElementById('customVisits').value : null;
            const desc = document.getElementById('customDescription').value.trim() || 'სხვა';
            if (!cp || !cd) { showToast("ფასი და ვადა სავალდებულოა", 'error'); return; }
            price = cp; end.setDate(start.getDate() + cd); visits = cv; type = desc;
          }
          await createMember({
            firstName: document.getElementById('firstName').value.trim(),
            lastName: document.getElementById('lastName').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            birthDate: document.getElementById('birthDate').value,
            personalId: document.getElementById('personalId').value.trim(),
            note: document.getElementById('note').value.trim() || null,
            subscriptionType: type,
            subscriptionPrice: price,
            subscriptionStartDate: start.toISOString(),
            subscriptionEndDate: end.toISOString(),
            remainingVisits: visits,
            totalVisits: 0,
            status: 'active',
            lastVisit: null,
            createdAt: new Date().toISOString()
          });
          e.target.reset();
          window.selectedSubscription = null;
          document.querySelectorAll('.subscription-card').forEach(c => c.classList.remove('selected'));
          document.getElementById('customSubscriptionFields').style.display = 'none';
          showToast("რეგისტრაცია წარმატებით დასრულდა!");
        } finally {
          btn.disabled = false; btn.innerHTML = 'რეგისტრაცია';
        }
      });

      document.getElementById('searchInput')?.addEventListener('input', updateSearchMemberList);
      document.getElementById('checkinSearch')?.addEventListener('input', e => {
        const v = e.target.value.trim();
        if (v.length >= 2) {
          const matches = window.members.filter(m => m.personalId.includes(v) || (m.firstName + ' ' + m.lastName).toLowerCase().includes(v.toLowerCase()));
          const el = document.getElementById('checkinResult');
          if (matches.length === 0) el.innerHTML = '<div class="member-card text-red-500 text-center py-10">ვერ მოიძებნა</div>';
          else if (matches.length === 1) checkMemberAccess(matches[0]);
          else el.innerHTML = `<div class="member-card"><h3 class="font-bold mb-6 text-center">აირჩიეთ:</h3>${matches.map(m=>`<div class="p-5 border border-gray-600 rounded-xl mb-3 cursor-pointer hover:bg-gray-700 text-center" onclick="checkMemberAccess(window.members.find(x=>x.id==='${m.id}'))"><strong>${m.firstName} ${m.lastName}</strong> — ${m.personalId}</div>`).join('')}</div>`;
        } else document.getElementById('checkinResult').innerHTML = '';
      });
    });
  </script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <style>
    :root { --bg: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #334155 100%); --card-bg: #1e293b; --text: #f1f5f9; --text-light: #cbd5e1; --accent: #60a5fa; --accent-hover: #3b82f6; --success: #10b981; --warning: #f59e0b; --danger: #ef4444; --border: #334155; --shadow: rgba(0,0,0,0.5); }
    body.light-mode { --bg: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); --card-bg: #ffffff; --text: #1e293b; --text-light: #475569; --accent: #3b82f6; --accent-hover: #2563eb; --border: #e2e8f0; --shadow: rgba(0,0,0,0.1); }
    body { margin:0; padding:0; font-family:'Segoe UI',sans-serif; background:var(--bg); color:var(--text); min-height:100vh; transition:all 0.4s; }
    .container { max-width:1280px; margin:0 auto; padding:20px; }
    .theme-toggle { position:fixed; top:20px; right:20px; z-index:1000; width:60px; height:60px; border-radius:50%; background:var(--card-bg); border:3px solid var(--border); box-shadow:0 8px 30px var(--shadow); display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:26px; color:#fbbf24; }
    .header { background:rgba(30,41,59,0.95); backdrop-filter:blur(12px); border-radius:24px; padding:24px; margin-bottom:30px; text-align:center; box-shadow:0 20px 50px var(--shadow); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; gap:16px; }
    .logo { height:90px; border-radius:16px; box-shadow:0 10px 30px var(--shadow); }
    .gym-title { font-size:3rem; font-weight:900; background:linear-gradient(to right,#60a5fa,#c084fc); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin:0; }
    .nav-tabs { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:30px; justify-content:center; }
    .nav-tab { background:var(--card-bg); border:1px solid var(--border); color:var(--text-light); padding:12px 20px; border-radius:14px; cursor:pointer; font-weight:600; transition:all 0.3s; box-shadow:0 6px 20px var(--shadow); min-width:120px; text-align:center; font-size:0.95rem; }
    .nav-tab:hover { background:var(--accent); color:white; transform:translateY(-4px); }
    .nav-tab.active { background:var(--accent); color:white; }
    .tab-content { display:none; background:var(--card-bg); border:1px solid var(--border); border-radius:20px; padding:30px; box-shadow:0 20px 60px var(--shadow); }
    .tab-content.active { display:block; }
    .form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; }
    .form-input, .search-input { width:100%; padding:14px 18px; background:#334155; border:1px solid var(--border); border-radius:14px; color:white; font-size:15px; }
    .light-mode .form-input, .light-mode .search-input { background:#f8fafc; color:#1e293b; }
    .form-input:focus, .search-input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 4px rgba(59,130,246,0.3); }
    .btn { background:var(--accent); color:white; border:none; padding:10px 20px; border-radius:12px; cursor:pointer; font-weight:600; transition:all 0.3s; box-shadow:0 6px 20px rgba(59,130,246,0.4); font-size:0.9rem; }
    .btn:hover { background:var(--accent-hover); transform:translateY(-2px); }
    .btn-success { background:var(--success); }
    .btn-warning { background:var(--warning); }
    .subscription-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; margin:24px 0; }
    .subscription-card { background:linear-gradient(135deg,#1e40af,#7c3aed); color:white; padding:20px 14px; border-radius:18px; text-align:center; cursor:pointer; transition:all 0.4s; border:4px solid transparent; box-shadow:0 10px 25px rgba(0,0,0,0.4); }
    .subscription-card:hover { transform:translateY(-6px) scale(1.03); }
    .subscription-card.selected { border-color:#fbbf24; box-shadow:0 0 30px rgba(251,191,36,0.7); }
    .member-card { background:var(--card-bg); border:2px solid var(--border); border-radius:18px; padding:20px; margin-bottom:16px; box-shadow:0 10px 30px var(--shadow); }
    .note-banner { background:linear-gradient(135deg,#7f1d1d,#991b1b); color:#ffcccc; padding:10px 16px; border-radius:12px; font-weight:bold; text-align:center; margin:12px 0; border:2px solid #ef4444; font-size:0.85rem; }
    .status-badge { padding:4px 10px; border-radius:10px; font-size:0.75rem; font-weight:700; }
    .status-active { background:#065f46; color:#6ee7b7; }
    .status-expired { background:#7f1d1d; color:#fca5a5; }
    .status-paused { background:#78350f; color:#fdba74; }
    .dashboard-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:20px; margin-bottom:32px; }
    .stat-card { background:linear-gradient(135deg,#1e40af,#3b82f6); padding:24px; border-radius:20px; text-align:center; box-shadow:0 12px 35px rgba(59,130,246,0.5); color:white; }
    #expiringMembersCard { background:linear-gradient(135deg,#ea580c,#f97316); cursor:pointer; }
    .toast { position:fixed; top:20px; right:20px; background:#10b981; color:white; padding:14px 28px; border-radius:14px; box-shadow:0 10px 30px var(--shadow); z-index:1000; transform:translateX(400px); transition:transform 0.4s; font-weight:600; }
    .toast.show { transform:translateX(0); }
    .toast.error { background:#ef4444; }
    .spinner { border:4px solid #f3f3f3; border-top:4px solid white; border-radius:50%; width:28px; height:28px; animation:spin 1s linear infinite; margin:0 auto; }
    @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
    @keyframes fadeIn { from {opacity:0; transform:translateY(10px);} to {opacity:1; transform:translateY(0);} }
    .animate-fadeIn { animation: fadeIn 0.4s ease-out; }

    /* ძიების გრაფები — უფრო მცირე და ლამაზი */
    .search-member-card {
      background:var(--card-bg); border:2px solid var(--border); border-radius:18px; padding:16px; margin-bottom:12px;
      cursor:pointer; transition:all 0.3s; box-shadow:0 8px 25px var(--shadow); display:flex; align-items:center; justify-content:space-between;
    }
    .search-member-card:hover { transform:translateY(-4px); box-shadow:0 12px 35px var(--shadow); border-color:var(--accent); }
    .search-card-content { display:flex; width:100%; justify-content:space-between; align-items:center; }
    .search-card-info { display:grid; gap:4px; }
    .search-name { font-size:1.25rem; font-weight:bold; }
    .search-id { font-size:1rem; color:var(--text-light); }
    .search-sub { font-size:0.9rem;; color:var(--text-light); }
    .search-end { font-size:0.9rem; color:#fbbf24; font-weight:600; }
    .search-arrow { font-size:2rem; color:var(--accent); font-weight:bold; transition:transform 0.3s; width:36px; text-align:center; }
    .search-member-card:hover .search-arrow { transform:scale(1.3); }

    /* გაშლილი დეტალები — პირდაპირ ქვემოთ */
    .member-details-card {
      background:var(--card-bg); border:2px solid var(--accent); border-radius:16px; padding:20px; margin:12px 0 20px; box-shadow:0 12px 40px rgba(96,165,250,0.3);
    }

    #loginScreen { position:fixed; inset:0; background:var(--bg); display:flex; align-items:center; justify-content:center; z-index:9999; }
    .login-box { background:rgba(30,41,59,0.95); padding:50px 70px; border-radius:28px; text-align:center; box-shadow:0 30px 80px rgba(0,0,0,0.8); border:1px solid #334155; }
    #adminPassword { width:100%; padding:18px; font-size:1.4rem; text-align:center; letter-spacing:8px; background:#334155; border:2px solid #475569; border-radius:18px; color:white; margin-bottom:24px; }
    #expiringSoonSection { background:var(--card-bg); border:2px solid #f59e0b; border-radius:20px; padding:24px; margin-top:32px; display:none; }
    @media (max-width:768px) { .gym-title{font-size:2.3rem} .header{flex-direction:column} .form-grid{grid-template-columns:1fr} }
  </style>
</head>
<body>
  <div id="loginScreen">
    <div class="login-box">
      <img src="fithause logo.png" alt="Fit House" class="logo" onerror="this.style.display='none'">
      <h1>Fit House Gym</h1>
      <input type="password" id="adminPassword" placeholder="••••">
      <button class="btn btn-success text-2xl px-12 py-5" onclick="login()">შესვლა</button>
    </div>
  </div>

  <div id="mainApp" style="display:none">
    <div class="theme-toggle" onclick="toggleTheme()"><i class="fas fa-sun"></i></div>
    <div class="container">
      <div class="header">
        <img src="fithause logo.png" alt="Fit House" class="logo" onerror="this.style.display='none'">
        <h1 class="gym-title">Fit House Gym</h1>
      </div>

      <div class="nav-tabs">
        <button class="nav-tab active" onclick="showTab('dashboard')">დეშბორდი</button>
        <button class="nav-tab" onclick="showTab('register')">რეგისტრაცია</button>
        <button class="nav-tab" onclick="showTab('search')">ძიება</button>
        <button class="nav-tab" onclick="showTab('checkin')">შესვლა</button>
        <button class="nav-tab" onclick="showTab('expired')">ვადაგასული</button>
        <button class="nav-tab bg-green-600 hover:bg-green-700" onclick="exportToExcel()">Excel</button>
      </div>

      <div id="dashboard" class="tab-content active">
        <h2 class="text-3xl font-bold mb-8 text-center">დეშბორდი</h2>
        <div class="dashboard-stats">
          <div class="stat-card"><div class="text-4xl font-bold" id="todayVisits">0</div><div class="text-lg mt-2">დღეს</div></div>
          <div class="stat-card"><div class="text-4xl font-bold" id="activeMembers">0</div><div class="text-lg mt-2">აქტიური</div></div>
          <div class="stat-card"><div class="text-4xl font-bold" id="expiredMembers">0</div><div class="text-lg mt-2">ვადაგასული</div></div>
          <div class="stat-card" id="expiringMembersCard"><div class="text-4xl font-bold" id="expiringMembers">0</div><div class="text-lg mt-2">3 დღეში</div></div>
          <div class="stat-card" style="background:linear-gradient(135deg,#ea580c,#f97316)"><div class="text-4xl font-bold" id="pausedMembers">0</div><div class="text-lg mt-2">შეჩერებული</div></div>
        </div>
        <div id="expiringSoonSection"><h2 class="text-2xl font-bold text-center mb-6">3 დღეში ვადაგასული</h2><div id="expiringSoonList"></div></div>
      </div>

      <div id="register" class="tab-content">
        <h2 class="text-3xl font-bold mb-8 text-center">ახალი წევრი</h2>
        <form id="registrationForm" class="bg-slate-800 p-8 rounded-2xl">
          <div class="form-grid">
            <input type="text" id="firstName" placeholder="სახელი" class="form-input" required>
            <input type="text" id="lastName" placeholder="გვარი" class="form-input" required>
            <input type="tel" id="phone" placeholder="ტელეფონი" class="form-input">
            <input type="date" id="birthDate" class="form-input">
            <input type="text" id="personalId" placeholder="პირადი ნომერი" class="form-input" required>
            <input type="text" id="note" placeholder="შენიშვნა" class="form-input">
          </div>
          <h3 class="text-xl font-bold mt-10 mb-6 text-center">აბონემენტი</h3>
          <div class="subscription-cards">
            <div class="subscription-card" data-type="12visits" data-price="70">12 ვარჯიში<br><span class="text-2xl font-bold">70₾</span></div>
            <div class="subscription-card" data-type="morning" data-price="90">დილის<br><span class="text-2xl font-bold">90₾</span></div>
            <div class="subscription-card" data-type="unlimited" data-price="110">ულიმიტო<br><span class="text-2xl font-bold">110₾</span></div>
            <div class="subscription-card" data-type="other">სხვა</div>
          </div>
          <div id="customSubscriptionFields" style="display:none" class="form-grid mt-6">
            <input type="text" id="customDescription" placeholder="აღწერა" class="form-input">
            <input type="number" id="customPrice" placeholder="ფასი ₾" class="form-input">
            <input type="number" id="customDuration" placeholder="ვადა (დღე)" class="form-input">
            <input type="number" id="customVisits" placeholder="ვიზიტები (ცარიელი = ულიმიტო)" class="form-input">
          </div>
          <button type="submit" id="registerBtn" class="btn btn-success text-xl px-12 py-4 mt-8 w-full">რეგისტრაცია</button>
        </form>
      </div>

      <div id="search" class="tab-content">
        <h2 class="text-3xl font-bold mb-8 text-center">ძიება</h2>
        <input type="text" id="searchInput" placeholder="სახელი ან პირადი ნომერი..." class="search-input w-full text-xl py-4 mb-6">
        <div id="searchResults"></div>
      </div>

      <div id="checkin" class="tab-content">
        <h2 class="text-3xl font-bold mb-8 text-center">შესვლა სალონში</h2>
        <input type="text" id="checkinSearch" placeholder="სახელი ან პირადი..." class="search-input w-full text-xl py-4">
        <div id="checkinResult" class="mt-8"></div>
      </div>

      <div id="expired" class="tab-content">
        <h2 class="text-3xl font-bold mb-8 text-center">ვადაგასული წევრები</h2>
        <div id="expiredList"></div>
      </div>
    </div>
  </div>
</body>
</html>
