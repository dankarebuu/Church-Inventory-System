// ========== SUPABASE CONFIGURATION ==========
const supabaseUrl = 'https://gcplffcftuhjthtcnjjc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjcGxmZmNmdHVoanRodGNuampjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNDM1OTMsImV4cCI6MjEwMTkxOTU5M30.euisTvPThLm8XixicuwKQNOxUlz_8D7F_KvuVKMc16w';

const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = null;
let items = [];
let history = [];
let editingId = null;
let pendingImportData = []; // Holds data temporarily for the Import Wizard
let existingUrls = [];
let newFiles = [];
let galleryImageUrls = [];
let currentGalleryIdx = 0;

function parseImages(imgData) {
  if (!imgData) return [];
  if (Array.isArray(imgData)) {
    return imgData.filter(url => typeof url === 'string' && url.trim()).map(url => url.trim());
  }

  if (typeof imgData !== 'string') return [];
  const value = imgData.trim();
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter(url => typeof url === 'string' && url.trim()).map(url => url.trim());
    }
    if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
    return [];
  } catch {
    return [value];
  }
}

// ========== CUSTOM ALERT & CONFIRM MODALS ==========
const alertOverlay = document.getElementById('alertOverlay');
const alertTitle = document.getElementById('alertTitle');
const alertMessage = document.getElementById('alertMessage');
const alertIconContainer = document.getElementById('alertIconContainer');

function customAlert(message, title = 'Notice', type = 'info') {
  alertTitle.textContent = title;
  alertMessage.innerHTML = message; 
  
  let iconHtml = '';
  if (type === 'error') {
    iconHtml = '<i data-lucide="x-circle" style="width: 54px; height: 54px; stroke-width: 1.5; color: var(--red);"></i>';
  } else if (type === 'success') {
    iconHtml = '<i data-lucide="check-circle-2" style="width: 54px; height: 54px; stroke-width: 1.5; color: var(--green);"></i>';
  } else {
    iconHtml = '<i data-lucide="info" style="width: 54px; height: 54px; stroke-width: 1.5; color: var(--blue);"></i>';
  }
  
  alertIconContainer.innerHTML = iconHtml;
  alertOverlay.classList.add('show');
  setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 10);
}

document.getElementById('closeAlertBtn').addEventListener('click', () => {
  alertOverlay.classList.remove('show');
});

let confirmAction = null;
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmMessage = document.getElementById('confirmMessage');

function openConfirmModal(message, actionCallback, confirmText = "Confirm", isDanger = true) {
  confirmMessage.textContent = message;
  confirmAction = actionCallback;
  
  const acceptBtn = document.getElementById('acceptConfirmBtn');
  acceptBtn.textContent = confirmText;
  
  if(isDanger) {
      acceptBtn.style.background = 'var(--red)';
      document.getElementById('confirmIcon').innerHTML = '<i data-lucide="alert-triangle" style="width: 54px; height: 54px; stroke-width: 1.5; color: var(--red);"></i>';
  } else {
      acceptBtn.style.background = 'var(--blue)';
      document.getElementById('confirmIcon').innerHTML = '<i data-lucide="help-circle" style="width: 54px; height: 54px; stroke-width: 1.5; color: var(--blue);"></i>';
  }

  confirmOverlay.classList.add('show');
  setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 10);
}

document.getElementById('cancelConfirmBtn').addEventListener('click', () => {
  confirmOverlay.classList.remove('show');
  confirmAction = null;
});

document.getElementById('acceptConfirmBtn').addEventListener('click', async () => {
  if (confirmAction) {
    const btn = document.getElementById('acceptConfirmBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Processing...';
    
    await confirmAction(); 
    
    btn.textContent = originalText;
  }
  confirmOverlay.classList.remove('show');
  confirmAction = null;
});

// ========== AUTHENTICATION LOGIC ==========
const authOverlay = document.getElementById('authOverlay');
const authForm = document.getElementById('authForm');
let isSignUpMode = false;
const bodyEl = document.body;

function lockBodyScroll() {
  bodyEl.classList.add('no-scroll');
}

function unlockBodyScroll() {
  bodyEl.classList.remove('no-scroll');
}

async function checkAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentUser = session?.user || null;
  updateAuthUI();
  
  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    updateAuthUI();
    
    if (event === 'PASSWORD_RECOVERY') {
      document.getElementById('authOverlay').classList.remove('show');
      document.getElementById('forgotOverlay').classList.remove('show');
      document.getElementById('updatePassOverlay').classList.add('show');
    }
  });
}

function getUserEmailPrefix(email) {
  if (typeof email !== 'string') return 'User';
  const trimmed = email.trim();
  if (!trimmed) return 'User';
  return trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
}

function getUserDisplayName(user) {
  const meta = user?.user_metadata || {};
  const metaName = [meta.first_name, meta.last_name].filter(Boolean).join(' ').trim()
    || meta.username
    || meta.full_name
    || '';

  if (metaName) return metaName;
  return getUserEmailPrefix(user?.email);
}

function getInitials(name) {
  if (!name) return '👤';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  const cleanName = name.replace(/[^a-zA-Z0-9]/g, '');
  if (cleanName.length >= 2) return (cleanName[0] + cleanName[1]).toUpperCase();
  if (cleanName.length === 1) return cleanName[0].toUpperCase();
  return '👤';
}

function updateAuthUI() {
  const addBtn = document.getElementById('addBtn');
  const gateway = document.getElementById('welcomeGateway');
  const guestViewControls = document.getElementById('guestViewControls');
  const profileDropdown = document.getElementById('profileDropdown');
  const userAvatar = document.getElementById('userAvatar');
  const profileEmail = document.getElementById('profileEmail');

  const historyBtn = document.getElementById('historyBtn');
  const exportMenu = document.getElementById('exportMenu');
  const importMenu = document.getElementById('importMenu');
  
  if (currentUser) {
    gateway.classList.add('hidden');
    addBtn.style.display = 'inline-flex';
    if (historyBtn) historyBtn.style.display = 'inline-flex';
    if (exportMenu) exportMenu.style.display = 'inline-block';
    if (importMenu) importMenu.style.display = 'inline-block';
    
    guestViewControls.style.display = 'none';
    profileDropdown.style.display = 'inline-block';
    
    const displayName = getUserDisplayName(currentUser);
    userAvatar.textContent = getInitials(displayName);
    profileEmail.textContent = displayName;
  } else {
    addBtn.style.display = 'none';
    if (historyBtn) historyBtn.style.display = 'none';
    if (exportMenu) exportMenu.style.display = 'none';
    if (importMenu) importMenu.style.display = 'none';

    guestViewControls.style.display = 'flex';
    profileDropdown.style.display = 'none';
  }

  if (!gateway.classList.contains('hidden')) {
    lockBodyScroll();
  } else {
    unlockBodyScroll();
  }

  render();
}

document.getElementById('headerLoginBtn').addEventListener('click', () => {
  document.getElementById('authOverlay').classList.add('show');
});

const welcomeGateway = document.getElementById('welcomeGateway');

document.getElementById('gateGuestBtn').addEventListener('click', () => {
  welcomeGateway.classList.add('hidden');
  unlockBodyScroll();
});

document.getElementById('gateLoginBtn').addEventListener('click', () => {
  welcomeGateway.classList.add('hidden');
  document.getElementById('authOverlay').classList.add('show');
  unlockBodyScroll();
});

document.getElementById('cancelAuthBtn').addEventListener('click', () => {
  authOverlay.classList.remove('show');
  authForm.reset();
});

