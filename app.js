/* ============================================================
   meDDI OCR Labeling Tool — App Logic
   ============================================================ */

// ⚠️ SET YOUR BACKEND URL HERE (no trailing slash)
const BACKEND_URL = 'https://api.meddiai.com';
const API = BACKEND_URL;

// ---- Auth ----
function getToken() { return localStorage.getItem('labeling_token'); }
function getRefresh() { return localStorage.getItem('labeling_refresh'); }
function setTokens(token, refresh) {
    localStorage.setItem('labeling_token', token);
    if (refresh) localStorage.setItem('labeling_refresh', refresh);
}
function clearTokens() {
    localStorage.removeItem('labeling_token');
    localStorage.removeItem('labeling_refresh');
}

async function tryRefresh() {
    const refresh = getRefresh();
    if (!refresh) return false;
    try {
        const res = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ refresh_token: refresh }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        setTokens(data.access_token, null);
        return true;
    } catch { return false; }
}

function logout() {
    clearTokens();
    document.getElementById('header-user').style.display = 'none';
    renderLogin();
}

function updateHeaderUser(user) {
    const el = document.getElementById('header-user');
    if (!el) return;
    el.style.display = 'flex';
    if (user) {
        document.getElementById('header-user-name').textContent = user.full_name || user.email || '';
    }
}

// Helper: build full image URL from API-returned path
function imgUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${BACKEND_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

// Helper: load image via fetch with ngrok header, then set as blob URL
// This bypasses ngrok's HTML interstitial for <img> tags
async function loadImage(imgElement, path) {
    if (!path) return;
    const url = imgUrl(path) + `?t=${Date.now()}`;
    const token = getToken();
    try {
        const headers = { 'ngrok-skip-browser-warning': 'true' };
        if (token && !url.includes('amazonaws.com')) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`${res.status}`);
        const blob = await res.blob();
        imgElement.src = URL.createObjectURL(blob);
    } catch (e) {
        console.warn('Image load failed:', url, e);
        imgElement.alt = 'Failed to load';
    }
}

// Helper: load all images on the page with data-img-path attribute
function loadAllImages() {
    document.querySelectorAll('img[data-img-path]').forEach(img => {
        loadImage(img, img.dataset.imgPath);
    });
}

// ---- State ----
let currentView = 'dashboard';
let currentReviewer = null;
let currentFilter = 'all';
let currentPage = 1;
let currentImageId = null;
let currentData = null;
let imageIds = []; // ordered list of IDs for prev/next navigation
let isZoomed = false;

