// ==========================================================
// APPETINA INVENTORY MANAGEMENT SYSTEM
// Mobile-first PWA with barcode/RFID scanning
// ==========================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbzgiIM1LfbujitaT3an4egn1NS9bH5Ll3FmjtiHaohmLNHtl0EV1fuB5W-InqNdUUvI/exec';

let sessionToken = '';
let inventory   = [];        // {id, sku, barcode, rfid, name, category, qty, unit, minStock, cost, vendor, location, notes}
let rentals     = [];        // {id, eventRef, client, dateOut, dateReturn, items, status}
let events      = [];        // From Appetina Bookings (Confirmed)
let recipes     = [];        // {dishName, category, ingredients:[{name, qty, unit}], pax, cost}
let purchases   = [];        // Purchase orders
let categories  = ['ingredients','equipment','furniture','serveware','linens','consumables'];
let vendors     = [];
let currentScreen = 'dashboard';
let _editingItem = null;
let _scanReader   = null;
let _scanMode     = 'camera';
let _hidBuffer    = '';
let _hidTimer     = null;
let _rentalItems  = [];

// =========================================================
//  SESSION & LOGIN
// =========================================================
function restoreSession() {
  try {
    const stored = sessionStorage.getItem('appetina_ims_session');
    if (stored) {
      const obj = JSON.parse(stored);
      if (obj.expiresAt > Date.now()) {
        sessionToken = obj.token;
        return true;
      }
      sessionStorage.removeItem('appetina_ims_session');
    }
  } catch(e) {}
  return false;
}

async function doLogin() {
  const pass = document.getElementById('passInput').value;
  const err  = document.getElementById('loginErr');
  const btn  = document.getElementById('loginBtn');

  if (!pass) { err.textContent = 'Please enter password.'; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Signing in...';
  err.textContent = '';

  try {
    const res = await fetch(GAS_URL + '?action=login&pass=' + encodeURIComponent(pass) + '&ts=' + Date.now());
    const json = await res.json();
    if (json.success && json.token) {
      sessionToken = json.token;
      sessionStorage.setItem('appetina_ims_session', JSON.stringify({
        token: sessionToken,
        expiresAt: Date.now() + (json.expiresIn * 1000)
      }));
      startApp();
    } else {
      err.textContent = json.error || 'Login failed.';
    }
  } catch(e) {
    err.textContent = 'Network error. Try again.';
  }
  btn.disabled = false; btn.innerHTML = '🔓 Sign In';
}

async function logout() {
  if (sessionToken) {
    try { await fetch(GAS_URL + '?action=logout&token=' + sessionToken); } catch(e) {}
  }
  sessionStorage.removeItem('appetina_ims_session');
  location.reload();
}

function startApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  loadAll();
}

// =========================================================
//  LOCAL STORAGE PERSISTENCE
//  Inventory is stored locally for instant access + offline support
//  Syncs with Google Sheets backend periodically
// =========================================================
function saveLocal() {
  try {
    localStorage.setItem('appetina_ims_inventory', JSON.stringify(inventory));
    localStorage.setItem('appetina_ims_rentals', JSON.stringify(rentals));
    localStorage.setItem('appetina_ims_recipes', JSON.stringify(recipes));
    localStorage.setItem('appetina_ims_purchases', JSON.stringify(purchases));
    localStorage.setItem('appetina_ims_vendors', JSON.stringify(vendors));
  } catch(e) { console.warn('saveLocal:', e); }
}

function loadLocal() {
  try {
    inventory = JSON.parse(localStorage.getItem('appetina_ims_inventory') || '[]');
    rentals   = JSON.parse(localStorage.getItem('appetina_ims_rentals')   || '[]');
    recipes   = JSON.parse(localStorage.getItem('appetina_ims_recipes')   || '[]');
    purchases = JSON.parse(localStorage.getItem('appetina_ims_purchases') || '[]');
    vendors   = JSON.parse(localStorage.getItem('appetina_ims_vendors')   || '[]');
  } catch(e) {
    inventory = []; rentals = []; recipes = []; purchases = []; vendors = [];
  }
}

async function loadAll() {
  loadLocal();
  // Seed with starter data if empty
  if (inventory.length === 0) seedStarterData();
  if (recipes.length === 0)   seedStarterRecipes();
  await loadEvents();
  renderAll();
}

// =========================================================
//  NAVIGATION
// =========================================================
function navigate(screen, opts) {
  currentScreen = screen;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('screen-' + screen);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  // Only home shows as 'home', everything else maps to 'More'
  let navHighlight = 'nav-settings';
  if (screen === 'dashboard') navHighlight = 'nav-dashboard';
  const navBtn = document.getElementById(navHighlight);
  if (navBtn) navBtn.classList.add('active');

  // Apply filter if provided
  if (opts && opts.filter && screen === 'inventory') {
    setTimeout(() => {
      document.querySelectorAll('#invFilters .filter-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.filter === opts.filter);
      });
      renderInventory();
    }, 50);
  }

  // Render the screen
  if (screen === 'dashboard') renderDashboard();
  if (screen === 'inventory') renderInventory();
  if (screen === 'events')    renderEvents();
  if (screen === 'rentals')   renderRentals();
  if (screen === 'recipes')   renderRecipes();
  if (screen === 'analytics') renderAnalytics();
  if (screen === 'procurement') renderProcurement();
  if (screen === 'settings')  renderSettings();

  // Stop camera scanner on screen change
  stopCamera();
}