document.getElementById('toggleAuthModeBtn').addEventListener('click', (e) => {
  isSignUpMode = !isSignUpMode;
  document.getElementById('authModalTitle').textContent = isSignUpMode ? 'Create Account' : 'Account Login';
  document.getElementById('submitAuthBtn').textContent = isSignUpMode ? 'Sign Up' : 'Login';
  e.target.textContent = isSignUpMode ? 'Already have an account? Login' : 'Need an account? Sign up';
  
  const usernameFields = document.getElementById('usernameFields');
  usernameFields.style.display = isSignUpMode ? 'block' : 'none';
  document.getElementById('auth_first_name').required = isSignUpMode;
  document.getElementById('auth_last_name').required = isSignUpMode;
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('auth_email').value;
  const password = document.getElementById('auth_password').value;
  
  document.getElementById('submitAuthBtn').textContent = 'Processing...';

  if (isSignUpMode) {
    const firstName = document.getElementById('auth_first_name').value.trim();
    const lastName = document.getElementById('auth_last_name').value.trim();
    const fullName = `${firstName} ${lastName}`.trim();

    const { error } = await supabaseClient.auth.signUp({ 
      email, 
      password, 
      options: { 
        data: { 
          username: fullName,
          first_name: firstName,
          last_name: lastName 
        } 
      }
    });
    
    if (error) {
      let customMsg = error.message;
      if (error.message.toLowerCase().includes('signups not allowed') || error.message.toLowerCase().includes('disabled')) {
        customMsg = `
          The email address used to sign up is <strong style="color: var(--red);">not permitted</strong> by system policy.<br><br>
          <span style="color: var(--muted); font-size: 13px;">Please reach out to obtain access:</span><br>
          <div style="margin-top: 12px; display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; background: rgba(49, 132, 209, 0.12); border: 1px solid var(--amber); border-radius: 8px; color: var(--white); font-weight: 600; font-size: 13px;">
            <i data-lucide="shield-check" style="width: 16px; height: 16px; color: var(--amber);"></i> Contact Admin: <span style="color: var(--amber);">Dan Caleb</span>
          </div>
        `;
      }
      customAlert(customMsg, "Sign Up Restricted", "error");
    } else {
      customAlert('Sign up successful! You can now log in.', "Success", "success");
      isSignUpMode = false;
      document.getElementById('toggleAuthModeBtn').click();
    }
  } else {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) customAlert(error.message, "Login Failed", "error");
    else {
      authOverlay.classList.remove('show');
      authForm.reset();
      flashToast('Logged in successfully');
    }
  }
  document.getElementById('submitAuthBtn').textContent = isSignUpMode ? 'Sign Up' : 'Login';
});

const forgotOverlay = document.getElementById('forgotOverlay');
const updatePassOverlay = document.getElementById('updatePassOverlay');

document.getElementById('forgotPassLink').addEventListener('click', () => {
  document.getElementById('authOverlay').classList.remove('show');
  forgotOverlay.classList.add('show');
});

document.getElementById('cancelForgotBtn').addEventListener('click', () => {
  forgotOverlay.classList.remove('show');
  document.getElementById('forgotForm').reset();
});

document.getElementById('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('forgot_email').value.trim();
  const btn = document.getElementById('submitForgotBtn');
  btn.textContent = 'Sending...';

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });

  if (error) {
    customAlert(error.message, "Error", "error");
  } else {
    customAlert("Reset link sent! Check your email inbox. (Supabase)", "Email Sent", "success");
    forgotOverlay.classList.remove('show');
  }
  btn.textContent = 'Send Link';
  document.getElementById('forgotForm').reset();
});

document.getElementById('updatePassForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const newPassword = document.getElementById('new_password').value;
  
  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
  
  if (error) {
    customAlert(error.message, "Update Failed", "error");
  } else {
    flashToast('Password updated successfully!');
    updatePassOverlay.classList.remove('show');
    document.getElementById('updatePassForm').reset();
  }
});

document.getElementById('menuLogout').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  flashToast('Logged out successfully');
  document.getElementById('welcomeGateway').classList.remove('hidden');
});

const accountOverlay = document.getElementById('accountOverlay');
const accountForm = document.getElementById('accountForm');

document.getElementById('menuChangePass').addEventListener('click', () => {
  const meta = currentUser.user_metadata || {};
  document.getElementById('acc_first_name').value = meta.first_name || meta.username?.split(' ')[0] || '';
  document.getElementById('acc_last_name').value = meta.last_name || meta.username?.split(' ').slice(1).join(' ') || '';
  accountOverlay.classList.add('show');
});

document.getElementById('cancelAccountBtn').addEventListener('click', () => {
  accountOverlay.classList.remove('show');
  accountForm.reset();
});

accountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const firstName = document.getElementById('acc_first_name').value.trim();
  const lastName = document.getElementById('acc_last_name').value.trim();
  const newPassword = document.getElementById('acc_password').value;
  const fullName = `${firstName} ${lastName}`.trim();
  
  const updates = { 
    data: { 
      username: fullName,
      first_name: firstName,
      last_name: lastName
    } 
  };
  if (newPassword) updates.password = newPassword; 

  const { error } = await supabaseClient.auth.updateUser(updates);
  
  if (error) {
    customAlert(error.message, "Update Failed", "error");
  } else {
    flashToast('Account settings updated!');
    accountOverlay.classList.remove('show');
    accountForm.reset();
    updateAuthUI(); 
  }
});

// ========== SHOW/HIDE PASSWORD TOGGLE ==========
function bindPasswordToggles() {
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const input = e.currentTarget.previousElementSibling;
      const icon = e.currentTarget.querySelector('i');
      if (input.type === 'password') {
        input.type = 'text';
        icon.setAttribute('data-lucide', 'eye-off');
      } else {
        input.type = 'password';
        icon.setAttribute('data-lucide', 'eye');
      }
      if (window.lucide) lucide.createIcons();
    });
  });
}
document.addEventListener('DOMContentLoaded', bindPasswordToggles);

// ========== SEED DATA & CATEGORY COLORS ==========
const CATEGORY_COLORS = {
  "Drums": "#d97740", "Bass Rig": "#e8a33d", "Electric Guitar Rig": "#d3554a",
  "Acoustic & Classical": "#5fa777", "Keyboard": "#4fa8a0", "In-Ear Monitors": "#9575b0",
  "Spares & Shared": "#4e7fb0", "Unassigned - Needs Review": "#8b92a0", "Others": "#8b92a0"
};

function colorFor(cat) { return CATEGORY_COLORS[cat] || "#7a8290"; }

// ========== DATA FETCHING & REAL-TIME SYNC ==========
async function loadData() {
  const now = new Date();
  const lastUpdatedEl = document.getElementById('lastUpdated');
  lastUpdatedEl.textContent = 'Syncing...';
  lastUpdatedEl.classList.remove('live');
  lastUpdatedEl.classList.add('syncing');

  const { data: invData, error: invErr } = await supabaseClient.from('inventory').select('*').is('deleted_at', null);
  if (invErr) console.error(invErr);
  else {
    items = (invData || []).sort((a, b) => {
      if (a.category === b.category) return a.item.localeCompare(b.item);
      return a.category.localeCompare(b.category);
    });
  }

  const { data: histData } = await supabaseClient.from('history_log').select('*').order('timestamp', { ascending: false }).limit(200);
  history = histData || [];

  lastUpdatedEl.textContent = 'Live • Synced ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  lastUpdatedEl.classList.remove('syncing');
  lastUpdatedEl.classList.add('live');
  render();
}

supabaseClient.channel('custom-all-channel')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => {
    loadData();
  })
  .subscribe();

// ========== CLOUD DATABASE ACTIONS ==========
async function logAction(action, itemData, prevData = null) {
  if (!currentUser) return;
  const entry = {
    id: 'h_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    action: action,
    item_id: itemData.id,
    item_data: itemData,
    prev_data: prevData,
    user_email: currentUser.email,
    undone: false
  };
  
  const { error } = await supabaseClient.from('history_log').insert([entry]);
  if(error) {
     customAlert(error.message, "Logging Issue", "error");
  }
}

function isOnLoan(item) {
  if (item.borrower && item.borrower.trim() !== '') return true;
  const text = ((item.remarks || '') + ' ' + (item.owner || '')).toLowerCase();
  return /\b(lent|borrow\w*|loan\w*)\b/i.test(text);
}

// ========== UI UTILITIES & RENDERING ==========
function flashToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2000);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m]));
}

function statusBadge(c) {
  if (c === 'missing') return '<span class="badge missing">Missing</span>';
  if (c === 'repair') return '<span class="badge repair">Needs repair</span>';
  return '<span class="badge working">Working</span>';
}

function uniqueCategories() { return [...new Set(items.map(i => i.category))]; }

function populateFilters() {
  const cats = uniqueCategories();
  const sel = document.getElementById('filterCat');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = cur;
  document.getElementById('catList').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
}

function renderStats() {
  const currentStatus = document.getElementById('filterStatus').value;
  const currentLoan = document.getElementById('filterLoan').value;

  const stats = [
    { type: 'all', n: items.length, l: 'Logged items', cls: '' },
    { type: 'all', n: items.reduce((a, i) => a + (Number(i.qty) || 0), 0), l: 'Total units', cls: '' },
    { type: 'working', n: items.filter(i => i.condition === 'working').length, l: 'Working', cls: `ok ${currentStatus === 'working' ? 'active' : ''}` },
    { type: 'flagged', n: items.filter(i => i.condition !== 'working').length, l: 'Flagged', cls: `${items.filter(i => i.condition !== 'working').length > 0 ? 'bad' : ''} ${(currentStatus === 'flagged' || currentStatus === 'repair' || currentStatus === 'missing') ? 'active' : ''}` },
    { type: 'loan', n: items.filter(isOnLoan).length, l: 'On loan', cls: currentLoan === 'loaned' ? 'active' : '' },
  ];

  document.getElementById('stats').innerHTML = stats.map(s => `
    <div class="stat ${s.cls}" data-stat="${s.type}">
      <div class="n">${s.n}</div>
      <div class="l">${s.l}</div>
    </div>
  `).join('');
}

