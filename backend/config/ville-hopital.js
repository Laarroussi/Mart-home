/**
 * Renvoi vers la source unique, à la racine du site.
 * ==================================================
 *
 * La normalisation est écrite une seule fois, dans /ville-hopital.js, parce
 * qu'elle doit donner exactement le même résultat selon que la donnée vient
 * d'un document lu par le serveur ou d'une saisie dans le navigateur. Deux
 * implémentations avaient divergé sur cinq libellés sur douze.
 *
 * Le chemin remonte de backend/config/ vers la racine du déploiement, où le
 * fichier est également servi au navigateur.
 */
'use strict';
module.exports = require('../../ville-hopital.js');
