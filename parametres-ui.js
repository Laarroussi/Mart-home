/* ============================================================
   PARAMÈTRES — administration des comptes
   ------------------------------------------------------------
   Réservé à l'administrateur principal. L'onglet lui-même est masqué pour
   les autres rôles, mais ce masquage n'est qu'un confort d'interface : ce
   qui protège réellement, ce sont les routes du serveur, qui refusent ces
   opérations à tout autre rôle. Cacher un bouton n'a jamais empêché personne
   d'appeler l'adresse directement.

   Sur les mots de passe, un parti pris qui mérite d'être expliqué :
   l'administrateur ne peut pas en choisir un. Fixer le mot de passe de
   quelqu'un, c'est pouvoir se connecter à sa place sans que rien ne l'en
   distingue — et tout ce que ce compte ferait ensuite lui serait attribué.
   Deux chemins sont donc proposés, et dans les deux l'administrateur ignore
   le mot de passe qui finira par être utilisé :

     • un lien de réinitialisation, que la personne suit elle-même ;
     • un mot de passe provisoire tiré au hasard, affiché une seule fois,
       et qui doit être changé à la première connexion.

   La suppression, elle, refuse trois cas : son propre compte, le dernier
   administrateur actif, et un compte patient rattaché à un dossier — dans ce
   dernier cas on propose la désactivation, qui coupe l'accès sans rendre le
   dossier orphelin.
   ============================================================ */