document.getElementById('stats').addEventListener('click', (e) => {
  const card = e.target.closest('.stat');
  if (!card) return;

  const type = card.dataset.stat;
  const filterStatus = document.getElementById('filterStatus');
  const filterLoan = document.getElementById('filterLoan');

  if (type === 'all') {
    filterStatus.value = '';
    filterLoan.value = '';
  } else if (type === 'working') {
    filterStatus.value = (filterStatus.value === 'working') ? '' : 'working';
    filterLoan.value = '';
  } else if (type === 'flagged') {
    filterStatus.value = (filterStatus.value === 'flagged' || filterStatus.value === 'repair' || filterStatus.value === 'missing') ? '' : 'flagged';
    filterLoan.value = '';
  } else if (type === 'loan') {
    filterLoan.value = (filterLoan.value === 'loaned') ? '' : 'loaned';
    filterStatus.value = '';
  }

  render(); 
});

function getFiltered() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const cat = document.getElementById('filterCat').value;
  const status = document.getElementById('filterStatus').value;
  const loan = document.getElementById('filterLoan').value;

  return items.filter(i => {
    if (cat && i.category !== cat) return false;

    if (status === 'flagged') {
      if (i.condition === 'working') return false;
    } else if (status && i.condition !== status) {
      return false;
    }
    
    if (loan === 'loaned' && !isOnLoan(i)) return false;
    if (q) {
      const hay = [i.item, i.brand, i.owner, i.location, i.checkedBy, i.remarks, i.category].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderGearCard(item) {
  const onLoan = isOnLoan(item);
  const loanBadge = onLoan ? '<span class="badge loaned">On Loan</span>' : '';
  
  const authControls = currentUser ? `
    <div class="status-buttons">
      <button class="status-btn ${item.condition === 'working' ? 'active' : ''}" data-status="working"><i data-lucide="check-circle-2" style="width: 12px; height: 12px; margin-right: 4px;"></i> OK</button>
      <button class="status-btn ${item.condition === 'repair' ? 'active' : ''}" data-status="repair"><i data-lucide="wrench" style="width: 12px; height: 12px; margin-right: 4px;"></i> Fix</button>
      <button class="status-btn ${item.condition === 'missing' ? 'active' : ''}" data-status="missing"><i data-lucide="alert-triangle" style="width: 12px; height: 12px; margin-right: 4px;"></i> Lost</button>
    </div>
    <div class="foot">
      <div class="meta">Checked ${esc(item.dateChecked)} · ${esc(item.checkedBy)}</div>
      <div class="acts">
        <button class="icon-btn" title="View Details" data-act="view"><i data-lucide="image" style="width: 16px; height: 16px;"></i></button>
        <button class="icon-btn edit-btn" title="Edit" data-act="edit"><i data-lucide="edit-2" style="width: 16px; height: 16px;"></i></button>
        <button class="icon-btn del-btn" title="Delete" data-act="del"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></button>
      </div>
    </div>
  ` : `
    <div class="foot" style="margin-top: 12px; border-top: 1px dashed var(--line); padding-top: 8px;">
      <div class="meta">Checked ${esc(item.dateChecked)} · ${esc(item.checkedBy)}</div>
      <div class="acts">
        <button class="icon-btn" title="View Details" data-act="view"><i data-lucide="image" style="width: 16px; height: 16px;"></i></button>
      </div>
    </div>
  `;

  return `
    <div class="tag" data-id="${item.id}">
      <div class="band" style="background:${colorFor(item.category)}"></div>
      
      <div class="tag-header-wrapper">
        <div class="item-name">${esc(item.item)} ${Number(item.qty) > 1 ? `<span style="color: var(--muted);">×${esc(item.qty)}</span>` : ''}</div>
        <div class="brand">${item.brand && item.brand !== 'N/A' ? esc(item.brand) : 'No brand listed'}</div>
      </div>

      <div class="list-status-indicator">
        ${statusBadge(item.condition)}
        <i data-lucide="chevron-right" style="width: 16px; height: 16px; color: var(--muted-2);"></i>
      </div>

      ${item.serial ? `<div class="row"><span>Serial/ID</span><b style="font-family: 'Plus Jakarta Sans', sans-serif; color: var(--muted);">${esc(item.serial)}</b></div>` : ''}
      <div class="row"><span>Status</span>${statusBadge(item.condition)}</div>
      ${onLoan ? `<div class="row"><span>Loan status</span>${loanBadge}</div>` : ''}
      <div class="row"><span>Owner</span><b>${esc(item.owner)}</b></div>
      <div class="row"><span>Location</span><b>${esc(item.location)}</b></div>
      ${item.borrower ? `<div class="row"><span>Borrower</span><b style="color: var(--blue);">${esc(item.borrower)}</b></div>` : ''}
      ${item.returnDate ? `<div class="row"><span>Return Date</span><b style="color: var(--red);">${esc(item.returnDate)}</b></div>` : ''}
      ${item.remarks ? `<div class="remark">${esc(item.remarks)}</div>` : ''}
      
      ${authControls}
    </div>
  `;
}

function render() {
  populateFilters();
  renderStats();
  const filtered = getFiltered();
  const content = document.getElementById('content');

  if (filtered.length === 0) {
    content.innerHTML = `<div class="empty">No gear matches this search.</div>`;
    return;
  }

  const byCat = {};
  filtered.forEach(i => { (byCat[i.category] = byCat[i.category] || []).push(i); });

  content.innerHTML = Object.keys(byCat).map(cat => {
    const list = byCat[cat];
    return `
      <div class="cat-section">
        <div class="cat-hdr" title="Click to collapse/expand section">
          <div class="cat-swatch" style="background:${colorFor(cat)}"></div>
          <h2>${esc(cat)}</h2><span class="count">${list.length} item${list.length !== 1 ? 's' : ''}</span>
          <div class="rule"></div>
          <div class="cat-chevron">▼</div>
        </div>
        <div class="grid">${list.map(i => renderGearCard(i)).join('')}</div>
      </div>
    `;
  }).join('');

  applyViewMode(currentViewMode); 

  setTimeout(() => { 
    if (window.lucide) { lucide.createIcons(); }
  }, 10);
}

// ========== MODAL: ADD/EDIT ==========
const overlay = document.getElementById('overlay');
const form = document.getElementById('itemForm');
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('f_image_file');
const fileNameDisplay = document.getElementById('fileNameDisplay');
const uploadStatus = document.getElementById('uploadStatus');

function setUploadZoneIcon(iconName, color) {
  const iconContainer = uploadZone?.querySelector('.upload-zone-icon');
  if (!iconContainer) return;

  iconContainer.innerHTML = `<i data-lucide="${iconName}" style="width: 24px; height: 24px; color: ${color}; margin-bottom: 8px;"></i>`;
  if (window.lucide) lucide.createIcons();
}

function renderThumbnails() {
  const container = document.getElementById('imageThumbnails');
  if (!container) return;

  container.querySelectorAll('img[data-preview-url]').forEach(img => {
    URL.revokeObjectURL(img.dataset.previewUrl);
  });
  container.replaceChildren();

  const total = existingUrls.length + newFiles.length;
  if (fileNameDisplay) {
    fileNameDisplay.textContent = total > 0 ? `${total} / 4 images selected` : 'Click to browse images';
  }
  uploadZone?.classList.toggle('has-file', total > 0);
  setUploadZoneIcon(total > 0 ? 'check-circle' : 'images', total > 0 ? 'var(--green)' : 'var(--muted)');

  const appendThumbnail = (src, source, index, isPreview = false) => {
    const box = document.createElement('div');
    box.className = 'thumb-box';

    const img = document.createElement('img');
    img.src = src;
    img.alt = `Gear photo ${index + 1}`;
    if (isPreview) img.dataset.previewUrl = src;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'thumb-remove';
    removeBtn.dataset.source = source;
    removeBtn.dataset.index = String(index);
    removeBtn.setAttribute('aria-label', `Remove gear photo ${index + 1}`);
    removeBtn.innerHTML = '<i data-lucide="x" style="width: 14px; height: 14px;"></i>';

    box.append(img, removeBtn);
    container.appendChild(box);
  };

  existingUrls.forEach((url, index) => appendThumbnail(url, 'existing', index));
  newFiles.forEach((file, index) => {
    appendThumbnail(URL.createObjectURL(file), 'new', index, true);
  });

  if (window.lucide) lucide.createIcons();
}

function resetUploadZone() {
  const hiddenImageInput = document.getElementById('f_image');
  if (fileInput) fileInput.value = '';
  existingUrls = [];
  newFiles = [];
  if (hiddenImageInput) hiddenImageInput.value = '';
  if (uploadStatus) {
    uploadStatus.style.display = 'none';
    uploadStatus.textContent = '';
  }
  renderThumbnails();
}

if (uploadZone && fileInput) {
  uploadZone.addEventListener('click', e => {
    if (e.target !== fileInput) fileInput.click();
  });

  uploadZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  document.getElementById('imageThumbnails')?.addEventListener('click', e => {
    const removeBtn = e.target.closest('.thumb-remove');
    if (!removeBtn) return;

    const index = Number(removeBtn.dataset.index);
    if (removeBtn.dataset.source === 'existing') existingUrls.splice(index, 1);
    else if (removeBtn.dataset.source === 'new') newFiles.splice(index, 1);
    renderThumbnails();
  });

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    let limitReached = false;
    for (const file of files) {
      if (existingUrls.length + newFiles.length >= 4) {
        limitReached = true;
        break;
      }
      if (!file.type.startsWith('image/')) {
        customAlert(`File ${file.name} is not an image.`, 'Invalid File', 'error');
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        customAlert(`File ${file.name} is larger than 5MB.`, 'Too Large', 'error');
        continue;
      }
      newFiles.push(file);
    }

    fileInput.value = '';
    renderThumbnails();
    if (limitReached) {
      customAlert('You can only upload up to 4 images per item.', 'Limit Reached', 'info');
    }
  });
}

function openModal(item) {
  if (!currentUser) {
    customAlert("You must be logged in to edit items.", "Access Denied", "error");
    return;
  }
  resetUploadZone();
  editingId = item ? item.id : null;
  document.getElementById('modalTitle').textContent = item ? 'Edit item' : 'Add item';
  document.getElementById('f_category').value = item?.category || '';
  document.getElementById('f_item').value = item?.item || '';
  document.getElementById('f_brand').value = item?.brand === 'N/A' ? '' : (item?.brand || '');
  document.getElementById('f_qty').value = item?.qty ?? 1;
  document.getElementById('f_condition').value = item?.condition || 'working';
  document.getElementById('f_owner').value = item?.owner || 'Church Property';
  document.getElementById('f_location').value = item?.location || 'Stage';
  document.getElementById('f_checkedBy').value = item?.checkedBy || getUserEmailPrefix(currentUser?.email);
  document.getElementById('f_date').value = item?.dateChecked || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('f_remarks').value = item?.remarks || '';
  document.getElementById('f_borrower').value = item?.borrower || '';
  document.getElementById('f_returnDate').value = item?.returnDate || '';
  document.getElementById('f_serial').value = item?.serial || '';
  document.getElementById('f_description').value = item?.description || '';
  existingUrls = parseImages(item?.image_filename);
  newFiles = [];
  renderThumbnails();
  overlay.classList.add('show');
}

function closeModal() {
  overlay.classList.remove('show');
  editingId = null;
  form.reset();
  resetUploadZone();
}
document.getElementById('addBtn').onclick = () => openModal(null);
document.getElementById('cancelBtn').onclick = closeModal;
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentUser) return;

  const uploadCount = newFiles.length;
  let uploadedCount = 0;

  while (newFiles.length > 0) {
    const file = newFiles[0];
    const fileExt = file.name.split('.').pop();
    const filePath = `${Date.now()}_${uploadedCount}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;

    uploadStatus.style.display = 'block';
    uploadStatus.textContent = `Uploading image ${uploadedCount + 1} of ${uploadCount}...`;

    const { error: uploadError } = await supabaseClient
      .storage
      .from('gear-photos')
      .upload(filePath, file);

    if (uploadError) {
      uploadStatus.style.display = 'none';
      renderThumbnails();
      customAlert(`Failed to upload ${file.name}: ${uploadError.message}`, 'Upload Error', 'error');
      return;
    }

    const { data: urlData } = supabaseClient
      .storage
      .from('gear-photos')
      .getPublicUrl(filePath);

    existingUrls.push(urlData.publicUrl);
    newFiles.shift();
    uploadedCount++;
  }
  uploadStatus.style.display = 'none';
  renderThumbnails();
  const savedImageString = existingUrls.length > 0 ? JSON.stringify(existingUrls) : '';

  const data = {
    category: document.getElementById('f_category').value.trim() || 'Others',
    item: document.getElementById('f_item').value.trim(),
    brand: document.getElementById('f_brand').value.trim() || 'N/A',
    qty: Number(document.getElementById('f_qty').value) || 1,
    condition: document.getElementById('f_condition').value,
    owner: document.getElementById('f_owner').value.trim() || 'Church Property',
    location: document.getElementById('f_location').value.trim() || 'Stage',
    checkedBy: document.getElementById('f_checkedBy').value.trim() || '—',
    dateChecked: document.getElementById('f_date').value.trim(),
    remarks: document.getElementById('f_remarks').value.trim(),
    borrower: document.getElementById('f_borrower').value.trim(),
    returnDate: document.getElementById('f_returnDate').value,
    serial: document.getElementById('f_serial').value.trim(),
    description: document.getElementById('f_description').value.trim(),
    image_filename: savedImageString
  };

  if (editingId) {
    const prevItem = items.find(i => i.id === editingId);
    
    const { error: err } = await supabaseClient.from('inventory').update(data).eq('id', editingId);
    if(err){ customAlert(err.message, "Save Failed", "error"); return; }
    
    await logAction('updated', { id: editingId, ...data }, prevItem);
  } else {
    const newItem = { id: 'item_' + Date.now(), ...data };
    
    const { error: err } = await supabaseClient.from('inventory').insert([newItem]);
    if(err){ customAlert(err.message, "Save Failed", "error"); return; }
    
    await logAction('added', newItem);
  }
  
  if (uploadStatus) uploadStatus.style.display = 'none';
  closeModal();
  await loadData();
  flashToast('Item saved to database');
});


// ========== CARD ACTIONS ==========
document.addEventListener('click', async e => {
  const hdr = e.target.closest('.cat-hdr');
  if (hdr) {
    const grid = hdr.nextElementSibling;
    const chevron = hdr.querySelector('.cat-chevron');
    grid.classList.toggle('collapsed');
    if (chevron) chevron.classList.toggle('collapsed');
    return;
  }

  const card = e.target.closest('.tag');
  if (!card) return;

  const isInsideModal = e.target.closest('#viewItemBody');

  if (currentViewMode === 'list' && !e.target.closest('button') && !isInsideModal) {
    const id = card.dataset.id;
    const item = items.find(i => i.id === id);
    
    const brandText = item.brand && item.brand !== 'N/A' ? esc(item.brand) : 'No brand listed';
    document.getElementById('viewItemTitle').innerHTML = `
      <div style="line-height: 1.2;">
        ${esc(item.item)}
        <div style="font-size: 13px; color: var(--muted); text-transform: none; font-weight: 500; font-family: 'Plus Jakarta Sans', sans-serif; margin-top: 4px; letter-spacing: 0;">
          ${brandText}
        </div>
      </div>
    `;
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = renderGearCard(item);
    const innerCard = tempDiv.firstElementChild;
    
    innerCard.style.boxShadow = 'none';
    innerCard.style.border = 'none';
    innerCard.style.background = 'transparent';
    
    const body = document.getElementById('viewItemBody');
    body.innerHTML = '';
    body.appendChild(innerCard);
    
    document.getElementById('viewItemOverlay').classList.add('show');
    setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 10);
    return; 
  }

  const btn = e.target.closest('button[data-act]');
  if (btn && btn.dataset.act === 'view') {
    const id = card.dataset.id;
    const item = items.find(i => i.id === id);
    
    if (isInsideModal) {
      document.getElementById('viewItemOverlay').classList.remove('show');
    }

    document.getElementById('galleryTitle').textContent = item.item;
    document.getElementById('galleryDesc').textContent = item.description || 'No description provided yet.';
    galleryImageUrls = parseImages(item.image_filename);
    currentGalleryIdx = 0;
    updateGalleryCarousel();
    document.getElementById('galleryOverlay').classList.add('show');
    return;
  }

  if (!currentUser) return;

  const statusBtn = e.target.closest('.status-btn');
  if (statusBtn) {
    const id = card.dataset.id;
    const newStatus = statusBtn.dataset.status;
    const prevItem = items.find(i => i.id === id);
    
    if (prevItem.condition !== newStatus) {
      const { error: updErr } = await supabaseClient.from('inventory').update({ condition: newStatus }).eq('id', id);
      if(updErr) { customAlert(updErr.message, "Update Failed", "error"); return; }
      
      await logAction('updated', { ...prevItem, condition: newStatus }, prevItem);
      await loadData();
      
      if (isInsideModal) document.getElementById('viewItemOverlay').classList.remove('show');
    }
    return;
  }

  if (!btn) return;
  const id = card.dataset.id;
  const item = items.find(i => i.id === id);

  if (btn.dataset.act === 'edit') {
    if (isInsideModal) document.getElementById('viewItemOverlay').classList.remove('show');
    openModal(item);
  }
  else if (btn.dataset.act === 'del') {
    if (isInsideModal) document.getElementById('viewItemOverlay').classList.remove('show');
    openConfirmModal(`Move "${item.item}" to trash?`, async () => {
      const now = new Date().toISOString();
      const { error: delErr } = await supabaseClient.from('inventory').update({ deleted_at: now }).eq('id', id);
      if(delErr) { customAlert(delErr.message, "Delete Failed", "error"); return; }
      
      await logAction('deleted', item);
      await loadData();
      flashToast('Item moved to trash');
    }, "Move to Trash", true);
  }
});

document.getElementById('closeGalleryBtn').addEventListener('click', () => {
  document.getElementById('galleryOverlay').classList.remove('show');
});


// ========== SMART HISTORY LOG ==========
function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function generateChangeText(prev, curr) {
  if (!prev) return 'Item added to database';
  
  const changes = [];
  if (prev.condition !== curr.condition) changes.push(`Status changed to ${esc(curr.condition).toUpperCase()}`);
  if (prev.qty !== curr.qty) changes.push(`Qty changed from ${esc(prev.qty)} to ${esc(curr.qty)}`);
  if (prev.location !== curr.location) changes.push(`Moved to ${esc(curr.location)}`);
  if (prev.owner !== curr.owner) changes.push(`Owner changed to ${esc(curr.owner)}`);
  if (prev.borrower !== curr.borrower) changes.push(`Borrower updated`);
  if (prev.remarks !== curr.remarks) changes.push(`Remarks updated`);
  
  return changes.length > 0 ? changes.join(', ') : 'Details updated';
}

function renderHistory() {
  const historyOverlay = document.getElementById('historyOverlay');
  const historyContent = document.getElementById('historyContent');
  
  const searchQuery = (document.getElementById('historySearch').value || '').toLowerCase();
  const actionFilter = document.getElementById('historyFilterAction').value;

  const filteredHistory = history.filter(entry => {
    if (actionFilter && entry.action !== actionFilter) return false;
    if (searchQuery) {
      const itemName = (entry.item_data?.item || '').toLowerCase();
      const userEmail = (entry.user_email || '').toLowerCase();
      if (!itemName.includes(searchQuery) && !userEmail.includes(searchQuery)) return false;
    }
    return true;
  });

  if (filteredHistory.length === 0) {
    historyContent.innerHTML = '<div class="empty">No changes match your search.</div>';
  } else {
    historyContent.innerHTML = filteredHistory.map(entry => {
      const userEmail = entry.user_email || 'unknown';
      const userName = esc(getUserEmailPrefix(userEmail));
      const safeEmail = esc(userEmail);
      
      let changeText = '';
      let actionIcon = '';
      let itemNameDisplay = '';

      if (entry.action === 'import') {
        const insCount = entry.item_data.insertedIds ? entry.item_data.insertedIds.length : 0;
        const updCount = entry.item_data.updatedItems ? entry.item_data.updatedItems.length : 0;
        changeText = `Added ${insCount} items, updated ${updCount} items.`;
        actionIcon = '<i data-lucide="upload-cloud" style="width: 18px; height: 18px;"></i>';
        itemNameDisplay = 'Batch Import';
      } else {
        changeText = entry.action === 'updated' 
          ? generateChangeText(entry.prev_data, entry.item_data) 
          : (entry.action === 'deleted' ? 'Removed from inventory' : 'Added to inventory');
        actionIcon = entry.action === 'added' ? '<i data-lucide="plus" style="width: 18px; height: 18px;"></i>' : 
                     entry.action === 'updated' ? '<i data-lucide="edit-2" style="width: 18px; height: 18px;"></i>' : 
                     '<i data-lucide="trash-2" style="width: 18px; height: 18px;"></i>';
        itemNameDisplay = esc(entry.item_data.item);
      }

      const isUndone = entry.undone;
      const opacity = isUndone ? '0.5' : '1';
      const textDecoration = isUndone ? 'line-through' : 'none';

      const canUndo = currentUser && !isUndone && (
        (entry.action === 'updated' && entry.prev_data) ||
        (entry.action === 'import')
      );
      const canRestore = currentUser && !isUndone && entry.action === 'deleted';

      return `
      <div class="history-item ${entry.action}" style="opacity: ${opacity};">
        <div class="icon">${actionIcon}</div>
        <div class="content">
          <div class="action-label" style="display:flex; justify-content:space-between;">
            <span style="text-decoration: ${textDecoration};">${entry.action.toUpperCase()}</span>
            <div style="text-align: right;">
               <div style="color: var(--amber); font-weight: 600; text-transform:none;">${userName}</div>
               <div style="color: var(--muted-2); font-size: 9px; text-transform:none;">${safeEmail}</div>
            </div>
          </div>
          <div class="item-desc" style="text-decoration: ${textDecoration};">${itemNameDisplay}</div>
          <div style="font-size: 11px; color: var(--muted); margin-bottom: 4px; font-style: italic; text-decoration: ${textDecoration};">
            ↳ ${changeText}
          </div>
          <div class="time">${formatDate(entry.timestamp)} ${isUndone ? '<span style="color: var(--red); font-weight: bold; margin-left: 8px;">(UNDONE)</span>' : ''}</div>
        </div>
        ${canRestore ? `<button class="restore-btn" data-entry-id="${entry.id}">Restore</button>` : ''}
        ${canUndo ? `<button class="undo-btn" data-entry-id="${entry.id}">Undo</button>` : ''}
      </div>
    `}).join('');

    historyContent.querySelectorAll('.restore-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const entry = history.find(h => h.id === e.target.dataset.entryId);
        if (entry) {
          const { error: updErr1 } = await supabaseClient.from('inventory').update({ deleted_at: null }).eq('id', entry.item_data.id);
          if (updErr1) { customAlert(updErr1.message, "Restore Failed", "error"); return; }
          
          const { error: updErr2 } = await supabaseClient.from('history_log').update({ undone: true }).eq('id', entry.id);
          if (updErr2) { customAlert(updErr2.message, "Log Issue", "error"); return; }
          
          await logAction('added', entry.item_data);
          await loadData();
          renderHistory();
          flashToast('Item restored!');
        }
      });
    });

    historyContent.querySelectorAll('.undo-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const entry = history.find(h => h.id === e.target.dataset.entryId);
        if (entry) {
          if (entry.action === 'import') {
            const { insertedIds, updatedItems } = entry.item_data;
            
            if (insertedIds && insertedIds.length > 0) {
              const now = new Date().toISOString();
              const { error: delErr } = await supabaseClient.from('inventory').update({ deleted_at: now }).in('id', insertedIds);
              if (delErr) { customAlert(delErr.message, "Undo Failed", "error"); return; }
            }
            
            if (updatedItems && updatedItems.length > 0) {
              for (const u of updatedItems) {
                const { error: updErr } = await supabaseClient.from('inventory').update(u.prev_data).eq('id', u.id);
                if (updErr) { customAlert(updErr.message, "Undo Failed", "error"); return; }
              }
            }
            
            await supabaseClient.from('history_log').update({ undone: true }).eq('id', entry.id);
            await loadData();
            renderHistory();
            flashToast('Import undone!');
          } else {
            const currentItem = items.find(i => i.id === entry.item_data.id);
            
            const { error: updErr1 } = await supabaseClient.from('inventory').update(entry.prev_data).eq('id', entry.item_data.id);
            if (updErr1) { customAlert(updErr1.message, "Undo Failed", "error"); return; }
            
            const { error: updErr2 } = await supabaseClient.from('history_log').update({ undone: true }).eq('id', entry.id); 
            if (updErr2) { customAlert(updErr2.message, "Log Issue", "error"); return; }
            
            await logAction('updated', entry.prev_data, currentItem);
            await loadData();
            renderHistory();
            flashToast('Changes undone!');
          }
        }
      });
    });
  }
  historyOverlay.classList.add('show');
  
  setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 10);
}

document.getElementById('historySearch').addEventListener('input', renderHistory);
document.getElementById('historyFilterAction').addEventListener('change', renderHistory);
document.getElementById('historyBtn').addEventListener('click', renderHistory);
document.getElementById('closeHistoryBtn').addEventListener('click', () => document.getElementById('historyOverlay').classList.remove('show'));

// ========== PRINT VIEW MODAL ==========
function renderPrintView() {
  const printOverlay = document.getElementById('printOverlay');
  const printContent = document.getElementById('printContent');
  const printDate = document.getElementById('printDate');
  const catFilter = document.getElementById('printCategoryFilter');

  const cats = uniqueCategories();
  const currentCat = catFilter.value;
  catFilter.innerHTML = '<option value="">All Categories (Full Log)</option>' + 
                        cats.map(c => `<option value="${esc(c)}">Print: ${esc(c)}</option>`).join('');
  if (cats.includes(currentCat)) catFilter.value = currentCat;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  printDate.textContent = 'Equipment Checklist • ' + today;

  const selectedCat = catFilter.value;
  const itemsToPrint = selectedCat ? items.filter(i => i.category === selectedCat) : items;

  const byCat = {};
  itemsToPrint.forEach(i => {
    (byCat[i.category] = byCat[i.category] || []).push(i);
  });

  printContent.innerHTML = Object.keys(byCat).map(cat => {
    const list = byCat[cat];
    const rows = list.map(i => `
      <tr>
        <td><div class="print-checkbox"></div></td>
        <td>${esc(i.item)}</td>
        <td>${i.brand !== 'N/A' ? esc(i.brand) : '—'}</td>
        <td style="text-align: center;">${i.qty}</td>
        <td>${esc(i.location)}</td>
        <td>${esc(i.owner)}</td>
      </tr>
    `).join('');

    return `
      <div class="print-section">
        <h3>${esc(cat)}</h3>
        <table class="print-table">
          <thead>
            <tr>
              <th style="width: 30px;"></th>
              <th>Equipment</th>
              <th>Brand</th>
              <th style="width: 50px;">Qty</th>
              <th>Location</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }).join('');

  printOverlay.classList.add('show');
}

