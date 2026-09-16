// ========== SUPABASE CONFIGURATION ==========
const supabaseUrl = 'SUPABASE_PROJECT_URL';
const supabaseKey = 'SUPABASE_ANON_KEY';

const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = null;
let items = [];
let history = [];
let editingId = null;

// ========== CUSTOM ALERT & CONFIRM MODALS ==========
const alertOverlay = document.getElementById('alertOverlay');
const alertTitle = document.getElementById('alertTitle');
const alertMessage = document.getElementById('alertMessage');
const alertIconContainer = document.getElementById('alertIconContainer');

function customAlert(message, title = 'Notice', type = 'info') {
  alertTitle.textContent = title;
  alertMessage.innerHTML = message; // Allow limited HTML formatting inside the alert body
  
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

function getInitials(name) {
  if (!name) return '👤';
  
  // Split a full name into words, such as "Dan Caleb" -> ["Dan", "Caleb"]
  const parts = name.trim().split(/\s+/).filter(Boolean);
  
  // Use the first letter of the first and last names for a compact avatar, e.g. DC
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  
  // Fall back to the first letters of a username or email prefix when no full name exists
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
  
  if (currentUser) {
    gateway.classList.add('hidden');
    addBtn.style.display = 'inline-block';
    guestViewControls.style.display = 'none';
    profileDropdown.style.display = 'inline-block';
    
    const displayName = currentUser.user_metadata?.username || currentUser.email.split('@')[0];
    userAvatar.textContent = getInitials(displayName);
    profileEmail.textContent = displayName;
  } else {
    addBtn.style.display = 'none';
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
  
  // Show or hide the name fields when switching between login and sign-up modes
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

// Password recovery flow for reset requests and account re-entry
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

// ========== SEED DATA & CATEGORY COLORS ==========
const CATEGORY_COLORS = {
  "Bass": "#e8a33d", "Electric Guitar (SELDER)": "#d3554a", "Acoustic (Guitar 2)": "#5fa777",
  "Classical Guitar": "#4e7fb0", "String Instrument": "#9575b0", "Piano/Keyboard": "#4fa8a0",
  "Drums": "#d97740", "Piano 1st (Roland E-09)": "#3f8f8a", "Piano 2nd (Roland Juno Stage)": "#6ab0aa",
  "Others": "#8b92a0", "Electric Guitar Effects": "#c0517a"
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

  const { data: histData } = await supabaseClient.from('history_log').select('*').order('timestamp', { ascending: false });
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
  await supabaseClient.from('history_log').insert([entry]);
}

function isOnLoan(item) {
  if (item.borrower && item.borrower.trim() !== '') return true;
  const loanKeywords = ['lent', 'borrowed', 'loan', 'on loan', 'borrow'];
  const text = ((item.remarks || '') + ' ' + (item.owner || '')).toLowerCase();
  return loanKeywords.some(kw => text.includes(kw));
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
    // Keep summary tiles neutral by default unless a filter is active
    { type: 'all', n: items.length, l: 'Logged items', cls: '' },
    { type: 'all', n: items.reduce((a, i) => a + (Number(i.qty) || 0), 0), l: 'Total units', cls: '' },
    
    // Preserve the highlighted state for quick-filter summary cards when they are selected
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

// Quick-summary filter handlers for status and loan shortcuts
document.getElementById('stats').addEventListener('click', (e) => {
  const card = e.target.closest('.stat');
  if (!card) return;

  const type = card.dataset.stat;
  const filterStatus = document.getElementById('filterStatus');
  const filterLoan = document.getElementById('filterLoan');

  if (type === 'all') {
    // Clear active filters and show the complete inventory list again
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

  render(); // Re-render the inventory list after the quick filter changes
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
      <div class="item-name">${esc(item.item)} ${Number(item.qty) > 1 ? `<span style="color: var(--muted);">×${esc(item.qty)}</span>` : ''}</div>
      <div class="brand">${item.brand && item.brand !== 'N/A' ? esc(item.brand) : 'No brand listed'}</div>
      ${item.serial ? `<div class="row"><span>Serial/ID</span><b style="font-family: monospace; color: var(--muted);">${esc(item.serial)}</b></div>` : ''}
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

  setTimeout(() => { 
    if (window.lucide) { lucide.createIcons(); }
  }, 10);
}

// ========== MODAL: ADD/EDIT ==========
const overlay = document.getElementById('overlay');
const form = document.getElementById('itemForm');

function openModal(item) {
  if (!currentUser) {
    customAlert("You must be logged in to edit items.", "Access Denied", "error");
    return;
  }
  editingId = item ? item.id : null;
  document.getElementById('modalTitle').textContent = item ? 'Edit item' : 'Add item';
  document.getElementById('f_category').value = item?.category || '';
  document.getElementById('f_item').value = item?.item || '';
  document.getElementById('f_brand').value = item?.brand === 'N/A' ? '' : (item?.brand || '');
  document.getElementById('f_qty').value = item?.qty ?? 1;
  document.getElementById('f_condition').value = item?.condition || 'working';
  document.getElementById('f_owner').value = item?.owner || 'Church Property';
  document.getElementById('f_location').value = item?.location || 'Stage';
  document.getElementById('f_checkedBy').value = item?.checkedBy || currentUser.email.split('@')[0];
  document.getElementById('f_date').value = item?.dateChecked || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('f_remarks').value = item?.remarks || '';
  document.getElementById('f_borrower').value = item?.borrower || '';
  document.getElementById('f_returnDate').value = item?.returnDate || '';
  document.getElementById('f_serial').value = item?.serial || '';
  document.getElementById('f_description').value = item?.description || '';
  document.getElementById('f_image').value = item?.image_filename || '';
  overlay.classList.add('show');
}

function closeModal() { overlay.classList.remove('show'); editingId = null; form.reset(); }
document.getElementById('addBtn').onclick = () => openModal(null);
document.getElementById('cancelBtn').onclick = closeModal;
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentUser) return;

  const fileInput = document.getElementById('f_image_file');
  const uploadStatus = document.getElementById('uploadStatus');
  let imageUrl = document.getElementById('f_image').value.trim();

  // Upload a selected photo to cloud storage before saving the inventory record
  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;
    const filePath = `${fileName}`;

    uploadStatus.style.display = 'block';
    uploadStatus.textContent = 'Uploading image to cloud storage...';

    // Store the image in the gear-photos storage bucket
    const { data: uploadData, error: uploadError } = await supabaseClient
      .storage
      .from('gear-photos')
      .upload(filePath, file);

    if (uploadError) {
      customAlert('Image upload failed: ' + uploadError.message, 'Upload Error', 'error');
      uploadStatus.style.display = 'none';
      return;
    }

    // Retrieve the public URL so the image can be displayed in the gallery
    const { data: urlData } = supabaseClient
      .storage
      .from('gear-photos')
      .getPublicUrl(filePath);

    imageUrl = urlData.publicUrl;
  }

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
    image_filename: imageUrl // Save the public image URL to the inventory item record
  };

  if (editingId) {
    const prevItem = items.find(i => i.id === editingId);
    await supabaseClient.from('inventory').update(data).eq('id', editingId);
    await logAction('updated', { id: editingId, ...data }, prevItem);
  } else {
    const newItem = { id: 'item_' + Date.now(), ...data };
    await supabaseClient.from('inventory').insert([newItem]);
    await logAction('added', newItem);
  }
  
  if (uploadStatus) uploadStatus.style.display = 'none';
  closeModal();
  await loadData();
  flashToast('Item saved to database');
});


// ========== CARD ACTIONS ==========
document.getElementById('content').addEventListener('click', async e => {
  const hdr = e.target.closest('.cat-hdr');
  if (hdr) {
    const grid = hdr.nextElementSibling;
    const chevron = hdr.querySelector('.cat-chevron');
    grid.classList.toggle('collapsed');
    if (chevron) chevron.classList.toggle('collapsed');
    return;
  }

  const btn = e.target.closest('button[data-act]');
  if (btn && btn.dataset.act === 'view') {
    const id = e.target.closest('.tag').dataset.id;
    const item = items.find(i => i.id === id);
    
    document.getElementById('galleryTitle').textContent = item.item;
    document.getElementById('galleryDesc').textContent = item.description || 'No description provided yet.';
    
    const img = document.getElementById('galleryImage');
    const noImg = document.getElementById('galleryNoImage');
    
    if (item.image_filename) {
      img.src = item.image_filename; 
      img.style.display = 'block';
      noImg.style.display = 'none';
    } else {
      img.style.display = 'none';
      noImg.style.display = 'block';
    }
    document.getElementById('galleryOverlay').classList.add('show');
    return;
  }

  if (!currentUser) return;

  const statusBtn = e.target.closest('.status-btn');
  if (statusBtn) {
    const card = e.target.closest('.tag');
    const id = card.dataset.id;
    const newStatus = statusBtn.dataset.status;
    const prevItem = items.find(i => i.id === id);
    
    if (prevItem.condition !== newStatus) {
      await supabaseClient.from('inventory').update({ condition: newStatus }).eq('id', id);
      await logAction('updated', { ...prevItem, condition: newStatus }, prevItem);
      await loadData();
    }
    return;
  }

  if (!btn) return;
  const id = e.target.closest('.tag').dataset.id;
  const item = items.find(i => i.id === id);

  if (btn.dataset.act === 'edit') openModal(item);
  else if (btn.dataset.act === 'del') {
    openConfirmModal(`Move "${item.item}" to trash?`, async () => {
      const now = new Date().toISOString();
      await supabaseClient.from('inventory').update({ deleted_at: now }).eq('id', id);
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
  if (prev.condition !== curr.condition) changes.push(`Status changed to ${curr.condition.toUpperCase()}`);
  if (prev.qty !== curr.qty) changes.push(`Qty changed from ${prev.qty} to ${curr.qty}`);
  if (prev.location !== curr.location) changes.push(`Moved to ${curr.location}`);
  if (prev.owner !== curr.owner) changes.push(`Owner changed to ${curr.owner}`);
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
      const userName = userEmail.split('@')[0];
      
      const changeText = entry.action === 'updated' 
        ? generateChangeText(entry.prev_data, entry.item_data) 
        : (entry.action === 'deleted' ? 'Removed from inventory' : 'Added to inventory');

      const isUndone = entry.undone;
      const opacity = isUndone ? '0.5' : '1';
      const textDecoration = isUndone ? 'line-through' : 'none';

      const actionIcon = entry.action === 'added' ? '<i data-lucide="plus" style="width: 18px; height: 18px;"></i>' : 
                         entry.action === 'updated' ? '<i data-lucide="edit-2" style="width: 18px; height: 18px;"></i>' : 
                         '<i data-lucide="trash-2" style="width: 18px; height: 18px;"></i>';

      return `
      <div class="history-item ${entry.action}" style="opacity: ${opacity};">
        <div class="icon">${actionIcon}</div>
        <div class="content">
          <div class="action-label" style="display:flex; justify-content:space-between;">
            <span style="text-decoration: ${textDecoration};">${entry.action.toUpperCase()}</span>
            <div style="text-align: right;">
               <div style="color: var(--amber); font-weight: 600; text-transform:none;">${userName}</div>
               <div style="color: var(--muted-2); font-size: 9px; text-transform:none;">${userEmail}</div>
            </div>
          </div>
          <div class="item-desc" style="text-decoration: ${textDecoration};">${esc(entry.item_data.item)}</div>
          <div style="font-size: 11px; color: var(--muted); margin-bottom: 4px; font-style: italic; text-decoration: ${textDecoration};">
            ↳ ${changeText}
          </div>
          <div class="time">${formatDate(entry.timestamp)} ${isUndone ? '<span style="color: var(--red); font-weight: bold; margin-left: 8px;">(UNDONE)</span>' : ''}</div>
        </div>
        ${currentUser && !isUndone && entry.action === 'deleted' ? `<button class="restore-btn" data-entry-id="${entry.id}">Restore</button>` : ''}
        ${currentUser && !isUndone && entry.action === 'updated' && entry.prev_data ? `<button class="undo-btn" data-entry-id="${entry.id}">Undo</button>` : ''}
      </div>
    `}).join('');

    // Restore deleted items and update the log entry state
    historyContent.querySelectorAll('.restore-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const entry = history.find(h => h.id === e.target.dataset.entryId);
        if (entry) {
          // Reactivate the item by clearing the soft-delete flag
          await supabaseClient.from('inventory').update({ deleted_at: null }).eq('id', entry.item_data.id);
          await supabaseClient.from('history_log').update({ undone: true }).eq('id', entry.id);
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
          const currentItem = items.find(i => i.id === entry.item_data.id);
          await supabaseClient.from('inventory').update(entry.prev_data).eq('id', entry.item_data.id);
          await supabaseClient.from('history_log').update({ undone: true }).eq('id', entry.id); 
          await logAction('updated', entry.prev_data, currentItem);
          await loadData();
          renderHistory();
          flashToast('Changes undone!');
        }
      });
    });
  }
  historyOverlay.classList.add('show');
  
  // Re-render the Lucide icons after injecting the updated history rows
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

  const blob = new Blob([csv], { type: 'text/csv' });
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
  pdfContainer.style.fontFamily = 'sans-serif';
  
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