// =========================================================
//  SETTINGS / MORE — central hub
// =========================================================
function renderSettings() {
  const setCount = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setCount('modInventoryCount', inventory.length);

  const today = new Date(); today.setHours(0,0,0,0);
  const upcoming = events.filter(e => {
    const d = new Date(e['Event Date']);
    d.setHours(0,0,0,0);
    return d >= today;
  });
  setCount('modEventsCount', upcoming.length);

  const out = rentals.filter(r => r.status === 'out').length;
  setCount('modRentalsCount', out);

  setCount('modRecipesCount', recipes.length);
  setCount('modPOCount', purchases.length);
}

// =========================================================
//  RENDER ALL SCREENS
// =========================================================
function renderAll() {
  renderDashboard();
  if (currentScreen === 'inventory') renderInventory();
  if (currentScreen === 'events')    renderEvents();
  if (currentScreen === 'rentals')   renderRentals();
  if (currentScreen === 'recipes')   renderRecipes();
}

// =========================================================
//  DASHBOARD
// =========================================================
function renderDashboard() {
  document.getElementById('statItems').textContent = inventory.length;
  const totalQty = inventory.reduce((s,i) => s + (+i.qty || 0), 0);
  document.getElementById('statItemsSub').textContent = totalQty.toLocaleString() + ' units';

  const lowStock = inventory.filter(i => (+i.qty || 0) <= (+i.minStock || 0));
  document.getElementById('statLow').textContent = lowStock.length;

  const upcoming = events.filter(e => {
    const d = new Date(e.eventDate);
    return d >= new Date();
  });
  document.getElementById('statEvents').textContent = upcoming.length;

  const out = rentals.filter(r => r.status === 'out').length;
  document.getElementById('statRentals').textContent = out;

  // Low stock list
  const lowList = document.getElementById('lowStockList');
  if (lowStock.length === 0) {
    lowList.innerHTML = '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:1.5rem;text-align:center;color:var(--success);">✓ All items are well stocked!</div>';
  } else {
    lowList.innerHTML = lowStock.slice(0,5).map(i => itemCardHTML(i)).join('');
  }
}

// =========================================================
//  INVENTORY
// =========================================================
function renderInventory() {
  const search   = (document.getElementById('invSearch').value || '').toLowerCase();
  const activeChip = document.querySelector('#invFilters .filter-chip.active');
  const filter   = activeChip ? activeChip.dataset.filter : 'all';

  let items = inventory.filter(i => {
    const hay = (i.name + ' ' + i.sku + ' ' + i.barcode + ' ' + (i.rfid||'')).toLowerCase();
    if (search && !hay.includes(search)) return false;
    if (filter === 'all') return true;
    if (filter === 'low') return (+i.qty || 0) <= (+i.minStock || 0);
    return i.category === filter;
  });

  // Sort: low stock first, then by name
  items.sort((a,b) => {
    const aLow = (+a.qty || 0) <= (+a.minStock || 0) ? 0 : 1;
    const bLow = (+b.qty || 0) <= (+b.minStock || 0) ? 0 : 1;
    if (aLow !== bLow) return aLow - bLow;
    return (a.name||'').localeCompare(b.name||'');
  });

  const list = document.getElementById('inventoryList');
  if (items.length === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">📦</div><div class="empty-text">No items found</div><button class="btn" onclick="openAddItemModal()">+ Add First Item</button></div>';
    return;
  }
  list.innerHTML = items.map(i => itemCardHTML(i)).join('');
}

function itemCardHTML(item) {
  const qty = +item.qty || 0;
  const min = +item.minStock || 0;
  const isLow = qty <= min;
  const isOut = qty === 0;
  const qtyClass = isOut ? 'out' : (isLow ? 'low' : '');
  const icon = ({
    ingredients:'🥘', equipment:'🍳', furniture:'🪑',
    serveware:'🍽️', linens:'📜', consumables:'🧻'
  })[item.category] || '📦';

  return `<div class="item-card" onclick="openEditItemModal('${item.id}')">
    <div class="item-icon">${icon}</div>
    <div class="item-body">
      <div class="item-name">${escapeHtml(item.name)}</div>
      <div class="item-meta">${item.sku ? item.sku + ' · ' : ''}${item.location || 'No location'}</div>
    </div>
    <div class="item-qty ${qtyClass}">${qty}${item.unit ? ' ' + item.unit : ''}</div>
  </div>`;
}

// Filter chips
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.filter-chip');
  if (chip && chip.parentElement.id === 'invFilters') {
    document.querySelectorAll('#invFilters .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderInventory();
  }
});

// =========================================================
//  ADD / EDIT ITEM
// =========================================================
function openAddItemModal(scannedCode) {
  _editingItem = null;
  document.getElementById('itemModalTitle').textContent = '➕ Add Item';
  document.getElementById('deleteItemBtn').style.display = 'none';
  document.getElementById('itemName').value     = '';
  document.getElementById('itemSku').value      = 'APT-' + Math.random().toString(36).substr(2,7).toUpperCase();
  document.getElementById('itemCategory').value = 'ingredients';
  document.getElementById('itemBarcode').value  = scannedCode || '';
  document.getElementById('itemRfid').value     = '';
  document.getElementById('itemQty').value      = 0;
  document.getElementById('itemUnit').value     = 'pcs';
  document.getElementById('itemMinStock').value = 5;
  document.getElementById('itemCost').value     = 0;
  document.getElementById('itemVendor').value   = '';
  document.getElementById('itemLocation').value = '';
  document.getElementById('itemNotes').value    = '';
  openModal('itemModal');
}

