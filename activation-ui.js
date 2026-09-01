/**
 * activation-ui.js — Page d'activation du compte patient
 * =======================================================
 * S'active uniquement lorsque l'URL contient ?activation=<jeton>.
 * Affiche alors un écran plein page où le patient choisit son mot de passe.
 *
 * Le jeton est vérifié auprès du serveur avant d'afficher le formulaire :
 *   - inconnu / déjà utilisé / expiré → message clair, pas de formulaire
 *   - valide → saisie du mot de passe + confirmation
 *
 * Aucun mot de passe n'a transité par e-mail : le patient le définit ici.
 * ======================================================= */

(function () {
  'use strict';

  function getToken() {
    try {
      const p = new URLSearchParams(window.location.search);
      const t = p.get('activation');
      return t && /^[a-f0-9]{64}$/i.test(t) ? t : null;
    } catch (_) { return null; }
  }

  const TOKEN = getToken();
  if (!TOKEN) return; // page normale, on ne fait rien

  // Le lien d'activation est destiné au PATIENT. Si une session est déjà ouverte
  // dans ce navigateur (typiquement celle de l'investigateur qui vient de créer
  // la fiche), on la ferme : sans cela, le patient était reconnecté automatiquement
  // sur l'espace de la session en cours au lieu du sien.
  function fermerSessionExistante() {
    try {
      localStorage.removeItem('marfan.token');
      localStorage.removeItem('marfan.user');
    } catch (_) { /* stockage indisponible */ }
  }
  fermerSessionExistante();

  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  function shell(inner) {
    return `
      <div id="activationOverlay" style="position:fixed; inset:0; z-index:100000; background:linear-gradient(160deg,#0b1530,#132a5c); display:flex; align-items:center; justify-content:center; padding:18px; overflow-y:auto; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <div style="background:#fff; border-radius:18px; width:460px; max-width:100%; box-shadow:0 30px 80px rgba(0,0,0,.4); overflow:hidden;">
          <div style="padding:24px 28px; background:linear-gradient(135deg,#0891b2,#06b6d4); color:#fff;">
            <div style="font-size:11.5px; letter-spacing:1.4px; text-transform:uppercase; opacity:.9;">Marfan APA</div>
            <h2 style="margin:4px 0 0; color:#fff; font-size:20px;">Activation de votre espace</h2>
          </div>
          <div style="padding:24px 28px;">${inner}</div>
        </div>
      </div>`;
  }

  function mount(html) {
    const old = document.getElementById('activationOverlay');
    if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', shell(html));
  }

  function messageErreur(titre, detail) {
    return `
      <div style="text-align:center; padding:8px 0 4px;">
        <div style="font-size:40px; margin-bottom:8px;">⚠️</div>
        <h3 style="margin:0 0 8px; font-size:17px; color:#0b1530;">${esc(titre)}</h3>
        <p style="margin:0 0 18px; font-size:13.5px; color:#475569; line-height:1.55;">${detail}</p>
        <a href="/" style="display:inline-block; padding:11px 22px; background:#0b1530; color:#fff; text-decoration:none; border-radius:9px; font-weight:600; font-size:13.5px;">Aller à la page de connexion</a>
      </div>`;
  }

  const RAISONS = {
    inconnu:      ['Lien non reconnu', "Ce lien d'activation n'existe pas. Vérifiez que vous avez bien copié l'adresse complète depuis l'e-mail."],
    deja_utilise: ['Lien déjà utilisé', "Ce lien a déjà servi à activer votre compte. Connectez-vous normalement, ou utilisez « mot de passe oublié » auprès de votre référent."],
    expire:       ['Lien expiré', "Ce lien n'est plus valable. Demandez à votre référent de vous en envoyer un nouveau."]
  };

  function formulaire(info) {
    const min = info.min_password || 10;
    return `
      <p style="margin:0 0 6px; font-size:14.5px; color:#0b1530;">
        ${info.nom ? 'Bonjour <strong>' + esc(info.nom) + '</strong>,' : 'Bonjour,'}
      </p>
      <p style="margin:0 0 18px; font-size:13.5px; color:#475569; line-height:1.55;">
        Choisissez le mot de passe qui protégera votre espace personnel.
        Il doit contenir au moins <strong>${min} caractères</strong>.
      </p>

      <div style="padding:11px 13px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:9px; margin-bottom:18px; font-size:12.5px; color:#475569;">
        <div>Vous vous connecterez avec votre adresse e-mail :</div>
        <div style="margin-top:3px; color:#0b1530; font-weight:700; font-size:13.5px;">${esc(info.identifiant || info.email_masque || '—')}</div>
        ${info.code_patient ? `<div style="margin-top:6px; font-size:11.5px;">Code de suivi : <strong style="color:#0b1530;">${esc(info.code_patient)}</strong></div>` : ''}
      </div>

      <label style="display:block; font-size:11.5px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.4px; margin-bottom:5px;">Nouveau mot de passe</label>
      <input type="password" id="actPwd1" autocomplete="new-password" style="width:100%; padding:12px; border:1px solid #cbd5e1; border-radius:9px; font-size:15px; box-sizing:border-box; margin-bottom:6px;">
      <div id="actForce" style="font-size:11.5px; color:#94a3b8; margin-bottom:14px;">Au moins ${min} caractères.</div>

      <label style="display:block; font-size:11.5px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.4px; margin-bottom:5px;">Confirmer le mot de passe</label>
      <input type="password" id="actPwd2" autocomplete="new-password" style="width:100%; padding:12px; border:1px solid #cbd5e1; border-radius:9px; font-size:15px; box-sizing:border-box; margin-bottom:6px;">

      <label style="display:flex; align-items:center; gap:7px; font-size:12.5px; color:#475569; margin:10px 0 16px; cursor:pointer;">
        <input type="checkbox" id="actShow" style="width:15px; height:15px; cursor:pointer;"> Afficher les mots de passe
      </label>

      <div id="actErr" style="display:none; padding:10px 12px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; border-radius:9px; font-size:12.5px; margin-bottom:14px;"></div>

      <button id="actSubmit" style="width:100%; padding:14px; border:none; background:linear-gradient(135deg,#0891b2,#06b6d4); color:#fff; border-radius:10px; font-weight:700; font-size:14.5px; cursor:pointer;">Activer mon espace</button>

      <p style="margin:16px 0 0; font-size:11.5px; color:#94a3b8; text-align:center; line-height:1.5;">
        Ce lien est personnel et utilisable une seule fois.<br>Ne le transmettez à personne.
      </p>`;
  }

  function succes(info) {
    const ident = esc((info && info.identifiant) || '');
    return `
      <div style="text-align:center; padding:8px 0 4px;">
        <div style="font-size:44px; margin-bottom:8px;">✅</div>
        <h3 style="margin:0 0 8px; font-size:18px; color:#065f46;">Votre espace est activé</h3>
        <p style="margin:0 0 16px; font-size:13.5px; color:#475569; line-height:1.55;">
          Votre mot de passe a bien été enregistré.
        </p>
        ${ident ? `<div style="padding:11px 13px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:9px; margin-bottom:18px; font-size:12.5px; color:#475569;">
          Connectez-vous avec votre adresse e-mail<br><strong style="color:#0b1530; font-size:14px;">${ident}</strong>
        </div>` : ''}
        <a href="/" onclick="try{localStorage.removeItem('marfan.token');localStorage.removeItem('marfan.user');}catch(e){}" style="display:inline-block; padding:13px 26px; background:linear-gradient(135deg,#10b981,#059669); color:#fff; text-decoration:none; border-radius:10px; font-weight:700; font-size:14px;">Me connecter</a>
      </div>`;
  }

  function brancher(info) {
    const p1 = document.getElementById('actPwd1');
    const p2 = document.getElementById('actPwd2');
    const show = document.getElementById('actShow');
    const btn = document.getElementById('actSubmit');
    const err = document.getElementById('actErr');
    const force = document.getElementById('actForce');
    const min = info.min_password || 10;

    const erreur = m => { err.style.display = 'block'; err.innerHTML = m; };
    const clearErr = () => { err.style.display = 'none'; };

    if (show) show.addEventListener('change', () => {
      const t = show.checked ? 'text' : 'password';
      p1.type = t; p2.type = t;
    });

    if (p1) p1.addEventListener('input', () => {
      const v = p1.value;
      let n = 0;
      if (v.length >= min) n++;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v)) n++;
      if (/[0-9]/.test(v)) n++;
      if (/[^a-zA-Z0-9]/.test(v)) n++;
      const libelles = ['Trop court', 'Faible', 'Correct', 'Bon', 'Excellent'];
      const couleurs = ['#94a3b8', '#dc2626', '#f59e0b', '#0891b2', '#16a34a'];
      const i = v.length < min ? 0 : n;
      force.textContent = v ? 'Robustesse : ' + libelles[i] : 'Au moins ' + min + ' caractères.';
      force.style.color = v ? couleurs[i] : '#94a3b8';
    });

    async function envoyer() {
      clearErr();
      const a = p1.value, b = p2.value;
      if (a.length < min) return erreur('Le mot de passe doit contenir au moins ' + min + ' caractères.');
      if (a !== b)        return erreur('Les deux mots de passe ne sont pas identiques.');
      btn.disabled = true; btn.textContent = 'Activation en cours…';
      try {
        await window.MarfanAPI.activation.complete(TOKEN, a);
        fermerSessionExistante();
        mount(succes(info));
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Activer mon espace';
        erreur(esc((e && e.message) || "L'activation a échoué. Réessayez."));
      }
    }

    if (btn) btn.addEventListener('click', envoyer);
    [p1, p2].forEach(el => el && el.addEventListener('keydown', e => {
      if (e.key === 'Enter') envoyer();
    }));
    if (p1) p1.focus();
  }

  async function demarrer() {
    mount('<div style="text-align:center; padding:22px 0; color:#64748b; font-size:13.5px;">Vérification du lien…</div>');
    // api-client.js peut ne pas être encore prêt
    for (let i = 0; i < 40 && !window.MarfanAPI; i++) {
      await new Promise(r => setTimeout(r, 50));
    }
    if (!window.MarfanAPI) {
      mount(messageErreur('Service indisponible', "Impossible de contacter le serveur. Réessayez dans quelques instants."));
      return;
    }
    try {
      const info = await window.MarfanAPI.activation.verify(TOKEN);
      if (!info || !info.valid) throw Object.assign(new Error('invalide'), { data: info });
      mount(formulaire(info));
      brancher(info);
    } catch (e) {
      const raison = (e && e.data && e.data.reason) || 'inconnu';
      const [titre, detail] = RAISONS[raison] || RAISONS.inconnu;
      mount(messageErreur(titre, detail));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', demarrer);
  } else {
    demarrer();
  }
})();
