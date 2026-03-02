    import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
    import { getFirestore, collection, addDoc, setDoc, doc, onSnapshot, query, deleteDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

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
    const db = getFirestore(app);
    const ADMIN_PASSWORD_HASH = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";
    let isAuthenticated = false;
    let notificationsSchedulerStarted = false;
    let expandedSearchMemberId = null;
    window.members = [];
    window.selectedSubscription = null;

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
          </div>
          <div class="flex flex-wrap gap-3 justify-center">
            <button class="btn btn-warning text-sm px-6 py-2" onclick="window.renewMembership('${member.id}')">განახლება</button>
            <button class="btn bg-blue-600 hover:bg-blue-700 text-sm px-6 py-2" onclick="window.showEditForm(event, '${member.id}')">რედაქტირება</button>
            <button class="btn bg-indigo-600 hover:bg-indigo-700 text-sm px-6 py-2" onclick="window.showMemberQr('${member.id}')"><i class="fas fa-qrcode"></i> QR</button>
            ${member.email ? `<button class="btn bg-purple-600 hover:bg-purple-700 text-sm px-6 py-2" onclick="window.openIndividualMessageModal('${member.id}')"><i class="fas fa-envelope"></i> Email</button>` : ''}
            <button class="btn bg-red-600 hover:bg-red-700 text-sm px-6 py-2" onclick="window.deleteMember('${member.id}')">წაშლა</button>
          </div>
        </div>
      `;
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

    window.login = async function() {
      const input = document.getElementById('adminPassword').value;
      const inputHash = await sha256Hex(input);
      if (inputHash === ADMIN_PASSWORD_HASH) {
        isAuthenticated = true;
        checkAuth();
        loadMembers();
        startExpiringNotificationsScheduler();
        showToast("ავტორიზაცია წარმატებით განხორციელდა!", "success");
      } else {
        showToast("პაროლი არასწორია!", "error");
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
          ...extraParams
        };
        
        await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams);
        return true;
      } catch (error) {
        console.error('Email error:', error);
        return false;
      }
    };

    // ავტომატური შეტყობინება ახალი რეგისტრაციისთვის
    async function sendWelcomeEmail(member) {
      if (!member.email) return;

      const subject = '🎉 Fit House Gym — თქვენი QR კოდი';
      const qrImageUrl = member.id ? getMemberQrImageUrl(member.id) : '';
      const message = qrImageUrl
        ? `თქვენი QR კოდი თან ერთვის ამ წერილს.\n\nთუ სურათი არ ჩანს, QR გახსენი ამ ბმულზე:\n${qrImageUrl}`
        : 'თქვენი QR კოდი თან ერთვის ამ წერილს.';
      const htmlMessage = qrImageUrl
        ? `<div style="text-align:center;padding:8px 0;"><img src="${qrImageUrl}" alt="Fit House QR" width="280" height="280" style="display:block;margin:0 auto;max-width:100%;height:auto;" /></div>`
        : '';

      await sendEmail(member.email, member.firstName, subject, message, {
        qr_image_url: qrImageUrl,
        html_message: htmlMessage
      });
    }

    // ავტომატური შეტყობინება განახლებისთვის
    async function sendRenewalEmail(member) {
      if (!member.email) return;
      
      const subject = '✅ აბონემენტი წარმატებით განახლდა!';
      const renewDate = formatDate(member.subscriptionStartDate || new Date().toISOString());
      const endDate = formatDate(member.subscriptionEndDate);
      const subType = getSubscriptionName(member.subscriptionType);
      
      const message = `თქვენი აბონემენტი წარმატებით განახლდა! ✅

მადლობა, რომ აგრძელებთ ვარჯიშს Fit House Gym-ში. ჩვენ ვაფასებთ თქვენ ერთგულებას და მზად ვართ კვლავ დაგეხმაროთ თქვენი მიზნების მიღწევაში!

📋 განახლებული აბონემენტის დეტალები:

🎫 ტიპი: ${subType}
💰 ფასი: ${member.subscriptionPrice}₾
📅 განახლების თარიღი: ${renewDate}
⏰ ვადის გასვლის თარიღი: ${endDate}
${member.remainingVisits != null ? `🔢 ვიზიტების რაოდენობა: ${member.remainingVisits}` : '♾️ ვიზიტები: ულიმიტო'}

💪 გააგრძელე შენი პროგრესი!

ჩვენ ყოველთვის აქ ვართ რომ დაგეხმაროთ და მხარი დაგიჭიროთ თქვენს ფიტნეს მოგზაურობაში.

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
            await updateMember({...member, expiringEmailSent: true});
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
      if (passHash !== ADMIN_PASSWORD_HASH) {
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
      try { 
        const docRef = await addDoc(collection(db, "members"), m);
        showToast("დარეგისტრირდა!");
        
        if (m.email) {
          const memberWithId = { ...m, id: docRef.id };
          setTimeout(() => sendWelcomeEmail(memberWithId), 1000);
        }
      }
      catch (e) { 
        showToast("შეცდომა", 'error'); 
      }
    }

    async function updateMember(m) {
      try { 
        await setDoc(doc(db, "members", m.id), m, { merge: true }); 
      }
      catch (e) { 
        console.error(e); 
      }
    }

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
        try { await html5QrScanner.stop(); } catch (e) {}
        html5QrScanner = null;
      }
      document.getElementById('qrScannerModal').style.display = 'none';
      const reader = document.getElementById('qr-reader');
      if (reader) reader.innerHTML = '';
      document.getElementById('qr-scan-result').innerHTML = '';
    };

    async function handleQrScan(decodedText) {
      let memberId = decodedText.trim();
      if (memberId.startsWith('FH_MEMBER:')) {
        memberId = memberId.slice('FH_MEMBER:'.length);
      }
      const member = window.members.find(m => m.id === memberId);
      if (!member) {
        document.getElementById('qr-scan-result').innerHTML = `
          <div style="text-align:center;padding:16px;">
            <div style="color:#f87171;font-size:1.1rem;font-weight:700;margin-bottom:8px;">❌ წევრი ვერ მოიძებნა</div>
            <div style="color:#9ca3af;font-size:0.9rem;margin-bottom:12px;">QR კოდი სისტემაში არ არსებობს</div>
            <button class="btn bg-indigo-600 hover:bg-indigo-700" onclick="window.openQrScanner()">ხელახლა სკანი</button>
          </div>`;
        return;
      }

      await window.closeQrScanner();
      window.showTab('checkin');
      await window.processCheckIn(member.id);
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
      if (tab === 'dashboard') {
        document.getElementById('expiringSoonSection').style.display = 'none';
      }
    };

    window.toggleExpiringSoon = function() {
      const section = document.getElementById('expiringSoonSection');
      if (section.style.display === 'block') {
        section.style.display = 'none';
      } else {
        section.style.display = 'block';
        showExpiringSoon();
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
        await updateMember({...m, status: 'expired'}); 
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
        await updateMember({...member, status:'expired'}); 
      }
      else if (member.remainingVisits !== null && member.remainingVisits <= 0) { 
        allowed = false; 
        msg = 'ვიზიტები ამოწურულია'; 
        await updateMember({...member, status:'expired'}); 
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

    window.renewMembership = async function(id) {
      const m = window.members.find(x => x.id === id);
      if (!m) return;
      const start = new Date();
      const end = setToEndOfDay(addMonthsPreserveDay(start, 1));
      let visits = null;
      if (m.subscriptionType === '12visits') { 
        visits = 12; 
      }
      
      const updated = { 
        ...m, 
        subscriptionStartDate: start.toISOString(),
        subscriptionEndDate: end.toISOString(), 
        remainingVisits: visits, 
        status: 'active',
        expiringEmailSent: false
      };
      
      await updateMember(updated);
      showToast("განახლდა!");
      
      if (updated.email) {
        setTimeout(() => {
          sendRenewalEmail(updated);
        }, 1000);
      }
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
            <div class="edit-field">
              <label class="edit-field-label" for="e_subtype_${id}">აბონემენტის ტიპი</label>
              <select id="e_subtype_${id}" class="form-input" onchange="window.autoFillSubscription('${id}')">
                <option value="12visits" ${m.subscriptionType==='12visits'?'selected':''}>12 ვარჯიში (70₾)</option>
                <option value="morning" ${m.subscriptionType==='morning'?'selected':''}>დილის ულიმიტო (90₾)</option>
                <option value="unlimited" ${m.subscriptionType==='unlimited'?'selected':''}>ულიმიტო (110₾)</option>
                <option value="other" ${!['12visits','morning','unlimited'].includes(m.subscriptionType)?'selected':''}>სხვა</option>
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
      if (type === '12visits') { 
        document.getElementById(`e_price_${id}`).value = 70; 
        document.getElementById(`e_visits_${id}`).value = 12; 
      }
      else if (type === 'morning') { 
        document.getElementById(`e_price_${id}`).value = 90; 
        document.getElementById(`e_visits_${id}`).value = ''; 
      }
      else if (type === 'unlimited') { 
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
        status: document.getElementById(`e_status_${id}`).value
      };
      await updateMember(updated);
      showToast("შენახულია!");
      document.querySelectorAll('.edit-form').forEach(f => f.remove());
      updateAll();
    };

    window.exportToExcel = function() {
      const data = window.members.map(m => ({
        "სახელი": m.firstName, 
        "გვარი": m.lastName, 
        "Email": m.email || '',
        "პირადი": m.personalId,
        "ტელეფონი": m.phone || '', 
        "აბონემენტი": getSubscriptionName(m.subscriptionType),
        "ფასი": m.subscriptionPrice + "₾", 
        "დასრულება": formatDate(m.subscriptionEndDate),
        "სტატუსი": getStatusText(m.status), 
        "დარჩენილი": m.remainingVisits != null ? m.remainingVisits : "ულიმიტო",
        "შენიშვნა": m.note || "", 
        "ბოლო ვიზიტი": m.lastVisit ? formatDate(m.lastVisit) : "—"
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, "წევრები");
      XLSX.writeFile(wb, `FitHouse_${new Date().toISOString().slice(0,10)}.xlsx`);
      showToast("Excel ჩამოიტვირთა!");
    };

    function updateAll() {
      updateDashboard(); 
      updateExpiredList(); 
      updateSearchMemberList(); 
      showExpiringSoon();
    }

    function updateDashboard() {
      const todayKey = new Date().toDateString();
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
            <button class="btn bg-indigo-600 hover:bg-indigo-700 px-5 py-2" onclick="window.showMemberQr('${m.id}')"><i class="fas fa-qrcode"></i> QR</button>
            ${m.email ? `<button class="btn bg-purple-600 hover:bg-purple-700 px-5 py-2" onclick="window.openIndividualMessageModal('${m.id}')"><i class="fas fa-envelope"></i> Email</button>` : ''}
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
            ${m.email ? `<button class="btn bg-purple-600 hover:bg-purple-700 text-sm px-5 py-2" onclick="window.openIndividualMessageModal('${m.id}')"><i class="fas fa-envelope"></i> Email</button>` : ''}
          </div></div>`;
      }).join('');
    }

    function getSubscriptionName(t) { 
      const map = {
        '12visits':'12 ვარჯიში',
        'morning':'დილის ულიმიტო',
        'unlimited':'ულიმიტო',
        'other':'სხვა'
      }; 
      return map[t] || t; 
    }
    
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

    document.addEventListener('DOMContentLoaded', () => {
      checkAuth();
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
        if (!window.selectedSubscription) { 
          showToast("აირჩიეთ აბონემენტი", 'error'); 
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
          
          await createMember({
            firstName: document.getElementById('firstName').value.trim(),
            lastName: document.getElementById('lastName').value.trim(),
            email: document.getElementById('email').value.trim() || null,
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
            createdAt: new Date().toISOString(),
            expiringEmailSent: false
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
      
      document.getElementById('searchInput')?.addEventListener('input', updateSearchMemberList);
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