document.getElementById('printCategoryFilter').addEventListener('change', renderPrintView);
document.getElementById('printBtn').addEventListener('click', renderPrintView);
document.getElementById('closePrintBtn').addEventListener('click', () => {
  document.getElementById('printOverlay').classList.remove('show');
});
document.getElementById('printOverlay').addEventListener('click', e => {
  if (e.target.id === 'printOverlay') document.getElementById('printOverlay').classList.remove('show');
});

// ========== DATA EXPORT & IMPORT ==========
function exportToJSON() {
  const data = {
    exportDate: new Date().toISOString(),
    items: items,
    history: history,
    stats: {
      totalItems: items.length,
      totalUnits: items.reduce((a, i) => a + (Number(i.qty) || 0), 0)
    }
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stage-log-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  flashToast('Exported as JSON');
}

function exportToCSV() {
  const headers = ['Category', 'Item', 'Brand', 'Qty', 'Condition', 'Owner', 'Location', 'Date Checked', 'Checked By', 'Remarks', 'Borrower', 'Return Date', 'Serial Number'];
  const rows = items.map(i => [
    i.category, i.item, i.brand, i.qty, i.condition, i.owner, i.location,
    i.dateChecked, i.checkedBy, i.remarks, (i.borrower || ''), (i.returnDate || ''), (i.serial || '')
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stage-log-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  flashToast('Exported as CSV');
}

document.getElementById('exportJSON').addEventListener('click', exportToJSON);
document.getElementById('exportCSV').addEventListener('click', exportToCSV);

document.getElementById('exportPDF').addEventListener('click', () => {
  flashToast('Generating PDF...');
  
  const pdfContainer = document.createElement('div');
  pdfContainer.style.padding = '30px';
  pdfContainer.style.background = 'white';
  pdfContainer.style.color = 'black';
  pdfContainer.style.fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
  
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  
  let html = `
    <div style="margin-bottom: 24px; border-bottom: 2px solid black; padding-bottom: 16px;">
      <h2 style="margin: 0 0 8px; font-size: 24px; text-transform: uppercase;">Sunday Equipment Checklist</h2>
      <p style="margin: 0; color: #666;">${today}</p>
    </div>
  `;
  
  const cats = uniqueCategories();
  cats.forEach(cat => {
    const list = items.filter(i => i.category === cat);
    if(list.length === 0) return;
    
    let rows = list.map(i => `
      <tr>
        <td style="padding: 6px; border-bottom: 1px solid #eee;"><div style="width:14px; height:14px; border:1px solid #999;"></div></td>
        <td style="padding: 6px; border-bottom: 1px solid #eee; font-weight: bold;">${esc(i.item)}</td>
        <td style="padding: 6px; border-bottom: 1px solid #eee;">${i.brand !== 'N/A' ? esc(i.brand) : '—'}</td>
        <td style="padding: 6px; border-bottom: 1px solid #eee; text-align: center;">${i.qty}</td>
        <td style="padding: 6px; border-bottom: 1px solid #eee;">${esc(i.location)}</td>
        <td style="padding: 6px; border-bottom: 1px solid #eee;">${esc(i.owner)}</td>
      </tr>
    `).join('');
    
    html += `
      <div style="page-break-inside: avoid; margin-bottom: 20px;">
        <h3 style="font-size: 14px; text-transform: uppercase; border-bottom: 2px solid #ddd; padding-bottom: 4px; margin: 0 0 8px;">${esc(cat)}</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
          <thead>
            <tr style="background: #f0f0f0;">
              <th style="width: 20px; padding: 6px;"></th>
              <th style="padding: 6px;">Equipment</th>
              <th style="padding: 6px;">Brand</th>
              <th style="width: 40px; padding: 6px;">Qty</th>
              <th style="padding: 6px;">Location</th>
              <th style="padding: 6px;">Owner</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  });
  
  html += `
    <div style="margin-top: 40px; display: flex; justify-content: space-between; page-break-inside: avoid;">
      <div style="flex: 1; text-align: center; margin-right: 40px;">
        <div style="border-bottom: 1px solid black; height: 30px; margin-bottom: 8px;"></div>
        <p style="font-size: 11px; color: #555; text-transform: uppercase;">Checked By (Signature)</p>
      </div>
      <div style="flex: 1; text-align: center; margin-left: 40px;">
        <div style="border-bottom: 1px solid black; height: 30px; margin-bottom: 8px;"></div>
        <p style="font-size: 11px; color: #555; text-transform: uppercase;">Date & Time</p>
      </div>
    </div>
  `;
  
  pdfContainer.innerHTML = html;
  
  html2pdf().set({
    margin: 10,
    filename:`stage-log-${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).from(pdfContainer).save();
});

// ========== ADVANCED IMPORT WIZARD ==========
document.getElementById('importJSONBtn').addEventListener('click', () => {
  if (!currentUser) {
    customAlert("You must be logged in to import data.", "Access Denied", "error");
    return;
  }
  document.getElementById('importFileInput').click();
});

document.getElementById('importFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const parsedData = JSON.parse(event.target.result);
      if (!parsedData.items || !Array.isArray(parsedData.items)) {
        throw new Error('Invalid file format: Missing items array.');
      }
      pendingImportData = parsedData.items;
      document.getElementById('importWizardOverlay').classList.add('show');
    } catch (error) {
      customAlert('Error importing JSON file: ' + error.message, "Import Error", "error");
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

function parseCSV(text) {
  const lines = [];
  let row = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim()); current = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      row.push(current.trim());
      if (row.some(cell => cell !== '')) lines.push(row);
      row = []; current = '';
    } else { current += char; }
  }
  if (current || row.length > 0) {
    row.push(current.trim());
    if (row.some(cell => cell !== '')) lines.push(row);
  }
  return lines;
}

document.getElementById('importCSVBtn').addEventListener('click', () => {
  if (!currentUser) {
    customAlert("You must be logged in to import CSV data.", "Access Denied", "error");
    return;
  }
  document.getElementById('importCSVFileInput').click();
});

document.getElementById('importCSVFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const rows = parseCSV(event.target.result);
      if (rows.length < 2) throw new Error('CSV file is empty or missing headers.');

      const headers = rows[0].map(h => h.toLowerCase());
      const hasItemHeader = headers.some(h => h.includes('item') || h.includes('equipment'));
      
      if (!hasItemHeader) {
        throw new Error('Invalid CSV structure. Header must contain an "Item" or "Equipment" column.');
      }

      const dataRows = rows.slice(1);
      const newItems = [];

      dataRows.forEach((r, idx) => {
        if (!r[1]) return;
        newItems.push({
          category: r[0] || 'Others',
          item: r[1],
          brand: r[2] || 'N/A',
          qty: Number(r[3]) || 1,
          condition: (r[4] || 'working').toLowerCase(),
          owner: r[5] || 'Church Property',
          location: r[6] || 'Stage',
          dateChecked: r[7] || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
          checkedBy: r[8] || '—',
          remarks: r[9] || '',
          borrower: r[10] || '',
          returnDate: r[11] || '',
          serial: r[12] || ''
        });
      });

      if (newItems.length > 0) {
        pendingImportData = newItems;
        document.getElementById('importWizardOverlay').classList.add('show');
      }
    } catch (error) {
      customAlert('Error reading CSV file: ' + error.message, "Import Error", "error");
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

document.getElementById('cancelImportBtn').addEventListener('click', () => {
  document.getElementById('importWizardOverlay').classList.remove('show');
  pendingImportData = [];
});

document.getElementById('confirmImportBtn').addEventListener('click', async () => {
  const btn = document.getElementById('confirmImportBtn');
  btn.textContent = 'Importing...';
  btn.disabled = true;

  try {
    const mode = document.querySelector('input[name="importMode"]:checked').value;
    const insertedItems = [];
    const updatedItems = [];

    for (const row of pendingImportData) {
      const newId = 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

      if (mode === 'duplicate') {
        row.id = newId;
        insertedItems.push(row);
      } else {
        const match = items.find(i =>
          (row.serial && i.serial === row.serial) ||
          (!row.serial && i.item.toLowerCase() === row.item.toLowerCase())
        );

        if (match) {
          if (mode === 'update') {
            row.id = match.id; 
            updatedItems.push({ newData: row, prevData: match });
          }
        } else {
          row.id = newId;
          insertedItems.push(row);
        }
      }
    }

    if (insertedItems.length > 0) {
      const { error } = await supabaseClient.from('inventory').insert(insertedItems);
      if (error) throw error;
    }

    for (const u of updatedItems) {
      const { error } = await supabaseClient.from('inventory').update(u.newData).eq('id', u.newData.id);
      if (error) throw error;
    }

    if (insertedItems.length > 0 || updatedItems.length > 0) {
      const historyEntry = {
        id: 'h_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        action: 'import',
        item_id: 'batch_import',
        item_data: {
          insertedIds: insertedItems.map(i => i.id),
          updatedItems: updatedItems.map(u => ({ id: u.newData.id, prev_data: u.prevData }))
        },
        user_email: currentUser.email,
        undone: false
      };
      await supabaseClient.from('history_log').insert([historyEntry]);
    }

    await loadData();
    flashToast(`Import complete: ${insertedItems.length} added, ${updatedItems.length} updated.`);
    document.getElementById('importWizardOverlay').classList.remove('show');
  } catch (error) {
    customAlert(error.message, "Import Failed", "error");
  } finally {
    btn.textContent = 'Start Import';
    btn.disabled = false;
    pendingImportData = [];
  }
});

// ========== INIT & EVENT LISTENERS ==========
document.getElementById('search').addEventListener('input', render);
document.getElementById('filterCat').addEventListener('change', render);
document.getElementById('filterStatus').addEventListener('change', render);
document.getElementById('filterLoan').addEventListener('change', render);
document.getElementById('resetBtn').addEventListener('click', () => {
  document.getElementById('search').value = '';
  document.getElementById('filterCat').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterLoan').value = '';
  render();

  setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 10);
});

// ========== CUSTOM SELECT PICKER INTERCEPTOR ==========
const customSelectOverlay = document.getElementById('customSelectOverlay');
const customSelectTitle = document.getElementById('customSelectTitle');
const customSelectList = document.getElementById('customSelectList');
const closeCustomSelectBtn = document.getElementById('closeCustomSelectBtn');

function getSelectTitle(select) {
  if (select.dataset.label) return select.dataset.label;
  const prev = select.previousElementSibling;
  if (prev && prev.tagName === 'LABEL') {
    return prev.textContent.trim();
  }
  if (select.labels && select.labels.length > 0) {
    return select.labels[0].textContent.trim();
  }
  if (select.options && select.options.length > 0 && select.options[0].text) {
    return select.options[0].text.trim();
  }
  return 'Select Option';
}

function openCustomSelect(selectEl) {
  const titleText = getSelectTitle(selectEl);
  customSelectTitle.textContent = titleText;
  customSelectList.innerHTML = '';

  const options = Array.from(selectEl.options);
  const currentValue = selectEl.value;

  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = `custom-select-item ${opt.value === currentValue ? 'selected' : ''}`;
    item.innerHTML = `
      <span>${esc(opt.text)}</span>
      <div class="custom-select-radio"></div>
    `;

    item.addEventListener('click', () => {
      selectEl.value = opt.value;
      selectEl.dispatchEvent(new Event('change'));
      closeCustomSelect();
    });

    customSelectList.appendChild(item);
  });

  customSelectOverlay.classList.add('show');
}

function closeCustomSelect() {
  customSelectOverlay.classList.remove('show');
}

closeCustomSelectBtn.addEventListener('click', closeCustomSelect);
customSelectOverlay.addEventListener('click', (e) => {
  if (e.target === customSelectOverlay) closeCustomSelect();
});

function bindCustomSelects() {
  const selectElements = document.querySelectorAll('select');

  selectElements.forEach(select => {
    let touchStartX = 0;
    let touchStartY = 0;
    let isScrolling = false;

    select.addEventListener('mousedown', (e) => {
      e.preventDefault();
      openCustomSelect(select);
    });

    select.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isScrolling = false;
      }
    }, { passive: true });

    select.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const deltaX = Math.abs(e.touches[0].clientX - touchStartX);
        const deltaY = Math.abs(e.touches[0].clientY - touchStartY);
        if (deltaX > 8 || deltaY > 8) {
          isScrolling = true;
        }
      }
    }, { passive: true });

    select.addEventListener('touchend', (e) => {
      if (!isScrolling) {
        e.preventDefault();
        openCustomSelect(select);
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', bindCustomSelects);

// ========== AUTOMATIC SCROLL LOCK FOR OVERLAYS & MODALS ==========
function checkModalScrollLock() {
  const activeOverlays = document.querySelectorAll('.overlay.show, .gateway-overlay:not(.hidden)');
  if (activeOverlays.length > 0) {
    document.body.classList.add('no-scroll');
  } else {
    document.body.classList.remove('no-scroll');
  }
}

const overlayObserver = new MutationObserver(() => {
  checkModalScrollLock();
});

document.querySelectorAll('.overlay, .gateway-overlay').forEach(overlay => {
  overlayObserver.observe(overlay, { attributes: true, attributeFilter: ['class'] });
});

checkModalScrollLock();

// ========== SMART TOUCH HANDLER FOR DROPDOWNS (EXPORT, IMPORT, PROFILE) ==========
function bindDropdownButtons() {
  const dropdowns = document.querySelectorAll('.dropdown');

  dropdowns.forEach(dropdown => {
    const trigger = dropdown.querySelector('.btn, .avatar');
    if (!trigger) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let isScrolling = false;

    trigger.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isScrolling = false;
      }
    }, { passive: true });

    trigger.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const deltaX = Math.abs(e.touches[0].clientX - touchStartX);
        const deltaY = Math.abs(e.touches[0].clientY - touchStartY);

        if (deltaX > 8 || deltaY > 8) {
          isScrolling = true;
        }
      }
    }, { passive: true });

    trigger.addEventListener('touchend', (e) => {
      if (!isScrolling) {
        e.preventDefault();
        const isOpen = dropdown.classList.contains('open');

        document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));

        if (!isOpen) {
          dropdown.classList.add('open');
        }
      }
    });
  });

  const closeOutside = (e) => {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    }
  };

  document.addEventListener('touchstart', closeOutside, { passive: true });
  document.addEventListener('click', closeOutside);
}