(function () {
  'use strict';

  var _comptes = [];
  var _filtre = '';
  var _role = '';
  // Les comptes archivés sont masqués par défaut : la liste quotidienne doit
  // montrer qui travaille, pas l'historique des départs.
  var _voirArchives = false;

  function el(id) { return document.getElementById(id); }
  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function jour(d) {
    if (!d) return '—';
    var x = new Date(d);
    return isNaN(x) ? '—' : x.toLocaleDateString('fr-FR');
  }
  function note(m, t) { if (typeof window.toast === 'function') window.toast(m, t || 'info', 7000); }

  var ROLES = {
    principal_admin: { l: 'Administrateur', c: '#5b21b6', f: '#faf5ff', b: '#ddd6fe' },
    investigator:    { l: 'Investigateur',  c: '#0369a1', f: '#f0f9ff', b: '#bae6fd' },
    patient:         { l: 'Patient',        c: '#0f766e', f: '#ecfdf5', b: '#a7f3d0' }
  };
  function roleInfo(r) {
    return ROLES[r] || { l: r || '—', c: '#64748b', f: '#f8fafc', b: '#e2e8f0' };
  }

  function info(html, ton) {
    var z = el('paInfo');
    if (!z) return;
    if (!html) { z.style.display = 'none'; z.innerHTML = ''; return; }
    var c = ton === 'erreur' ? ['#fef2f2', '#fecaca', '#991b1b']
          : ton === 'ok'     ? ['#ecfdf5', '#a7f3d0', '#065f46']
          : ton === 'alerte' ? ['#fffbeb', '#fde68a', '#92400e']
                             : ['#f8fafc', '#e2e8f0', '#475569'];
    z.style.cssText = 'display:block; margin-bottom:16px; padding:12px 15px; border-radius:10px; ' +
      'font-size:12.5px; line-height:1.6; background:' + c[0] + '; border:1px solid ' + c[1] +
      '; color:' + c[2] + ';';
    z.innerHTML = html;
  }

  function moiMeme(u) {
    var moi = (window.MarfanAPI && window.MarfanAPI.currentUser && window.MarfanAPI.currentUser()) || {};
    return moi && u && moi.id === u.id;
  }

  function dessiner() {
    var z = el('paTable');
    if (!z) return;

    var q = _filtre.trim().toLowerCase();
    var liste = _comptes.filter(function (u) {
      if (!u.active && !_voirArchives) return false;
      if (_role && u.role !== _role) return false;
      if (!q) return true;
      return [u.name, u.email, u.username, u.patient_id, u.service]
        .filter(Boolean).join(' ').toLowerCase().indexOf(q) >= 0;
    });

    if (!liste.length) {
      z.innerHTML = '<div style="padding:18px; background:#f8fafc; border:1px dashed #cbd5e1; ' +
        'border-radius:10px; font-size:13px; color:#64748b;">Aucun compte ne correspond.</div>';
      return;
    }

    z.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:12.5px;">' +
      '<thead><tr style="text-align:left; color:#64748b; font-size:11px; text-transform:uppercase; letter-spacing:.04em;">' +
        '<th style="padding:8px;">Compte</th><th style="padding:8px;">Rôle</th>' +
        '<th style="padding:8px;">Dernière connexion</th><th style="padding:8px;">Accès</th>' +
        '<th style="padding:8px; text-align:right;">Actions</th></tr></thead><tbody>' +
      liste.map(function (u) {
        var r = roleInfo(u.role);
        var moi = moiMeme(u);
        return '<tr style="border-top:1px solid var(--line);">' +
          '<td style="padding:9px 8px;">' +
            '<strong style="color:#0b1530;">' + esc(u.name || u.username || u.email || u.id) + '</strong>' +
            (moi ? ' <span style="font-size:10.5px; font-weight:800; color:#0f766e; background:#ecfdf5; ' +
                   'border:1px solid #a7f3d0; border-radius:5px; padding:1px 6px;">vous</span>' : '') +
            '<div style="color:#64748b; font-size:11.5px;">' + esc(u.email || '—') +
              (u.patient_id ? ' · dossier ' + esc(u.patient_id) : '') + '</div>' +
            (u.must_change_password
              ? '<div style="color:#b45309; font-size:11px; font-weight:700;">mot de passe à changer</div>' : '') +
          '</td>' +
          '<td style="padding:9px 8px;"><span style="font-size:10.5px; font-weight:800; text-transform:uppercase; ' +
            'letter-spacing:.04em; color:' + r.c + '; background:' + r.f + '; border:1px solid ' + r.b + '; ' +
            'border-radius:6px; padding:3px 8px; white-space:nowrap;">' + esc(r.l) + '</span></td>' +
          '<td style="padding:9px 8px; color:#475569; white-space:nowrap;">' + jour(u.last_login) + '</td>' +
          // Une case à cocher plutôt qu'un bouton : l'état se lit d'un coup
          // d'œil sur toute la colonne, au lieu d'être déduit du libellé d'un
          // bouton qui annonce l'action inverse de l'état en cours.
          '<td style="padding:9px 8px;">' +
            '<label style="display:inline-flex; align-items:center; gap:7px; cursor:' +
              (moi ? 'not-allowed' : 'pointer') + '; font-weight:700; font-size:12px; color:' +
              (u.active ? '#065f46' : '#94a3b8') + ';"' +
              (moi ? ' title="Sur votre propre compte, non"' : '') + '>' +
              '<input type="checkbox" data-actif="' + esc(u.id) + '"' + (u.active ? ' checked' : '') +
                (moi ? ' disabled' : '') + ' style="width:17px; height:17px; accent-color:#0f766e; cursor:inherit;">' +
              (u.active ? 'Actif' : 'Archivé') +
            '</label></td>' +
          '<td style="padding:9px 8px; text-align:right; white-space:nowrap;">' +
            '<button type="button" data-reset="' + esc(u.id) + '" class="btn-light" ' +
              'style="font-size:11px; padding:4px 9px;">🔑 Mot de passe</button>' +
            // La suppression n'apparaît que sur un compte déjà archivé. On
            // archive, on constate que rien ne manque, puis on supprime si
            // vraiment nécessaire — plutôt que d'offrir l'irréversible à côté
            // du réversible, au même endroit et de la même taille.
            (u.active || moi ? '' :
              ' <button type="button" data-suppr="' + esc(u.id) + '" class="btn-light" ' +
              'style="font-size:11px; padding:4px 9px; color:#991b1b;">Supprimer définitivement</button>') +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';

    var lier = function (attr, fn) {
      Array.prototype.forEach.call(z.querySelectorAll('[' + attr + ']'), function (b) {
        if (b.disabled) return;
        b.addEventListener('click', function () { fn(b.getAttribute(attr)); });
      });
    };
    lier('data-reset', reinitialiser);
    lier('data-suppr', supprimer);
    Array.prototype.forEach.call(z.querySelectorAll('[data-actif]'), function (c) {
      if (c.disabled) return;
      c.addEventListener('change', function () {
        basculerActif(c.getAttribute('data-actif'), c.checked, c);
      });
    });
  }

  function compteDe(id) {
    return _comptes.filter(function (u) { return String(u.id) === String(id); })[0];
  }

  // ============================================================
  // Actions
  // ============================================================
  async function charger() {
    try {
      var r = await window.MarfanAPI.users.list();
      _comptes = r.users || [];
      var c = el('paCompte');
      if (c) {
        var actifs = _comptes.filter(function (u) { return u.active; }).length;
        var archives = _comptes.length - actifs;
        c.textContent = actifs + ' actif(s)' + (archives ? ' · ' + archives + ' archivé(s)' : '');
      }
      dessiner();
    } catch (e) {
      info('Comptes non chargés : ' + esc(e && e.message), 'erreur');
    }
  }

  async function reinitialiser(id) {
    var u = compteDe(id);
    if (!u) return;
    var avecMail = !!u.email;
    var choix = prompt(
      'Réinitialiser le mot de passe de « ' + (u.name || u.email || u.id) + ' ».\n\n' +
      'Vous ne choisissez pas le mot de passe vous-même : pouvoir le fixer reviendrait\n' +
      'à pouvoir vous connecter à sa place sans que rien ne vous en distingue.\n\n' +
      '1 — Envoyer un lien de réinitialisation' + (avecMail ? '' : '  (indisponible : pas d\'adresse)') + '\n' +
      '2 — Générer un mot de passe provisoire, à lui transmettre vous-même\n\n' +
      'Tapez 1 ou 2 :', avecMail ? '1' : '2');
    if (choix === null) return;
    var mode = String(choix).trim() === '2' ? 'provisoire' : 'lien';

    try {
      var r = await window.MarfanAPI.users.reinitialiser(id, mode);
      if (r.mode === 'provisoire') {
        // Affiché une seule fois : il n'est stocké nulle part en clair, et le
        // relire exigerait d'en générer un nouveau.
        info('<strong>Mot de passe provisoire pour ' + esc(u.name || u.email) + '</strong><br>' +
          '<code style="display:inline-block; margin:8px 0; padding:9px 14px; background:#fff; ' +
          'border:2px solid #0f766e; border-radius:9px; font-size:16px; font-weight:800; ' +
          'letter-spacing:1px; color:#0b1530;">' + esc(r.mot_de_passe) + '</code><br>' +
          'Notez-le maintenant : il n\'est enregistré nulle part en clair et ne pourra pas être relu. ' +
          'La personne devra le changer à sa première connexion.', 'alerte');
      } else if (r.envoye) {
        info('✉️ Lien de réinitialisation envoyé' +
          (r.email_masque ? ' à <strong>' + esc(r.email_masque) + '</strong>' : '') +
          '. Il est valable 24 heures.', 'ok');
      } else {
        info('<strong>Le courriel n\'est pas parti.</strong> ' + esc(r.avertissement || '') +
          (r.lien_secours ? '<br>Le lien reste valable, transmettez-le autrement :<br>' +
            '<code style="display:block; margin-top:6px; padding:7px 9px; background:#fff; ' +
            'border:1px solid #e2e8f0; border-radius:7px; word-break:break-all; font-size:11.5px;">' +
            esc(r.lien_secours) + '</code>' : ''), 'alerte');
      }
      await charger();
    } catch (e) {
      info('Réinitialisation impossible : ' + esc(e && e.message), 'erreur');
    }
  }

  async function basculerActif(id, vers, caseACocher) {
    var u = compteDe(id);
    if (!u) return;
    var nom = u.name || u.email || u.id;
    var ok = vers
      ? confirm('Réactiver le compte de « ' + nom + ' » ?\n\nIl pourra de nouveau se connecter.')
      : confirm('Archiver le compte de « ' + nom + ' » ?\n\n' +
                'Il ne pourra plus se connecter, mais rien n\'est effacé : ses dossiers, ses\n' +
                'synthèses et ses validations restent en place et à son nom.\n\n' +
                'C\'est réversible à tout moment.');
    if (!ok) {
      // L'utilisateur a renoncé : la case doit revenir à l'état réel, sinon
      // elle afficherait un état que le serveur n'a pas enregistré.
      if (caseACocher) caseACocher.checked = !vers;
      return;
    }
    try {
      await window.MarfanAPI.users.update(id, { active: vers });
      await charger();
      note(vers ? '✓ Compte réactivé.' : '✓ Compte archivé.', 'success');
    } catch (e) {
      if (caseACocher) caseACocher.checked = !vers;
      info('Modification impossible : ' + esc(e && e.message), 'erreur');
    }
  }

  async function supprimer(id) {
    var u = compteDe(id);
    if (!u) return;
    var nom = u.name || u.email || u.id;
    if (!confirm('Supprimer définitivement le compte de « ' + nom + ' » ?\n\n' +
                 'Cette action est irréversible. Si vous voulez seulement couper l\'accès,\n' +
                 'préférez « Désactiver » : les données restent et le compte peut revenir.')) return;
    try {
      await window.MarfanAPI.users.supprimer(id);
      await charger();
      note('Compte supprimé.', 'info');
    } catch (e) {
      // Le serveur refuse pour une raison précise — compte patient rattaché,
      // dernier administrateur. On la montre telle quelle, et on ne propose
      // de forcer que dans le cas où forcer a un sens.
      var msg = (e && e.message) || 'Suppression impossible.';
      var rattache = e && e.data && e.data.patient_id;
      if (rattache && confirm(msg + '\n\nSupprimer quand même le compte ?')) {
        try {
          await window.MarfanAPI.users.supprimer(id, true);
          await charger();
          note('Compte supprimé. Le dossier ' + rattache + ' reste en base, sans accès patient.', 'info');
          return;
        } catch (e2) { msg = (e2 && e2.message) || msg; }
      }
      info(esc(msg), 'erreur');
    }
  }

  // ============================================================
  // Montage
  // ============================================================
  function render() {
    var hote = el('parametresMount');
    if (!hote) return;

    var moi = (window.MarfanAPI && window.MarfanAPI.currentUser && window.MarfanAPI.currentUser()) || {};
    if (moi.role !== 'principal_admin') {
      // Garde côté interface. La vraie protection est sur le serveur : ces
      // routes refusent tout rôle autre qu'administrateur principal.
      hote.innerHTML = '<article class="card" style="padding:24px; text-align:center;">' +
        '<div style="font-size:34px; margin-bottom:8px;">🔒</div>' +
        '<p style="color:var(--muted); font-size:13px; margin:0;">' +
        'Cette page est réservée à l\'administrateur principal.</p></article>';
      return;
    }

    if (!hote.dataset.pret) {
      hote.innerHTML =
        '<div id="paInfo" style="display:none;"></div>' +
        '<article class="card" style="padding:22px;">' +
          '<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px;">' +
            '<h3 style="font-size:16px; font-weight:800;">👥 Tous les comptes</h3>' +
            '<span id="paCompte" style="font-size:12px; color:var(--muted);"></span>' +
            '<button type="button" class="btn-secondary" id="paRecharger" style="margin-left:auto;">↻ Rafraîchir</button>' +
          '</div>' +
          '<p style="color:var(--muted); font-size:12.5px; line-height:1.6; margin-bottom:14px;">' +
            'Décochez <strong>Actif</strong> pour archiver un compte : il ne peut plus se connecter, ' +
            'mais rien n\'est effacé et c\'est réversible. La suppression définitive n\'apparaît ' +
            'qu\'ensuite, sur un compte déjà archivé.<br>' +
            'Vous ne pouvez pas choisir le mot de passe de quelqu\'un : le fixer reviendrait à pouvoir ' +
            'vous connecter à sa place sans que rien ne vous en distingue. Deux chemins sont proposés, ' +
            'et dans les deux le mot de passe final vous reste inconnu.' +
          '</p>' +
          '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px;">' +
            '<input type="search" id="paRecherche" placeholder="Nom, adresse, dossier…" ' +
              'style="flex:1; min-width:200px;" />' +
            '<select id="paRole" style="max-width:220px;">' +
              '<option value="">Tous les rôles</option>' +
              '<option value="principal_admin">Administrateurs</option>' +
              '<option value="investigator">Investigateurs</option>' +
              '<option value="patient">Patients</option>' +
            '</select>' +
            '<label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; ' +
              'font-size:12.5px; font-weight:700; color:#475569; white-space:nowrap; ' +
              'padding:0 4px;">' +
              '<input type="checkbox" id="paArchives" style="width:17px; height:17px; accent-color:#0f766e;">' +
              'Afficher les comptes archivés' +
            '</label>' +
          '</div>' +
          '<div id="paTable"></div>' +
        '</article>';
      hote.dataset.pret = '1';

      el('paRecherche').addEventListener('input', function (e) { _filtre = e.target.value; dessiner(); });
      el('paRole').addEventListener('change', function (e) { _role = e.target.value; dessiner(); });
      el('paArchives').addEventListener('change', function (e) {
        _voirArchives = e.target.checked; dessiner();
      });
      el('paRecharger').addEventListener('click', function () { info(''); charger(); });
    }
    charger();
  }

  window.ParametresUI = { render: render };
})();