function openEditItemModal(id) {
  const item = inventory.find(i => i.id === id);
  if (!item) return;
  _editingItem = id;
  document.getElementById('itemModalTitle').textContent = '✏️ Edit Item';
  document.getElementById('deleteItemBtn').style.display = 'block';
  document.getElementById('itemName').value     = item.name || '';
  document.getElementById('itemSku').value      = item.sku || '';
  document.getElementById('itemCategory').value = item.category || 'ingredients';
  document.getElementById('itemBarcode').value  = item.barcode || '';
  document.getElementById('itemRfid').value     = item.rfid || '';
  document.getElementById('itemQty').value      = item.qty || 0;
  document.getElementById('itemUnit').value     = item.unit || '';
  document.getElementById('itemMinStock').value = item.minStock || 0;
  document.getElementById('itemCost').value     = item.cost || 0;
  document.getElementById('itemVendor').value   = item.vendor || '';
  document.getElementById('itemLocation').value = item.location || '';
  document.getElementById('itemNotes').value    = item.notes || '';
  openModal('itemModal');
}

function saveItem() {
  const name = document.getElementById('itemName').value.trim();
  if (!name) { toast('Please enter item name', 'error'); return; }

  const data = {
    id:        _editingItem || ('itm_' + Date.now()),
    name:      name,
    sku:       document.getElementById('itemSku').value.trim(),
    category:  document.getElementById('itemCategory').value,
    barcode:   document.getElementById('itemBarcode').value.trim(),
    rfid:      document.getElementById('itemRfid').value.trim(),
    qty:       +document.getElementById('itemQty').value || 0,
    unit:      document.getElementById('itemUnit').value.trim(),
    minStock:  +document.getElementById('itemMinStock').value || 0,
    cost:      +document.getElementById('itemCost').value || 0,
    vendor:    document.getElementById('itemVendor').value.trim(),
    location:  document.getElementById('itemLocation').value.trim(),
    notes:     document.getElementById('itemNotes').value.trim(),
    updatedAt: Date.now()
  };

  if (_editingItem) {
    const idx = inventory.findIndex(i => i.id === _editingItem);
    if (idx >= 0) inventory[idx] = data;
    toast('✓ Item updated', 'success');
  } else {
    inventory.push(data);
    toast('✓ Item added', 'success');
  }
  saveLocal();
  closeModal('itemModal');
  renderInventory();
  renderDashboard();
}

function deleteItem() {
  if (!_editingItem) return;
  if (!confirm('Delete this item permanently?')) return;
  inventory = inventory.filter(i => i.id !== _editingItem);
  saveLocal();
  closeModal('itemModal');
  toast('🗑️ Item deleted', 'success');
  renderInventory();
  renderDashboard();
}

// =========================================================
//  EVENTS (synced from Appetina Bookings)
// =========================================================
async function loadEvents() {
  try {
    const res = await fetch(GAS_URL + '?action=list&token=' + encodeURIComponent(sessionToken) + '&ts=' + Date.now());
    const json = await res.json();
    if (json.success && json.bookings) {
      events = json.bookings.filter(b => b['Status'] === 'Confirmed' || b['Status'] === 'Done');
    }
  } catch(e) { console.warn('Events load error:', e); }
}

function renderEvents() {
  filterEvents('upcoming');
}

function filterEvents(filter) {
  document.querySelectorAll('#screen-events .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === filter));
  const today = new Date(); today.setHours(0,0,0,0);
  let filtered = events.slice();

  if (filter === 'upcoming') {
    filtered = filtered.filter(e => {
      const d = new Date(e['Event Date']); d.setHours(0,0,0,0);
      return d >= today;
    });
  } else if (filter === 'today') {
    filtered = filtered.filter(e => {
      const d = new Date(e['Event Date']); d.setHours(0,0,0,0);
      return d.getTime() === today.getTime();
    });
  } else {
    filtered = filtered.filter(e => {
      const d = new Date(e['Event Date']); d.setHours(0,0,0,0);
      return d < today;
    });
  }

  // Sort by date
  filtered.sort((a,b) => new Date(a['Event Date']) - new Date(b['Event Date']));

  const list = document.getElementById('eventsList');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">📅</div><div class="empty-text">No events in this view</div></div>';
    return;
  }

  list.innerHTML = filtered.map(e => {
    const date = new Date(e['Event Date']);
    const dateStr = isNaN(date) ? e['Event Date'] : date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    return `<div class="item-card" onclick="openEventDetail('${e['Booking Ref']}')">
      <div class="item-icon">🎉</div>
      <div class="item-body">
        <div class="item-name">${escapeHtml(e['Client Name']||'—')}</div>
        <div class="item-meta">${dateStr} · ${escapeHtml(e['Event Type']||'')} · ${e['No. of Pax']||0} pax</div>
      </div>
      <div class="item-qty">${escapeHtml(e['Booking Ref']||'')}</div>
    </div>`;
  }).join('');
}