document.addEventListener('DOMContentLoaded', bindDropdownButtons);

// ========== THEME CONTROLLER (LIGHT / DARK) ==========
const themeToggleBtn = document.getElementById('themeToggleBtn');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('wingmacc_theme', theme);

  const themeIcon = document.getElementById('themeIcon');
  if (themeIcon) {
    themeIcon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
    if (window.lucide) lucide.createIcons();
  }
}

const initialTheme = localStorage.getItem('wingmacc_theme') || 'light';
applyTheme(initialTheme);

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    flashToast(`Switched to ${nextTheme === 'dark' ? 'Dark' : 'Light'} Mode`);
  });
}

// ========== VIEW MODE TOGGLE LOGIC ==========
let currentViewMode = localStorage.getItem('wingmacc_view_mode') || 'grid';

function applyViewMode(mode) {
  currentViewMode = mode;
  localStorage.setItem('wingmacc_view_mode', mode);
  
  const icon = document.getElementById('viewToggleIcon');
  if (icon) {
    icon.setAttribute('data-lucide', mode === 'grid' ? 'list' : 'layout-grid');
    if (window.lucide) lucide.createIcons();
  }

  document.querySelectorAll('.grid').forEach(grid => {
    grid.classList.remove('animate-switch');
    void grid.offsetWidth; 
    
    grid.classList.add('animate-switch');
    
    if (mode === 'list') {
      grid.classList.add('list-view');
    } else {
      grid.classList.remove('list-view');
    }
  });
}

