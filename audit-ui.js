/**
 * audit-ui.js — Motif de correction et historique des modifications
 * ==================================================================
 *
 * Deux fonctions, qui répondent à l'exigence des bonnes pratiques cliniques :
 * une correction doit être motivée, et la valeur d'origine doit rester
 * consultable.
 *
 *   demanderMotif()   → fenêtre bloquante avant toute correction
 *   monterHistorique() → journal des modifications d'un dossier
 *
 * Le motif est demandé AVANT l'envoi au serveur, et le serveur le réclame de
 * son côté. Cette double exigence est volontaire : la première est un confort
 * de saisie, la seconde une garantie. Un contrôle qui n'existe que dans le
 * navigateur se contourne en ouvrant la console.
 *
 * Expose window.AuditUI = { demanderMotif, monterHistorique, MOTIFS }
 */
(function () {
  'use strict';

  // Reprise exacte de la liste du serveur. Les deux doivent rester
  // identiques : un code inconnu serait refusé à l'enregistrement.
  var MOTIFS = {
    saisie:        "Erreur de saisie",
    lecture_doc:   "Erreur de lecture du document",
    extraction_ia: "Correction d'une extraction automatique",
    source:        "Valeur corrigée par le centre ou le document source",
    aberrante:     "Valeur aberrante écartée",
    complement:    "Complément d'information reçu",
    protocole:     "Mise en conformité au protocole",
    autre:         "Autre (préciser)"
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Fenêtre de motif.
   * @param {object} opts { titre, resume, champs: [{libelle, avant, apres}] }
   * @returns {Promise<{motif_code, motif_texte}|null>} null si annulé
   */
  function demanderMotif(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var vieux = document.getElementById('auditMotifModal');
      if (vieux) vieux.remove();

      var apercu = (opts.champs || []).length
        ? '<div style="margin-bottom:14px; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden;">' +
            '<div style="padding:7px 12px; background:#f8fafc; font-size:11.5px; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:.4px;">Ce qui va changer</div>' +
            '<table style="width:100%; border-collapse:collapse; font-size:12.5px;">' +
            opts.champs.map(function (c) {
              return '<tr style="border-top:1px solid #eef2f7;">' +
                '<td style="padding:6px 12px; color:#475569; width:38%;">' + esc(c.libelle) + '</td>' +
                '<td style="padding:6px 8px; color:#991b1b; text-decoration:line-through; white-space:nowrap;">' +
                  esc(c.avant == null || c.avant === '' ? '—' : c.avant) + '</td>' +
                '<td style="padding:6px 8px; color:#94a3b8;">→</td>' +
                '<td style="padding:6px 12px; color:#065f46; font-weight:700; white-space:nowrap;">' +
                  esc(c.apres == null || c.apres === '' ? '—' : c.apres) + '</td>' +
              '</tr>';
            }).join('') +
            '</table></div>'
        : '';

      document.body.insertAdjacentHTML('beforeend',
        '<div id="auditMotifModal" style="position:fixed; inset:0; background:rgba(11,21,48,.84); z-index:10095; display:flex; align-items:center; justify-content:center; padding:18px;">' +
          '<div style="background:white; border-radius:16px; width:620px; max-width:96vw; max-height:92vh; display:flex; flex-direction:column; box-shadow:0 26px 70px rgba(0,0,0,.35);">' +
            '<div style="padding:18px 22px; background:linear-gradient(135deg,#b45309,#f59e0b); color:white; border-radius:16px 16px 0 0;">' +
              '<h3 style="margin:0; color:white; font-size:16px;">✎ ' + esc(opts.titre || 'Motif de la correction') + '</h3>' +
              '<p style="margin:4px 0 0; font-size:12px; opacity:.95;">La valeur d\'origine est conservée. Votre nom et la date sont enregistrés.</p>' +
            '</div>' +
            '<div style="padding:18px 22px; overflow-y:auto; flex:1;">' +
              (opts.resume ? '<p style="margin:0 0 12px; font-size:12.5px; color:#475569; line-height:1.55;">' + opts.resume + '</p>' : '') +
              apercu +
              '<label class="control-label" for="auditMotifCode">Motif de la correction *</label>' +
              '<select id="auditMotifCode" style="width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:9px; font-size:13px; margin-bottom:12px;">' +
                '<option value="">— Choisir —</option>' +
                Object.keys(MOTIFS).map(function (k) {
                  return '<option value="' + k + '">' + esc(MOTIFS[k]) + '</option>';
                }).join('') +
              '</select>' +
              '<label class="control-label" for="auditMotifTexte">Précision</label>' +
              '<textarea id="auditMotifTexte" rows="3" placeholder="Ex. : valeur relue sur le compte rendu du CHU du 12/03/2026"' +
                ' style="width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:9px; font-family:inherit; font-size:13px; line-height:1.6; resize:vertical; box-sizing:border-box;"></textarea>' +
              '<div id="auditMotifErr" style="display:none; margin-top:10px; padding:9px 12px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; border-radius:9px; font-size:12.5px;"></div>' +
            '</div>' +
            '<div style="padding:14px 22px; border-top:1px solid #e2e8f0; display:flex; gap:10px; justify-content:flex-end;">' +
              '<button type="button" class="btn-light" id="auditMotifAnnuler">Annuler</button>' +
              '<button type="button" class="btn-gradient" id="auditMotifOk">✓ Enregistrer la correction</button>' +
            '</div>' +
          '</div>' +
        '</div>');

      var modal = document.getElementById('auditMotifModal');
      var sel = document.getElementById('auditMotifCode');
      var txt = document.getElementById('auditMotifTexte');
      var err = document.getElementById('auditMotifErr');
      var fermer = function (r) { modal.remove(); resolve(r); };

      document.getElementById('auditMotifAnnuler').addEventListener('click', function () { fermer(null); });
      document.getElementById('auditMotifOk').addEventListener('click', function () {
        var code = sel.value;
        var texte = (txt.value || '').trim();
        if (!code) {
          err.style.display = 'block';
          err.textContent = "Choisissez un motif : sans lui, la correction ne peut pas être enregistrée.";
          return;
        }
        if (code === 'autre' && texte.length < 5) {
          err.style.display = 'block';
          err.textContent = "Le motif « Autre » demande une précision d'au moins cinq caractères.";
          return;
        }
        fermer({ motif_code: code, motif_texte: texte || null });
      });
      // Échap annule : une correction ne doit jamais partir par inadvertance.
      modal.addEventListener('keydown', function (e) { if (e.key === 'Escape') fermer(null); });
      setTimeout(function () { sel.focus(); }, 60);
    });
  }

  // ============================================================
  // Historique des modifications d'un dossier
  // ============================================================
  var LIBELLES_TABLES = {
    evaluations: 'Évaluation',
    consultations: 'Consultation',
    medical_timeline: 'Chronologie',
    patients: 'Fiche patient'
  };

  function ligne(e) {
    var date = e.fait_le ? new Date(e.fait_le).toLocaleString('fr-FR') : '—';
    var supprime = e.operation === 'suppression';
    return '<tr style="border-top:1px solid #eef2f7;' + (supprime ? ' background:#fef2f2;' : '') + '">' +
      '<td style="padding:7px 10px; white-space:nowrap; color:#64748b; font-size:11.5px;">' + esc(date) + '</td>' +
      '<td style="padding:7px 10px; font-size:11.5px;">' + esc(LIBELLES_TABLES[e.table_cible] || e.table_cible) + '</td>' +
      '<td style="padding:7px 10px; font-weight:700; font-size:11.5px;">' + esc(e.champ) + '</td>' +
      '<td style="padding:7px 10px; color:#991b1b; text-decoration:line-through; font-size:11.5px;">' +
        esc(e.ancienne_valeur == null ? '—' : e.ancienne_valeur) + '</td>' +
      '<td style="padding:7px 10px; color:#065f46; font-weight:700; font-size:11.5px;">' +
        esc(e.nouvelle_valeur == null ? '—' : e.nouvelle_valeur) + '</td>' +
      '<td style="padding:7px 10px; font-size:11.5px;">' + esc(e.motif_libelle || e.motif_code) +
        (e.motif_texte ? '<br><span style="color:#64748b;">' + esc(e.motif_texte) + '</span>' : '') + '</td>' +
      '<td style="padding:7px 10px; white-space:nowrap; font-size:11.5px;">' + esc(e.auteur_nom || e.auteur_id || '—') + '</td>' +
    '</tr>';
  }

  async function monterHistorique(conteneurId, patientId) {
    var hote = document.getElementById(conteneurId);
    if (!hote) return;
    if (!patientId) { hote.innerHTML = ''; return; }

    hote.innerHTML = '<article class="card" style="padding:16px 18px; margin-bottom:16px;">' +
      '<div style="color:#64748b; font-size:12.5px;">Chargement du journal des modifications…</div></article>';

    var lignes = [];
    try {
      var r = await window.MarfanAPI.audit.dossier(patientId, 200);
      lignes = (r && r.historique) || [];
    } catch (e) {
      hote.innerHTML = '<article class="card" style="padding:16px 18px; margin-bottom:16px;">' +
        '<div style="color:#991b1b; font-size:12.5px;">Journal indisponible : ' + esc(e && e.message) + '</div></article>';
      return;
    }

    if (!lignes.length) {
      hote.innerHTML = '<article class="card" style="padding:16px 18px; margin-bottom:16px;">' +
        '<h3 style="font-size:15px; font-weight:800; margin-bottom:5px;">🧾 Journal des modifications</h3>' +
        '<p style="color:var(--muted); font-size:12.5px; margin:0;">Aucune donnée de ce dossier n\'a été corrigée ' +
        'depuis sa création. Toute correction future y figurera, avec son motif et son auteur.</p></article>';
      return;
    }

    hote.innerHTML = '<article class="card" style="padding:16px 18px; margin-bottom:16px;">' +
      '<div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; margin-bottom:4px;">' +
        '<h3 style="font-size:15px; font-weight:800;">🧾 Journal des modifications</h3>' +
        '<span style="font-size:11.5px; color:#64748b;">' + lignes.length + ' correction(s)</span>' +
      '</div>' +
      '<p style="color:var(--muted); font-size:12.5px; margin:0 0 12px;">' +
        'Chaque correction conserve la valeur d\'origine, son motif et son auteur. ' +
        'Ce journal ne peut être ni modifié ni effacé.</p>' +
      '<div style="max-height:360px; overflow:auto; border:1px solid #e2e8f0; border-radius:10px;">' +
        '<table style="width:100%; border-collapse:collapse; min-width:820px;">' +
          '<thead><tr style="background:#f8fafc;">' +
            ['Date', 'Où', 'Champ', 'Avant', 'Après', 'Motif', 'Auteur'].map(function (h) {
              return '<th style="padding:8px 10px; text-align:left; font-size:11.5px; font-weight:800; color:#475569; position:sticky; top:0; background:#f8fafc;">' + h + '</th>';
            }).join('') +
          '</tr></thead>' +
          '<tbody>' + lignes.map(ligne).join('') + '</tbody>' +
        '</table></div>' +
      '</article>';
  }

  window.AuditUI = { demanderMotif: demanderMotif, monterHistorique: monterHistorique, MOTIFS: MOTIFS };
})();