function openEventDetail(ref) {
  const event = events.find(e => e['Booking Ref'] === ref);
  if (!event) return;

  document.getElementById('eventModalTitle').textContent = event['Booking Ref'] + ' — ' + (event['Client Name']||'');

  // Compute required inventory based on package
  const pax = +event['No. of Pax'] || 0;
  const required = computeEventRequirements(event, pax);

  const body = document.getElementById('eventModalBody');
  body.innerHTML = `
    <div style="background:var(--cream);border-radius:10px;padding:0.85rem;margin-bottom:1rem;">
      <div style="font-size:0.78rem;color:var(--brown);font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.4rem;">Event Info</div>
      <div style="font-size:0.88rem;line-height:1.7;">
        <strong>${escapeHtml(event['Client Name']||'')}</strong><br>
        📅 ${event['Event Date']} at ${event['Event Time']||'—'}<br>
        📍 ${escapeHtml(event['Venue']||'—')}<br>
        👥 ${pax} guests · 📦 ${escapeHtml(event['Package']||'—')}
      </div>
    </div>

    <div class="section-title" style="font-size:0.92rem;">🍽️ Menu Items</div>
    <div style="font-size:0.85rem;color:var(--text);line-height:1.9;background:#fff;border:1px solid var(--border);border-radius:10px;padding:0.85rem;margin-bottom:1rem;">
      🥩 Beef: <strong>${escapeHtml(event['Beef']||'—')}</strong><br>
      🐟 Fish: <strong>${escapeHtml(event['Fish']||'—')}</strong><br>
      🍗 Chicken: <strong>${escapeHtml(event['Chicken']||'—')}</strong><br>
      🥦 Veggie: <strong>${escapeHtml(event['Veggie']||'—')}</strong><br>
      🍝 Pasta: <strong>${escapeHtml(event['Pasta']||'—')}</strong><br>
      🥤 Drinks: <strong>${escapeHtml(event['Drinks']||'—')}</strong>
      ${event['Lechon'] && event['Lechon'].includes('Yes') ? '<br>🐷 <strong>Lechon Add-on</strong>' : ''}
    </div>

    <div class="section-title" style="font-size:0.92rem;">📋 Required Inventory</div>
    <div id="eventReqList">${required.html}</div>

    <div style="margin-top:1.25rem;">
      <button class="btn btn-block" onclick="checkOutEventItems('${ref}')">📤 Check Out Items for Event</button>
    </div>
  `;
  openModal('eventModal');
}

function computeEventRequirements(event, pax) {
  // Standard requirements based on pax count
  const requirements = [
    { name: 'Round Tables (60in)', qty: Math.ceil(pax / 10), category: 'furniture' },
    { name: 'Chairs',              qty: pax,                  category: 'furniture' },
    { name: 'Table Covers',        qty: Math.ceil(pax / 10),  category: 'linens' },
    { name: 'Chafing Dishes',      qty: 7,                    category: 'equipment' },
    { name: 'Dinner Plates',       qty: pax + 10,             category: 'serveware' },
    { name: 'Drinking Glasses',    qty: pax + 10,             category: 'serveware' },
    { name: 'Spoon & Fork Sets',   qty: pax + 10,             category: 'serveware' },
    { name: 'Buffet Table',        qty: 2,                    category: 'furniture' },
    { name: 'Serving Spoons',      qty: 15,                   category: 'equipment' }
  ];

  let html = '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;">';
  requirements.forEach((req, idx) => {
    const matched = findInventoryByName(req.name);
    const available = matched ? (+matched.qty || 0) : 0;
    const ok = available >= req.qty;
    const status = ok
      ? '<span class="badge badge-success">✓ Ready</span>'
      : '<span class="badge badge-danger">Short ' + (req.qty - available) + '</span>';
    html += `<div style="padding:0.65rem 0.85rem;display:flex;align-items:center;justify-content:space-between;${idx<requirements.length-1?'border-bottom:1px solid var(--border);':''}">
      <div>
        <div style="font-weight:600;font-size:0.88rem;">${req.name}</div>
        <div style="font-size:0.75rem;color:var(--muted);">Need ${req.qty} · Available ${available}</div>
      </div>
      ${status}
    </div>`;
  });
  html += '</div>';

  return { html: html, items: requirements };
}

function findInventoryByName(name) {
  return inventory.find(i => (i.name||'').toLowerCase().includes(name.toLowerCase()));
}

async function checkOutEventItems(ref) {
  const event = events.find(e => e['Booking Ref'] === ref);
  if (!event) return;
  const pax = +event['No. of Pax'] || 0;
  const req = computeEventRequirements(event, pax);

  // Create a rental record
  const rentalItems = req.items.map(r => ({ name: r.name, qty: r.qty }));

  rentals.push({
    id: 'rent_' + Date.now(),
    eventRef: ref,
    client: event['Client Name'] || '',
    dateOut: new Date().toISOString().split('T')[0],
    dateReturn: event['Event Date'],
    items: rentalItems,
    status: 'out'
  });

  // Deduct from inventory
  rentalItems.forEach(r => {
    const inv = findInventoryByName(r.name);
    if (inv) {
      inv.qty = Math.max(0, (+inv.qty || 0) - r.qty);
      inv.updatedAt = Date.now();
    }
  });

  saveLocal();
  closeModal('eventModal');
  toast('📤 Items checked out for ' + ref, 'success');
  renderDashboard();
}

// =========================================================
//  RENTALS
// =========================================================
function renderRentals() {
  filterRentals('out');
}