document.getElementById('viewToggleBtn').addEventListener('click', () => {
  applyViewMode(currentViewMode === 'grid' ? 'list' : 'grid');
});

document.getElementById('closeViewItemBtn').addEventListener('click', () => {
  document.getElementById('viewItemOverlay').classList.remove('show');
});
document.getElementById('viewItemOverlay').addEventListener('click', e => {
  if (e.target.id === 'viewItemOverlay') document.getElementById('viewItemOverlay').classList.remove('show');
});

// ========== GALLERY CAROUSEL LOGIC ==========
function updateGalleryCarousel() {
  const img = document.getElementById('galleryImage');
  const noImg = document.getElementById('galleryNoImage');
  const prevBtn = document.getElementById('galleryPrevBtn');
  const nextBtn = document.getElementById('galleryNextBtn');
  const counter = document.getElementById('galleryCounter');
  const hasImages = galleryImageUrls.length > 0;
  const hasMultipleImages = galleryImageUrls.length > 1;

  if (hasImages) {
    img.src = galleryImageUrls[currentGalleryIdx];
    img.alt = `Gear image ${currentGalleryIdx + 1} of ${galleryImageUrls.length}`;
    img.style.display = 'block';
    noImg.style.display = 'none';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    noImg.style.display = 'block';
  }

  prevBtn.style.display = hasMultipleImages ? 'flex' : 'none';
  nextBtn.style.display = hasMultipleImages ? 'flex' : 'none';
  counter.style.display = hasMultipleImages ? 'block' : 'none';
  if (hasMultipleImages) {
    counter.textContent = `${currentGalleryIdx + 1} / ${galleryImageUrls.length}`;
  }
}

