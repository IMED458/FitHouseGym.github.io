<html lang="ka">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Fit House Gym - მენეჯმენტი</title>
  <meta name="description" content="Fit House Gym - წევრთა მართვის სისტემა">
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

    const ADMIN_PASSWORD = "1234"; // ← შეცვალეთ თქვენთვის სასურველი პაროლით

    let isAuthenticated = false;
    window.members = [];
    window.selectedSubscription = null;

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
        <div class="bg-slate-800 p-8 rounded-2xl border-2 border-red-500 max-w-sm w-full">
          <h3 class="text-2xl font-bold text-red-400 mb-4">წაშლის დადასტურება</h3>
          <p class="mb-6">დარწმუნებული ხართ? წაშლა შეუქცევადია!</p>
          <input type="password" id="deletePassword" placeholder="შეიყვანეთ პაროლი" class="form-input mb-6">
          <div class="flex gap-4">
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
      } catch (e) {
        showToast("წაშლა ვერ მოხერხდა", "error");
      }
    };

    function loadMembers() {
      const q = query(collection(db, "members"));
      onSnapshot(q, (snapshot) => {
        window.members = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        updateAll();
      }, err => showToast("Firestore შეცდომა: " + err.message, 'error'));
    }

    async function createMember(m) {
      try { await addDoc(collection(db, "members"), m); showToast("წევრი დარეგისტრირდა!"); }
      catch (e) { showToast("რეგისტრაცია ვერ მოხერხდა", 'error'); }
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
      if (tab === 'search') updateFullMemberList();
    };

    // 3 დღეში ვადაგასული წევრების სია
    window.showExpiringSoon = function() {
      const soon = new Date();
      soon.setDate(soon.getDate() + 3);
      const expiringMembers = window.members.filter(m => 
        m.status === 'active' && 
        new Date(m.subscriptionEndDate) <= soon && 
        new Date(m.subscriptionEndDate) >= new Date()
      ).sort((a, b) => new Date(a.subscriptionEndDate) - new Date(b.subscriptionEndDate));

      const container = document.getElementById('expiringSoonList');
      if (expiringMembers.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-10">3 დღეში ვადაგასული წევრები არ არის</p>';
        return;
      }

      container.innerHTML = expiringMembers.map(m => {
        const daysLeft = Math.ceil((new Date(m.subscriptionEndDate) - new Date()) / 86400000);
        const noteBanner = m.note ? `
          <div class="note-banner">
            <i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${m.note}
          </div>` : '';

        return `
          <div class="member-card">
            ${noteBanner}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div><strong>${m.firstName} ${m.lastName}</strong></div>
              <div><strong>პირადი:</strong> ${m.personalId}</div>
              <div><strong>აბონემენტი:</strong> ${getSubscriptionName(m.subscriptionType)}</div>
              <div><strong>ვადა იწურება:</strong> <span class="text-orange-400 font-bold">${formatDate(m.subscriptionEndDate)} (${daysLeft} დღე)</span></div>
              ${m.remainingVisits != null ? `<div><strong>დარჩენილი ვიზიტები:</strong> ${m.remainingVisits}</div>` : ''}
            </div>
            <div class="mt-4 flex flex-wrap gap-3">
              <button class="btn btn-warning" onclick="renewMembership('${m.id}')">განახლება</button>
              <button class="btn bg-blue-600 hover:bg-blue-700" onclick="showEditForm(event, '${m.id}')">რედაქტირება</button>
            </div>
          </div>`;
      }).join('');
    };

    window.processCheckIn = async function(id) {
      const m = window.members.find(x => x.id === id);
      if (!m || m.status !== 'active') {
        showToast("წევრი არ არის აქტიური", 'error');
        return;
      }
      const now = new Date();
      const end = new Date(m.subscriptionEndDate);
      const hour = now.getHours();
      if (now > end) {
        await updateMember({...m, status: 'expired'});
        showToast("ვადა გასულია!", 'error');
        checkMemberAccess(m);
        return;
      }
      if (m.subscriptionType === 'morning' && (hour < 9 || hour >= 16)) {
        showToast("დილის აბონემენტი: მხოლოდ 09:00–16:00", 'error');
        return;
      }
      let updated = { ...m };
      updated.lastVisit = now.toISOString();
      updated.totalVisits = (updated.totalVisits || 0) + 1;
      if (m.remainingVisits !== null && m.remainingVisits !== undefined) {
        updated.remainingVisits = m.remainingVisits - 1;
        if (updated.remainingVisits <= 0) {
          updated.status = 'expired';
          await updateMember(updated);
          showToast("ვიზიტები ამოიწურა — აბონემენტი დასრულდა", 'warning');
          return;
        }
      }
      await updateMember(updated);
      showToast("შესვლა დაფიქსირდა!");
      document.getElementById('checkinSearch').value = '';
      document.getElementById('checkinResult').innerHTML = '';
    };

    window.checkMemberAccess = async function(member) {
      const now = new Date();
      const end = new Date(member.subscriptionEndDate);
      const hour = now.getHours();
      let allowed = true;
      let msg = 'ნებადართული';
      if (member.status !== 'active') { allowed = false; msg = 'შეჩერებულია'; }
      else if (now > end) { allowed = false; msg = 'ვადა გასულია'; await updateMember({...member, status:'expired'}); }
      else if (member.remainingVisits !== null && member.remainingVisits !== undefined && member.remainingVisits <= 0) {
        allowed = false; msg = 'ვიზიტები ამოწურულია'; await updateMember({...member, status:'expired'}); }
      else if (member.subscriptionType === 'morning' && (hour < 9 || hour >= 16)) { allowed = false; msg = 'მხოლოდ 09:00–16:00'; }

      const noteBanner = member.note ? `
        <div class="note-banner">
          <i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${member.note}
        </div>` : '';

      document.getElementById('checkinResult').innerHTML = `
        <div class="member-card p-6">
          ${noteBanner}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
            <div><strong>პირადი:</strong> ${member.personalId}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(member.subscriptionType)}</div>
            <div><strong>სტატუსი:</strong> <span class="status-badge status-small ${allowed?'status-active':'status-expired'}">${msg}</span></div>
            ${member.remainingVisits != null ? `<div><strong>დარჩენილი ვიზიტები:</strong> ${member.remainingVisits}</div>` : ''}
            <div><strong>ვადა:</strong> ${formatDate(member.subscriptionEndDate)}</div>
            <div><strong>ბოლო ვიზიტი:</strong> ${member.lastVisit ? formatDate(member.lastVisit) : '—'}</div>
            <div><strong>ჯამში:</strong> ${member.totalVisits || 0}</div>
          </div>
          ${allowed ? `<button class="btn btn-success mt-5 w-full text-lg py-3" onclick="processCheckIn('${member.id}')">შესვლის დადასტურება</button>` : ''}
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
      showToast("აბონემენტი განახლდა!");
    };

    window.showEditForm = function(e, id) {
      if (e) e.stopPropagation();
      document.querySelectorAll('.edit-form').forEach(f => f.remove());
      const m = window.members.find(x => x.id === id);
      if (!m) return;
      const div = document.createElement('div');
      div.className = 'edit-form';
      const todayISO = new Date().toISOString().split('T')[0];
      const endDate = m.subscriptionEndDate ? new Date(m.subscriptionEndDate).toISOString().split('T')[0] : todayISO;
      div.innerHTML = `
        <div class="bg-slate-800 dark:bg-slate-900 p-6 rounded-2xl border-2 border-blue-500 mt-6 shadow-2xl">
          <h4 class="text-2xl font-bold mb-5 text-blue-400">რედაქტირება — ${m.firstName} ${m.lastName}</h4>
          <div class="form-grid">
            <div><label class="block text-sm font-semibold mb-1 text-gray-300">სახელი</label><input type="text" value="${m.firstName}" id="e_fn_${id}" class="form-input"></div>
            <div><label class="block text-sm font-semibold mb-1 text-gray-300">გვარი</label><input type="text" value="${m.lastName}" id="e_ln_${id}" class="form-input"></div>
            <div><label class="block text-sm font-semibold mb-1 text-gray-300">ტელეფონი</label><input type="tel" value="${m.phone}" id="e_ph_${id}" class="form-input"></div>
            <div><label class="block text-sm font-semibold mb-1 text-gray-300">პირადი ნომერი</label><input type="text" value="${m.personalId}" id="e_pid_${id}" class="form-input"></div>
          </div>
          <div class="mt-6">
            <label class="block text-sm font-semibold mb-1 text-red-400">შენიშვნა </label>
            <textarea id="e_note_${id}" class="form-input h-24 resize-none">${m.note || ''}</textarea>
          </div>
          <div class="form-grid mt-6">
            <div>
              <label class="block text-sm font-semibold mb-1 text-gray-300">აბონემენტის ტიპი</label>
              <select id="e_subtype_${id}" class="form-input text-lg" onchange="autoFillSubscription('${id}')">
                <option value="12visits" ${m.subscriptionType==='12visits'?'selected':''}>12 ვარჯიში (70₾)</option>
                <option value="morning" ${m.subscriptionType==='morning'?'selected':''}>დილის (90₾)</option>
                <option value="unlimited" ${m.subscriptionType==='unlimited'?'selected':''}>ულიმიტო (110₾)</option>
                <option value="other" ${!['12visits','morning','unlimited'].includes(m.subscriptionType)?'selected':''}>სხვა</option>
              </select>
            </div>
            <div><label class="block text-sm font-semibold mb-1 text-gray-300">ფასი (₾)</label><input type="number" value="${m.subscriptionPrice||0}" id="e_price_${id}" class="form-input"></div>
            <div><label class="block text-sm font-semibold mb-1 text-gray-300">ვადის გასვლა</label><input type="date" value="${endDate}" id="e_enddate_${id}" class="form-input"></div>
            <div><label class="block text-sm font-semibold mb-1 text-gray-300">დარჩენილი ვიზიტები</label><input type="number" value="${m.remainingVisits == null ? '' : m.remainingVisits}" id="e_visits_${id}" class="form-input" placeholder="ცარიელი = ულიმიტო"></div>
            <div>
              <label class="block text-sm font-semibold mb-1 text-gray-300">სტატუსი</label>
              <select id="e_status_${id}" class="form-input">
                <option value="active" ${m.status==='active'?'selected':''}>აქტიური</option>
                <option value="expired" ${m.status==='expired'?'selected':''}>ვადაგასული</option>
                <option value="paused" ${m.status==='paused'?'selected':''}>შეჩერებული</option>
              </select>
            </div>
          </div>
          <div class="mt-6 flex gap-4">
            <button class="btn btn-success text-lg px-8 py-3" onclick="saveEdit('${id}')">შენახვა</button>
            <button class="btn bg-red-600 hover:bg-red-700 text-lg px-8 py-3" onclick="this.closest('.edit-form').remove()">გაუქმება</button>
          </div>
        </div>`;
      const card = e ? e.target.closest('.member-card') : document.querySelector(`[data-id="${id}"]`)?.closest('.member-card');
      if (card) card.appendChild(div);
      autoFillSubscription(id);
    };

    window.autoFillSubscription = function(id) {
      const type = document.getElementById(`e_subtype_${id}`).value;
      const today = new Date();
      let end = new Date();
      if (type === '12visits') {
        document.getElementById(`e_price_${id}`).value = 70;
        document.getElementById(`e_visits_${id}`).value = 12;
        end.setDate(today.getDate() + 30);
      } else if (type === 'morning') {
        document.getElementById(`e_price_${id}`).value = 90;
        document.getElementById(`e_visits_${id}`).value = '';
        end.setDate(today.getDate() + 30);
      } else if (type === 'unlimited') {
        document.getElementById(`e_price_${id}`).value = 110;
        document.getElementById(`e_visits_${id}`).value = '';
        end.setDate(today.getDate() + 30);
      }
      document.getElementById(`e_enddate_${id}`).value = end.toISOString().split('T')[0];
    };

    window.saveEdit = async function(id) {
      const m = window.members.find(x => x.id === id);
      if (!m) return;
      const endDateInput = document.getElementById(`e_enddate_${id}`).value;
      if (!endDateInput) { showToast("ვადა სავალდებულოა!", 'error'); return; }
      const updated = {
        ...m,
        firstName: document.getElementById(`e_fn_${id}`).value.trim(),
        lastName: document.getElementById(`e_ln_${id}`).value.trim(),
        phone: document.getElementById(`e_ph_${id}`).value.trim(),
        personalId: document.getElementById(`e_pid_${id}`).value.trim(),
        note: document.getElementById(`e_note_${id}`).value.trim() || null,
        subscriptionType: document.getElementById(`e_subtype_${id}`).value,
        subscriptionPrice: parseFloat(document.getElementById(`e_price_${id}`).value) || 0,
        subscriptionEndDate: new Date(endDateInput + 'T00:00:00').toISOString(),
        remainingVisits: document.getElementById(`e_visits_${id}`).value === '' ? null : parseInt(document.getElementById(`e_visits_${id}`).value),
        status: document.getElementById(`e_status_${id}`).value
      };
      await updateMember(updated);
      showToast("ცვლილებები შენახულია!");
      document.querySelectorAll('.edit-form').forEach(f => f.remove());
    };

    window.exportToExcel = function() {
      const data = window.members.map(m => ({
        "სახელი": m.firstName,
        "გვარი": m.lastName,
        "პირადი": m.personalId,
        "ტელეფონი": m.phone,
        "აბონემენტი": getSubscriptionName(m.subscriptionType),
        "ფასი": m.subscriptionPrice + "₾",
        "დასრულება": formatDate(m.subscriptionEndDate),
        "სტატუსი": getStatusText(m.status),
        "დარჩენილი ვიზიტები": m.remainingVisits != null ? m.remainingVisits : "ულიმიტო",
        "შენიშვნა": m.note || "",
        "ბოლო ვიზიტი": m.lastVisit ? formatDate(m.lastVisit) : "—"
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, "წევრები");
      XLSX.writeFile(wb, `FitHouse_წევრები_${new Date().toISOString().slice(0,10)}.xlsx`);
      showToast("Excel ფაილი ჩამოიტვირთა!");
    };

    function updateAll() {
      updateDashboard();
      updateExpiredList();
      updateFullMemberList();
      showExpiringSoon();
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

      document.getElementById('expiringMembersCard').onclick = function() {
        document.getElementById('expiringSoonSection').style.display = 'block';
        document.getElementById('dashboard').scrollIntoView({ behavior: 'smooth' });
        showExpiringSoon();
      };
    }

    function updateExpiredList() {
      const list = window.members.filter(m => m.status === 'expired');
      document.getElementById('expiredList').innerHTML = list.length === 0 ? '<p class="text-gray-500 text-center py-10">ვადაგასული წევრები არ არის</p>' : list.map(m => {
        const over = Math.floor((new Date() - new Date(m.subscriptionEndDate)) / 86400000);
        const reason = (m.remainingVisits != null && m.remainingVisits <= 0) ? 'ვიზიტები ამოწურულია' : `ვადა გასულია ${over} დღით`;
        const noteBanner = m.note ? `<div class="note-banner"><i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${m.note}</div>` : '';
        return `<div class="member-card">
          ${noteBanner}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div><strong>${m.firstName} ${m.lastName}</strong></div>
            <div><strong>პირადი:</strong> ${m.personalId}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(m.subscriptionType)}</div>
            <div><strong>მიზეზი:</strong> <span class="text-red-400 font-bold">${reason}</span></div>
          </div>
          <div class="mt-4 flex flex-wrap gap-3">
            <button class="btn btn-warning" onclick="renewMembership('${m.id}')">განახლება</button>
            <button class="btn bg-blue-600 hover:bg-blue-700" onclick="showEditForm(event, '${m.id}')">რედაქტირება</button>
            <button class="btn bg-red-600 hover:bg-red-700" onclick="deleteMember('${m.id}')">წაშლა</button>
          </div>
        </div>`;
      }).join('');
    }

    function updateFullMemberList() {
      const container = document.getElementById('searchResults');
      const searchValue = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
      let filtered = window.members;
      if (searchValue) {
        filtered = window.members.filter(m =>
          m.personalId.includes(searchValue) ||
          (m.firstName + ' ' + m.lastName).toLowerCase().includes(searchValue)
        );
      }
      container.innerHTML = filtered.length === 0 ? `<p class="text-center py-10 text-gray-500">${searchValue ? 'ვერ მოიძებნა' : 'ჯერ არ არის წევრები'}</p>` : filtered.map(m => {
        const noteBanner = m.note ? `<div class="note-banner"><i class="fas fa-exclamation-triangle"></i> <strong>შენიშვნა:</strong> ${m.note}</div>` : '';
        return `
        <div class="member-card">
          ${noteBanner}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div><strong>${m.firstName} ${m.lastName}</strong></div>
            <div><strong>პირადი:</strong> ${m.personalId}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(m.subscriptionType)}</div>
            <div><strong>დარჩენილი დღეები:</strong> ${Math.max(0, Math.ceil((new Date(m.subscriptionEndDate) - new Date()) / 86400000))}</div>
            <div><strong>სტატუსი:</strong> <span class="status-badge status-small ${getStatusClass(m.status)}">${getStatusText(m.status)}</span></div>
            ${m.remainingVisits != null ? `<div><strong>დარჩენილი ვიზიტები:</strong> ${m.remainingVisits}</div>` : ''}
          </div>
          <div class="mt-4 flex flex-wrap gap-3">
            <button class="btn btn-warning" onclick="renewMembership('${m.id}')">განახლება</button>
            <button class="btn bg-blue-600 hover:bg-blue-700" onclick="showEditForm(event, '${m.id}')">რედაქტირება</button>
            <button class="btn bg-red-600 hover:bg-red-700" onclick="deleteMember('${m.id}')">წაშლა</button>
          </div>
        </div>`;
      }).join('');
    }

    function searchAndCheckAccess(term) {
      if (!term || term.trim() === '') {
        document.getElementById('checkinResult').innerHTML = '';
        return;
      }
      const matches = window.members.filter(m =>
        m.personalId.includes(term) ||
        (m.firstName + ' ' + m.lastName).toLowerCase().includes(term.toLowerCase())
      );
      const el = document.getElementById('checkinResult');
      if (matches.length === 0) el.innerHTML = '<div class="member-card text-red-500 font-bold text-center py-10">ვერ მოიძებნა</div>';
      else if (matches.length === 1) checkMemberAccess(matches[0]);
      else el.innerHTML = `<div class="member-card"><h3 class="font-bold mb-4">აირჩიეთ წევრი:</h3>${matches.map(m=>`<div class="p-4 border border-gray-600 rounded-lg mb-3 cursor-pointer hover:bg-gray-700" onclick="checkMemberAccess(window.members.find(x=>x.id==='${m.id}'))"><strong>${m.firstName} ${m.lastName}</strong> — ${m.personalId}</div>`).join('')}</div>`;
    }

    function getSubscriptionName(t) { const map = {'12visits':'12 ვარჯიში','morning':'დილის','unlimited':'ულიმიტო','other':'სხვა'}; return map[t] || t; }
    function getStatusClass(s) { return {active:'status-active',expired:'status-expired',paused:'status-paused'}[s] || 'status-expired'; }
    function getStatusText(s) { return {active:'აქტიური',expired:'ვადაგასული',paused:'შეჩერებული'}[s] || s; }
    function formatDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('ka-GE'); }

    function showToast(msg, type='success') {
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      t.innerHTML = `${msg}`;
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
        const btn = document.getElementById('registerBtn');
        btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> მიმდინარეობს...';
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
          btn.disabled = false;
          btn.innerHTML = 'რეგისტრაცია';
        }
      });

      document.getElementById('searchInput')?.addEventListener('input', updateFullMemberList);
      document.getElementById('checkinSearch')?.addEventListener('input', e => {
        const v = e.target.value.trim();
        if (v.length >= 2) searchAndCheckAccess(v);
        else document.getElementById('checkinResult').innerHTML = '';
      });
    });
  </script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <style>
    :root { --bg: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #334155 100%); --card-bg: #1e293b; --text: #f1f5f9; --text-light: #cbd5e1; --accent: #60a5fa; --accent-hover: #3b82f6; --success: #10b981; --warning: #f59e0b; --danger: #ef4444; --border: #334155; --shadow: rgba(0,0,0,0.5); }
    body.light-mode { --bg: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); --card-bg: #ffffff; --text: #1e293b; --text-light: #475569; --accent: #3b82f6; --accent-hover: #2563eb; --border: #e2e8f0; --shadow: rgba(0,0,0,0.1); }
    body { margin:0; padding:0; font-family:'Segoe UI',sans-serif; background:var(--bg); color:var(--text); min-height:100vh; transition:all 0.4s ease; }
    .container { max-width:1280px; margin:0 auto; padding:20px; }
    .theme-toggle { position:fixed; top:20px; right:20px; z-index:1000; width:64px; height:64px; border-radius:50%; background:var(--card-bg); border:3px solid var(--border); box-shadow:0 8px 30px var(--shadow); display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:28px; color:#fbbf24; transition:all 0.4s; }
    .theme-toggle:hover { transform:scale(1.2) rotate(360deg); }
    .header { background:rgba(30,41,59,0.95); backdrop-filter:blur(12px); border-radius:24px; padding:30px; margin-bottom:30px; text-align:center; box-shadow:0 20px 50px var(--shadow); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; gap:20px; }
    .light-mode .header { background:rgba(255,255,255,0.95); }
    .logo { height:100px; border-radius:20px; box-shadow:0 10px 30px var(--shadow); object-fit:contain; }
    .gym-title { font-size:3.5rem; font-weight:900; background:linear-gradient(to right,#60a5fa,#c084fc); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin:0; }
    .nav-tabs { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 30px; justify-content: center; padding: 10px 0; }
    .nav-tab { background:var(--card-bg); border:1px solid var(--border); color:var(--text-light); padding: 14px 22px; border-radius: 16px; cursor: pointer; font-weight: 600; white-space: nowrap; transition: all 0.3s; box-shadow: 0 6px 20px var(--shadow); min-width: 130px; text-align: center; }
    .nav-tab:hover { background:var(--accent); color:white; transform:translateY(-4px); }
    .nav-tab.active { background:var(--accent); color:white; box-shadow:0 10px 30px rgba(59,130,246,0.6); }
    .tab-content { display:none; background:var(--card-bg); border:1px solid var(--border); border-radius:24px; padding:40px; box-shadow:0 20px 60px var(--shadow); }
    .tab-content.active { display:block; }
    .form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:20px; }
    .form-input, .search-input { width:100%; padding:16px 20px; background:#334155; border:1px solid var(--border); border-radius:16px; color:white; font-size:16px; transition:all 0.3s; }
    .light-mode .form-input, .light-mode .search-input { background:#f8fafc; color:#1e293b; }
    .form-input:focus, .search-input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 4px rgba(59,130,246,0.3); }
    .btn { background:var(--accent); color:white; border:none; padding:14px 24px; border-radius:16px; cursor:pointer; font-weight:600; transition:all 0.3s; box-shadow:0 8px 25px rgba(59,130,246,0.4); white-space:nowrap; }
    .btn:hover { background:var(--accent-hover); transform:translateY(-3px); }
    .btn-success { background:var(--success); box-shadow:0 8px 25px rgba(16,185,129,0.4); }
    .btn-warning { background:var(--warning); box-shadow:0 8px 25px rgba(245,158,11,0.4); }
    .subscription-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin: 30px 0; }
    .subscription-card { background:linear-gradient(135deg,#1e40af,#7c3aed); color:white; padding: 24px 16px; border-radius: 20px; text-align:center; cursor:pointer; transition:all 0.4s; border:4px solid transparent; box-shadow:0 12px 30px rgba(0,0,0,0.4); }
    .subscription-card:hover { transform:translateY(-8px) scale(1.03); }
    .subscription-card.selected { border-color:#fbbf24; box-shadow:0 0 35px rgba(251,191,36,0.7); }
    .member-card { background:var(--card-bg); border:1px solid var(--border); border-radius:20px; padding:28px; margin-bottom:24px; box-shadow:0 10px 30px var(--shadow); transition:all 0.3s; }
    .member-card:hover { transform:translateY(-4px); box-shadow:0 15px 40px var(--shadow); }
    .status-badge { padding:4px 10px; border-radius:12px; font-size:0.75rem; font-weight:700; }
    .status-active { background:#065f46; color:#6ee7b7; }
    .status-expired { background:#7f1d1d; color:#fca5a5; }
    .status-paused { background:#78350f; color:#fdba74; }
    .status-small { font-size:0.7rem; padding:3px 8px; }
    .dashboard-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:24px; margin-bottom:40px; }
    .stat-card { background:linear-gradient(135deg,#1e40af,#3b82f6); padding:32px; border-radius:24px; text-align:center; box-shadow:0 15px 40px rgba(59,130,246,0.5); color:white; transition:transform 0.3s; cursor:default; }
    .stat-card:hover { transform:scale(1.05); }
    #expiringMembersCard { background:linear-gradient(135deg,#ea580c,#f97316); cursor:pointer !important; }
    .toast { position:fixed; top:20px; right:20px; background:#10b981; color:white; padding:16px 28px; border-radius:16px; box-shadow:0 10px 30px var(--shadow); z-index:1000; transform:translateX(400px); transition:transform 0.4s; font-weight:600; }
    .toast.show { transform:translateX(0); }
    .toast.error { background:#ef4444; }
    .toast.warning { background:#f59e0b; color:#000; }
    .spinner { border:4px solid #f3f3f3; border-top:4px solid white; border-radius:50%; width:28px; height:28px; animation:spin 1s linear infinite; margin:0 auto; }
    @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }

    /* წითელი შენიშვნის ბანერი */
    .note-banner {
      background: linear-gradient(135deg, #7f1d1d, #991b1b);
      color: #ff6b6b;
      padding: 16px 20px;
      border-radius: 16px;
      font-weight: bold;
      font-size: 1.15rem;
      text-align: center;
      margin-bottom: 24px;
      border: 3px solid #ef4444;
      box-shadow: 0 10px 30px rgba(239, 68, 68, 0.5);
      animation: pulse 2.5s infinite;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 10px 30px rgba(239, 68, 68, 0.5); }
      50% { box-shadow: 0 10px 50px rgba(239, 68, 68, 0.8); }
    }

    #loginScreen { position: fixed; inset: 0; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); display: flex; align-items: center; justify-content: center; z-index: 9999; flex-direction: column; }
    .login-box { background: rgba(30,41,59,0.95); padding: 60px 80px; border-radius: 32px; text-align: center; box-shadow: 0 30px 80px rgba(0,0,0,0.8); border: 1px solid #334155; max-width: 500px; }
    .login-box img { height: 120px; margin-bottom: 30px; }
    .login-box h1 { font-size: 4rem; background: linear-gradient(to right,#60a5fa,#c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 40px; }
    #adminPassword { width: 100%; padding: 20px; font-size: 1.5rem; text-align: center; letter-spacing: 8px; background: #334155; border: 2px solid #475569; border-radius: 20px; color: white; margin-bottom: 30px; }
    #adminPassword:focus { border-color: #60a5fa; box-shadow: 0 0 0 4px rgba(96,165,250,0.3); }

    #expiringSoonSection { background:var(--card-bg); border:2px solid #f59e0b; border-radius:24px; padding:30px; margin-top:40px; display:none; }
    #expiringSoonSection h2 { color:#f59e0b; text-align:center; margin-bottom:20px; font-size:2.2rem; }

    @media (max-width:768px) {
      .gym-title {font-size:2.5rem}
      .header {flex-direction:column}
      .login-box { padding: 40px; width: 90%; }
      .login-box h1 { font-size: 3rem; }
      .note-banner { font-size: 1rem; padding: 14px; }
    }
  </style>
</head>
<body>

  <div id="loginScreen">
    <div class="login-box">
      <img src="fithause logo.png" alt="Fit House Gym" class="logo" onerror="this.style.display='none'">
      <h1>Fit House Gym</h1>
      <input type="password" id="adminPassword" placeholder="••••••" autocomplete="off">
      <button class="btn btn-success text-2xl px-12 py-5" onclick="login()">შესვლა</button>
    </div>
  </div>

  <div id="mainApp" style="display:none">
    <div class="theme-toggle" onclick="toggleTheme()">
      <i class="fas fa-sun"></i>
    </div>
    <div class="container">
      <div class="header">
        <img src="fithause logo.png" alt="Fit House Gym" class="logo" onerror="this.style.display='none'">
        <h1 class="gym-title">Fit House Gym</h1>
      </div>
      <div class="nav-tabs">
        <button class="nav-tab active" onclick="showTab('dashboard')">დეშბორდი</button>
        <button class="nav-tab" onclick="showTab('register')">რეგისტრაცია</button>
        <button class="nav-tab" onclick="showTab('search')">ძიება</button>
        <button class="nav-tab" onclick="showTab('checkin')">შესვლა</button>
        <button class="nav-tab" onclick="showTab('expired')">ვადაგასული</button>
        <button class="nav-tab bg-green-600 hover:bg-green-700" onclick="exportToExcel()">Excel ექსპორტი</button>
      </div>

      <div id="dashboard" class="tab-content active">
        <h2 class="text-3xl font-bold mb-8">დეშბორდი</h2>
        <div class="dashboard-stats">
          <div class="stat-card"><div class="text-5xl font-bold" id="todayVisits">0</div><div class="text-xl mt-3">დღევანდელი ვიზიტები</div></div>
          <div class="stat-card"><div class="text-5xl font-bold" id="activeMembers">0</div><div class="text-xl mt-3">აქტიური წევრები</div></div>
          <div class="stat-card"><div class="text-5xl font-bold" id="expiredMembers">0</div><div class="text-xl mt-3">ვადაგასული</div></div>
          <div class="stat-card" id="expiringMembersCard">
            <div class="text-5xl font-bold" id="expiringMembers">0</div>
            <div class="text-xl mt-3">3 დღეში ვადაგასული</div>
          </div>
          <div class="stat-card" style="background:linear-gradient(135deg,#ea580c,#f97316)"><div class="text-5xl font-bold" id="pausedMembers">0</div><div class="text-xl mt-3">შეჩერებული</div></div>
        </div>

        <div id="expiringSoonSection">
          <h2 class="text-3xl font-bold">3 დღეში ან ნაკლებში ვადაგასული წევრები</h2>
          <div id="expiringSoonList" class="mt-8"></div>
        </div>
      </div>

      <!-- დანარჩენი ტაბები უცვლელი -->
      <div id="register" class="tab-content">
        <h2 class="text-3xl font-bold mb-8">ახალი წევრის რეგისტრაცია</h2>
        <form id="registrationForm">
          <div class="form-grid">
            <input type="text" id="firstName" class="form-input" placeholder="სახელი *" required>
            <input type="text" id="lastName" class="form-input" placeholder="გვარი *" required>
            <input type="tel" id="phone" class="form-input" placeholder="ტელეფონი *" required>
            <input type="date" id="birthDate" class="form-input" required>
            <input type="text" id="personalId" class="form-input" placeholder="პირადი ნომერი *" required>
          </div>
          <div class="mt-6">
            <label class="block text-sm font-semibold mb-1 text-red-400">შენიშვნა</label>
            <textarea id="note" class="form-input h-32 resize-none" placeholder="მაგ: არასრულწლოვანი, სიფრთხილე..."></textarea>
          </div>
          <h3 class="text-2xl font-bold my-8">აირჩიეთ აბონემენტი</h3>
          <div class="subscription-cards">
            <div class="subscription-card" data-type="12visits" data-price="70">
              <div class="text-2xl font-bold">12 ვარჯიში</div>
              <div class="text-5xl font-bold my-4">70₾</div>
              <div class="text-lg">30 დღე</div>
            </div>
            <div class="subscription-card" data-type="morning" data-price="90">
              <div class="text-2xl font-bold">დილის</div>
              <div class="text-5xl font-bold my-4">90₾</div>
              <div class="text-lg">09:00–16:00</div>
            </div>
            <div class="subscription-card" data-type="unlimited" data-price="110">
              <div class="text-2xl font-bold">ულიმიტო</div>
              <div class="text-5xl font-bold my-4">110₾</div>
              <div class="text-lg">30 დღე</div>
            </div>
            <div class="subscription-card" data-type="other" data-price="0">
              <div class="text-2xl font-bold">სხვა</div>
              <div class="text-5xl font-bold my-4">თავისუფალი</div>
            </div>
          </div>
          <div id="customSubscriptionFields" class="bg-slate-800 p-6 rounded-2xl" style="display:none">
            <div class="form-grid">
              <input type="number" id="customPrice" class="form-input" placeholder="ფასი ₾ *">
              <input type="number" id="customDuration" class="form-input" placeholder="ვადა (დღე) *">
              <input type="number" id="customVisits" class="form-input" placeholder="ვიზიტები (ცარიელი = ულიმიტო)">
              <input type="text" id="customDescription" class="form-input" placeholder="აღწერა">
            </div>
          </div>
          <button type="submit" id="registerBtn" class="btn btn-success text-2xl px-12 py-5 mt-8">რეგისტრაცია</button>
        </form>
      </div>

      <div id="search" class="tab-content">
        <h2 class="text-3xl font-bold mb-8">წევრების ძიება</h2>
        <input type="text" id="searchInput" class="search-input text-xl" placeholder="ძიება პირადით ან სახელ-გვარით...">
        <div id="searchResults" class="mt-8"></div>
      </div>

      <div id="checkin" class="tab-content">
        <h2 class="text-3xl font-bold mb-8">შესვლა</h2>
        <input type="text" id="checkinSearch" class="search-input text-xl" placeholder="ძიება პირადით ან სახელ-გვარით...">
        <div id="checkinResult" class="mt-8"></div>
      </div>

      <div id="expired" class="tab-content">
        <h2 class="text-3xl font-bold mb-8">ვადაგასული წევრები</h2>
        <div id="expiredList" class="mt-8"></div>
      </div>
    </div>
  </div>
</body>
</html>