function filterRentals(filter) {
  document.querySelectorAll('#screen-rentals .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === filter));
  const today = new Date(); today.setHours(0,0,0,0);
  let filtered;
  if (filter === 'overdue') {
    filtered = rentals.filter(r => {
      if (r.status !== 'out') return false;
      const due = new Date(r.dateReturn);
      return !isNaN(due) && due < today;
    });
  } else {
    filtered = rentals.filter(r => r.status === filter);
  }

  // Sort by date
  filtered.sort((a,b) => new Date(b.dateOut) - new Date(a.dateOut));

  const list = document.getElementById('rentalsList');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">🪑</div><div class="empty-text">No rentals in this view</div></div>';
    return;
  }

  list.innerHTML = filtered.map(r => {
    const totalItems = r.items.reduce((s,i) => s + (+i.qty || 0), 0);
    const due = new Date(r.dateReturn);
    const overdue = !isNaN(due) && due < today && r.status === 'out';
    return `<div class="item-card" onclick="openRentalDetail('${r.id}')">
      <div class="item-icon">🚚</div>
      <div class="item-body">
        <div class="item-name">${escapeHtml(r.client||'—')} ${r.eventRef ? '(' + escapeHtml(r.eventRef) + ')' : ''}</div>
        <div class="item-meta">${totalItems} items · Return: ${r.dateReturn} ${overdue ? '<span class="badge badge-danger" style="margin-left:5px;">OVERDUE</span>' : ''}</div>
      </div>
      ${r.status === 'out'
        ? '<button class="btn btn-sm btn-success" onclick="event.stopPropagation();returnRental(\'' + r.id + '\')">Return</button>'
        : '<span class="badge badge-success">Returned</span>'}
    </div>`;
  }).join('');
}

function openNewRentalModal() {
  document.getElementById('rentalEventRef').value = '';
  document.getElementById('rentalClient').value = '';
  document.getElementById('rentalDateOut').value = new Date().toISOString().split('T')[0];
  document.getElementById('rentalDateReturn').value = '';
  _rentalItems = [];
  renderRentalItemsList();
  openModal('rentalModal');
}

function addRentalItem() {
  _rentalItems.push({ name: '', qty: 1 });
  renderRentalItemsList();
}

function renderRentalItemsList() {
  const list = document.getElementById('rentalItemsList');
  list.innerHTML = _rentalItems.map((it, idx) =>
    `<div class="rental-row">
      <select class="form-select" onchange="_rentalItems[${idx}].name=this.value">
        <option value="">Select item...</option>
        ${inventory.filter(i => i.category === 'furniture' || i.category === 'serveware' || i.category === 'linens' || i.category === 'equipment').map(i =>
          `<option value="${escapeHtml(i.name)}" ${i.name===it.name?'selected':''}>${escapeHtml(i.name)} (${i.qty} avail)</option>`
        ).join('')}
      </select>
      <input type="number" class="qty-input" value="${it.qty}" min="1" onchange="_rentalItems[${idx}].qty=+this.value"/>
      <button class="qty-btn" onclick="_rentalItems.splice(${idx},1);renderRentalItemsList();">✕</button>
    </div>`
  ).join('');
}

function saveRental() {
  const items = _rentalItems.filter(i => i.name && i.qty > 0);
  if (items.length === 0) { toast('Please add at least one item', 'error'); return; }

  rentals.push({
    id: 'rent_' + Date.now(),
    eventRef: document.getElementById('rentalEventRef').value.trim(),
    client:   document.getElementById('rentalClient').value.trim() || 'Walk-in',
    dateOut:  document.getElementById('rentalDateOut').value,
    dateReturn: document.getElementById('rentalDateReturn').value,
    items: items,
    status: 'out'
  });

  items.forEach(r => {
    const inv = findInventoryByName(r.name);
    if (inv) {
      inv.qty = Math.max(0, (+inv.qty || 0) - r.qty);
      inv.updatedAt = Date.now();
    }
  });

  saveLocal();
  closeModal('rentalModal');
  toast('📤 Rental recorded', 'success');
  renderRentals();
}

function openRentalDetail(id) {
  const r = rentals.find(x => x.id === id);
  if (!r) return;
  alert('Rental Details:\n\nClient: ' + r.client + '\nRef: ' + (r.eventRef||'—') + '\nOut: ' + r.dateOut + '\nReturn: ' + r.dateReturn + '\n\nItems:\n' + r.items.map(i => '• ' + i.qty + 'x ' + i.name).join('\n'));
}

function returnRental(id) {
  const r = rentals.find(x => x.id === id);
  if (!r) return;
  if (!confirm('Mark this rental as returned and add items back to inventory?')) return;

  r.status = 'returned';
  r.dateReturned = new Date().toISOString().split('T')[0];

  // Add back to inventory
  r.items.forEach(it => {
    const inv = findInventoryByName(it.name);
    if (inv) {
      inv.qty = (+inv.qty || 0) + it.qty;
      inv.updatedAt = Date.now();
    }
  });

  saveLocal();
  toast('📥 Items returned to inventory', 'success');
  renderRentals();
  renderDashboard();
}

// =========================================================
//  RECIPES & COSTING
// =========================================================
function renderRecipes() {
  const search = (document.getElementById('recipeSearch').value || '').toLowerCase();
  const filtered = recipes.filter(r => !search || (r.dishName||'').toLowerCase().includes(search) || (r.category||'').toLowerCase().includes(search));

  const list = document.getElementById('recipesList');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">🍽️</div><div class="empty-text">No recipes yet</div></div>';
    return;
  }
  list.innerHTML = filtered.map(r => {
    const totalCost = computeRecipeCost(r);
    return `<div class="item-card" onclick="openRecipeDetail('${escapeHtml(r.dishName)}')">
      <div class="item-icon">🍽️</div>
      <div class="item-body">
        <div class="item-name">${escapeHtml(r.dishName)}</div>
        <div class="item-meta">${escapeHtml(r.category||'')} · ${r.pax||30} pax · ${(r.ingredients||[]).length} ingredients</div>
      </div>
      <div class="item-qty">₱${totalCost.toFixed(0)}</div>
    </div>`;
  }).join('');
}