document.getElementById('galleryPrevBtn')?.addEventListener('click', () => {
  if (galleryImageUrls.length < 2) return;
  currentGalleryIdx = (currentGalleryIdx - 1 + galleryImageUrls.length) % galleryImageUrls.length;
  updateGalleryCarousel();
});

document.getElementById('galleryNextBtn')?.addEventListener('click', () => {
  if (galleryImageUrls.length < 2) return;
  currentGalleryIdx = (currentGalleryIdx + 1) % galleryImageUrls.length;
  updateGalleryCarousel();
});

// ========== FULLSCREEN ZOOM & PINCH-TO-ZOOM LOGIC ==========
const galleryImage = document.getElementById('galleryImage');
const fullscreenZoomOverlay = document.getElementById('fullscreenZoomOverlay');
const fullscreenZoomImage = document.getElementById('fullscreenZoomImage');
const closeZoomBtn = document.getElementById('closeZoomBtn');
const zoomTip = document.getElementById('zoomTip');

let scale = 1;
let pointX = 0;
let pointY = 0;
let startX = 0;
let startY = 0;
let panning = false;
let pinchStartDistance = 0;
let baseScale = 1;

function setZoomTransform(smooth = false) {
  fullscreenZoomImage.style.transition = smooth ? 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
  fullscreenZoomImage.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
}

