<!doctype html>
<html lang="ka">
 <head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fit House Gym Management System</title>
  <script src="/_sdk/data_sdk.js"></script>
  <script src="/_sdk/element_sdk.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <style>
        body {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100%;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 30px;
            margin-bottom: 30px;
            text-align: center;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }

        .gym-title {
            font-size: 2.5rem;
            font-weight: bold;
            color: #2d3748;
            margin-bottom: 10px;
        }

        .contact-info {
            color: #718096;
            font-size: 1.1rem;
        }

        .nav-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 30px;
            justify-content: center;
        }

        .nav-tab {
            background: rgba(255, 255, 255, 0.9);
            border: none;
            padding: 15px 25px;
            border-radius: 15px;
            cursor: pointer;
            font-weight: 600;
            color: #4a5568;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
        }

        .nav-tab:hover {
            background: rgba(255, 255, 255, 1);
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
        }

        .nav-tab.active {
            background: #4299e1;
            color: white;
            transform: translateY(-2px);
        }

        .tab-content {
            display: none;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }

        .tab-content.active {
            display: block;
        }

        .form-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #2d3748;
        }

        .form-input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e2e8f0;
            border-radius: 12px;
            font-size: 16px;
            transition: all 0.3s ease;
            box-sizing: border-box;
        }

        .form-input:focus {
            outline: none;
            border-color: #4299e1;
            box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.1);
        }

        .btn {
            background: linear-gradient(135deg, #4299e1, #3182ce);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 12px;
            cursor: pointer;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(66, 153, 225, 0.3);
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(66, 153, 225, 0.4);
        }

        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .btn-success {
            background: linear-gradient(135deg, #48bb78, #38a169);
            box-shadow: 0 4px 15px rgba(72, 187, 120, 0.3);
        }

        .btn-danger {
            background: linear-gradient(135deg, #f56565, #e53e3e);
            box-shadow: 0 4px 15px rgba(245, 101, 101, 0.3);
        }

        .btn-warning {
            background: linear-gradient(135deg, #ed8936, #dd6b20);
            box-shadow: 0 4px 15px rgba(237, 137, 54, 0.3);
        }

        .subscription-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .subscription-card {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 25px;
            border-radius: 20px;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s ease;
            border: 3px solid transparent;
        }

        .subscription-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        }

        .subscription-card.selected {
            border-color: #ffd700;
            box-shadow: 0 0 20px rgba(255, 215, 0, 0.5);
        }

        .subscription-title {
            font-size: 1.5rem;
            font-weight: bold;
            margin-bottom: 10px;
        }

        .subscription-price {
            font-size: 2rem;
            font-weight: bold;
            color: #ffd700;
            margin-bottom: 15px;
        }

        .subscription-details {
            font-size: 0.9rem;
            opacity: 0.9;
        }

        .member-card {
            background: white;
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 15px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
            transition: all 0.3s ease;
        }

        .member-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
        }

        .member-info {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 15px;
        }

        .status-badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            text-transform: uppercase;
        }

        .status-active {
            background: #c6f6d5;
            color: #22543d;
        }

        .status-expired {
            background: #fed7d7;
            color: #742a2a;
        }

        .status-blocked {
            background: #fbb6ce;
            color: #702459;
        }

        .status-paused {
            background: #fed7aa;
            color: #9a3412;
        }

        .dashboard-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: linear-gradient(135deg, #4299e1, #3182ce);
            color: white;
            padding: 25px;
            border-radius: 20px;
            text-align: center;
            box-shadow: 0 8px 25px rgba(66, 153, 225, 0.3);
        }

        .stat-number {
            font-size: 2.5rem;
            font-weight: bold;
            margin-bottom: 10px;
        }

        .stat-label {
            font-size: 1rem;
            opacity: 0.9;
        }

        .search-container {
            margin-bottom: 30px;
        }

        .search-input {
            width: 100%;
            padding: 15px 20px;
            border: 2px solid #e2e8f0;
            border-radius: 15px;
            font-size: 18px;
            box-sizing: border-box;
        }

        .loading {
            text-align: center;
            padding: 20px;
            color: #718096;
        }

        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #4299e1;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto 10px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .toast {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #48bb78;
            color: white;
            padding: 15px 20px;
            border-radius: 10px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
            z-index: 1000;
            transform: translateX(400px);
            transition: transform 0.3s ease;
        }

        .toast.show {
            transform: translateX(0);
        }

        .toast.error {
            background: #f56565;
        }

        .export-buttons {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            margin-bottom: 20px;
        }

        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }

            .gym-title {
                font-size: 2rem;
            }

            .nav-tabs {
                flex-direction: column;
            }

            .nav-tab {
                text-align: center;
            }

            .form-grid {
                grid-template-columns: 1fr;
            }

            .subscription-cards {
                grid-template-columns: 1fr;
            }

            .dashboard-stats {
                grid-template-columns: 1fr;
            }

            .export-buttons {
                flex-direction: column;
            }
        }
    </style>
  <style>@view-transition { navigation: auto; }</style>
  <script src="https://cdn.tailwindcss.com" type="text/javascript"></script>
 </head>
 <body>
  <div class="container">
   <div class="header">
    <h1 class="gym-title" id="gymName">Fit House Gym</h1>
    <p class="contact-info" id="contactInfo">Phone: +995 XXX XXX XXX</p>
   </div>
   <div class="nav-tabs"><button class="nav-tab active" onclick="showTab('dashboard')">დეშბორდი</button> <button class="nav-tab" onclick="showTab('register')">რეგისტრაცია</button> <button class="nav-tab" onclick="showTab('search')">ძიება</button> <button class="nav-tab" onclick="showTab('checkin')">შესვლა</button> <button class="nav-tab" onclick="showTab('expired')">ვადაგასული</button> <button class="nav-tab" onclick="showTab('export')">ექსპორტი</button>
   </div><!-- Dashboard Tab -->
   <div id="dashboard" class="tab-content active">
    <h2>დეშბორდი</h2>
    <div class="dashboard-stats">
     <div class="stat-card">
      <div class="stat-number" id="todayVisits">
       0
      </div>
      <div class="stat-label">
       დღევანდელი შესვლები
      </div>
     </div>
     <div class="stat-card">
      <div class="stat-number" id="activeMembers">
       0
      </div>
      <div class="stat-label">
       აქტიური აბონემენტები
      </div>
     </div>
     <div class="stat-card">
      <div class="stat-number" id="expiredMembers">
       0
      </div>
      <div class="stat-label">
       ვადაგასული აბონემენტები
      </div>
     </div>
     <div class="stat-card">
      <div class="stat-number" id="expiringMembers">
       0
      </div>
      <div class="stat-label">
       მომდევნო 3 დღეში ვადაგასული
      </div>
     </div>
     <div class="stat-card" style="background: linear-gradient(135deg, #ed8936, #dd6b20);">
      <div class="stat-number" id="pausedMembers">
       0
      </div>
      <div class="stat-label">
       შეჩერებული აბონემენტები
      </div>
     </div>
    </div>
    <div id="expiringList"></div>
   </div><!-- Registration Tab -->
   <div id="register" class="tab-content">
    <h2>მომხმარებლის რეგისტრაცია</h2>
    <form id="registrationForm">
     <div class="form-grid">
      <div class="form-group"><label class="form-label" for="firstName">სახელი *</label> <input type="text" id="firstName" class="form-input" required>
      </div>
      <div class="form-group"><label class="form-label" for="lastName">გვარი *</label> <input type="text" id="lastName" class="form-input" required>
      </div>
      <div class="form-group"><label class="form-label" for="phone">ტელეფონის ნომერი *</label> <input type="tel" id="phone" class="form-input" required>
      </div>
      <div class="form-group"><label class="form-label" for="birthDate">დაბადების თარიღი *</label> <input type="date" id="birthDate" class="form-input" required>
      </div>
      <div class="form-group"><label class="form-label" for="email">ელ.ფოსტა</label> <input type="email" id="email" class="form-input">
      </div>
      <div class="form-group"><label class="form-label" for="personalId">პირადი ნომერი *</label> <input type="text" id="personalId" class="form-input" required>
      </div>
     </div>
     <h3>აბონემენტის არჩევა</h3>
     <div class="subscription-cards">
      <div class="subscription-card" data-type="12visits" data-price="70">
       <div class="subscription-title">
        12 ვარჯიში
       </div>
       <div class="subscription-price">
        70₾
       </div>
       <div class="subscription-details">
        მოქმედების ვადა: 30 დღე<br>
         შეზღუდვა: 12 შემოსვლა
       </div>
      </div>
      <div class="subscription-card" data-type="morning" data-price="90">
       <div class="subscription-title">
        დილის ულიმიტო
       </div>
       <div class="subscription-price">
        90₾
       </div>
       <div class="subscription-details">
        მოქმედებს: 09:00–16:00<br>
         მოქმედების ვადა: 30 დღე
       </div>
      </div>
      <div class="subscription-card" data-type="unlimited" data-price="110">
       <div class="subscription-title">
        სრული ულიმიტო
       </div>
       <div class="subscription-price">
        110₾
       </div>
       <div class="subscription-details">
        ულიმიტო შესვლა<br>
         მოქმედების ვადა: 60 დღე
       </div>
      </div>
      <div class="subscription-card" data-type="other" data-price="0">
       <div class="subscription-title">
        სხვა
       </div>
       <div class="subscription-price">
        0₾
       </div>
       <div class="subscription-details">
        მითითებული ფასი<br>
         მითითებული ვადა
       </div>
      </div>
     </div><!-- Custom subscription fields (shown when "other" is selected) -->
     <div id="customSubscriptionFields" style="display: none; margin-top: 20px; padding: 20px; background: #f7fafc; border-radius: 12px;">
      <h4>სხვა აბონემენტის დეტალები</h4>
      <div class="form-grid">
       <div class="form-group"><label class="form-label" for="customPrice">ფასი (₾) *</label> <input type="number" id="customPrice" class="form-input" min="0" step="1">
       </div>
       <div class="form-group"><label class="form-label" for="customDuration">ვადა (დღეები) *</label> <input type="number" id="customDuration" class="form-input" min="1" step="1">
       </div>
       <div class="form-group"><label class="form-label" for="customVisits">ვიზიტების რაოდენობა</label> <input type="number" id="customVisits" class="form-input" min="1" step="1" placeholder="ცარიელი = ულიმიტო">
       </div>
       <div class="form-group"><label class="form-label" for="customDescription">აღწერა</label> <input type="text" id="customDescription" class="form-input" placeholder="მაგ: სტუდენტური აბონემენტი">
       </div>
      </div>
     </div><button type="submit" class="btn btn-success" id="registerBtn"> <span class="btn-text">რეგისტრაცია</span>
      <div class="spinner" style="display: none;"></div></button>
    </form>
   </div><!-- Search Tab -->
   <div id="search" class="tab-content">
    <h2>მომხმარებლის ძიება</h2>
    <div class="search-container"><input type="text" id="searchInput" class="search-input" placeholder="ძიება პირადი ნომრით, სახელით ან გვარით...">
    </div>
    <div id="searchResults"></div>
   </div><!-- Check-in Tab -->
   <div id="checkin" class="tab-content">
    <h2>შესვლის კონტროლი</h2>
    <div class="search-container"><input type="text" id="checkinSearch" class="search-input" placeholder="ძიება პირადი ნომრით, სახელით ან გვარით შესვლისთვის...">
    </div>
    <div id="checkinResult"></div>
   </div><!-- Expired Tab -->
   <div id="expired" class="tab-content">
    <h2>ვადაგასული აბონემენტები</h2>
    <div id="expiredList"></div>
   </div><!-- Export Tab -->
   <div id="export" class="tab-content">
    <h2>მონაცემების ექსპორტი</h2>
    <div class="export-buttons"><button class="btn" onclick="exportToExcel()">Excel Export (XLSX)</button> <button class="btn" onclick="exportToPDF()">PDF Export</button>
    </div>
    <div id="exportStatus"></div>
   </div>
  </div>
  <script>
        let members = [];
        let selectedSubscription = null;
        let currentRecordCount = 0;

        const defaultConfig = {
            gym_name: "Fit House Gym",
            contact_info: "Phone: +995 XXX XXX XXX"
        };

        // Data SDK Handler
        const dataHandler = {
            onDataChanged(data) {
                members = data;
                currentRecordCount = data.length;
                updateDashboard();
                updateSearchResults();
                updateExpiredList();
            }
        };

        // Element SDK Configuration
        async function onConfigChange(config) {
            const gymNameEl = document.getElementById('gymName');
            const contactInfoEl = document.getElementById('contactInfo');
            
            if (gymNameEl) {
                gymNameEl.textContent = config.gym_name || defaultConfig.gym_name;
            }
            if (contactInfoEl) {
                contactInfoEl.textContent = config.contact_info || defaultConfig.contact_info;
            }
        }

        function mapToCapabilities(config) {
            return {
                recolorables: [],
                borderables: [],
                fontEditable: undefined,
                fontSizeable: undefined
            };
        }

        function mapToEditPanelValues(config) {
            return new Map([
                ["gym_name", config.gym_name || defaultConfig.gym_name],
                ["contact_info", config.contact_info || defaultConfig.contact_info]
            ]);
        }

        // Initialize SDKs
        async function initializeApp() {
            try {
                if (window.dataSdk) {
                    const initResult = await window.dataSdk.init(dataHandler);
                    if (!initResult.isOk) {
                        console.error("Failed to initialize data SDK");
                    }
                }

                if (window.elementSdk) {
                    await window.elementSdk.init({
                        defaultConfig,
                        onConfigChange,
                        mapToCapabilities,
                        mapToEditPanelValues
                    });
                }
            } catch (error) {
                console.error("Initialization error:", error);
            }
        }

        // Tab Management
        function showTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.classList.remove('active');
            });
            document.querySelectorAll('.nav-tab').forEach(tab => {
                tab.classList.remove('active');
            });
            
            document.getElementById(tabName).classList.add('active');
            event.target.classList.add('active');
        }

        // Subscription Selection
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('.subscription-card').forEach(card => {
                card.addEventListener('click', function() {
                    document.querySelectorAll('.subscription-card').forEach(c => c.classList.remove('selected'));
                    this.classList.add('selected');
                    selectedSubscription = {
                        type: this.dataset.type,
                        price: parseInt(this.dataset.price)
                    };
                    
                    // Show/hide custom fields based on selection
                    const customFields = document.getElementById('customSubscriptionFields');
                    if (this.dataset.type === 'other') {
                        customFields.style.display = 'block';
                    } else {
                        customFields.style.display = 'none';
                    }
                });
            });
        });

        // Registration Form
        document.getElementById('registrationForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            if (currentRecordCount >= 999) {
                showToast("მაქსიმალური ლიმიტი 999 წევრისა მიღწეულია. გთხოვთ, წაშალოთ ზოგიერთი ჩანაწერი.", 'error');
                return;
            }

            if (!selectedSubscription) {
                showToast("გთხოვთ, აირჩიოთ აბონემენტი", 'error');
                return;
            }

            const btn = document.getElementById('registerBtn');
            const btnText = btn.querySelector('.btn-text');
            const spinner = btn.querySelector('.spinner');
            
            btn.disabled = true;
            btnText.style.display = 'none';
            spinner.style.display = 'block';

            try {
                const formData = new FormData(this);
                const startDate = new Date();
                let endDate = new Date();
                let remainingVisits = null;
                let subscriptionPrice = selectedSubscription.price;
                let subscriptionType = selectedSubscription.type;

                // Calculate subscription details
                if (selectedSubscription.type === '12visits') {
                    endDate.setDate(startDate.getDate() + 30);
                    remainingVisits = 12;
                } else if (selectedSubscription.type === 'morning') {
                    endDate.setDate(startDate.getDate() + 30);
                } else if (selectedSubscription.type === 'unlimited') {
                    endDate.setDate(startDate.getDate() + 60);
                } else if (selectedSubscription.type === 'other') {
                    // Handle custom subscription
                    const customPrice = document.getElementById('customPrice').value;
                    const customDuration = document.getElementById('customDuration').value;
                    const customVisits = document.getElementById('customVisits').value;
                    const customDescription = document.getElementById('customDescription').value;

                    if (!customPrice || !customDuration) {
                        showToast("გთხოვთ, შეავსოთ ფასი და ვადა", 'error');
                        return;
                    }

                    subscriptionPrice = parseInt(customPrice);
                    endDate.setDate(startDate.getDate() + parseInt(customDuration));
                    remainingVisits = customVisits ? parseInt(customVisits) : null;
                    subscriptionType = customDescription || 'სხვა აბონემენტი';
                }

                const member = {
                    id: generateId(),
                    firstName: document.getElementById('firstName').value,
                    lastName: document.getElementById('lastName').value,
                    phone: document.getElementById('phone').value,
                    birthDate: document.getElementById('birthDate').value,
                    email: document.getElementById('email').value,
                    personalId: document.getElementById('personalId').value,
                    subscriptionType: subscriptionType,
                    subscriptionPrice: subscriptionPrice,
                    subscriptionStartDate: startDate.toISOString(),
                    subscriptionEndDate: endDate.toISOString(),
                    remainingVisits: remainingVisits,
                    totalVisits: 0,
                    status: 'active',
                    lastVisit: null,
                    createdAt: new Date().toISOString()
                };

                const result = await window.dataSdk.create(member);
                
                if (result.isOk) {
                    showToast("წევრი წარმატებით დარეგისტრირდა!");
                    this.reset();
                    selectedSubscription = null;
                    document.querySelectorAll('.subscription-card').forEach(c => c.classList.remove('selected'));
                } else {
                    showToast("რეგისტრაციისას მოხდა შეცდომა", 'error');
                }
            } catch (error) {
                showToast("რეგისტრაციისას მოხდა შეცდომა", 'error');
            } finally {
                btn.disabled = false;
                btnText.style.display = 'inline';
                spinner.style.display = 'none';
            }
        });

        // Search Functionality
        document.getElementById('searchInput').addEventListener('input', function() {
            updateSearchResults(this.value);
        });

        function updateSearchResults(searchTerm = '') {
            const resultsContainer = document.getElementById('searchResults');
            
            if (!searchTerm) {
                resultsContainer.innerHTML = '<p class="loading">შეიყვანეთ საძიებო ტერმინი</p>';
                return;
            }

            const filteredMembers = members.filter(member => 
                member.personalId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                member.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                member.lastName.toLowerCase().includes(searchTerm.toLowerCase())
            );

            if (filteredMembers.length === 0) {
                resultsContainer.innerHTML = '<p class="loading">წევრი ვერ მოიძებნა</p>';
                return;
            }

            resultsContainer.innerHTML = filteredMembers.map(member => createMemberCard(member)).join('');
        }

        // Check-in Functionality
        document.getElementById('checkinSearch').addEventListener('input', function() {
            const searchTerm = this.value.trim();
            if (searchTerm.length > 2) {
                searchAndCheckAccess(searchTerm);
            } else {
                document.getElementById('checkinResult').innerHTML = '';
            }
        });

        async function searchAndCheckAccess(searchTerm) {
            const resultContainer = document.getElementById('checkinResult');
            
            // Search by personal ID, first name, or last name
            const matchingMembers = members.filter(member => 
                member.personalId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                member.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                member.lastName.toLowerCase().includes(searchTerm.toLowerCase())
            );

            if (matchingMembers.length === 0) {
                resultContainer.innerHTML = '<div class="member-card"><p style="color: #e53e3e; font-weight: bold;">წევრი ვერ მოიძებნა</p></div>';
                return;
            }

            if (matchingMembers.length === 1) {
                // If only one member found, proceed with access check
                await checkMemberAccess(matchingMembers[0]);
            } else {
                // If multiple members found, show selection list
                resultContainer.innerHTML = `
                    <div class="member-card">
                        <h3>რამდენიმე წევრი მოიძებნა:</h3>
                        ${matchingMembers.map((member, index) => `
                            <div style="padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; margin: 10px 0; cursor: pointer; transition: background-color 0.2s;" 
                                 onmouseover="this.style.backgroundColor='#f7fafc'" 
                                 onmouseout="this.style.backgroundColor='white'"
                                 onclick="selectMemberForCheckin('${member.id}')">
                                <strong>${member.firstName} ${member.lastName}</strong><br>
                                პირადი ნომერი: ${member.personalId}<br>
                                ტელეფონი: ${member.phone}
                            </div>
                        `).join('')}
                    </div>
                `;
            }
        }

        async function selectMemberForCheckin(memberId) {
            const member = members.find(m => m.id === memberId);
            if (member) {
                await checkMemberAccess(member);
            }
        }

        async function checkMemberAccess(member) {
            const resultContainer = document.getElementById('checkinResult');

            if (!member) {
                resultContainer.innerHTML = '<div class="member-card"><p style="color: #e53e3e; font-weight: bold;">წევრი ვერ მოიძებნა</p></div>';
                return;
            }

            const now = new Date();
            const endDate = new Date(member.subscriptionEndDate);
            const currentHour = now.getHours();
            let accessAllowed = false;
            let message = '';

            // Check subscription validity
            if (member.status === 'expired' || member.status === 'blocked') {
                message = 'შესვლა აკრძალულია - აბონემენტი ვადაგასულია';
            } else if (member.status === 'paused') {
                message = 'შესვლა აკრძალულია - აბონემენტი შეჩერებულია';
            } else if (now > endDate) {
                message = 'შესვლა აკრძალულია - აბონემენტის ვადა გასულია';
                await updateMemberStatus(member, 'expired');
            } else if (member.subscriptionType === '12visits' && member.remainingVisits <= 0) {
                message = 'შესვლა აკრძალულია - ვარჯიშები ამოწურულია';
                await updateMemberStatus(member, 'expired');
            } else if (member.subscriptionType === 'morning' && (currentHour < 9 || currentHour >= 16)) {
                message = 'შესვლა აკრძალულია - დილის აბონემენტი მოქმედებს 09:00-16:00';
            } else {
                accessAllowed = true;
                message = 'შესვლა ნებადართულია';
            }

            resultContainer.innerHTML = `
                <div class="member-card">
                    <div class="member-info">
                        <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
                        <div><strong>პირადი ნომერი:</strong> ${member.personalId}</div>
                        <div><strong>აბონემენტი:</strong> ${getSubscriptionName(member.subscriptionType)}</div>
                        <div><strong>სტატუსი:</strong> <span class="status-badge ${accessAllowed ? 'status-active' : 'status-expired'}">${message}</span></div>
                        ${member.remainingVisits !== null ? `<div><strong>დარჩენილი ვარჯიშები:</strong> ${member.remainingVisits}</div>` : ''}
                        <div><strong>ვადა:</strong> ${formatDate(member.subscriptionEndDate)}</div>
                    </div>
                    ${accessAllowed ? `<button class="btn btn-success" onclick="processCheckIn('${member.id}')">შესვლის დადასტურება</button>` : ''}
                </div>
            `;
        }

        async function processCheckIn(memberId) {
            const member = members.find(m => m.id === memberId);
            if (!member) return;

            try {
                const updatedMember = { ...member };
                updatedMember.lastVisit = new Date().toISOString();
                updatedMember.totalVisits = (updatedMember.totalVisits || 0) + 1;

                if (updatedMember.subscriptionType === '12visits' && updatedMember.remainingVisits > 0) {
                    updatedMember.remainingVisits -= 1;
                    if (updatedMember.remainingVisits === 0) {
                        updatedMember.status = 'expired';
                    }
                }

                const result = await window.dataSdk.update(updatedMember);
                
                if (result.isOk) {
                    showToast("შესვლა წარმატებით დაფიქსირდა!");
                    document.getElementById('checkinSearch').value = '';
                    document.getElementById('checkinResult').innerHTML = '';
                } else {
                    showToast("შესვლის დაფიქსირებისას მოხდა შეცდომა", 'error');
                }
            } catch (error) {
                showToast("შესვლის დაფიქსირებისას მოხდა შეცდომა", 'error');
            }
        }

        // Dashboard Updates
        function updateDashboard() {
            const today = new Date().toDateString();
            const todayVisits = members.filter(m => 
                m.lastVisit && new Date(m.lastVisit).toDateString() === today
            ).length;

            const activeMembers = members.filter(m => m.status === 'active').length;
            const expiredMembers = members.filter(m => m.status === 'expired' || m.status === 'blocked').length;
            const pausedMembers = members.filter(m => m.status === 'paused').length;

            // Members expiring in next 3 days
            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
            
            const expiringMembers = members.filter(m => {
                if (m.status !== 'active') return false;
                const endDate = new Date(m.subscriptionEndDate);
                return endDate <= threeDaysFromNow && endDate > new Date();
            });

            document.getElementById('todayVisits').textContent = todayVisits;
            document.getElementById('activeMembers').textContent = activeMembers;
            document.getElementById('expiredMembers').textContent = expiredMembers;
            document.getElementById('expiringMembers').textContent = expiringMembers.length;
            document.getElementById('pausedMembers').textContent = pausedMembers;

            // Show expiring members list
            const expiringList = document.getElementById('expiringList');
            if (expiringMembers.length > 0) {
                expiringList.innerHTML = `
                    <h3>მომდევნო 3 დღეში ვადაგასული აბონემენტები:</h3>
                    ${expiringMembers.map(member => `
                        <div class="member-card">
                            <div class="member-info">
                                <div><strong>${member.firstName} ${member.lastName}</strong></div>
                                <div>ვადა: ${formatDate(member.subscriptionEndDate)}</div>
                                <div>აბონემენტი: ${getSubscriptionName(member.subscriptionType)}</div>
                            </div>
                        </div>
                    `).join('')}
                `;
            } else {
                expiringList.innerHTML = '';
            }
        }

        // Expired Members List
        function updateExpiredList() {
            const expiredMembers = members.filter(m => m.status === 'expired');
            const expiredContainer = document.getElementById('expiredList');

            if (expiredMembers.length === 0) {
                expiredContainer.innerHTML = '<p class="loading">ვადაგასული აბონემენტები არ არის</p>';
                return;
            }

            expiredContainer.innerHTML = expiredMembers.map(member => {
                const endDate = new Date(member.subscriptionEndDate);
                const now = new Date();
                let reason = '';

                if (member.subscriptionType === '12visits' && member.remainingVisits === 0) {
                    reason = '12 ვიზიტი შესრულებულია';
                } else if (now > endDate) {
                    const daysPassed = Math.floor((now - endDate) / (1000 * 60 * 60 * 24));
                    if (member.subscriptionType === 'unlimited') {
                        reason = `გასულია 60 დღე (${daysPassed} დღით გადაცილებული)`;
                    } else {
                        reason = `გასულია 30 დღე (${daysPassed} დღით გადაცილებული)`;
                    }
                }

                return `
                    <div class="member-card">
                        <div class="member-info">
                            <div><strong>${member.firstName} ${member.lastName}</strong></div>
                            <div><strong>პირადი ნომერი:</strong> ${member.personalId}</div>
                            <div><strong>აბონემენტი:</strong> ${getSubscriptionName(member.subscriptionType)}</div>
                            <div><strong>მიზეზი:</strong> ${reason}</div>
                            <div><strong>ბოლო ვიზიტი:</strong> ${member.lastVisit ? formatDate(member.lastVisit) : 'არ არის'}</div>
                            <div><strong>სტატუსი:</strong> <span class="status-badge status-expired">შესვლა აკრძალულია</span></div>
                        </div>
                        <button class="btn btn-warning" onclick="renewMembership('${member.id}')">აბონემენტის განახლება</button>
                    </div>
                `;
            }).join('');
        }

        // Export Functions
        function exportToExcel() {
            try {
                const wb = XLSX.utils.book_new();
                
                // All members sheet
                const membersData = members.map(member => ({
                    'სახელი': member.firstName,
                    'გვარი': member.lastName,
                    'პირადი ნომერი': member.personalId,
                    'ტელეფონი': member.phone,
                    'ელ.ფოსტა': member.email || '',
                    'დაბადების თარიღი': member.birthDate,
                    'აბონემენტი': getSubscriptionName(member.subscriptionType),
                    'ფასი': member.subscriptionPrice + '₾',
                    'დაწყების თარიღი': formatDate(member.subscriptionStartDate),
                    'დასრულების თარიღი': formatDate(member.subscriptionEndDate),
                    'დარჩენილი ვარჯიშები': member.remainingVisits || 'ულიმიტო',
                    'სულ ვიზიტები': member.totalVisits,
                    'ბოლო ვიზიტი': member.lastVisit ? formatDate(member.lastVisit) : 'არ არის',
                    'სტატუსი': member.status === 'active' ? 'აქტიური' : 'ვადაგასული'
                }));
                
                const ws1 = XLSX.utils.json_to_sheet(membersData);
                XLSX.utils.book_append_sheet(wb, ws1, 'ყველა წევრი');
                
                // Active members sheet
                const activeMembers = members.filter(m => m.status === 'active');
                const activeData = activeMembers.map(member => ({
                    'სახელი': member.firstName,
                    'გვარი': member.lastName,
                    'პირადი ნომერი': member.personalId,
                    'აბონემენტი': getSubscriptionName(member.subscriptionType),
                    'დარჩენილი დღეები': Math.ceil((new Date(member.subscriptionEndDate) - new Date()) / (1000 * 60 * 60 * 24)),
                    'დარჩენილი ვარჯიშები': member.remainingVisits || 'ულიმიტო'
                }));
                
                const ws2 = XLSX.utils.json_to_sheet(activeData);
                XLSX.utils.book_append_sheet(wb, ws2, 'აქტიური აბონემენტები');
                
                // Expired members sheet
                const expiredMembers = members.filter(m => m.status === 'expired');
                const expiredData = expiredMembers.map(member => ({
                    'სახელი': member.firstName,
                    'გვარი': member.lastName,
                    'პირადი ნომერი': member.personalId,
                    'აბონემენტი': getSubscriptionName(member.subscriptionType),
                    'ვადის გასვლის თარიღი': formatDate(member.subscriptionEndDate),
                    'ბოლო ვიზიტი': member.lastVisit ? formatDate(member.lastVisit) : 'არ არის'
                }));
                
                const ws3 = XLSX.utils.json_to_sheet(expiredData);
                XLSX.utils.book_append_sheet(wb, ws3, 'ვადაგასული აბონემენტები');
                
                XLSX.writeFile(wb, `Fit_House_Gym_${new Date().toISOString().split('T')[0]}.xlsx`);
                showToast("Excel ფაილი წარმატებით ჩამოიტვირთა!");
            } catch (error) {
                showToast("Excel ექსპორტისას მოხდა შეცდომა", 'error');
            }
        }

        function exportToPDF() {
            try {
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF();
                
                // Add title
                doc.setFontSize(20);
                doc.text('Fit House Gym - Members Report', 20, 20);
                
                doc.setFontSize(12);
                doc.text(`Generated: ${new Date().toLocaleDateString('ka-GE')}`, 20, 35);
                
                // Statistics
                const activeCount = members.filter(m => m.status === 'active').length;
                const expiredCount = members.filter(m => m.status === 'expired').length;
                
                doc.text(`Total Members: ${members.length}`, 20, 50);
                doc.text(`Active Subscriptions: ${activeCount}`, 20, 60);
                doc.text(`Expired Subscriptions: ${expiredCount}`, 20, 70);
                
                // Active members list
                doc.setFontSize(14);
                doc.text('Active Members:', 20, 90);
                
                doc.setFontSize(10);
                let yPos = 105;
                
                members.filter(m => m.status === 'active').forEach((member, index) => {
                    if (yPos > 270) {
                        doc.addPage();
                        yPos = 20;
                    }
                    
                    doc.text(`${index + 1}. ${member.firstName} ${member.lastName} - ${member.personalId}`, 25, yPos);
                    doc.text(`   Subscription: ${getSubscriptionName(member.subscriptionType)}`, 25, yPos + 8);
                    doc.text(`   Expires: ${formatDate(member.subscriptionEndDate)}`, 25, yPos + 16);
                    yPos += 25;
                });
                
                doc.save(`Fit_House_Gym_Report_${new Date().toISOString().split('T')[0]}.pdf`);
                showToast("PDF ფაილი წარმატებით ჩამოიტვირთა!");
            } catch (error) {
                showToast("PDF ექსპორტისას მოხდა შეცდომა", 'error');
            }
        }

        // Utility Functions
        function createMemberCard(member) {
            const remainingDays = Math.ceil((new Date(member.subscriptionEndDate) - new Date()) / (1000 * 60 * 60 * 24));
            
            return `
                <div class="member-card">
                    <div class="member-info">
                        <div><strong>სახელი:</strong> ${member.firstName} ${member.lastName}</div>
                        <div><strong>პირადი ნომერი:</strong> ${member.personalId}</div>
                        <div><strong>ტელეფონი:</strong> ${member.phone}</div>
                        <div><strong>ელ.ფოსტა:</strong> ${member.email || 'არ არის'}</div>
                        <div><strong>აბონემენტი:</strong> ${getSubscriptionName(member.subscriptionType)}</div>
                        <div><strong>დარჩენილი დღეები:</strong> ${remainingDays > 0 ? remainingDays : 'ვადაგასული'}</div>
                        ${member.remainingVisits !== null ? `<div><strong>დარჩენილი ვარჯიშები:</strong> ${member.remainingVisits}</div>` : ''}
                        <div><strong>სულ ვიზიტები:</strong> ${member.totalVisits}</div>
                        <div><strong>ბოლო ვიზიტი:</strong> ${member.lastVisit ? formatDate(member.lastVisit) : 'არ არის'}</div>
                        <div><strong>სტატუსი:</strong> <span class="status-badge ${getStatusClass(member.status)}">${getStatusText(member.status)}</span></div>
                    </div>
                    <div style="margin-top: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="btn btn-warning" onclick="showRenewalOptions('${member.id}')">აბონემენტის განახლება</button>
                        <button class="btn" onclick="showEditForm('${member.id}')" style="background: #4299e1;">რედაქტირება</button>
                        ${member.status === 'active' ? 
                            `<button class="btn" onclick="pauseMembership('${member.id}')" style="background: #ed8936;">შეჩერება</button>` :
                            member.status === 'paused' ?
                            `<button class="btn btn-success" onclick="resumeMembership('${member.id}')">აქტივაცია</button>` :
                            ''
                        }
                    </div>
                    <div id="renewalOptions_${member.id}" style="display: none; margin-top: 15px; padding: 15px; background: #f7fafc; border-radius: 8px;">
                        <h4>აბონემენტის ვარიანტები:</h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 15px 0;">
                            <button class="btn" onclick="renewWithSubscription('${member.id}', '12visits', 70)" style="padding: 10px; font-size: 14px;">
                                12 ვარჯიში - 70₾
                            </button>
                            <button class="btn" onclick="renewWithSubscription('${member.id}', 'morning', 90)" style="padding: 10px; font-size: 14px;">
                                დილის ულიმიტო - 90₾
                            </button>
                            <button class="btn" onclick="renewWithSubscription('${member.id}', 'unlimited', 110)" style="padding: 10px; font-size: 14px;">
                                სრული ულიმიტო - 110₾
                            </button>
                            <button class="btn" onclick="showCustomRenewal('${member.id}')" style="padding: 10px; font-size: 14px; background: #ed8936;">
                                სხვა ვარიანტი
                            </button>
                        </div>
                        <div id="customRenewal_${member.id}" style="display: none; margin-top: 15px; padding: 15px; background: white; border-radius: 8px; border: 1px solid #e2e8f0;">
                            <h5>სხვა აბონემენტის დეტალები:</h5>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 10px 0;">
                                <input type="number" id="renewPrice_${member.id}" placeholder="ფასი (₾)" class="form-input" style="padding: 8px;">
                                <input type="number" id="renewDuration_${member.id}" placeholder="ვადა (დღე)" class="form-input" style="padding: 8px;">
                                <input type="number" id="renewVisits_${member.id}" placeholder="ვიზიტები (ცარიელი=ულიმიტო)" class="form-input" style="padding: 8px;">
                                <input type="text" id="renewDescription_${member.id}" placeholder="აღწერა" class="form-input" style="padding: 8px;">
                            </div>
                            <button class="btn btn-success" onclick="renewWithCustom('${member.id}')" style="margin-top: 10px;">განახლება</button>
                        </div>
                        <button class="btn" onclick="hideRenewalOptions('${member.id}')" style="margin-top: 10px; background: #718096;">დახურვა</button>
                    </div>
                    <div id="editForm_${member.id}" style="display: none; margin-top: 15px; padding: 15px; background: #f0f8ff; border-radius: 8px; border: 2px solid #4299e1;">
                        <h4>მომხმარებლის რედაქტირება:</h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 15px 0;">
                            <div>
                                <label style="display: block; margin-bottom: 5px; font-weight: 600;">სახელი:</label>
                                <input type="text" id="editFirstName_${member.id}" value="${member.firstName}" class="form-input" style="padding: 8px;">
                            </div>
                            <div>
                                <label style="display: block; margin-bottom: 5px; font-weight: 600;">გვარი:</label>
                                <input type="text" id="editLastName_${member.id}" value="${member.lastName}" class="form-input" style="padding: 8px;">
                            </div>
                            <div>
                                <label style="display: block; margin-bottom: 5px; font-weight: 600;">ტელეფონი:</label>
                                <input type="tel" id="editPhone_${member.id}" value="${member.phone}" class="form-input" style="padding: 8px;">
                            </div>
                            <div>
                                <label style="display: block; margin-bottom: 5px; font-weight: 600;">ელ.ფოსტა:</label>
                                <input type="email" id="editEmail_${member.id}" value="${member.email || ''}" class="form-input" style="padding: 8px;">
                            </div>
                            <div>
                                <label style="display: block; margin-bottom: 5px; font-weight: 600;">პირადი ნომერი:</label>
                                <input type="text" id="editPersonalId_${member.id}" value="${member.personalId}" class="form-input" style="padding: 8px;">
                            </div>
                            <div>
                                <label style="display: block; margin-bottom: 5px; font-weight: 600;">დაბადების თარიღი:</label>
                                <input type="date" id="editBirthDate_${member.id}" value="${member.birthDate}" class="form-input" style="padding: 8px;">
                            </div>
                        </div>
                        <div style="margin-top: 15px;">
                            <button class="btn btn-success" onclick="saveEditedMember('${member.id}')" style="margin-right: 10px;">შენახვა</button>
                            <button class="btn" onclick="hideEditForm('${member.id}')" style="background: #718096;">გაუქმება</button>
                        </div>
                    </div>
                </div>
            `;
        }

        function getSubscriptionName(type) {
            const names = {
                '12visits': '12 ვარჯიში',
                'morning': 'დილის ულიმიტო',
                'unlimited': 'სრული ულიმიტო',
                'other': 'სხვა აბონემენტი'
            };
            return names[type] || type;
        }

        function getStatusClass(status) {
            const classes = {
                'active': 'status-active',
                'expired': 'status-expired',
                'blocked': 'status-blocked',
                'paused': 'status-paused'
            };
            return classes[status] || 'status-expired';
        }

        function getStatusText(status) {
            const texts = {
                'active': 'აქტიური',
                'expired': 'ვადაგასული',
                'blocked': 'დაბლოკილი',
                'paused': 'შეჩერებული'
            };
            return texts[status] || status;
        }

        function formatDate(dateString) {
            return new Date(dateString).toLocaleDateString('ka-GE');
        }

        function generateId() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2);
        }

        async function updateMemberStatus(member, status) {
            try {
                const updatedMember = { ...member, status };
                await window.dataSdk.update(updatedMember);
            } catch (error) {
                console.error("Status update failed:", error);
            }
        }

        async function renewMembership(memberId) {
            const member = members.find(m => m.id === memberId);
            if (!member) return;

            // Simple renewal - extend by original period
            const startDate = new Date();
            let endDate = new Date();
            let remainingVisits = null;

            if (member.subscriptionType === '12visits') {
                endDate.setDate(startDate.getDate() + 30);
                remainingVisits = 12;
            } else if (member.subscriptionType === 'morning') {
                endDate.setDate(startDate.getDate() + 30);
            } else if (member.subscriptionType === 'unlimited') {
                endDate.setDate(startDate.getDate() + 60);
            }

            try {
                const updatedMember = {
                    ...member,
                    subscriptionStartDate: startDate.toISOString(),
                    subscriptionEndDate: endDate.toISOString(),
                    remainingVisits: remainingVisits,
                    status: 'active'
                };

                const result = await window.dataSdk.update(updatedMember);
                
                if (result.isOk) {
                    showToast("აბონემენტი წარმატებით განახლდა!");
                } else {
                    showToast("აბონემენტის განახლებისას მოხდა შეცდომა", 'error');
                }
            } catch (error) {
                showToast("აბონემენტის განახლებისას მოხდა შეცდომა", 'error');
            }
        }

        // Renewal Functions
        function showRenewalOptions(memberId) {
            const optionsDiv = document.getElementById(`renewalOptions_${memberId}`);
            optionsDiv.style.display = optionsDiv.style.display === 'none' ? 'block' : 'none';
        }

        function hideRenewalOptions(memberId) {
            document.getElementById(`renewalOptions_${memberId}`).style.display = 'none';
        }

        function showCustomRenewal(memberId) {
            const customDiv = document.getElementById(`customRenewal_${memberId}`);
            customDiv.style.display = customDiv.style.display === 'none' ? 'block' : 'none';
        }

        async function renewWithSubscription(memberId, subscriptionType, price) {
            const member = members.find(m => m.id === memberId);
            if (!member) return;

            const startDate = new Date();
            let endDate = new Date();
            let remainingVisits = null;

            // Calculate subscription details
            if (subscriptionType === '12visits') {
                endDate.setDate(startDate.getDate() + 30);
                remainingVisits = 12;
            } else if (subscriptionType === 'morning') {
                endDate.setDate(startDate.getDate() + 30);
            } else if (subscriptionType === 'unlimited') {
                endDate.setDate(startDate.getDate() + 60);
            }

            try {
                const updatedMember = {
                    ...member,
                    subscriptionType: subscriptionType,
                    subscriptionPrice: price,
                    subscriptionStartDate: startDate.toISOString(),
                    subscriptionEndDate: endDate.toISOString(),
                    remainingVisits: remainingVisits,
                    status: 'active'
                };

                const result = await window.dataSdk.update(updatedMember);
                
                if (result.isOk) {
                    showToast("აბონემენტი წარმატებით განახლდა!");
                    hideRenewalOptions(memberId);
                } else {
                    showToast("აბონემენტის განახლებისას მოხდა შეცდომა", 'error');
                }
            } catch (error) {
                showToast("აბონემენტის განახლებისას მოხდა შეცდომა", 'error');
            }
        }

        async function renewWithCustom(memberId) {
            const member = members.find(m => m.id === memberId);
            if (!member) return;

            const price = document.getElementById(`renewPrice_${memberId}`).value;
            const duration = document.getElementById(`renewDuration_${memberId}`).value;
            const visits = document.getElementById(`renewVisits_${memberId}`).value;
            const description = document.getElementById(`renewDescription_${memberId}`).value;

            if (!price || !duration) {
                showToast("გთხოვთ, შეავსოთ ფასი და ვადა", 'error');
                return;
            }

            const startDate = new Date();
            const endDate = new Date();
            endDate.setDate(startDate.getDate() + parseInt(duration));

            try {
                const updatedMember = {
                    ...member,
                    subscriptionType: description || 'სხვა აბონემენტი',
                    subscriptionPrice: parseInt(price),
                    subscriptionStartDate: startDate.toISOString(),
                    subscriptionEndDate: endDate.toISOString(),
                    remainingVisits: visits ? parseInt(visits) : null,
                    status: 'active'
                };

                const result = await window.dataSdk.update(updatedMember);
                
                if (result.isOk) {
                    showToast("აბონემენტი წარმატებით განახლდა!");
                    hideRenewalOptions(memberId);
                    // Clear custom fields
                    document.getElementById(`renewPrice_${memberId}`).value = '';
                    document.getElementById(`renewDuration_${memberId}`).value = '';
                    document.getElementById(`renewVisits_${memberId}`).value = '';
                    document.getElementById(`renewDescription_${memberId}`).value = '';
                } else {
                    showToast("აბონემენტის განახლებისას მოხდა შეცდომა", 'error');
                }
            } catch (error) {
                showToast("აბონემენტის განახლებისას მოხდა შეცდომა", 'error');
            }
        }

        function showToast(message, type = 'success') {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            document.body.appendChild(toast);
            
            setTimeout(() => toast.classList.add('show'), 100);
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => document.body.removeChild(toast), 300);
            }, 3000);
        }

        // Member Management Functions
        function showEditForm(memberId) {
            const editForm = document.getElementById(`editForm_${memberId}`);
            editForm.style.display = editForm.style.display === 'none' ? 'block' : 'none';
        }

        function hideEditForm(memberId) {
            document.getElementById(`editForm_${memberId}`).style.display = 'none';
        }

        async function saveEditedMember(memberId) {
            const member = members.find(m => m.id === memberId);
            if (!member) return;

            try {
                const updatedMember = {
                    ...member,
                    firstName: document.getElementById(`editFirstName_${memberId}`).value,
                    lastName: document.getElementById(`editLastName_${memberId}`).value,
                    phone: document.getElementById(`editPhone_${memberId}`).value,
                    email: document.getElementById(`editEmail_${memberId}`).value,
                    personalId: document.getElementById(`editPersonalId_${memberId}`).value,
                    birthDate: document.getElementById(`editBirthDate_${memberId}`).value
                };

                const result = await window.dataSdk.update(updatedMember);
                
                if (result.isOk) {
                    showToast("მომხმარებლის მონაცემები წარმატებით განახლდა!");
                    hideEditForm(memberId);
                } else {
                    showToast("მონაცემების განახლებისას მოხდა შეცდომა", 'error');
                }
            } catch (error) {
                showToast("მონაცემების განახლებისას მოხდა შეცდომა", 'error');
            }
        }

        async function pauseMembership(memberId) {
            const member = members.find(m => m.id === memberId);
            if (!member) return;

            try {
                const updatedMember = {
                    ...member,
                    status: 'paused'
                };

                const result = await window.dataSdk.update(updatedMember);
                
                if (result.isOk) {
                    showToast("აბონემენტი შეჩერდა!");
                } else {
                    showToast("აბონემენტის შეჩერებისას მოხდა შეცდომა", 'error');
                }
            } catch (error) {
                showToast("აბონემენტის შეჩერებისას მოხდა შეცდომა", 'error');
            }
        }

        async function resumeMembership(memberId) {
            const member = members.find(m => m.id === memberId);
            if (!member) return;

            // Check if subscription is still valid by date
            const now = new Date();
            const endDate = new Date(member.subscriptionEndDate);
            
            if (now > endDate) {
                showToast("აბონემენტის ვადა გასულია. გთხოვთ, განაახლოთ აბონემენტი", 'error');
                return;
            }

            try {
                const updatedMember = {
                    ...member,
                    status: 'active'
                };

                const result = await window.dataSdk.update(updatedMember);
                
                if (result.isOk) {
                    showToast("აბონემენტი აქტივირდა!");
                } else {
                    showToast("აბონემენტის აქტივაციისას მოხდა შეცდომა", 'error');
                }
            } catch (error) {
                showToast("აბონემენტის აქტივაციისას მოხდა შეცდომა", 'error');
            }
        }

        // Initialize app when page loads
        document.addEventListener('DOMContentLoaded', initializeApp);
    </script>
 <script>(function(){function c(){var b=a.contentDocument||a.contentWindow.document;if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'99fd2784e38fe40e',t:'MTc2MzM2MDc2My4wMDAwMDA='};var a=document.createElement('script');a.nonce='';a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();</script></body>
</html>