// ---- Login ----
async function renderLogin() {
    currentView = 'login';
    document.getElementById('breadcrumb').innerHTML = '';
    document.getElementById('header-user').style.display = 'none';
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="login-container">
            <div class="login-card">
                <div class="login-header">
                    <span class="logo">me<span class="logo-accent">DDI</span></span>
                    <p class="login-subtitle">OCR Labeling Tool — Sign In</p>
                </div>
                <form id="loginForm" onsubmit="doLogin(event)">
                    <div class="form-group">
                        <label>Email</label>
                        <input type="email" id="loginEmail" required autocomplete="email" placeholder="you@example.com">
                    </div>
                    <div class="form-group" style="margin-top:0.8rem">
                        <label>Password</label>
                        <input type="password" id="loginPassword" required autocomplete="current-password" placeholder="••••••••">
                    </div>
                    <div id="loginError" class="login-error" style="display:none"></div>
                    <button type="submit" class="btn btn-primary login-btn" id="loginBtn">Sign In</button>
                </form>
            </div>
        </div>
    `;
    setTimeout(() => document.getElementById('loginEmail')?.focus(), 50);
}

async function doLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    btn.disabled = true;
    btn.textContent = 'Signing in…';
    errEl.style.display = 'none';

    try {
        const res = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Login failed');
        setTokens(data.token, data.refresh_token);
        updateHeaderUser(data.user);
        navigate('#/');
    } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Sign In';
    }
}

// ---- Router ----
function navigate(hash) {
    window.location.hash = hash;
}

function handleRoute() {
    if (!getToken()) {
        renderLogin();
        return;
    }
    updateHeaderUser(null);

    const hash = window.location.hash || '#/';
    const parts = hash.replace('#/', '').split('/');

    if (parts[0] === 'reviewer' && parts[1]) {
        currentView = 'grid';
        currentReviewer = parseInt(parts[1]);
        currentFilter = parts[2] || 'all';
        currentPage = parseInt(parts[3]) || 1;
        renderGrid();
    } else if (parts[0] === 'editor' && parts[1]) {
        currentView = 'editor';
        currentImageId = parseInt(parts[1]);
        renderEditor();
    } else {
        currentView = 'dashboard';
        renderDashboard();
    }
}

window.addEventListener('hashchange', handleRoute);
window.addEventListener('load', handleRoute);

// ---- API helpers ----
async function api(path, options = {}, _retry = false) {
    const url = `${API}/labeling${path}`;
    const token = getToken();
    const res = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...options.headers,
        },
        ...options,
    });
    if (res.status === 401 && !_retry) {
        const refreshed = await tryRefresh();
        if (refreshed) return api(path, options, true);
        logout();
        throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`API error ${res.status}: ${err}`);
    }
    return res.json();
}

// ---- Toast ----
function showToast(message, type = 'info') {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `toast ${type}`;
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// ---- Breadcrumb ----
function setBreadcrumb(items) {
    const el = document.getElementById('breadcrumb');
    el.innerHTML = items.map((item, i) => {
        if (i === items.length - 1) {
            return `<span class="current">${item.label}</span>`;
        }
        return `<a href="${item.href}">${item.label}</a><span class="sep">›</span>`;
    }).join('');
}

// ---- Dashboard View ----
async function renderDashboard() {
    const main = document.getElementById('main-content');
    main.innerHTML = '<div class="loading"><div class="spinner"></div>Loading stats...</div>';
    setBreadcrumb([{ label: 'Dashboard' }]);

    try {
        const stats = await api('/stats');
        main.innerHTML = `
            <div class="dashboard-header">
                <h2>Prescription OCR Labeling</h2>
                <p>Review and correct OCR outputs for VLM fine-tuning • ${stats.total} total images</p>
            </div>

            <div class="overall-progress">
                <div style="display:flex; justify-content:space-between; align-items:baseline">
                    <span style="font-weight:600; font-size:0.95rem">Overall Progress</span>
                    <span style="font-size:1.4rem; font-weight:700; color:var(--accent-light)">
                        ${stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%
                    </span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width:${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}%"></div>
                </div>
                <div class="progress-stats">
                    <span><span class="highlight" style="color:var(--green)">${stats.completed}</span> completed</span>
                    <span><span class="highlight" style="color:var(--yellow)">${stats.pending}</span> pending</span>
                    <span><span class="highlight" style="color:var(--gray)">${stats.skipped}</span> skipped</span>
                </div>
            </div>

            <div class="reviewer-cards">
                ${[1, 2, 3].map(r => {
            const rs = stats.reviewers[String(r)] || { total: 0, completed: 0, pending: 0, skipped: 0 };
            const pct = rs.total > 0 ? Math.round((rs.completed / rs.total) * 100) : 0;
            return `
                        <div class="reviewer-card" onclick="navigate('#/reviewer/${r}')">
                            <div class="card-header">
                                <span class="reviewer-name">Reviewer ${r}</span>
                                <span class="reviewer-badge">${r}</span>
                            </div>
                            <div class="progress-bar-container" style="height:8px">
                                <div class="progress-bar" style="width:${pct}%"></div>
                            </div>
                            <div style="text-align:right; font-size:0.8rem; color:var(--text-secondary); margin-top:0.3rem">
                                ${pct}% done
                            </div>
                            <div class="card-stats">
                                <div class="stat-item completed">
                                    <div class="stat-value">${rs.completed}</div>
                                    <div class="stat-label">Done</div>
                                </div>
                                <div class="stat-item pending">
                                    <div class="stat-value">${rs.pending}</div>
                                    <div class="stat-label">Pending</div>
                                </div>
                                <div class="stat-item skipped">
                                    <div class="stat-value">${rs.skipped}</div>
                                    <div class="stat-label">Skipped</div>
                                </div>
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    } catch (e) {
        main.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Failed to load stats: ${e.message}</p></div>`;
    }
}

// ---- Grid View ----
async function renderGrid() {
    const main = document.getElementById('main-content');
    main.innerHTML = '<div class="loading"><div class="spinner"></div>Loading images...</div>';
    setBreadcrumb([
        { label: 'Dashboard', href: '#/' },
        { label: `Reviewer ${currentReviewer}` },
    ]);

    try {
        const data = await api(`/images?reviewer=${currentReviewer}&status=${currentFilter}&page=${currentPage}&limit=60`);
        // Store IDs for navigation
        imageIds = data.items.map(item => item.id);

        main.innerHTML = `
            <div class="grid-header">
                <h2>Reviewer ${currentReviewer}</h2>
                <div class="grid-filters">
                    ${['all', 'pending', 'completed', 'skipped'].map(f => `
                        <button class="filter-btn ${currentFilter === f ? 'active' : ''}"
                                onclick="setFilter('${f}')">${f}</button>
                    `).join('')}
                </div>
            </div>

            ${data.items.length === 0
                ? '<div class="empty-state"><div class="empty-icon">📭</div><p>No images found</p></div>'
                : `<div class="image-grid">
                    ${data.items.map(item => `
                        <div class="image-card" onclick="navigate('#/editor/${item.id}')">
                            <img data-img-path="${item.image_url || ''}" alt="Prescription ${item.id}"
                                 loading="lazy" src="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22160%22><rect fill=%22%231a2235%22 width=%22200%22 height=%22160%22/><text fill=%22%235a6a8a%22 x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2214%22>Loading...</text></svg>">
                            <div class="card-info">
                                <span class="image-id">#${item.id}</span>
                                <span class="status-badge ${item.label_status}">${item.label_status}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>`
            }

            <div class="pagination">
                <button ${data.page <= 1 ? 'disabled' : ''} onclick="goPage(${data.page - 1})">← Prev</button>
                <span class="page-info">Page ${data.page} of ${data.pages} (${data.total} images)</span>
                <button ${data.page >= data.pages ? 'disabled' : ''} onclick="goPage(${data.page + 1})">Next →</button>
            </div>
        `;
        loadAllImages();
    } catch (e) {
        main.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Error: ${e.message}</p></div>`;
    }
}

function setFilter(f) {
    currentFilter = f;
    currentPage = 1;
    navigate(`#/reviewer/${currentReviewer}/${f}/1`);
}

function goPage(p) {
    currentPage = p;
    navigate(`#/reviewer/${currentReviewer}/${currentFilter}/${p}`);
}

// ---- Editor View ----
async function renderEditor() {
    const main = document.getElementById('main-content');
    main.innerHTML = '<div class="loading"><div class="spinner"></div>Loading image data...</div>';

    try {
        currentData = await api(`/images/${currentImageId}`);
        const d = currentData;
        const reviewer = d.reviewer;

        setBreadcrumb([
            { label: 'Dashboard', href: '#/' },
            { label: `Reviewer ${reviewer}`, href: `#/reviewer/${reviewer}` },
            { label: `Image #${d.id}` },
        ]);

        // Use corrected data if available, else fall back to OCR data
        const formData = d.corrected_data || d.ocr_data;
        const meds = formData.medicines_parsed || [];

        // Initialize boxes from server data (contains p.label_coordinates or original bboxes)
        const bboxes = d.ocr_data.bboxes || {};
        currentBoxesData = JSON.parse(JSON.stringify(bboxes)); // deep copy

        main.innerHTML = `
            <div class="editor-layout">
                <!-- Image Panel -->
                <div class="editor-image-panel">
                    <div class="panel-header">
                        <span class="panel-title">📷 Prescription Image</span>
                        <div id="imageActionsNormal">
                            <button class="btn btn-ghost btn-sm" onclick="startCrop()">✂️ Crop</button>
                            <button class="btn btn-ghost btn-sm" onclick="redoOCR()">🔄 Redo OCR</button>
                            <span class="status-badge ${d.label_status}">${d.label_status}</span>
                        </div>
                        <div id="imageActionsCrop" style="display:none; gap:5px;">
                            <button class="btn btn-ghost btn-sm" onclick="rotateImage(-90)" title="Rotate Left">↺ 90°</button>
                            <button class="btn btn-ghost btn-sm" onclick="rotateImage(90)" title="Rotate Right">↻ 90°</button>
                            <div class="header-divider" style="height:15px; margin:0 5px"></div>
                            <button class="btn btn-ghost btn-sm" onclick="cancelCrop()">Cancel</button>
                            <button class="btn btn-success btn-sm" onclick="applyCrop()">✓ Apply Crop</button>
                        </div>
                    </div>
                    <div class="image-container" id="imageContainer" onclick="toggleZoom(event)">
                        <div class="image-wrapper" id="imageWrapper">
                            <img data-img-path="${d.image_url || ''}" src="${d.image_url || ''}?t=${Date.now()}" alt="Prescription ${d.id}" id="editorImage" onload="drawBBoxes()">
                            <div id="bboxOverlay" class="bbox-overlay"></div>
                        </div>
                    </div>
                </div>

                <!-- Form Panel -->
                <div class="editor-form-panel">
                    <div class="panel-header">
                        <span class="panel-title">✏️ OCR Output — Edit & Correct</span>
                        <span style="font-size:0.75rem; color:var(--text-muted)">ID: ${d.id}</span>
                    </div>
                    <div class="form-scroll" id="formScroll">
                        <!-- Patient Details -->
                        <div class="form-section">
                            <div class="form-section-title">Patient Details</div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label>Name</label>
                                    <input type="text" id="f_patient_name" value="${esc(formData.patient_name || '')}" oninput="syncPatientField(this.value, 'Patient Name')">
                                </div>
                                <div class="form-group">
                                    <label>Age</label>
                                    <input type="text" id="f_patient_age" value="${esc(formData.patient_age != null ? formData.patient_age : '')}" oninput="syncPatientField(this.value, 'Age')">
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label>Gender</label>
                                    <select id="f_patient_gender" onchange="syncPatientField(this.value, 'Gender')">
                                        <option value="">—</option>
                                        <option value="Male" ${formData.patient_gender === 'Male' ? 'selected' : ''}>Male</option>
                                        <option value="Female" ${formData.patient_gender === 'Female' ? 'selected' : ''}>Female</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>CNIC</label>
                                    <input type="text" id="f_patient_cnic" value="${esc(formData.patient_cnic || '')}">
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label>Phone</label>
                                    <input type="text" id="f_patient_phone" value="${esc(formData.patient_phone || '')}" oninput="syncPatientField(this.value, 'Mobile #')">
                                </div>
                                <div class="form-group">
                                    <label>Patient Details (full text)</label>
                                    <input type="text" id="f_patient_details" value="${esc(formData.patient_details || '')}">
                                </div>
                            </div>
                        </div>

                        <!-- Clinical -->
                        <div class="form-section">
                            <div class="form-section-title">Clinical Info</div>
                            <div class="form-group full-width">
                                <label>Symptoms</label>
                                <textarea id="f_symptoms" rows="2">${esc(formData.symptoms || '')}</textarea>
                            </div>
                            <div class="form-group full-width" style="margin-top:0.5rem">
                                <label>Diagnosis</label>
                                <textarea id="f_diagnosis" rows="2">${esc(formData.diagnosis || '')}</textarea>
                            </div>
                            <div class="form-group full-width" style="margin-top:0.5rem">
                                <label>Tests</label>
                                <textarea id="f_tests" rows="2">${esc(formData.tests || '')}</textarea>
                            </div>
                        </div>

                        <!-- Medicines -->
                        <div class="form-section">
                            <div class="form-section-title">Medicines (${meds.length})</div>
                            <div class="medicine-list" id="medicineList">
                                ${meds.map((m, i) => renderMedicineItem(m, i)).join('')}
                            </div>
                            <button class="add-medicine-btn" onclick="addMedicine()">+ Add Medicine</button>
                        </div>
                    </div>

                    <!-- Action Bar -->
                    <div class="action-bar">
                        <div class="nav-actions">
                            <button class="btn btn-ghost" onclick="navPrev()">← Prev <span class="kbd">←</span></button>
                            <button class="btn btn-ghost" onclick="navNext()">Next → <span class="kbd">→</span></button>
                        </div>
                        <div class="main-actions">
                            <button class="btn btn-warning" onclick="skipImage()">Skip</button>
                            <button class="btn btn-success" onclick="markCorrect()">✓ Mark Correct</button>
                            <button class="btn btn-primary" onclick="saveAndNext()">Save & Next <span class="kbd">Ctrl+↵</span></button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Load ordered image list for this reviewer for prev/next
        if (imageIds.length === 0 && reviewer) {
            const all = await api(`/images?reviewer=${reviewer}&status=all&limit=200`);
            imageIds = all.items.map(item => item.id);
        }

        loadAllImages();

    } catch (e) {
        main.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Error: ${e.message}</p></div>`;
    }
}

function renderMedicineItem(m, index) {
    return `
        <div class="medicine-item" data-index="${index}">
            <div class="med-header">
                <span class="med-number">Medicine ${index + 1}</span>
                <button class="med-remove" onclick="removeMedicine(${index})">×</button>
            </div>
            <div class="med-fields">
                <div class="form-group med-raw">
                    <label>Raw Text</label>
                    <input type="text" class="med-field" data-field="raw" data-index="${index}" value="${esc(m.raw || '')}">
                </div>
                <div class="form-group">
                    <label>Name</label>
                    <input type="text" class="med-field" data-field="name" data-index="${index}" value="${esc(m.name || '')}">
                </div>
                <div class="form-group">
                    <label>Dosage Form</label>
                    <input type="text" class="med-field" data-field="dosage_form" data-index="${index}" value="${esc(m.dosage_form || '')}" placeholder="Tab, Cap, Syp...">
                </div>
                <div class="form-group">
                    <label>Strength</label>
                    <input type="text" class="med-field" data-field="strength" data-index="${index}" value="${esc(m.strength || '')}" placeholder="500mg">
                </div>
                <div class="form-group">
                    <label>Frequency</label>
                    <input type="text" class="med-field" data-field="frequency" data-index="${index}" value="${esc(m.frequency || '')}" placeholder="BD, OD, 1+1...">
                </div>
                <div class="form-group">
                    <label>Duration</label>
                    <input type="text" class="med-field" data-field="duration" data-index="${index}" value="${esc(m.duration || '')}" placeholder="7 days">
                </div>
            </div>
        </div>
    `;
}

function addMedicine() {
    const list = document.getElementById('medicineList');
    const index = list.children.length;
    const html = renderMedicineItem({ raw: '', name: '', dosage_form: '', strength: '', frequency: '', duration: '' }, index);
    list.insertAdjacentHTML('beforeend', html);
}

function removeMedicine(index) {
    const list = document.getElementById('medicineList');
    const items = list.querySelectorAll('.medicine-item');
    if (items[index]) {
        items[index].remove();
        // Re-index remaining items
        list.querySelectorAll('.medicine-item').forEach((item, i) => {
            item.dataset.index = i;
            item.querySelector('.med-number').textContent = `Medicine ${i + 1}`;
            item.querySelectorAll('.med-field').forEach(f => f.dataset.index = i);
        });
    }
}

// Function to automatically sync edited structured fields into the Patient Details raw string
window.syncPatientField = function (newVal, labelStr) {
    const rawInput = document.getElementById('f_patient_details');
    if (!rawInput || !rawInput.value) return;

    // Look for e.g. "Patient Name : whatever," or "Age : whatever,"
    const regex = new RegExp(`(${labelStr}\\s*:\\s*)([^,]*)`, 'i');
    if (regex.test(rawInput.value)) {
        rawInput.value = rawInput.value.replace(regex, `$1${newVal}`);
    }
};

// ---- Form data collection ----
function collectFormData() {
    const val = id => (document.getElementById(id)?.value || '').trim();

    // Collect medicines
    const medItems = document.querySelectorAll('.medicine-item');
    const medicines_parsed = [];
    medItems.forEach(item => {
        const fields = {};
        item.querySelectorAll('.med-field').forEach(input => {
            fields[input.dataset.field] = input.value.trim() || null;
        });
        if (fields.raw || fields.name) {
            medicines_parsed.push(fields);
        }
    });

    const age = val('f_patient_age');
    return {
        patient_name: val('f_patient_name') || null,
        patient_age: age ? (isNaN(Number(age)) ? age : Number(age)) : null,
        patient_gender: val('f_patient_gender') || null,
        patient_cnic: val('f_patient_cnic') || null,
        patient_phone: val('f_patient_phone') || null,
        patient_details: val('f_patient_details') || null,
        symptoms: val('f_symptoms') || null,
        diagnosis: val('f_diagnosis') || null,
        tests: val('f_tests') || null,
        medicines_parsed,
    };
}

// ---- Actions ----
async function saveAndNext() {
    try {
        const corrected = collectFormData();
        await api(`/images/${currentImageId}`, {
            method: 'PUT',
            body: JSON.stringify({ corrected_data: corrected, bboxes: currentBoxesData }),
        });
        showToast('Saved ✓', 'success');
        navNext();
    } catch (e) {
        showToast('Save failed: ' + e.message, 'error');
    }
}

async function markCorrect() {
    try {
        // First save any edits made, then mark complete
        const corrected = collectFormData();
        await api(`/images/${currentImageId}`, {
            method: 'PUT',
            body: JSON.stringify({ corrected_data: corrected, bboxes: currentBoxesData }),
        });
        await api(`/images/${currentImageId}/complete`, { method: 'POST' });
        showToast('Marked as correct ✓', 'success');
        navNext();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

async function skipImage() {
    try {
        await api(`/images/${currentImageId}/skip`, { method: 'POST' });
        showToast('Skipped', 'info');
        navNext();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

function navNext() {
    const idx = imageIds.indexOf(currentImageId);
    if (idx >= 0 && idx < imageIds.length - 1) {
        navigate(`#/editor/${imageIds[idx + 1]}`);
    } else {
        showToast('No more images', 'info');
    }
}

function navPrev() {
    const idx = imageIds.indexOf(currentImageId);
    if (idx > 0) {
        navigate(`#/editor/${imageIds[idx - 1]}`);
    } else {
        showToast('At the beginning', 'info');
    }
}

let isDragPanning = false;

function toggleZoom(e) {
    const container = document.getElementById('imageContainer');
    if (!container) return;

    // Set smooth scrolling for the transition
    container.style.scrollBehavior = 'smooth';

    // Prevent zoom toggle if the user was dragging/panning
    if (isDragPanning) {
        isDragPanning = false;
        return;
    }

    const img = document.getElementById('editorImage');

    // Calculate click position ratio before zoom
    let xRatio = 0.5;
    let yRatio = 0.5;

    if (e && e.target === img && !isZoomed) {
        const rect = img.getBoundingClientRect();
        xRatio = (e.clientX - rect.left) / rect.width;
        yRatio = (e.clientY - rect.top) / rect.height;
    }

    isZoomed = !isZoomed;
    container.classList.toggle('zoomed', isZoomed);

    if (isZoomed && e) {
        // Wait for CSS to apply the new size, then scroll to center the clicked point
        setTimeout(() => {
            const newRect = img.getBoundingClientRect();
            // scrollX = (absolute position of clicked point on new image) - (half viewport width)
            container.scrollLeft = (newRect.width * xRatio) - (container.clientWidth / 2);
            container.scrollTop = (newRect.height * yRatio) - (container.clientHeight / 2);
            drawBBoxes(); // Recalculate bbox overlay for new zoom state

            // Turn off smooth scrolling after the transition to allow instant drag-panning
            setTimeout(() => { container.style.scrollBehavior = 'auto'; }, 600);
        }, 30);
    } else {
        // Recalculate bbox overlay for unzoomed state
        setTimeout(() => {
            drawBBoxes();
            container.style.scrollBehavior = 'auto';
        }, 30);
    }
}

// Add simple pan support when zoomed
let startX, startY, scrollLeft, scrollTop, isDown = false;
document.addEventListener('mousedown', (e) => {
    const container = document.getElementById('imageContainer');
    if (!container || !isZoomed || !container.contains(e.target)) return;

    // Ignore if starting drag on a bbox
    if (e.target.classList.contains('bbox-rect') || e.target.classList.contains('bbox-handle')) return;

    isDown = true;
    isDragPanning = false;
    startX = e.pageX - container.offsetLeft;
    startY = e.pageY - container.offsetTop;
    scrollLeft = container.scrollLeft;
    scrollTop = container.scrollTop;
});

document.addEventListener('mouseleave', () => { isDown = false; });
document.addEventListener('mouseup', () => { isDown = false; });
document.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const container = document.getElementById('imageContainer');
    const x = e.pageX - container.offsetLeft;
    const y = e.pageY - container.offsetTop;
    const walkX = (x - startX);
    const walkY = (y - startY);

    if (Math.abs(walkX) > 5 || Math.abs(walkY) > 5) {
        isDragPanning = true;
    }

    container.scrollLeft = scrollLeft - walkX;
    container.scrollTop = scrollTop - walkY;
});


// ---- Advanced Editor Features (BBoxes, Crop, Redo) ----
let cropper = null;

async function redoOCR() {
    if (!confirm("Are you sure you want to redo OCR? This will overwrite your current corrections.")) return;

    document.getElementById('main-content').innerHTML = '<div class="loading"><div class="spinner"></div>Rerunning OCR...</div>';
    try {
        await api(`/images/${currentImageId}/redo_ocr`, { method: 'POST' });
        showToast('OCR completely redone', 'success');
        renderEditor(); // Reload the whole editor with new data
    } catch (e) {
        showToast('Redo failed: ' + e.message, 'error');
        renderEditor(); // Reload properly
    }
}

function startCrop() {
    const img = document.getElementById('editorImage');
    const container = document.getElementById('imageContainer');
    if (!img || !container) return;

    if (isZoomed) toggleZoom(); // unzoom first

    document.getElementById('imageActionsNormal').style.display = 'none';
    document.getElementById('imageActionsCrop').style.display = 'flex';
    document.getElementById('bboxOverlay').style.display = 'none'; // hide bboxes
    container.classList.add('cropping-active');

    // Auto-init Cropper.js
    cropper = new Cropper(img, {
        viewMode: 1,
        dragMode: 'none',
        autoCropArea: 0.9,
        responsive: true,
        restore: false,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        zoomable: false,
        zoomOnTouch: false,
        zoomOnWheel: false,
    });
}

function rotateImage(deg) {
    if (cropper) cropper.rotate(deg);
}
function cancelCrop() {
    if (cropper) {
        cropper.destroy();
        cropper = null;
    }
    const container = document.getElementById('imageContainer');
    if (container) container.classList.remove('cropping-active');

    document.getElementById('imageActionsCrop').style.display = 'none';
    document.getElementById('imageActionsNormal').style.display = 'flex';
    document.getElementById('bboxOverlay').style.display = 'block';
}

async function applyCrop() {
    if (!cropper) return;

    // Get cropped canvas
    const canvas = cropper.getCroppedCanvas();
    if (!canvas) return;

    // Convert to base64 jpeg
    const base64Image = canvas.toDataURL('image/jpeg', 0.85);

    document.getElementById('imageActionsCrop').innerHTML = '<span>Saving...</span>';
    try {
        await api(`/images/${currentImageId}/replace`, {
            method: 'POST',
            body: JSON.stringify({ image_base64: base64Image })
        });
        showToast('Image cropped and saved', 'success');

        const container = document.getElementById('imageContainer');
        if (container) container.classList.remove('cropping-active');
    } catch (e) {
        showToast('Crop save failed: ' + e.message, 'error');
    }

    cancelCrop();
    // Fully re-render to ensure bboxes and image are in sync with the server
    renderEditor();
}

// BBox Rendering logic
let dragBBox = null;
let currentBoxesData = {};

function drawBBoxes() {
    const overlay = document.getElementById('bboxOverlay');
    const img = document.getElementById('editorImage');
    const wrapper = document.getElementById('imageWrapper');
    if (!overlay || !img || !wrapper) return;

    if (isZoomed) {
        // Zoomed: wrapper is inline-block, matches image 1:1
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
    } else {
        // Normal: wrapper fills container, image uses object-fit: contain
        // Compute actual rendered image rect within the wrapper
        const wrapperW = wrapper.clientWidth;
        const wrapperH = wrapper.clientHeight;
        const imgNatW = img.naturalWidth || 1;
        const imgNatH = img.naturalHeight || 1;

        const scale = Math.min(wrapperW / imgNatW, wrapperH / imgNatH);
        const renderedW = imgNatW * scale;
        const renderedH = imgNatH * scale;
        const offsetX = (wrapperW - renderedW) / 2;
        const offsetY = (wrapperH - renderedH) / 2;

        overlay.style.left = offsetX + 'px';
        overlay.style.top = offsetY + 'px';
        overlay.style.width = renderedW + 'px';
        overlay.style.height = renderedH + 'px';
    }

    overlay.innerHTML = '';

    for (const [label, coords] of Object.entries(currentBoxesData)) {
        if (!coords || coords.length !== 4) continue;

        const [x1, y1, x2, y2] = coords; // 0-1000 scale

        const box = document.createElement('div');
        box.className = 'bbox-rect';
        box.dataset.label = label;

        // Convert to % for responsive absolute positioning within overlay
        box.style.left = (x1 / 1000 * 100) + '%';
        box.style.top = (y1 / 1000 * 100) + '%';
        box.style.width = ((x2 - x1) / 1000 * 100) + '%';
        box.style.height = ((y2 - y1) / 1000 * 100) + '%';

        const labelEl = document.createElement('div');
        labelEl.className = 'bbox-label';
        labelEl.textContent = label;
        box.appendChild(labelEl);

        // Add resize handles (bottom-right)
        const handle = document.createElement('div');
        handle.className = 'bbox-handle';

        // Add simple dragging functionality
        box.onmousedown = (e) => startDragBBox(e, box, label);
        // Prevent zoom when clicking the box itself
        box.onclick = (e) => e.stopPropagation();

        box.appendChild(handle);
        overlay.appendChild(box);
    }
}

function startDragBBox(e, boxEl, label) {
    e.stopPropagation(); // prevent pan logic

    const isResize = e.target.classList.contains('bbox-handle');
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;

    const overlay = document.getElementById('bboxOverlay');
    const rect = overlay.getBoundingClientRect();

    const coords = currentBoxesData[label];
    const startX1 = coords[0];
    const startY1 = coords[1];
    const startX2 = coords[2];
    const startY2 = coords[3];

    function onMove(ev) {
        ev.stopPropagation();
        const dx = ev.clientX - startMouseX;
        const dy = ev.clientY - startMouseY;

        // Convert screen delta to 0-1000 scale delta
        const dScaleX = (dx / rect.width) * 1000;
        const dScaleY = (dy / rect.height) * 1000;

        if (isResize) {
            coords[2] = Math.min(1000, startX2 + dScaleX);
            coords[3] = Math.min(1000, startY2 + dScaleY);
        } else {
            const shiftX = Math.max(-startX1, Math.min(1000 - startX2, dScaleX));
            const shiftY = Math.max(-startY1, Math.min(1000 - startY2, dScaleY));
            coords[0] = startX1 + shiftX;
            coords[1] = startY1 + shiftY;
            coords[2] = startX2 + shiftX;
            coords[3] = startY2 + shiftY;
        }

        // Apply inline
        boxEl.style.left = (coords[0] / 1000 * 100) + '%';
        boxEl.style.top = (coords[1] / 1000 * 100) + '%';
        boxEl.style.width = ((coords[2] - coords[0]) / 1000 * 100) + '%';
        boxEl.style.height = ((coords[3] - coords[1]) / 1000 * 100) + '%';
    }

    function onUp(ev) {
        ev.stopPropagation();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // Ensure ints
        currentBoxesData[label] = coords.map(c => Math.round(c));
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}


// Recalculate bbox overlay on window resize
window.addEventListener('resize', () => {
    if (currentView === 'editor' && Object.keys(currentBoxesData).length > 0) {
        drawBBoxes();
    }
});

// ---- Keyboard shortcuts ----
document.addEventListener('keydown', (e) => {
    if (currentView !== 'editor') return;

    // Don't intercept when typing in inputs
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') document.activeElement.blur();
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            saveAndNext();
        }
        return;
    }

    if (e.key === 'ArrowRight') { e.preventDefault(); navNext(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); navPrev(); }
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); saveAndNext(); }
});

// ---- Utility ----
function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
