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
      list:   (filters = {}) => {
        const qs = Object.keys(filters).length
          ? '?' + new URLSearchParams(filters).toString()
          : '';
        return request('GET', '/patients' + qs);
      },
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
      sessions:        (filters = {}) => request('GET', '/visio/sessions?' + new URLSearchParams(filters).toString()),
      mine:            ()             => request('GET', '/visio/mine'),
      get:             (id)           => request('GET', `/visio/sessions/${id}`),
      create:          (data)         => request('POST', '/visio/sessions', data),
      update:          (id, data)     => request('PATCH', `/visio/sessions/${id}`, data),
      cancel:          (id)           => request('POST', `/visio/sessions/${id}/cancel`),
      start:           (id)           => request('POST', `/visio/sessions/${id}/start`),
      end:             (id, data)     => request('PATCH', `/visio/sessions/${id}/end`, data),
      remove:          (id)           => request('DELETE', `/visio/sessions/${id}`),
      addParticipants: (id, patientIds) => request('POST', `/visio/sessions/${id}/participants`, { patientIds }),
      removeParticipant:(id, patientId) => request('DELETE', `/visio/sessions/${id}/participants/${patientId}`)
    },

    /** ===== Vidéos (entraînement, éducation, info) ===== */
    videos: {
      list:     (filters = {}) => request('GET', '/videos?' + new URLSearchParams(filters).toString()),
      mine:     ()              => request('GET', '/videos/mine'),
      create:   (data)          => request('POST', '/videos', data),
      update:   (id, data)      => request('PATCH', `/videos/${id}`, data),
      remove:   (id, hard=false)=> request('DELETE', `/videos/${id}${hard ? '?hard=true' : ''}`),
      assign:   (id, patientIds, note) => request('POST', `/videos/${id}/assign`, { patientIds, note }),
      unassign: (id, patientId) => request('DELETE', `/videos/${id}/assign/${patientId}`),
      patients: (id)            => request('GET', `/videos/${id}/patients`)
    },

    /** ===== Cohorte / BDD ===== */
    cohort: {
      overview: () => request('GET', '/cohort/overview'),
      database: (mode = 'long') => request('GET', `/cohort/database?mode=${mode}`),
      exportUrl: (mode) => `${API_BASE}/cohort/export?mode=${mode}` // à utiliser avec token en query si besoin
    },

    /** ===== Examens médicaux (CPET, Onde de pouls, ...) ===== */
    medicalExams: {
      create:        (data)         => request('POST', '/medical-exams', data),
      listByPatient: (patientId)    => request('GET', `/medical-exams/patient/${patientId}`),
      get:           (id, withRaw)  => request('GET', `/medical-exams/${id}${withRaw ? '?withRaw=true' : ''}`),
      validate:      (id, validatedData, notes) => request('POST', `/medical-exams/${id}/validate`,
                                                            { validated_data: validatedData, notes }),
      saveGraphConfig: (id, graphConfig, validatedData, validate, notes) =>
        request('POST', `/medical-exams/${id}/graph-config`,
                { graph_config: graphConfig, validated_data: validatedData, validate: !!validate, notes }),
      remove:        (id)           => request('DELETE', `/medical-exams/${id}`),
      list:          (filters = {}) => request('GET', '/medical-exams?' + new URLSearchParams(filters).toString())
    },

    /** ===== Dossier médical structuré (8 sections + import PDF) ===== */
    medicalRecords: {
      get:            (patientId) => request('GET', `/medical-records/${patientId}`),
      patchSection:   (patientId, section, data, source, sourceDocId, comment) =>
                        request('PATCH', `/medical-records/${patientId}/${section}`,
                                { data, source, source_doc_id: sourceDocId, comment }),
      listDocuments:  (patientId) => request('GET', `/medical-records/${patientId}/documents`),
      uploadDocument: (patientId, data) => request('POST', `/medical-records/${patientId}/documents`, data),
      getDocument:    (patientId, id, withRaw) =>
                        request('GET', `/medical-records/${patientId}/documents/${id}${withRaw ? '?withRaw=true' : ''}`),
      integrate:      (patientId, id, sectionsToIntegrate, comment) =>
                        request('POST', `/medical-records/${patientId}/documents/${id}/integrate`,
                                { sections_to_integrate: sectionsToIntegrate, comment }),
      reject:         (patientId, id, notes) =>
                        request('POST', `/medical-records/${patientId}/documents/${id}/reject`, { notes }),
      removeDocument: (patientId, id) => request('DELETE', `/medical-records/${patientId}/documents/${id}`)
    },

    /** ===== Consultations chronologiques + suivi aortique ===== */
    consultations: {
      list:        (patientId)             => request('GET',   `/consultations/${patientId}`),
      create:      (patientId, data)       => request('POST',  `/consultations/${patientId}`, data),
      update:      (patientId, id, data)   => request('PATCH', `/consultations/${patientId}/${id}`, data),
      remove:      (patientId, id)         => request('DELETE',`/consultations/${patientId}/${id}`),
      getAortic:   (patientId)             => request('GET',   `/consultations/${patientId}/aortic`),
      patchAortic: (patientId, data)       => request('PATCH', `/consultations/${patientId}/aortic`, data)
    },

    /** ===== Chronologie médicale extraite des documents (IA) ===== */
    timeline: {
      list:     (patientId)              => request('GET',   `/timeline/${patientId}`),
      analyser: (patientId, texte, docId)=> request('POST',  `/timeline/${patientId}/analyser`, { texte, doc_id: docId }),
      save:     (patientId, faits, docId)=> request('POST',  `/timeline/${patientId}`, { faits, doc_id: docId }),
      update:   (patientId, id, data)    => request('PATCH', `/timeline/${patientId}/${id}`, data),
      remove:   (patientId, id)          => request('DELETE',`/timeline/${patientId}/${id}`),
      statutIA: ()                       => request('GET',   '/timeline/statut/ia')
    },

    /** ===== Activation de compte patient (lien e-mail à usage unique) ===== */
    activation: {
      // Public — le jeton du lien fait foi, aucune session requise
      verify:   (token)            => request('GET',  `/activation/verify/${token}`),
      complete: (token, password)  => request('POST', '/activation/complete', { token, password }),
      // Staff
      send:     (patientId, data)  => request('POST', `/activation/send/${patientId}`, data || {}),
      status:   ()                 => request('GET',  '/activation/status')
    },

    /** ===== Questionnaires validés (SF-36, GPAQ) ===== */
    questionnaires: {
      mine:    ()             => request('GET',  '/questionnaires/mine'),
      pending: ()             => request('GET',  '/questionnaires/pending'),
      get:     (id)           => request('GET',  `/questionnaires/${id}`),
      send:    (data)         => request('POST', '/questionnaires/send', data),
      submit:  (id, answers)  => request('POST', `/questionnaires/${id}/submit`, { answers }),
      list:    (filters = {}) => request('GET',  '/questionnaires?' + new URLSearchParams(filters).toString())
    },

    /** ===== Programmes / séances prescrites d'entraînement ===== */
    trainingPrograms: {
      list:   (filters = {}) => request('GET', '/training-programs?' + new URLSearchParams(filters).toString()),
      mine:   ()             => request('GET', '/training-programs/mine'),
      get:    (id)           => request('GET', `/training-programs/${id}`),
      create: (data)         => request('POST', '/training-programs', data),
      update: (id, data)     => request('PATCH', `/training-programs/${id}`, data),
      remove: (id, hard=false) => request('DELETE', `/training-programs/${id}${hard ? '?hard=true' : ''}`)
    },

    /** ===== Séances d'entraînement patient =====
     *  start(opts) où opts = {
     *    session_type: 'video' | 'visio' | 'libre' | 'autre'
     *    video_id?, training_program_id?, visio_session_id?, content?
     *  }
     *  Compat ancienne signature : start(visioId) avec un nombre/string
     */
    training: {
      start: (opts) => {
        // Compat : si on reçoit juste un id de visio (number/string), on convertit
        if (opts == null) opts = { session_type: 'libre' };
        else if (typeof opts === 'number' || typeof opts === 'string') {
          opts = { session_type: 'visio', visio_session_id: opts };
        }
        return request('POST', '/training/sessions', opts);
      },
      pushSamples: (id, samples)            => request('POST', `/training/sessions/${id}/samples`, { samples }),
      end:         (id, borg, opts={})      => request('POST', `/training/sessions/${id}/end`,
                                                       Object.assign({ borg_cr10: borg }, opts)),
      mine:        ()                       => request('GET',  '/training/sessions/mine'),
      get:         (id)                     => request('GET',  `/training/sessions/${id}`),
      list:        (filters={})             => request('GET',  '/training/sessions?' + new URLSearchParams(filters).toString())
    },

    /** ===== Sauvegarde / Restauration (principal_admin uniquement) ===== */
    backup: {
      status:  () => request('GET',  '/backup/status'),
      // Export : on n'utilise PAS request() (qui parse en JSON) car on veut le blob ZIP
      async exportZip() {
        const token = getToken();
        const resp = await fetch(API_BASE + '/backup/export', {
          method: 'POST',
          headers: token ? { Authorization: 'Bearer ' + token } : {}
        });
        if (!resp.ok) {
          let msg = 'Export échoué';
          try { const j = await resp.json(); msg = j.error || msg; } catch (_) {}
          throw new APIError(resp.status, msg);
        }
        const blob = await resp.blob();
        const filename = (resp.headers.get('content-disposition') || '').match(/filename="?([^";]+)"?/);
        return {
          blob,
          filename: filename ? filename[1] : 'marfan_apa_backup.backup.zip',
          sha256: resp.headers.get('x-backup-sha256')
        };
      },
      async inspect(file) {
        const fd = new FormData(); fd.append('file', file);
        return request('POST', '/backup/inspect', fd, { formData: true });
      },
      async restore(file, forcePasswordChange = false) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('confirm', 'true');
        fd.append('forcePasswordChange', forcePasswordChange ? 'true' : 'false');
        return request('POST', '/backup/restore', fd, { formData: true });
      }
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