function computeRecipeCost(recipe) {
  if (!recipe.ingredients) return 0;
  return recipe.ingredients.reduce((sum, ing) => {
    const inv = findInventoryByName(ing.name);
    const unitCost = inv ? (+inv.cost || 0) : 0;
    return sum + (unitCost * (+ing.qty || 0));
  }, 0);
}

function openRecipeDetail(name) {
  const r = recipes.find(x => x.dishName === name);
  if (!r) return;
  document.getElementById('recipeModalTitle').textContent = r.dishName;
  const cost = computeRecipeCost(r);
  const perHead = r.pax ? cost / r.pax : 0;
  const body = document.getElementById('recipeModalBody');
  body.innerHTML = `
    <div style="background:var(--cream);border-radius:10px;padding:0.85rem;margin-bottom:1rem;">
      <div style="font-size:0.78rem;color:var(--brown);font-weight:700;margin-bottom:0.3rem;">Recipe Info</div>
      <div style="font-size:0.88rem;line-height:1.7;">
        Category: <strong>${escapeHtml(r.category||'')}</strong><br>
        Serves: <strong>${r.pax||0} pax</strong><br>
        Total cost: <strong>₱${cost.toFixed(2)}</strong><br>
        Cost per head: <strong>₱${perHead.toFixed(2)}</strong>
      </div>
    </div>
    <div class="section-title" style="font-size:0.9rem;">🥘 Ingredients</div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      ${(r.ingredients||[]).map((ing,idx) => {
        const inv = findInventoryByName(ing.name);
        const stock = inv ? (+inv.qty||0) : 0;
        const ok = stock >= ing.qty;
        return `<div style="padding:0.6rem 0.85rem;display:flex;justify-content:space-between;align-items:center;${idx<r.ingredients.length-1?'border-bottom:1px solid var(--border);':''}">
          <div>
            <div style="font-weight:600;font-size:0.88rem;">${escapeHtml(ing.name)}</div>
            <div style="font-size:0.75rem;color:var(--muted);">${ing.qty} ${ing.unit||''} needed · ${stock} in stock</div>
          </div>
          ${ok ? '<span class="badge badge-success">✓</span>' : '<span class="badge badge-warning">Short</span>'}
        </div>`;
      }).join('')}
    </div>
  `;
  openModal('recipeModal');
}

// =========================================================
//  PROCUREMENT
// =========================================================
function renderProcurement() {
  const list = document.getElementById('procurementList');
  if (purchases.length === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">🛒</div><div class="empty-text">No purchase orders yet</div><button class="btn" onclick="openPurchaseOrderModal()">+ Create First PO</button></div>';
    return;
  }
  list.innerHTML = purchases.map(p => `<div class="item-card">
    <div class="item-icon">🛒</div>
    <div class="item-body">
      <div class="item-name">PO-${p.id.slice(-6)}</div>
      <div class="item-meta">${p.vendor} · ${p.items.length} items · ${p.date}</div>
    </div>
    <div class="item-qty">₱${p.total.toFixed(0)}</div>
  </div>`).join('');
}

function openPurchaseOrderModal() {
  alert('Purchase Order creation: Use the inventory page to track items needing restock. PO module coming in v1.1.');
}

// =========================================================
//  ANALYTICS
// =========================================================
function renderAnalytics() {
  // Stock usage chart
  const usageCtx = document.getElementById('usageChart');
  if (usageCtx) {
    const labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    const used   = [120, 145, 180, 165]; // Sample data
    new Chart(usageCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{ label: 'Items Used', data: used, borderColor: '#8B4513', backgroundColor: 'rgba(139,69,19,0.1)', tension: 0.4, fill: true }]
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}} }
    });
  }

  // Category value chart
  const catCtx = document.getElementById('categoryChart');
  if (catCtx) {
    const byCat = {};
    inventory.forEach(i => {
      byCat[i.category] = (byCat[i.category] || 0) + ((+i.cost || 0) * (+i.qty || 0));
    });
    new Chart(catCtx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(byCat),
        datasets: [{ data: Object.values(byCat), backgroundColor: ['#8B4513','#C9A84C','#2E7D32','#1565C0','#c62828','#f57c00'] }]
      },
      options: { responsive:true, maintainAspectRatio:false }
    });
  }

  // Top consumed items
  const topList = document.getElementById('topConsumedList');
  const sorted = inventory.slice().sort((a,b) => ((+b.cost||0) * (+b.qty||0)) - ((+a.cost||0) * (+a.qty||0))).slice(0,5);
  topList.innerHTML = sorted.map(i => `<div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.85rem;"><span>${escapeHtml(i.name)}</span><strong>₱${((+i.cost||0)*(+i.qty||0)).toFixed(0)}</strong></div>`).join('');
}

// =========================================================
//  SCANNER (Camera, USB HID, Manual)
// =========================================================
function openScanner() {
  document.getElementById('scanResult').innerHTML = '';
  openModal('scannerModal');
  setScanMode(_scanMode);
}

function closeScanner() {
  stopCamera();
  closeModal('scannerModal');
}

