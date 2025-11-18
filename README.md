<!DOCTYPE html>
<html lang="ka">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Fit House Gym</title>

  <!-- Firebase v9+ Modular -->
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

    window.members = [];
    window.selectedSubscription = null;

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

    async function deleteMember(id) {
      if (!confirm("დარწმუნებული ხართ? წაშლა შეუქცევადია!")) return;
      try {
        await deleteDoc(doc(db, "members", id));
        showToast("წევრი წაიშალა!");
      } catch (e) {
        showToast("წაშლა ვერ მოხერხდა", 'error');
      }
    }
    window.deleteMember = deleteMember;

    window.showTab = function(tab) {
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.getElementById(tab).classList.add('active');
      document.querySelector(`[onclick="showTab('${tab}')"]`).classList.add('active');
      if (tab === 'search') updateFullMemberList();
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
        updated.remainingVisits = (m.remainingVisits || 0) - 1;
        if (updated.remainingVisits <= 0) {
          updated.status = 'expired';
          await updateMember(updated);
          showToast("ვიზიტები ამოიწურა — აბონემენტი დასრულდა", 'warning');
          checkMemberAccess(updated);
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

      document.getElementById('checkinResult').innerHTML = `
        <div class="member-card">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
            <div><strong>პირადი:</strong> ${member.personalId}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(member.subscriptionType)}</div>
            <div><strong>სტატუსი:</strong> <span class="status-badge ${allowed?'status-active':'status-expired'}">${msg}</span></div>
            ${member.remainingVisits != null ? `<div><strong>დარჩენილი ვიზიტები:</strong> ${member.remainingVisits}</div>` : ''}
            <div><strong>ვადა:</strong> ${formatDate(member.subscriptionEndDate)}</div>
            <div><strong>ბოლო ვიზიტი:</strong> ${member.lastVisit ? formatDate(member.lastVisit) : '—'}</div>
            <div><strong>ჯამში:</strong> ${member.totalVisits || 0}</div>
          </div>
          ${allowed ? `<button class="btn btn-success mt-4 w-full" onclick="processCheckIn('${member.id}')">შესვლის დადასტურება</button>` : ''}
        </div>`;
    };

    window.renewMembership = async function(id) {
      const m = window.members.find(x => x.id === id);
      if (!m) return;
      const start = new Date(), end = new Date();
      let visits = null;
      if (m.subscriptionType === '12visits') { end.setDate(start.getDate() + 30); visits = 12; }
      else if (m.subscriptionType === 'morning') end.setDate(start.getDate() + 30);
      else if (m.subscriptionType === 'unlimited') end.setDate(start.getDate() + 60);
      else if (m.remainingVisits !== null) { end.setDate(start.getDate() + 30); visits = m.remainingVisits > 0 ? m.remainingVisits : 10; }

      await updateMember({ ...m, subscriptionEndDate: end.toISOString(), remainingVisits: visits, status: 'active' });
      showToast("აბონემენტი განახლდა!");
    };

    window.showEditForm = function(e, id) {
      if (e) e.stopPropagation();
      const m = window.members.find(x => x.id === id);
      if (!m) return;
      const div = document.createElement('div');
      div.id = `edit_${id}`;
      div.className = 'edit-form';
      const todayISO = new Date().toISOString().split('T')[0];
      const endDate = m.subscriptionEndDate ? new Date(m.subscriptionEndDate).toISOString().split('T')[0] : todayISO;

      div.innerHTML = `
        <h4 class="font-bold mb-4">რედაქტირება</h4>
        <div class="form-grid">
          <input type="text" value="${m.firstName}" id="e_fn_${id}" class="form-input" placeholder="სახელი">
          <input type="text" value="${m.lastName}" id="e_ln_${id}" class="form-input" placeholder="გვარი">
          <input type="tel" value="${m.phone}" id="e_ph_${id}" class="form-input" placeholder="ტელეფონი">
          <input type="text" value="${m.personalId}" id="e_pid_${id}" class="form-input" placeholder="პირადი">
          <input type="email" value="${m.email||''}" id="e_em_${id}" class="form-input" placeholder="ელ.ფოსტა">
          <input type="date" value="${m.birthDate||''}" id="e_bd_${id}" class="form-input">
        </div>
        <div class="form-grid mt-4">
          <select id="e_subtype_${id}" class="form-input">
            <option value="12visits" ${m.subscriptionType==='12visits'?'selected':''}>12 ვარჯიში</option>
            <option value="morning" ${m.subscriptionType==='morning'?'selected':''}>დილის</option>
            <option value="unlimited" ${m.subscriptionType==='unlimited'?'selected':''}>ულიმიტო</option>
            <option value="other" ${!['12visits','morning','unlimited'].includes(m.subscriptionType)?'selected':''}>სხვა</option>
          </select>
          <input type="number" value="${m.subscriptionPrice||0}" id="e_price_${id}" class="form-input" placeholder="ფასი ₾">
          <input type="date" value="${endDate}" id="e_enddate_${id}" class="form-input">
          <input type="number" value="${m.remainingVisits == null ? '' : m.remainingVisits}" id="e_visits_${id}" class="form-input" placeholder="დარჩენილი ვიზიტები">
          <select id="e_status_${id}" class="form-input">
            <option value="active" ${m.status==='active'?'selected':''}>აქტიური</option>
            <option value="expired" ${m.status==='expired'?'selected':''}>ვადაგასული</option>
            <option value="paused" ${m.status==='paused'?'selected':''}>შეჩერებული</option>
          </select>
        </div>
        <div class="mt-4 flex gap-3">
          <button class="btn btn-success" onclick="saveEdit('${id}')">შენახვა</button>
          <button class="btn" style="background:#e53e3e" onclick="document.getElementById('edit_${id}').remove()">გაუქმება</button>
        </div>`;
      e ? e.target.closest('.member-card').appendChild(div) : document.querySelector(`[onclick*="${id}"]`).closest('.member-card').appendChild(div);
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
        email: document.getElementById(`e_em_${id}`).value.trim(),
        birthDate: document.getElementById(`e_bd_${id}`).value || null,
        subscriptionType: document.getElementById(`e_subtype_${id}`).value,
        subscriptionPrice: parseFloat(document.getElementById(`e_price_${id}`).value) || 0,
        subscriptionEndDate: new Date(endDateInput + 'T00:00:00').toISOString(),
        remainingVisits: document.getElementById(`e_visits_${id}`).value === '' ? null : parseInt(document.getElementById(`e_visits_${id}`).value),
        status: document.getElementById(`e_status_${id}`).value
      };
      await updateMember(updated);
      showToast("ცვლილებები შენახულია!");
      document.getElementById(`edit_${id}`).remove();
    };

    window.exportToExcel = function() {
      const data = window.members.map(m => ({
        "სახელი": m.firstName,
        "გვარი": m.lastName,
        "პირადი": m.personalId,
        "აბონემენტი": getSubscriptionName(m.subscriptionType),
        "ფასი": m.subscriptionPrice + "₾",
        "დასრულება": formatDate(m.subscriptionEndDate),
        "სტატუსი": getStatusText(m.status),
        "დარჩენილი ვიზიტები": m.remainingVisits != null ? m.remainingVisits : "ულიმიტო",
        "ჯამური ვიზიტები": m.totalVisits || 0,
        "ბოლო ვიზიტი": m.lastVisit ? formatDate(m.lastVisit) : "—"
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, "წევრები");
      XLSX.writeFile(wb, `Gym_წევრები_${new Date().toISOString().slice(0,10)}.xlsx`);
      showToast("Excel ჩამოიტვირთა!");
    };

    function updateAll() {
      updateDashboard();
      updateExpiredList();
      updateFullMemberList();
    }

    function updateDashboard() {
      const today = new Date().toDateString();
      const todayVisits = window.members.filter(m => m.lastVisit && new Date(m.lastVisit).toDateString() === today).length;
      const active = window.members.filter(m => m.status === 'active').length;
      const expired = window.members.filter(m => ['expired','blocked'].includes(m.status)).length;
      const paused = window.members.filter(m => m.status === 'paused').length;
      const soon = new Date(); soon.setDate(soon.getDate() + 3);
      const expiring = window.members.filter(m => m.status === 'active' && new Date(m.subscriptionEndDate) <= soon && new Date(m.subscriptionEndDate) > new Date()).length;

      document.getElementById('todayVisits').textContent = todayVisits;
      document.getElementById('activeMembers').textContent = active;
      document.getElementById('expiredMembers').textContent = expired;
      document.getElementById('expiringMembers').textContent = expiring;
      document.getElementById('pausedMembers').textContent = paused;

      document.getElementById('expiringList').innerHTML = expiring ? 
        `<h3 class="mt-6 text-xl font-bold">3 დღეში ვადაგასული:</h3>` + 
        window.members.filter(m=>m.status==='active' && new Date(m.subscriptionEndDate)<=soon && new Date(m.subscriptionEndDate)>new Date())
          .map(m=>`<div class="member-card p-3 mb-2"><strong>${m.firstName} ${m.lastName}</strong> — ${formatDate(m.subscriptionEndDate)}</div>`).join('')
        : '';
    }

    function updateExpiredList() {
      const list = window.members.filter(m => m.status === 'expired');
      document.getElementById('expiredList').innerHTML = list.length === 0 ? '<p class="text-gray-500">ვადაგასული არ არის</p>' : list.map(m => {
        const over = Math.floor((new Date() - new Date(m.subscriptionEndDate)) / 86400000);
        const reason = (m.remainingVisits != null && m.remainingVisits <= 0) ? 'ვიზიტები ამოწურულია' : `ვადა გასულია ${over} დღით`;
        return `<div class="member-card">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div><strong>${m.firstName} ${m.lastName}</strong></div>
            <div><strong>პირადი:</strong> ${m.personalId}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(m.subscriptionType)}</div>
            <div><strong>მიზეზი:</strong> ${reason}</div>
          </div>
          <div class="mt-4 flex gap-3 flex-wrap">
            <button class="btn btn-warning" onclick="renewMembership('${m.id}')">განახლება</button>
            <button class="btn" onclick="showEditForm(event, '${m.id}')" style="background:#3b82f6">რედაქტირება</button>
            <button class="btn" onclick="deleteMember('${m.id}')" style="background:#ef4444">წაშლა</button>
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
      container.innerHTML = filtered.length === 0 ? (searchValue ? '<p class="text-red-500">ვერ მოიძებნა</p>' : '<p class="text-gray-500">ჯერ არ არის წევრები</p>') : filtered.map(m => `
        <div class="member-card">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div><strong>სახელი:</strong> ${m.firstName} ${m.lastName}</div>
            <div><strong>პირადი:</strong> ${m.personalId}</div>
            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(m.subscriptionType)}</div>
            <div><strong>დარჩენილი დღეები:</strong> ${Math.max(0, Math.ceil((new Date(m.subscriptionEndDate) - new Date()) / 86400000))}</div>
            <div><strong>სტატუსი:</strong> <span class="status-badge ${getStatusClass(m.status)}">${getStatusText(m.status)}</span></div>
            ${m.remainingVisits != null ? `<div><strong>დარჩენილი ვიზიტები:</strong> ${m.remainingVisits}</div>` : ''}
            <div><strong>ჯამური ვიზიტები:</strong> ${m.totalVisits || 0}</div>
          </div>
          <div class="mt-4 flex gap-3 flex-wrap">
            <button class="btn btn-warning" onclick="renewMembership('${m.id}')">განახლება</button>
            <button class="btn" onclick="showEditForm(event, '${m.id}')" style="background:#3b82f6">რედაქტირება</button>
            <button class="btn" onclick="deleteMember('${m.id}')" style="background:#ef4444">წაშლა</button>
          </div>
        </div>`).join('');
    }

    async function searchAndCheckAccess(term) {
      const matches = window.members.filter(m => m.personalId.includes(term) || (m.firstName+' '+m.lastName).toLowerCase().includes(term.toLowerCase()));
      const el = document.getElementById('checkinResult');
      if (matches.length === 0) el.innerHTML = '<div class="member-card text-red-500 font-bold">ვერ მოიძებნა</div>';
      else if (matches.length === 1) await window.checkMemberAccess(matches[0]);
      else el.innerHTML = `<div class="member-card"><h3 class="font-bold mb-3">აირჩიეთ:</h3>${matches.map(m=>`<div class="p-3 border rounded mb-2 cursor-pointer hover:bg-gray-700" onclick="window.checkMemberAccess(window.members.find(x=>x.id==='${m.id}'))"><strong>${m.firstName} ${m.lastName}</strong> — ${m.personalId}</div>`).join('')}</div>`;
    }

    function getSubscriptionName(t) { const map = {'12visits':'12 ვარჯიში','morning':'დილის','unlimited':'ულიმიტო','other':'სხვა'}; return map[t] || t; }
    function getStatusClass(s) { return {active:'status-active',expired:'status-expired',paused:'status-paused'}[s] || 'status-expired'; }
    function getStatusText(s) { return {active:'აქტიური',expired:'ვადაგასული',paused:'შეჩერებული'}[s] || s; }
    function formatDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('ka-GE'); }

    function showToast(msg, type='success') {
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.classList.add('show'), 100);
      setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
    }

    window.toggleTheme = function() {
      document.body.classList.toggle('light-mode');
      localStorage.setItem('gym-theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
    };

    document.addEventListener('DOMContentLoaded', () => {
      if (localStorage.getItem('gym-theme') === 'light') document.body.classList.add('light-mode');
      loadMembers();

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
        btn.disabled = true; btn.querySelector('.btn-text').style.display = 'none'; btn.querySelector('.spinner').style.display = 'block';

        try {
          const start = new Date(); let end = new Date(); let visits = null; let price = window.selectedSubscription.price; let type = window.selectedSubscription.type;
          if (type === '12visits') { end.setDate(start.getDate() + 30); visits = 12; }
          else if (type === 'morning') end.setDate(start.getDate() + 30);
          else if (type === 'unlimited') end.setDate(start.getDate() + 60);
          else if (type === 'other') {
            const cp = +document.getElementById('customPrice').value;
            const cd = +document.getElementById('customDuration').value;
            const cv = document.getElementById('customVisits').value ? +document.getElementById('customVisits').value : null;
            const desc = document.getElementById('customDescription').value;
            if (!cp || !cd) { showToast("ფასი და ვადა სავალდებულოა", 'error'); return; }
            price = cp; end.setDate(start.getDate() + cd); visits = cv; type = desc || 'სხვა';
          }

          await createMember({
            firstName: document.getElementById('firstName').value.trim(),
            lastName: document.getElementById('lastName').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            birthDate: document.getElementById('birthDate').value,
            email: document.getElementById('email').value.trim(),
            personalId: document.getElementById('personalId').value.trim(),
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
        } finally {
          btn.disabled = false; btn.querySelector('.btn-text').style.display = 'inline'; btn.querySelector('.spinner').style.display = 'none';
        }
      });

      document.getElementById('searchInput')?.addEventListener('input', updateFullMemberList);
      document.getElementById('checkinSearch')?.addEventListener('input', e => {
        const v = e.target.value.trim();
        if (v.length > 2) searchAndCheckAccess(v);
        else document.getElementById('checkinResult').innerHTML = '';
      });
    });
  </script>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script>
    window.jspdf.jsPDF.API.addFont('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/fonts/DejaVuSans.ttf', 'DejaVu', 'normal');
  </script>

  <style>
    :root {
      --bg-gradient: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #334155 100%);
      --card-bg: #1e293b;
      --text: #f1f5f9;
      --text-light: #cbd5e1;
      --accent: #60a5fa;
      --accent-hover: #3b82f6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --border: #334155;
      --shadow: rgba(0,0,0,0.4);
    }

    body.light-mode {
      --bg-gradient: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
      --card-bg: #ffffff;
      --text: #1e293b;
      --text-light: #475569;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --border: #e2e8f0;
      --shadow: rgba(0,0,0,0.08);
    }

    body { margin:0; padding:0; font-family: 'Segoe UI', sans-serif; background: var(--bg-gradient); color: var(--text); min-height:100vh; transition: all 0.4s ease; }
    .container { max-width: 1280px; margin: 0 auto; padding: 20px; }

    .header { background: rgba(30,41,59,0.95); backdrop-filter: blur(12px); border-radius: 20px; padding: 24px; margin-bottom: 30px; text-align: center; box-shadow: 0 20px 40px var(--shadow); display: flex; align-items: center; justify-content: center; gap: 20px; border: 1px solid var(--border); }
    .light-mode .header { background: rgba(255,255,255,0.95); }

    .logo { height: 70px; border-radius: 16px; box-shadow: 0 8px 20px var(--shadow); }
    .gym-title { font-size: 2.8rem; font-weight: 800; background: linear-gradient(to right, #60a5fa, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0; }

    .nav-tabs { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 30px; justify-content: center; }
    .nav-tab { background: var(--card-bg); border: 1px solid var(--border); color: var(--text-light); padding: 14px 28px; border-radius: 16px; cursor: pointer; font-weight: 600; transition: all 0.3s; box-shadow: 0 4px 15px var(--shadow); }
    .nav-tab:hover { background: var(--card-hover, #334155); transform: translateY(-3px); color: white; }
    .nav-tab.active { background: var(--accent); color: white; box-shadow: 0 8px 25px rgba(59,130,246,0.5); }

    .tab-content { display: none; background: var(--card-bg); border: 1px solid var(--border); border-radius: 20px; padding: 32px; box-shadow: 0 20px 50px var(--shadow); }
    .tab-content.active { display: block; }

    h2 { font-size: 2rem; margin-bottom: 24px; font-weight: 700; }

    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .form-input, .search-input { width: 100%; padding: 16px 20px; background: #334155; border: 1px solid var(--border); border-radius: 14px; color: white; font-size: 16px; }
    .light-mode .form-input, .light-mode .search-input { background: #f8fafc; color: #1e293b; }
    .form-input:focus, .search-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 4px rgba(59,130,246,0.2); }

    .btn { background: var(--accent); color: white; border: none; padding: 14px 28px; border-radius: 14px; cursor: pointer; font-weight: 600; transition: all 0.3s; box-shadow: 0 6px 20px rgba(59,130,246,0.4); }
    .btn:hover { background: var(--accent-hover); transform: translateY(-3px); }
    .btn-success { background: var(--success); box-shadow: 0 6px 20px rgba(16,185,129,0.4); }
    .btn-warning { background: var(--warning); box-shadow: 0 6px 20px rgba(245,158,11,0.4); }

    .subscription-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; margin-bottom: 30px; }
    .subscription-card { background: linear-gradient(135deg, #1e40af, #7c3aed); color: white; padding: 32px 24px; border-radius: 20px; text-align: center; cursor: pointer; transition: all 0.4s; border: 3px solid transparent; box-shadow: 0 15px 35px rgba(0,0,0,0.3); }
    .subscription-card:hover { transform: translateY(-10px) scale(1.03); }
    .subscription-card.selected { border-color: #fbbf24; box-shadow: 0 0 30px rgba(251,191,36,0.6); }

    .member-card { background: #334155; border: 1px solid var(--border); border-radius: 18px; padding: 24px; margin-bottom: 20px; box-shadow: 0 8px 25px var(--shadow); }
    .light-mode .member-card { background: #f8fafc; }

    .status-active { background: #065f46; color: #6ee7b7; }
    .status-expired { background: #7f1d1d; color: #fca5a5; }
    .status-paused { background: #78350f; color: #fdba74; }
    .status-badge { padding: 6px 14px; border-radius: 30px; font-weight: 700; font-size: 0.85rem; }

    .dashboard-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; margin-bottom: 40px; }
    .stat-card { background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 28px; border-radius: 20px; text-align: center; box-shadow: 0 15px 35px rgba(59,130,246,0.4); color: white; }

    .theme-toggle {
      position: fixed; top: 20px; right: 20px; background: var(--card-bg); border: 2px solid var(--border);
      width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      cursor: pointer; z-index: 1000; box-shadow: 0 4px 15px var(--shadow); font-size: 28px; transition: all 0.3s;
    }
    .theme-toggle:hover { transform: scale(1.1); }

    .toast { position: fixed; top: 20px; right: 20px; background: #10b981; color: white; padding: 16px 24px; border-radius: 12px; box-shadow: 0 10px 30px var(--shadow); z-index: 1000; transform: translateX(400px); transition: transform 0.4s; font-weight: 600; }
    .toast.show { transform: translateX(0); }
    .toast.error { background: #ef4444; }
    .toast.warning { background: #f59e0b; color: #000; }

    .spinner { border: 3px solid #f3f3f3; border-top: 3px solid white; border Explosion-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; margin: 0 auto; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    @media (max-width: 768px) { .header { flex-direction: column; } .gym-title { font-size: 2.2rem; } }
  </style>
</head>
<body>
  <button class="theme-toggle" onclick="toggleTheme()" title="თემის გადართვა">Dark/Light</button>

  <div class="container">
    <div class="header">
      <img src="./fithause logo.png" alt="Fit House Logo" class="logo" onerror="this.style.display='none'">
      <h1 class="gym-title">Fit House Gym</h1>
    </div>

    <div class="nav-tabs">
      <button class="nav-tab active" onclick="showTab('dashboard')">დეშბორდი</button>
      <button class="nav-tab" onclick="showTab('register')">რეგისტრაცია</button>
      <button class="nav-tab" onclick="showTab('search')">ძიება</button>
      <button class="nav-tab" onclick="showTab('checkin')">შესვლა</button>
      <button class="nav-tab" onclick="showTab('expired')">ვადაგასული</button>
      <button class="nav-tab" onclick="showTab('export')">ექსპორტი</button>
    </div>

    <div id="dashboard" class="tab-content active">
      <h2>დეშბორდი</h2>
      <div class="dashboard-stats">
        <div class="stat-card"><div class="text-4xl font-bold" id="todayVisits">0</div><div class="text-lg mt-2">დღევანდელი ვიზიტები</div></div>
        <div class="stat-card"><div class="text-4xl font-bold" id="activeMembers">0</div><div class="text-lg mt-2">აქტიური წევრები</div></div>
        <div class="stat-card"><div class="text-4xl font-bold" id="expiredMembers">0</div><div class="text-lg mt-2">ვადაგასული</div></div>
        <div class="stat-card"><div class="text-4xl font-bold" id="expiringMembers">0</div><div class="text-lg mt-2">3 დღეში ვადაგასული</div></div>
        <div class="stat-card" style="background: linear-gradient(135deg, #ea580c, #f97316);"><div class="text-4xl font-bold" id="pausedMembers">0</div><div class="text-lg mt-2">შეჩერებული</div></div>
      </div>
      <div id="expiringList"></div>
    </div>

    <div id="register" class="tab-content">
      <h2>რეგისტრაცია</h2>
      <form id="registrationForm">
        <div class="form-grid">
          <input type="text" id="firstName" class="form-input" placeholder="სახელი *" required>
          <input type="text" id="lastName" class="form-input" placeholder="გვარი *" required>
          <input type="tel" id="phone" class="form-input" placeholder="ტელეფონი *" required>
          <input type="date" id="birthDate" class="form-input" required>
          <input type="email" id="email" class="form-input" placeholder="ელ.ფოსტა">
          <input type="text" id="personalId" class="form-input" placeholder="პირადი ნომერი *" required>
        </div>
        <h3 class="mb-4">აირჩიეთ აბონემენტი</h3>
        <div class="subscription-cards">
          <div class="subscription-card" data-type="12visits" data-price="70"><div class="font-bold text-xl">12 ვარჯიში</div><div class="text-3xl">70₾</div><div>30 დღე</div></div>
          <div class="subscription-card" data-type="morning" data-price="90"><div class="font-bold text-xl">დილის</div><div class="text-3xl">90₾</div><div>09:00–16:00</div></div>
          <div class="subscription-card" data-type="unlimited" data-price="110"><div class="font-bold text-xl">ულიმიტო</div><div class="text-3xl">110₾</div><div>60 დღე</div></div>
          <div class="subscription-card" data-type="other" data-price="0"><div class="font-bold text-xl">სხვა</div><div class="text-3xl">თავისუფალი</div></div>
        </div>
        <div id="customSubscriptionFields" style="display:none; margin-top:20px; padding:20px; background:#334155; border-radius:16px;">
          <div class="form-grid">
            <input type="number" id="customPrice" class="form-input" placeholder="ფასი ₾ *">
            <input type="number" id="customDuration" class="form-input" placeholder="ვადა (დღე) *">
            <input type="number" id="customVisits" class="form-input" placeholder="ვიზიტები (ცარიელი = ულიმიტო)">
            <input type="text" id="customDescription" class="form-input" placeholder="აღწერა">
          </div>
        </div>
        <button type="submit" id="registerBtn" class="btn btn-success mt-6">
          <span class="btn-text">რეგისტრაცია</span>
          <div class="spinner" style="display:none"></div>
        </button>
      </form>
    </div>

    <div id="search" class="tab-content">
      <h2>ძიება</h2>
      <input type="text" id="searchInput" class="search-input" placeholder="ფილტრი: პირადი ან სახელი...">
      <div id="searchResults" class="mt-6"></div>
    </div>

    <div id="checkin" class="tab-content">
      <h2>შესვლა</h2>
      <input type="text" id="checkinSearch" class="search-input" placeholder="ძიება პირადით ან სახელით...">
      <div id="checkinResult" class="mt-6"></div>
    </div>

    <div id="expired" class="tab-content">
      <h2>ვადაგასული წევრები</h2>
      <div id="expiredList" class="mt-6"></div>
    </div>

    <div id="export" class="tab-content">
      <h2>ექსპორტი</h2>
      <button class="btn mr-4" onclick="exportToExcel()">Excel (.xlsx)</button>
      <button class="btn" onclick="alert('PDF მალე დაემატება')">PDF (მალე)</button>
    </div>
  </div>
</body>
</html>
