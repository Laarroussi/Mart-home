/* ============================================================
   FICHE SYNTHÉTIQUE D'ENTRÉE EN ACTIVITÉ PHYSIQUE ADAPTÉE
   ------------------------------------------------------------
   Un document d'une page, lisible en trente secondes par un soignant qui
   ne connaît pas le patient : qui il est, ce qu'il a, où en est son aorte,
   ce qu'il peut faire, ce qu'il veut, et ce qu'on lui propose.

   La forme est volontairement pauvre. Les informations administratives
   tiennent dans un bandeau compact, parce qu'on les cherche du regard sans
   les lire. Le reste est de la prose : deux rubriques rédigées, pas trente
   cases. Un dossier d'APA découpé en cases se remplit mal et se lit encore
   plus mal — on y perd justement le raisonnement clinique qui justifie la
   prise en charge.

   Rien n'est inventé ici : le module met en page ce qu'on lui donne. Une
   donnée absente disparaît du bandeau au lieu d'afficher un tiret, pour la
   même raison qu'on interdit à l'IA d'écrire « non renseigné » : dans un
   dossier médical, un trou annoncé se lit comme un fait.
   ============================================================ */
(function () {
  'use strict';

  const ech = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const jour = (d) => {
    if (!d) return '';
    const x = new Date(d);
    if (isNaN(x)) return String(d);
    return x.toLocaleDateString('fr-FR');
  };

  /** Âge calculé depuis la date de naissance, qui ne vieillit pas comme un
   *  âge saisi une fois pour toutes dans la fiche. */
  function ageDepuis(dob, secours) {
    if (!dob) return secours || null;
    const n = new Date(dob);
    if (isNaN(n)) return secours || null;
    const a = new Date();
    let v = a.getFullYear() - n.getFullYear();
    const m = a.getMonth() - n.getMonth();
    if (m < 0 || (m === 0 && a.getDate() < n.getDate())) v--;
    return v >= 0 && v < 130 ? v : (secours || null);
  }

  /**
   * Construit le HTML de la fiche.
   *
   * @param {object} d
   *   nom, prenom, ipp, dob, age, sexe, taille_cm, poids_kg, profession,
   *   diagnostic, gene, variant, date_entree_apa,
   *   histoire   — rubrique 1, prose
   *   difficultes — rubrique 2, prose
   *   modalites  — une ligne libre
   *   auteur, valide_le
   */
  function construire(d) {
    d = d || {};
    const nom = [d.nom, d.prenom].filter(Boolean).join(' ').trim();
    const age = ageDepuis(d.dob, d.age);

    // Bandeau : uniquement les lignes qui portent une valeur.
    const champs = [
      ['IPP', d.ipp],
      ['Naissance', d.dob ? jour(d.dob) + (age != null ? ' (' + age + ' ans)' : '')
                          : (age != null ? age + ' ans' : '')],
      ['Sexe', d.sexe],
      ['Taille', d.taille_cm ? d.taille_cm + ' cm' : ''],
      ['Poids', d.poids_kg ? d.poids_kg + ' kg' : ''],
      ['Profession', d.profession],
      ['Diagnostic', d.diagnostic || 'Syndrome de Marfan'],
      ['Gène', [d.gene, d.variant].filter(Boolean).join(' — ')],
      ['Entrée APA', jour(d.date_entree_apa)]
    ].filter(x => x[1] !== '' && x[1] != null);

    const bandeau = champs.map(([k, v]) =>
      '<div class="fa-champ"><span class="fa-k">' + ech(k) + '</span>' +
      '<span class="fa-v">' + ech(v) + '</span></div>').join('');

    // Une rubrique vide n'est pas affichée : mieux vaut une fiche courte
    // qu'un titre qui promet un contenu absent.
    const rubrique = (titre, texte) => {
      const t = String(texte || '').trim();
      if (!t) return '';
      const paras = t.split(/\n{2,}|\n/).map(x => x.trim()).filter(Boolean)
        .map(x => '<p>' + ech(x) + '</p>').join('');
      return '<section class="fa-rub"><h3>' + ech(titre) + '</h3>' + paras + '</section>';
    };

    const mod = String(d.modalites || '').trim();
    const blocMod = mod
      ? '<p class="fa-mod"><strong>Modalités proposées :</strong> ' + ech(mod) + '.</p>'
      : '';

    const pied = (d.auteur || d.valide_le)
      ? '<footer class="fa-pied">' +
        (d.auteur ? 'Rédigé par ' + ech(d.auteur) : '') +
        (d.valide_le ? (d.auteur ? ' — ' : '') + 'validé le ' + jour(d.valide_le) : '') +
        '</footer>'
      : '';

    return '' +
      '<article class="fiche-apa">' +
        '<header class="fa-tete">' +
          '<div class="fa-titre">' +
            '<h2>' + (nom ? ech(nom) : 'Fiche d\'entrée') + '</h2>' +
            '<span>Fiche synthétique d\'entrée en activité physique adaptée</span>' +
          '</div>' +
          (d.code ? '<span class="fa-code">' + ech(d.code) + '</span>' : '') +
        '</header>' +
        '<div class="fa-bandeau">' + bandeau + '</div>' +
        rubrique('Histoire de la maladie et éléments médicaux pertinents', d.histoire) +
        rubrique('Difficultés physiques, objectifs et prise en charge proposée', d.difficultes) +
        blocMod +
        pied +
      '</article>';
  }

  /** Feuille de style, injectée une seule fois. Le bloc @media print est
   *  l'essentiel : à l'impression tout le reste de l'application disparaît
   *  et seule la fiche occupe la page. */
  function injecterStyle() {
    if (document.getElementById('ficheApaStyle')) return;
    const st = document.createElement('style');
    st.id = 'ficheApaStyle';
    st.textContent = `
      .fiche-apa {
        background: #fff; color: #10233f;
        border: 1px solid #dbe3ec; border-radius: 12px;
        padding: 22px 26px;
        font-size: 13.5px; line-height: 1.6;
        max-width: 860px;
      }
      .fa-tete { display: flex; align-items: flex-start; gap: 14px;
        padding-bottom: 12px; border-bottom: 2px solid #0f766e; margin-bottom: 14px; }
      .fa-titre h2 { font-size: 20px; font-weight: 800; margin: 0 0 2px; letter-spacing: -.3px; }
      .fa-titre span { font-size: 12px; color: #64748b; font-weight: 600;
        text-transform: uppercase; letter-spacing: .06em; }
      .fa-code { margin-left: auto; font-size: 12px; font-weight: 800; color: #0f766e;
        background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 7px; padding: 4px 10px;
        white-space: nowrap; }
      .fa-bandeau { display: flex; flex-wrap: wrap; gap: 4px 0;
        background: #f8fafc; border: 1px solid #e8edf4; border-radius: 9px;
        padding: 10px 12px; margin-bottom: 18px; }
      .fa-champ { flex: 1 1 32%; min-width: 180px; display: flex; gap: 7px;
        font-size: 12.5px; padding: 2px 6px 2px 0; }
      .fa-k { color: #64748b; font-weight: 700; min-width: 86px; }
      .fa-v { color: #10233f; font-weight: 600; }
      .fa-rub { margin-bottom: 16px; }
      .fa-rub h3 { font-size: 13px; font-weight: 800; color: #0f766e;
        text-transform: uppercase; letter-spacing: .05em;
        margin: 0 0 7px; padding-bottom: 4px; border-bottom: 1px solid #e8edf4; }
      .fa-rub p { margin: 0 0 8px; text-align: justify; }
      .fa-rub p:last-child { margin-bottom: 0; }
      .fa-mod { margin: 0 0 12px; padding: 9px 12px; background: #f0f9ff;
        border-left: 3px solid #0891b2; border-radius: 0 7px 7px 0; font-size: 13px; }
      .fa-pied { font-size: 11.5px; color: #94a3b8; border-top: 1px solid #e8edf4;
        padding-top: 8px; }

      .fa-bilan { margin-top: 20px; }
      .fa-bilan-tete { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
        padding-bottom: 6px; margin-bottom: 12px; border-bottom: 2px solid #0f766e; }
      .fa-bilan-titre { font-size: 15px; font-weight: 800; color: #0f766e; margin: 0; }
      .fa-periode { font-size: 11.5px; color: #64748b; font-weight: 600; }
      .fa-valide { margin-left: auto; font-size: 11px; font-weight: 700; color: #065f46; }
      .fa-brouillon { margin-left: auto; font-size: 11px; font-weight: 800; color: #b45309;
        background: #fffbeb; border: 1px solid #fde68a; border-radius: 5px; padding: 2px 7px; }

      /* À l'impression : la fiche seule, sur une page, sans décor. */
      @media print {
        body > *:not(#ficheApaImpression) { display: none !important; }
        #ficheApaImpression { display: block !important; position: static !important; }
        .fiche-apa { border: 0; border-radius: 0; padding: 0; max-width: none;
          font-size: 11pt; line-height: 1.45; }
        .fa-rub p { orphans: 3; widows: 3; }
        /* Un bilan coupé en deux par un saut de page se relit mal : chacun
           commence sur sa propre page dès qu'il y en a plusieurs. */
        .fa-saut { break-before: page; page-break-before: always; }
        .fa-bilan { break-inside: auto; }
        .fa-bilan-tete { break-after: avoid; page-break-after: avoid; }
        .fa-rub h3 { break-after: avoid; page-break-after: avoid; }
        @page { margin: 16mm 15mm; }
      }
    `;
    document.head.appendChild(st);
  }

  /** Ouvre la boîte d'impression du navigateur sur la fiche seule.
   *  On n'ouvre pas de fenêtre : les bloqueurs de pop-up les suppriment
   *  silencieusement, et l'utilisateur croit que le bouton ne marche pas. */
  function imprimer(d) {
    injecterStyle();
    let hote = document.getElementById('ficheApaImpression');
    if (!hote) {
      hote = document.createElement('div');
      hote.id = 'ficheApaImpression';
      document.body.appendChild(hote);
    }
    hote.style.display = 'none';
    hote.innerHTML = construire(d);
    window.print();
  }

  /**
   * Document multi-bilans : le parcours complet du patient.
   *
   * L'en-tête d'identité n'est imprimé qu'une fois, en tête du document. La
   * répéter avant chaque bilan gonflerait le dossier sans rien apprendre, et
   * un document de sortie qui fait dix pages n'est pas lu.
   *
   * Chaque bilan commence sur une nouvelle page lorsqu'il y en a plusieurs :
   * on les consulte séparément, et un bilan coupé en deux par un saut de
   * page se relit mal.
   */
  function construireParcours(ident, bilans, options) {
    ident = ident || {};
    bilans = bilans || [];
    options = options || {};
    const plusieurs = bilans.length > 1;

    const corps = bilans.map((b, i) => {
      const sections = (b.sections || [])
        .filter(x => String(x[1] || '').trim())
        .map(x => {
          const paras = String(x[1]).split(/\n{2,}|\n/).map(t => t.trim()).filter(Boolean)
            .map(t => '<p>' + ech(t) + '</p>').join('');
          return '<section class="fa-rub"><h3>' + ech(x[0]) + '</h3>' + paras + '</section>';
        }).join('');

      if (!sections) return '';

      const etat = b.brouillon
        ? '<span class="fa-brouillon">brouillon — non validé</span>'
        : (b.valide_le
            ? '<span class="fa-valide">validé le ' + jour(b.valide_le) +
              (b.auteur ? ' par ' + ech(b.auteur) : '') + '</span>'
            : '');

      return '<div class="fa-bilan' + (plusieurs && i > 0 ? ' fa-saut' : '') + '">' +
        '<div class="fa-bilan-tete">' +
          '<h3 class="fa-bilan-titre">' + ech(b.titre || 'Bilan') + '</h3>' +
          (b.periode ? '<span class="fa-periode">' + ech(b.periode) + '</span>' : '') +
          etat +
        '</div>' + sections + '</div>';
    }).join('');

    const nom = [ident.nom, ident.prenom].filter(Boolean).join(' ').trim();
    const age = ageDepuis(ident.dob, ident.age);
    const champs = [
      ['IPP', ident.ipp],
      ['Naissance', ident.dob ? jour(ident.dob) + (age != null ? ' (' + age + ' ans)' : '')
                              : (age != null ? age + ' ans' : '')],
      ['Sexe', ident.sexe],
      ['Taille', ident.taille_cm ? ident.taille_cm + ' cm' : ''],
      ['Poids', ident.poids_kg ? ident.poids_kg + ' kg' : ''],
      ['Profession', ident.profession],
      ['Diagnostic', ident.diagnostic || 'Syndrome de Marfan'],
      ['Gène', [ident.gene, ident.variant].filter(Boolean).join(' — ')],
      ['Entrée APA', jour(ident.date_entree_apa)]
    ].filter(x => x[1] !== '' && x[1] != null);

    return '<article class="fiche-apa">' +
      '<header class="fa-tete">' +
        '<div class="fa-titre">' +
          '<h2>' + (nom ? ech(nom) : 'Dossier patient') + '</h2>' +
          '<span>' + ech(options.titre || 'Activité physique adaptée') + '</span>' +
        '</div>' +
        (ident.code ? '<span class="fa-code">' + ech(ident.code) + '</span>' : '') +
      '</header>' +
      '<div class="fa-bandeau">' +
        champs.map(([k, v]) => '<div class="fa-champ"><span class="fa-k">' + ech(k) +
          '</span><span class="fa-v">' + ech(v) + '</span></div>').join('') +
      '</div>' +
      (ident.modalites
        ? '<p class="fa-mod"><strong>Modalités :</strong> ' + ech(ident.modalites) + '.</p>'
        : '') +
      corps +
    '</article>';
  }

  function imprimerParcours(ident, bilans, options) {
    injecterStyle();
    let hote = document.getElementById('ficheApaImpression');
    if (!hote) {
      hote = document.createElement('div');
      hote.id = 'ficheApaImpression';
      document.body.appendChild(hote);
    }
    hote.style.display = 'none';
    hote.innerHTML = construireParcours(ident, bilans, options);
    window.print();
  }

  window.FicheAPA = {
    construire, injecterStyle, imprimer,
    construireParcours, imprimerParcours
  };
})();