// Import inventory data from a previously exported JSON file
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

      openConfirmModal(`Import ${parsedData.items.length} items to your cloud database?`, async () => {
        for (const item of parsedData.items) {
          await supabaseClient.from('inventory').upsert([item]);
        }
        await loadData();
        flashToast('Data imported successfully to database!');
      }, "Import Data", false);

    } catch (error) {
      customAlert('Error importing JSON file: ' + error.message, "Import Error", "error");
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// CSV parser used to import inventory records from spreadsheet exports
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

      // Ensure the CSV contains the minimum columns needed for inventory import
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
          id: 'item_csv_' + Date.now() + '_' + idx,
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
        await supabaseClient.from('inventory').insert(newItems);
        await loadData();
        flashToast(`Imported ${newItems.length} items from CSV!`);
      }
    } catch (error) {
      customAlert('Error reading CSV file: ' + error.message, "Import Error", "error");
    }
    e.target.value = '';
  };
  reader.readAsText(file);
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

// Helper to safely get clean modal title without grabbing adjacent select options
function getSelectTitle(select) {
  if (select.dataset.label) return select.dataset.label;

  // Check if previous element is a REAL <label>
  const prev = select.previousElementSibling;
  if (prev && prev.tagName === 'LABEL') {
    return prev.textContent.trim();
  }

  // Check associated label
  if (select.labels && select.labels.length > 0) {
    return select.labels[0].textContent.trim();
  }

  // Fallback to first option text (e.g. "All categories") or default
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

// Attach custom picker to all filter and modal select elements
// Attach custom picker with smart scroll-drag detection for mobile
function bindCustomSelects() {
  const selectElements = document.querySelectorAll('select');

  selectElements.forEach(select => {
    let touchStartX = 0;
    let touchStartY = 0;
    let isScrolling = false;

    // 1. Desktop Mouse Click Handling
    select.addEventListener('mousedown', (e) => {
      // Direct mouse click on desktop
      e.preventDefault();
      openCustomSelect(select);
    });

    // 2. Mobile Touch Handling (Allows natural page scrolling over dropdowns)
    select.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isScrolling = false; // Reset scroll status on touch start
      }
    }, { passive: true });

    select.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const deltaX = Math.abs(e.touches[0].clientX - touchStartX);
        const deltaY = Math.abs(e.touches[0].clientY - touchStartY);

        // If finger moves more than 8px in any direction, user is scrolling the page!
        if (deltaX > 8 || deltaY > 8) {
          isScrolling = true;
        }
      }
    }, { passive: true });

    select.addEventListener('touchend', (e) => {
      // Only open the custom select if it was a clean tap (not a scroll gesture)
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
  // Add a scroll lock whenever a modal or welcome screen is visible
  const activeOverlays = document.querySelectorAll('.overlay.show, .gateway-overlay:not(.hidden)');
  
  if (activeOverlays.length > 0) {
    document.body.classList.add('no-scroll');
  } else {
    document.body.classList.remove('no-scroll');
  }
}

// Watch the DOM for '.show' class changes on overlays and gateway screens
const overlayObserver = new MutationObserver(() => {
  checkModalScrollLock();
});

// Attach the observer to all overlay and welcome-screen elements
document.querySelectorAll('.overlay, .gateway-overlay').forEach(overlay => {
  overlayObserver.observe(overlay, { attributes: true, attributeFilter: ['class'] });
});

// Run an initial check when the app loads
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

        // If finger moves more than 8px, user is scrolling, NOT tapping!
        if (deltaX > 8 || deltaY > 8) {
          isScrolling = true;
        }
      }
    }, { passive: true });

    trigger.addEventListener('touchend', (e) => {
      // Only open if it was a clean tap (not a scroll swipe)
      if (!isScrolling) {
        e.preventDefault();
        const isOpen = dropdown.classList.contains('open');

        // Close all other dropdowns
        document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));

        if (!isOpen) {
          dropdown.classList.add('open');
        }
      }
    });
  });

  // Close dropdowns when tapping anywhere outside
  const closeOutside = (e) => {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    }
  };

  document.addEventListener('touchstart', closeOutside, { passive: true });
  document.addEventListener('click', closeOutside);
}

// Ensure bindDropdownButtons runs when DOM is loaded
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

// 1. Default to 'light' unless user has saved 'dark' previously
const initialTheme = localStorage.getItem('wingmacc_theme') || 'light';
applyTheme(initialTheme);

// 2. Toggle on button click
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    flashToast(`Switched to ${nextTheme === 'dark' ? 'Dark' : 'Light'} Mode`);
  });
}

// Boot up!
checkAuth();
loadData();