function resetZoom() {
  scale = 1;
  pointX = 0;
  pointY = 0;
  panning = false;
  pinchStartDistance = 0;
  baseScale = 1;
  setZoomTransform(true);
  zoomTip.style.opacity = '1';
}

if (galleryImage) {
  galleryImage.addEventListener('click', () => {
    if (!galleryImage.src) return;
    fullscreenZoomImage.src = galleryImage.src;
    resetZoom();
    fullscreenZoomOverlay.classList.add('show');
    closeZoomBtn.focus();
    if (window.lucide) lucide.createIcons();
  });
}

if (fullscreenZoomImage) {
  fullscreenZoomImage.addEventListener('dblclick', e => {
    e.stopPropagation();
    if (scale > 1) {
      resetZoom();
    } else {
      scale = 2.5;
      pointX = 0;
      pointY = 0;
      setZoomTransform(true);
      zoomTip.style.opacity = '0';
    }
  });

  fullscreenZoomImage.addEventListener('mousedown', e => {
    if (e.button !== 0 || scale <= 1) return;
    e.preventDefault();
    startX = e.clientX - pointX;
    startY = e.clientY - pointY;
    panning = true;
  });

  window.addEventListener('mousemove', e => {
    if (!panning) return;
    pointX = e.clientX - startX;
    pointY = e.clientY - startY;
    setZoomTransform();
  });

  window.addEventListener('mouseup', () => {
    panning = false;
  });

  fullscreenZoomImage.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      pinchStartDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      baseScale = scale;
      panning = false;
    } else if (e.touches.length === 1) {
      startX = e.touches[0].clientX - pointX;
      startY = e.touches[0].clientY - pointY;
      panning = scale > 1;
    }
  }, { passive: true });

  fullscreenZoomImage.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinchStartDistance > 0) {
      e.preventDefault();
      const currentDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      scale = Math.max(1, Math.min(baseScale * currentDistance / pinchStartDistance, 5));
      setZoomTransform();
      zoomTip.style.opacity = scale > 1 ? '0' : '1';
    } else if (e.touches.length === 1 && panning && scale > 1) {
      e.preventDefault();
      pointX = e.touches[0].clientX - startX;
      pointY = e.touches[0].clientY - startY;
      setZoomTransform();
    }
  }, { passive: false });

  fullscreenZoomImage.addEventListener('touchend', e => {
    if (e.touches.length < 2) {
      pinchStartDistance = 0;
      baseScale = scale;
    }
    if (e.touches.length === 1 && scale > 1) {
      startX = e.touches[0].clientX - pointX;
      startY = e.touches[0].clientY - pointY;
      panning = true;
    } else if (e.touches.length === 0) {
      panning = false;
      if (scale < 1) resetZoom();
    }
  });
}

function closeZoom() {
  fullscreenZoomOverlay.classList.remove('show');
  resetZoom();
}

if (closeZoomBtn) closeZoomBtn.addEventListener('click', closeZoom);

if (fullscreenZoomOverlay) {
  fullscreenZoomOverlay.addEventListener('click', e => {
    if (e.target.id === 'zoomContainer' || e.target.id === 'fullscreenZoomOverlay') {
      closeZoom();
    }
  });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && fullscreenZoomOverlay.classList.contains('show')) {
    closeZoom();
  }
});

// ========== SMART SCROLL HEADER ==========
let lastScrollY = window.scrollY;
const topbar = document.querySelector('.topbar');

let isHeaderHidden = false;
let isHeaderCompact = false;
let scrollUpDistance = 0; // BAGO: Taga-bilang kung gaano kalayo na ang inakyat ng daliri mo

window.addEventListener('scroll', () => {
  const currentScrollY = window.scrollY;
  
  // 1. Kapag nasa pinaka-tuktok na talaga
  if (currentScrollY <= 10) {
    if (isHeaderHidden || isHeaderCompact) {
      topbar.classList.remove('hidden-scroll', 'compact');
      isHeaderHidden = false;
      isHeaderCompact = false;
    }
    scrollUpDistance = 0; // I-reset ang counter
  } 
  // 2. Kapag nag-scroll PABABA (Naghahanap)
  else if (currentScrollY > lastScrollY) {
    scrollUpDistance = 0; // I-reset ang upward counter dahil bumaba ulit ang user
    
    if (!isHeaderHidden && currentScrollY > 100) {
      topbar.classList.remove('compact');
      topbar.classList.add('hidden-scroll');
      isHeaderHidden = true;
      isHeaderCompact = false;
    }
  } 
  // 3. Kapag nag-scroll PATAAS
  else if (currentScrollY < lastScrollY) {
    // I-add kung ilang pixels na ang nai-scroll pataas
    scrollUpDistance += (lastScrollY - currentScrollY);
    
    // REQUIREMENT: Kailangan umabot sa 60px na dire-diretsong taas bago ilabas ang header
    if (scrollUpDistance > 60) {
      if (isHeaderHidden || !isHeaderCompact) {
        topbar.classList.remove('hidden-scroll');
        topbar.classList.add('compact');
        isHeaderHidden = false;
        isHeaderCompact = true;
      }
    }
  }
  
  lastScrollY = currentScrollY;
}, { passive: true });

// Boot up!
checkAuth();
loadData();