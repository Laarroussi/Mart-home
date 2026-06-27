/**
 * ============================================================
 * CLIENT API — Marfan APA Frontend
 * À inclure dans investigateur.html via :
 *   <script src="api-client.js"></script>
 *
 * Tous les appels passent par window.MarfanAPI.*
 * Le token JWT est stocké dans localStorage.
 *
 * Mode dégradé : si l'API n'est pas joignable, on retombe sur
 * les données in-memory existantes (mode démo).
 * ============================================================
 */
(function () {
  const API_BASE = (window.MARFAN_API_BASE || '/api').replace(/\/$/, '');
  const TOKEN_KEY = 'marfan.token';
  const USER_KEY  = 'marfan.user';

  // ============================================================
  // Helpers HTTP
  // ============================================================
  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(token, user) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (user)  localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  }

  async function request(method, path, body, opts = {}) {
    const headers = { 'Accept': 'application/json' };
    if (body && !opts.formData) headers['Content-Type'] = 'application/json';
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const fetchOpts = { method, headers };
    if (body) fetchOpts.body = opts.formData ? body : JSON.stringify(body);

    let resp;
    try {
      resp = await fetch(API_BASE + path, fetchOpts);
    } catch (networkErr) {
      throw new APIError(0, 'API injoignable. Vérifiez votre connexion.', networkErr);
    }

    let data = null;
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await resp.json().catch(() => null);
    } else if (resp.status !== 204) {
      data = await resp.text().catch(() => null);
    }

    if (!resp.ok) {
      if (resp.status === 401) clearToken();
      const message = (data && data.error) || `Erreur HTTP ${resp.status}`;
      throw new APIError(resp.status, message, data);
    }
    return data;
  }

  class APIError extends Error {
    constructor(status, message, data) {
      super(message); this.name = 'APIError'; this.status = status; this.data = data;
    }
  }

  // ============================================================
  // API publique
  // ============================================================
  const API = {
    /** ===== Authentification ===== */
    async login(email, password) {
      const res = await request('POST', '/auth/login', { email, password });
      setToken(res.token, res.user);
      return res.user;
    },
    async logout() {
      try { await request('POST', '/auth/logout'); } catch (e) { /* ignore */ }
      clearToken();
    },
    async me() {
      try { const r = await request('GET', '/auth/me'); return r.user; }
      catch { return null; }
    },
    async changePassword(oldPassword, newPassword) {
      const res = await request('POST', '/auth/change-password', { oldPassword, newPassword });
      // Met à jour le user en cache pour refléter must_change_password=false
      const u = getUser();
      if (u) { u.must_change_password = false; setToken(null, u); }
      return res;
    },
    isAuthenticated() { return !!getToken(); },
    currentUser() { return getUser(); },
    mustChangePassword() {
      const u = getUser();
      return !!(u && u.must_change_password);
    },

    /** ===== Utilisateurs ===== */
    users: {
      list:   (filters = {}) => request('GET', '/users?' + new URLSearchParams(filters).toString()),
      create: (data) => request('POST', '/users', data),
      update: (id, data) => request('PATCH', `/users/${id}`, data)
    },

    /** ===== Patients ===== */
    patients: {
      list:   () => request('GET', '/patients'),
      get:    (id) => request('GET', `/patients/${id}`),
      create: (data) => request('POST', '/patients', data),
      update: (id, data) => request('PATCH', `/patients/${id}`, data)
    },

    /** ===== Évaluations ===== */
    evaluations: {
      list:   (patientId) => request('GET', `/evaluations/${patientId}`),
      create: (patientId, data) => request('POST', `/evaluations/${patientId}`, data),
      update: (id, data) => request('PATCH', `/evaluations/by-id/${id}`, data)
    },

    /** ===== Notifications ===== */
    notifications: {
      list: (patientId) => request('GET', `/notifications/${patientId}`),
      send: (patientIds, types) => request('POST', '/notifications/send', { patientIds, types }),
      complete: (id, score) => request('POST', `/notifications/${id}/complete`, { score }),
      log: (limit = 100) => request('GET', `/notifications/log/recent?limit=${limit}`)
    },

    /** ===== Éducation ===== */
    education: {
      capsules: () => request('GET', '/education/capsules'),
      summary:  () => request('GET', '/education/summary'),
      records:  (filters = {}) => request('GET', '/education/records?' + new URLSearchParams(filters).toString()),
      send:     (patientIds, capsuleId, when) => request('POST', '/education/send', { patientIds, capsuleId, when }),
      completePre:  (patientId, capsuleId, score) => request('POST', `/education/${patientId}/${capsuleId}/complete-pre`, { score }),
      watchVideo:   (patientId, capsuleId)        => request('POST', `/education/${patientId}/${capsuleId}/watch-video`),
      completePost: (patientId, capsuleId, score) => request('POST', `/education/${patientId}/${capsuleId}/complete-post`, { score })
    },

    /** ===== Analyses (upload CSV/XLSX) ===== */
    analyses: {
      uploadVo2: (patientId, evalId, file) => {
        const fd = new FormData(); fd.append('file', file);
        return request('POST', `/analyses/vo2/upload/${patientId}/${evalId}`, fd, { formData: true });
      },
      uploadPulse: (patientId, evalId, file) => {
        const fd = new FormData(); fd.append('file', file);
        return request('POST', `/analyses/pulse/upload/${patientId}/${evalId}`, fd, { formData: true });
      },
      list: (patientId) => request('GET', `/analyses/${patientId}`)
    },

    /** ===== Visio ===== */
    visio: {
      sessions: () => request('GET', '/visio/sessions'),
      start:    (data) => request('POST', '/visio/sessions', data),
      end:      (id, data) => request('PATCH', `/visio/sessions/${id}/end`, data)
    },

    /** ===== Cohorte / BDD ===== */
    cohort: {
      overview: () => request('GET', '/cohort/overview'),
      database: (mode = 'long') => request('GET', `/cohort/database?mode=${mode}`),
      exportUrl: (mode) => `${API_BASE}/cohort/export?mode=${mode}` // à utiliser avec token en query si besoin
    },

    /** ===== Healthcheck ===== */
    health: () => request('GET', '/health'),

    /** ===== Mode dégradé ===== */
    async tryConnect() {
      try { await this.health(); return true; }
      catch { console.warn('[MarfanAPI] backend injoignable — mode démo (données in-memory)'); return false; }
    }
  };

  window.MarfanAPI = API;
  window.APIError = APIError;
})();
