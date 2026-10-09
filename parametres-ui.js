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
  // Les comptes archivés sont masqués par défaut : la liste quotidienne doit
  // montrer qui travaille, pas l'historique des départs.
  var _voirArchives = false;
  // Les comptes de démonstration sont exclus par défaut. Mélangés aux comptes
  // réels dans un écran d'administration, ils font courir le risque d'archiver
  // ou de réinitialiser le mauvais compte en croyant agir sur une fiction.
  var _voirDemo = false;

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
    // Le bandeau vit en tête de page. Quand on agit depuis une ligne du bas du
    // tableau — ce qui est le cas courant — le résultat s'affichait hors de
    // l'écran : le mot de passe provisoire était bien généré, mais invisible,
    // et l'opération paraissait n'avoir rien produit.
    try { z.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
  }

  function moiMeme(u) {
    var moi = (window.MarfanAPI && window.MarfanAPI.currentUser && window.MarfanAPI.currentUser()) || {};
    return moi && u && moi.id === u.id;
  }

  /**
   * Compte d'essai ?
   *
   * Le marqueur is_demo vient du dossier patient : les investigateurs n'en ont
   * pas, et les fiches créées après la migration qui l'a introduit ne sont pas
   * marquées. Le filtre ne voyait donc rien, alors que des comptes manifestement
   * fictifs restaient dans la liste.
   *
   * On s'appuie ici sur l'adresse. example.fr, example.com et example.org sont
   * des domaines réservés par la RFC 2606 précisément pour la documentation et
   * les essais : aucune adresse réelle n'y existe. C'est un indice sûr, pas une
   * supposition. On y ajoute le motif « .test@ », une convention locale visible
   * dans vos comptes.
   *
   * Ces comptes sont signalés, PAS supprimés : l'automatisme s'arrête là où
   * commence le jugement. C'est vous qui décidez de les archiver.
   */
  function estEssai(u) {
    if (u.is_demo) return true;
    // Compte issu du jeu de données initial : créé par le script d'amorçage,
    // il n'a pas d'auteur. Ceux que vous créez dans l'interface portent
    // toujours l'identifiant de leur créateur.
    //
    // C'est un repère sûr, là où l'adresse ne dit rien : « Dr. Camille Dupont,
    // c.dupont@bichat.fr » est parfaitement crédible et aucune règle sur le
    // nom ou le domaine ne pouvait le distinguer d'un vrai collègue.
    //
    // Votre propre compte vient lui aussi de l'amorçage : il est exclu, sans
    // quoi vous disparaîtriez de votre propre liste.
    if (!u.created_by && !moiMeme(u)) return true;
    var e = String(u.email || '').toLowerCase();
    return /@example\.(fr|com|org|net)$/.test(e) || /\.test@/.test(e);
  }


  /**
   * Une ligne de compte.
   *
   * Les actions sont regroupées à droite et de largeur fixe : avec des
   * boutons de tailles variables selon l'état, la colonne dansait d'une ligne
   * à l'autre et l'œil ne trouvait plus où cliquer.
   */
  function ligne(u) {
    var r = roleInfo(u.role);
    var moi = moiMeme(u);
    return '<tr style="border-top:1px solid var(--line);' + (u.active ? '' : ' background:#fafbfc;') + '">' +
      '<td style="padding:10px 10px;">' +
        '<div style="display:flex; align-items:center; gap:9px; min-width:0;">' +
          '<span style="width:30px; height:30px; border-radius:9px; flex:0 0 auto; display:flex; ' +
            'align-items:center; justify-content:center; font-size:11px; font-weight:800; ' +
            'color:' + r.c + '; background:' + r.f + '; border:1px solid ' + r.b + ';">' +
            esc(((u.name || u.email || '?').trim()[0] || '?').toUpperCase()) + '</span>' +
          '<div style="min-width:0; overflow-wrap:anywhere;">' +
            '<div style="font-weight:700; color:#0b1530; font-size:13px;">' +
              esc(u.name || u.username || u.email || u.id) +
              (moi ? ' <span style="font-size:10px; font-weight:800; color:#0f766e; background:#ecfdf5; ' +
                     'border:1px solid #a7f3d0; border-radius:5px; padding:1px 6px;">vous</span>' : '') +
              (estEssai(u) ? ' <span style="font-size:10px; font-weight:800; color:#92400e; background:#fffbeb; ' +
                     'border:1px solid #fde68a; border-radius:5px; padding:1px 6px;">essai</span>' : '') +
            '</div>' +
            '<div style="color:#64748b; font-size:11.5px;">' + esc(u.email || '—') +
              (u.patient_id ? ' · ' + esc(u.patient_id) : '') +
              (u.service ? ' · ' + esc(u.service) : '') + '</div>' +
            // La date rejoint la fiche du compte : en colonne séparée, elle
            // poussait les actions hors de l'écran sur une fenêtre ordinaire,
            // et l'on ne pouvait plus ni archiver ni réinitialiser sans faire
            // défiler le tableau latéralement — ce que personne ne devine.
            '<div style="color:#94a3b8; font-size:11px;">' +
              (u.last_login ? 'Dernière connexion : ' + jour(u.last_login)
                            : 'Jamais connecté') + '</div>' +
            (u.must_change_password
              ? '<div style="color:#b45309; font-size:11px; font-weight:700;">mot de passe à changer</div>' : '') +
          '</div>' +
        '</div>' +
      '</td>' +

      '<td style="padding:10px; white-space:nowrap; width:1%;">' +
        '<label style="display:inline-flex; align-items:center; gap:7px; white-space:nowrap; ' +
          'cursor:' + (moi ? 'not-allowed' : 'pointer') + '; font-weight:700; font-size:12px; color:' +
          (u.active ? '#065f46' : '#94a3b8') + ';"' +
          (moi ? ' title="Sur votre propre compte, non"' : '') + '>' +
          '<input type="checkbox" data-actif="' + esc(u.id) + '"' + (u.active ? ' checked' : '') +
            (moi ? ' disabled' : '') + ' style="width:17px; height:17px; accent-color:#0f766e; cursor:inherit;">' +
          (u.active ? 'Actif' : 'Archivé') +
        '</label></td>' +
      // Collée à droite : même en faisant défiler, les deux boutons restent
      // sous les yeux. C'est la colonne qu'on vient chercher.
      '<td style="padding:10px; text-align:right; white-space:nowrap; width:1%; ' +
        'position:sticky; right:0; background:' + (u.active ? '#fff' : '#fafbfc') + ';">' +
        '<button type="button" data-reset="' + esc(u.id) + '" class="btn-light" ' +
          'title="Réinitialiser le mot de passe" ' +
          'style="font-size:12px; padding:5px 10px;">🔑</button>' +
        (u.active || moi ? '' :
          ' <button type="button" data-suppr="' + esc(u.id) + '" class="btn-light" ' +
          'title="Supprimer définitivement" ' +
          'style="font-size:12px; padding:5px 10px; color:#991b1b;">🗑</button>') +
      '</td></tr>';
  }

  function tableau(titre, icone, liste, vide) {
    if (!liste.length) {
      return '<div style="margin-bottom:20px;">' +
        '<h4 style="font-size:13px; font-weight:800; color:#0b1530; margin:0 0 8px;">' +
          icone + ' ' + esc(titre) + '</h4>' +
        '<div style="padding:14px 16px; background:#f8fafc; border:1px dashed #cbd5e1; ' +
          'border-radius:10px; font-size:12.5px; color:#64748b;">' + esc(vide) + '</div></div>';
    }
    return '<div style="margin-bottom:20px;">' +
      '<h4 style="font-size:13px; font-weight:800; color:#0b1530; margin:0 0 8px;">' +
        icone + ' ' + esc(titre) +
        ' <span style="font-weight:600; color:#94a3b8;">— ' + liste.length + '</span></h4>' +
      // Le conteneur à défilement est indispensable. Sans lui, un tableau plus
      // large que la fenêtre est simplement coupé : la case Actif et la clé
      // disparaissent, et rien ne permet de les atteindre. Je l'avais retiré
      // en croyant la largeur maîtrisée — elle ne l'est pas sur une fenêtre
      // étroite, où la colonne « Compte » a une largeur minimale incompressible.
      '<div style="border:1px solid var(--line); border-radius:11px; overflow-x:auto;">' +
      // table-layout reste en « auto ». Un essai en « fixed » combiné à des
      // colonnes déclarées à 1 % les a réduites à néant : la case Actif et le
      // bouton de mot de passe avaient disparu de l'écran. En auto, width:100%
      // sur la première colonne lui fait absorber la place restante, et les
      // deux dernières se dimensionnent sur leur contenu.
      '<table style="width:100%; border-collapse:collapse; font-size:12.5px;">' +
        '<thead><tr style="text-align:left; color:#64748b; font-size:10.5px; ' +
          'text-transform:uppercase; letter-spacing:.05em; background:#f8fafc;">' +
          // En disposition automatique, width:100% sur la PREMIÈRE colonne lui
          // donne toute la largeur du tableau — les deux suivantes débordent
          // alors du cadre et la clé devient inatteignable. C'est l'inverse
          // qu'il faut faire : contraindre les colonnes étroites à width:1%,
          // le navigateur leur accorde le minimum nécessaire et la première
          // absorbe le reste.
          '<th style="padding:8px 10px;">Compte</th>' +
          '<th style="padding:8px 10px; width:1%; white-space:nowrap;">Accès</th>' +
          '<th style="padding:8px 10px; width:1%; white-space:nowrap; ' +
            'position:sticky; right:0; background:#f8fafc;">Actions</th></tr></thead>' +
        '<tbody>' + liste.map(ligne).join('') + '</tbody>' +
      '</table></div></div>';
  }

  function dessiner() {
    var z = el('paTable');
    if (!z) return;

    var q = _filtre.trim().toLowerCase();
    var liste = _comptes.filter(function (u) {
      if (estEssai(u) && !_voirDemo) return false;
      if (!u.active && !_voirArchives) return false;
      if (!q) return true;
      return [u.name, u.email, u.username, u.patient_id, u.service]
        .filter(Boolean).join(' ').toLowerCase().indexOf(q) >= 0;
    });

    // Deux populations qu'on n'administre pas pour les mêmes raisons :
    // l'équipe, qu'on gère au cas par cas, et les patients, qu'on parcourt.
    var equipe = liste.filter(function (u) { return u.role !== 'patient'; });
    var pat = liste.filter(function (u) { return u.role === 'patient'; });

    z.innerHTML =
      tableau("Équipe", '🩺', equipe,
        q ? 'Aucun membre de l\'équipe ne correspond à cette recherche.'
          : 'Aucun compte administrateur ni investigateur.') +
      tableau('Patients', '👤', pat,
        q ? 'Aucun patient ne correspond à cette recherche.'
          : 'Aucun compte patient.');

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
        // On ne compte que les comptes réels : annoncer « 24 comptes » en
        // incluant vingt fiches de démonstration donnerait une idée fausse
        // de la taille de l'équipe et de la file active.
        var reels = _comptes.filter(function (u) { return !estEssai(u); });
        var actifs = reels.filter(function (u) { return u.active; }).length;
        var archives = reels.length - actifs;
        var demo = _comptes.length - reels.length;
        c.textContent = actifs + ' actif(s)' +
          (archives ? ' · ' + archives + ' archivé(s)' : '') +
          (demo ? ' · ' + demo + ' d\'essai' : '');
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
          '<span style="display:inline-flex; align-items:center; gap:10px; margin:10px 0;">' +
            '<code id="paMdp" style="padding:11px 16px; background:#fff; ' +
            'border:2px solid #0f766e; border-radius:9px; font-size:18px; font-weight:800; ' +
            'letter-spacing:1.5px; color:#0b1530; user-select:all;">' + esc(r.mot_de_passe) + '</code>' +
            '<button type="button" id="paCopier" class="btn-secondary" ' +
            'style="font-size:12px; white-space:nowrap;">📋 Copier</button>' +
          '</span><br>' +
          'Identifiant : <strong>' + esc(u.email || '') + '</strong><br>' +
          'Notez-le maintenant : il n\'est enregistré nulle part en clair et ne pourra pas être relu. ' +
          'La personne devra le changer à sa première connexion.', 'alerte');
        // Un mot de passe qu'on doit retaper à la main se transmet avec des
        // fautes : les caractères évitent déjà les confusions, le bouton
        // supprime le reste du risque.
        var bc = el('paCopier');
        if (bc) bc.addEventListener('click', async function () {
          try {
            await navigator.clipboard.writeText(r.mot_de_passe);
            bc.textContent = '✓ Copié';
          } catch (_) {
            // Presse-papiers refusé : on sélectionne, l'utilisateur fait Cmd+C.
            try {
              var rg = document.createRange();
              rg.selectNodeContents(el('paMdp'));
              var sel = window.getSelection();
              sel.removeAllRanges(); sel.addRange(rg);
              bc.textContent = 'Sélectionné — Cmd+C';
            } catch (__) {}
          }
        });
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
            // Le filtre par rôle a disparu : les deux tableaux font déjà la
            // séparation, et un filtre qui vide un tableau entier déroute
            // plus qu'il n'aide.
            '<label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; ' +
              'font-size:12.5px; font-weight:700; color:#475569; white-space:nowrap; padding:0 4px;">' +
              '<input type="checkbox" id="paArchives" style="width:17px; height:17px; accent-color:#0f766e;">' +
              'Archivés' +
            '</label>' +
            '<label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; ' +
              'font-size:12.5px; font-weight:700; color:#475569; white-space:nowrap; padding:0 4px;">' +
              '<input type="checkbox" id="paDemo" style="width:17px; height:17px; accent-color:#0f766e;">' +
              'Comptes d\'essai' +
            '</label>' +
          '</div>' +
          '<div id="paTable"></div>' +
        '</article>';
      hote.dataset.pret = '1';

      el('paRecherche').addEventListener('input', function (e) { _filtre = e.target.value; dessiner(); });
      el('paDemo').addEventListener('change', function (e) {
        _voirDemo = e.target.checked; dessiner();
      });
      el('paArchives').addEventListener('change', function (e) {
        _voirArchives = e.target.checked; dessiner();
      });
      el('paRecharger').addEventListener('click', function () { info(''); charger(); });
    }
    charger();
  }

  window.ParametresUI = { render: render };
})();