function setScanMode(mode) {
  _scanMode = mode;
  document.querySelectorAll('#scannerModal .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
  document.getElementById('scanCameraMode').style.display = mode === 'camera' ? 'block' : 'none';
  document.getElementById('scanHidMode').style.display    = mode === 'hid'    ? 'block' : 'none';
  document.getElementById('scanManualMode').style.display = mode === 'manual' ? 'block' : 'none';

  stopCamera();
  if (mode === 'camera') startCamera();
  if (mode === 'hid')    startHidListener();
  if (mode === 'manual') document.getElementById('manualInput').focus();
}

async function startCamera() {
  const video = document.getElementById('scannerVideo');
  const status = document.getElementById('scanStatus');
  try {
    if (typeof ZXing === 'undefined') {
      status.textContent = '⚠️ Scanner library not loaded';
      return;
    }
    _scanReader = new ZXing.BrowserMultiFormatReader();
    const devices = await _scanReader.listVideoInputDevices();
    if (devices.length === 0) {
      status.textContent = '⚠️ No camera found';
      return;
    }
    // Prefer rear camera
    const rear = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[devices.length-1];
    status.textContent = '📷 Scanning... point at barcode';

    _scanReader.decodeFromVideoDevice(rear.deviceId, video, (result, err) => {
      if (result) {
        const code = result.getText();
        navigator.vibrate && navigator.vibrate(80);
        stopCamera();
        processCode(code);
      }
    });
  } catch(e) {
    console.error('Camera error:', e);
    status.textContent = '⚠️ Camera access denied. Use Manual mode.';
  }
}

function stopCamera() {
  if (_scanReader) {
    try { _scanReader.reset(); } catch(e) {}
    _scanReader = null;
  }
}

function startHidListener() {
  const input = document.getElementById('hidInput');
  input.value = '';
  input.focus();
  _hidBuffer = '';
  input.oninput = function(e) {
    _hidBuffer = e.target.value;
    clearTimeout(_hidTimer);
    // HID barcode scanners type fast then press Enter
    _hidTimer = setTimeout(() => {
      if (_hidBuffer.length > 3) {
        processCode(_hidBuffer);
        input.value = '';
        _hidBuffer = '';
      }
    }, 150);
  };
  input.onkeydown = function(e) {
    if (e.key === 'Enter' && _hidBuffer.length > 0) {
      e.preventDefault();
      processCode(_hidBuffer);
      input.value = '';
      _hidBuffer = '';
    }
  };
}

function processCode(code) {
  code = (code || '').trim();
  if (!code) return;

  const resultDiv = document.getElementById('scanResult');
  const match = inventory.find(i => i.barcode === code || i.rfid === code || i.sku === code);

  if (match) {
    resultDiv.innerHTML = `
      <div style="background:#e8f5e9;border:1.5px solid var(--success);border-radius:10px;padding:1rem;">
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
          <div style="font-size:2rem;">✅</div>
          <div>
            <div style="font-weight:700;font-size:1rem;">${escapeHtml(match.name)}</div>
            <div style="font-size:0.78rem;color:var(--muted);">${match.sku} · ${match.qty} ${match.unit||''} in stock</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.4rem;">
          <button class="btn btn-success btn-sm" onclick="quickAdjust('${match.id}',1)">+1 In</button>
          <button class="btn btn-danger btn-sm" onclick="quickAdjust('${match.id}',-1)">-1 Out</button>
          <button class="btn btn-secondary btn-sm" onclick="closeScanner();openEditItemModal('${match.id}')">Edit</button>
        </div>
      </div>
    `;
  } else {
    resultDiv.innerHTML = `
      <div style="background:#fff3e0;border:1.5px solid var(--warning);border-radius:10px;padding:1rem;text-align:center;">
        <div style="font-size:2rem;margin-bottom:0.5rem;">❓</div>
        <div style="font-weight:700;margin-bottom:0.25rem;">Item Not Found</div>
        <div style="font-size:0.82rem;color:var(--muted);margin-bottom:0.75rem;">Code: <code>${escapeHtml(code)}</code></div>
        <button class="btn" onclick="closeScanner();openAddItemModal('${code}')">+ Add as New Item</button>
      </div>
    `;
  }
}

function quickAdjust(id, delta) {
  const item = inventory.find(i => i.id === id);
  if (!item) return;
  item.qty = Math.max(0, (+item.qty || 0) + delta);
  item.updatedAt = Date.now();
  saveLocal();
  toast(delta > 0 ? '✓ Added +' + delta : '✓ Removed ' + Math.abs(delta), 'success');
  document.getElementById('scanResult').innerHTML = '';
  if (_scanMode === 'camera') startCamera();
  renderInventory();
  renderDashboard();
}

// =========================================================
//  SEED DATA (sample inventory for first-time users)
// =========================================================
function seedStarterData() {
  inventory = [
    // Furniture
    { id:'itm_t1', sku:'FRN-001', name:'Round Tables (60in)', category:'furniture', barcode:'8901234567001', qty:30, unit:'pcs', minStock:10, cost:0, location:'Warehouse A', vendor:'Owned' },
    { id:'itm_c1', sku:'FRN-002', name:'Chairs', category:'furniture', barcode:'8901234567002', qty:250, unit:'pcs', minStock:50, cost:0, location:'Warehouse A', vendor:'Owned' },
    { id:'itm_b1', sku:'FRN-003', name:'Buffet Table', category:'furniture', barcode:'8901234567003', qty:8, unit:'pcs', minStock:2, cost:0, location:'Warehouse A', vendor:'Owned' },
    // Serveware
    { id:'itm_p1', sku:'SRV-001', name:'Dinner Plates', category:'serveware', barcode:'8901234567010', qty:300, unit:'pcs', minStock:50, cost:35, location:'Warehouse B' },
    { id:'itm_g1', sku:'SRV-002', name:'Drinking Glasses', category:'serveware', barcode:'8901234567011', qty:250, unit:'pcs', minStock:50, cost:25, location:'Warehouse B' },
    { id:'itm_sf', sku:'SRV-003', name:'Spoon & Fork Sets', category:'serveware', barcode:'8901234567012', qty:280, unit:'sets', minStock:50, cost:45, location:'Warehouse B' },
    { id:'itm_ss', sku:'SRV-004', name:'Serving Spoons', category:'serveware', barcode:'8901234567013', qty:30, unit:'pcs', minStock:10, cost:75, location:'Warehouse B' },
    // Equipment
    { id:'itm_ch', sku:'EQP-001', name:'Chafing Dishes', category:'equipment', barcode:'8901234567020', qty:12, unit:'pcs', minStock:5, cost:2500, location:'Equipment Room' },
    { id:'itm_st', sku:'EQP-002', name:'Sterno Fuel', category:'equipment', barcode:'8901234567021', qty:48, unit:'pcs', minStock:20, cost:65, location:'Equipment Room' },
    // Linens
    { id:'itm_l1', sku:'LIN-001', name:'Table Covers', category:'linens', barcode:'8901234567030', qty:40, unit:'pcs', minStock:10, cost:350, location:'Linen Closet' },
    { id:'itm_l2', sku:'LIN-002', name:'Napkins (Cloth)', category:'linens', barcode:'8901234567031', qty:300, unit:'pcs', minStock:100, cost:15, location:'Linen Closet' },
    // Ingredients
    { id:'itm_i1', sku:'ING-001', name:'Beef (1kg)', category:'ingredients', barcode:'8901234567040', qty:25, unit:'kg', minStock:10, cost:550, vendor:'Iligan Meat Mart' },
    { id:'itm_i2', sku:'ING-002', name:'Chicken (1kg)', category:'ingredients', barcode:'8901234567041', qty:35, unit:'kg', minStock:15, cost:220, vendor:'Iligan Meat Mart' },
    { id:'itm_i3', sku:'ING-003', name:'Fish Fillet (1kg)', category:'ingredients', barcode:'8901234567042', qty:18, unit:'kg', minStock:8, cost:320, vendor:'Local Fishmonger' },
    { id:'itm_i4', sku:'ING-004', name:'Rice (1 sack)', category:'ingredients', barcode:'8901234567043', qty:5, unit:'sacks', minStock:3, cost:2400, vendor:'Iligan Grains' },
    // Consumables (low stock examples)
    { id:'itm_d1', sku:'CON-001', name:'Disposable Gloves', category:'consumables', qty:2, unit:'boxes', minStock:5, cost:180, vendor:'Cebu Supply Co.' }
  ];
  saveLocal();
}

function seedStarterRecipes() {
  recipes = [
    { dishName:'Beef Kare-Kara', category:'Beef', pax:30, ingredients:[
      { name:'Beef (1kg)', qty:5, unit:'kg' },
      { name:'Peanut Butter', qty:1, unit:'kg' },
      { name:'Eggplant', qty:2, unit:'kg' },
      { name:'String Beans', qty:1, unit:'kg' }
    ]},
    { dishName:'Fish Fillet Mango Sauce', category:'Fish', pax:30, ingredients:[
      { name:'Fish Fillet (1kg)', qty:4, unit:'kg' },
      { name:'Mango (Ripe)', qty:2, unit:'kg' },
      { name:'Onions', qty:0.5, unit:'kg' }
    ]},
    { dishName:'Buttered Chicken with Lumpia Shanghai', category:'Chicken', pax:30, ingredients:[
      { name:'Chicken (1kg)', qty:5, unit:'kg' },
      { name:'Butter', qty:0.5, unit:'kg' },
      { name:'Ground Pork', qty:1, unit:'kg' }
    ]},
    { dishName:'Crispy Kangkong', category:'Veggie', pax:30, ingredients:[
      { name:'Kangkong', qty:2, unit:'kg' },
      { name:'Flour', qty:0.5, unit:'kg' },
      { name:'Cooking Oil', qty:1, unit:'L' }
    ]},
    { dishName:'Beef Lasagna', category:'Pasta', pax:30, ingredients:[
      { name:'Lasagna Sheets', qty:1, unit:'pack' },
      { name:'Beef (1kg)', qty:3, unit:'kg' },
      { name:'Cheese', qty:1, unit:'kg' }
    ]}
  ];
  saveLocal();
}

// =========================================================
//  UTILITIES
// =========================================================
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); stopCamera(); }

function toast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function escapeHtml(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c]);
}

function exportInventoryCSV() {
  const rows = [['SKU','Name','Category','Barcode','RFID','Qty','Unit','Min Stock','Cost','Vendor','Location','Notes']];
  inventory.forEach(i => rows.push([i.sku,i.name,i.category,i.barcode,i.rfid,i.qty,i.unit,i.minStock,i.cost,i.vendor,i.location,i.notes]));
  const csv = rows.map(r => r.map(c => '"' + String(c||'').replace(/"/g,'""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'appetina-inventory-' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  toast('📥 CSV downloaded', 'success');
}

function syncWithSheets() {
  toast('🔄 Sync coming in v1.1 — currently using local storage', 'success');
}

function openCategoriesModal() { alert('Categories: ' + categories.join(', ')); }
function openVendorsModal()    { alert('Vendor management coming in v1.1'); }

// =========================================================
//  INIT
// =========================================================
if (restoreSession()) {
  startApp();
} else {
  document.getElementById('passInput').focus();
}
