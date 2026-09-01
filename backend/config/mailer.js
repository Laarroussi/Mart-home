/**
 * ============================================================
 * ENVOI D'E-MAILS — Marfan APA
 * ============================================================
 * Deux modes, essayés dans cet ordre :
 *
 *  1. SMTP via nodemailer — utilisé si le paquet est installé ET que
 *     SMTP_HOST est défini dans .env. C'est le mode recommandé sur
 *     o2switch (adresse d'envoi créée dans cPanel → Comptes de messagerie).
 *
 *  2. Binaire sendmail local (/usr/sbin/sendmail) — présent par défaut
 *     sur les hébergements cPanel. Aucune dépendance ni identifiant requis.
 *     Sert de repli automatique si le mode SMTP n'est pas disponible.
 *
 * Variables .env reconnues :
 *   MAIL_FROM        ex. "Marfan APA <no-reply@marfan-sport-sante.fr>"
 *   MAIL_REPLY_TO    ex. "contact@marfan-sport-sante.fr"      (optionnel)
 *   PUBLIC_BASE_URL  ex. "https://marfan-sport-sante.fr"
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE   (optionnels)
 *   SENDMAIL_PATH    (optionnel, défaut /usr/sbin/sendmail)
 * ============================================================
 */
const { spawn } = require('child_process');

const FROM = process.env.MAIL_FROM || 'Marfan APA <no-reply@marfan-sport-sante.fr>';
const REPLY_TO = process.env.MAIL_REPLY_TO || '';

/** Charge nodemailer seulement s'il est installé (dépendance facultative) */
function getNodemailer() {
  try { return require('nodemailer'); } catch (_) { return null; }
}

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** Encodage RFC 2047 pour les sujets contenant des accents */
function encodeSubject(s) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}

/** Envoi via le binaire sendmail local (cPanel/o2switch) */
function sendViaSendmail({ to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    const bin = process.env.SENDMAIL_PATH || '/usr/sbin/sendmail';
    const boundary = 'mrf_' + Date.now().toString(36);
    const headers = [
      'From: ' + FROM,
      'To: ' + to,
      REPLY_TO ? 'Reply-To: ' + REPLY_TO : null,
      'Subject: ' + encodeSubject(subject),
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="' + boundary + '"'
    ].filter(Boolean).join('\r\n');

    const body =
      '\r\n\r\n--' + boundary + '\r\n' +
      'Content-Type: text/plain; charset=UTF-8\r\n' +
      'Content-Transfer-Encoding: 8bit\r\n\r\n' + text + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: text/html; charset=UTF-8\r\n' +
      'Content-Transfer-Encoding: 8bit\r\n\r\n' + html + '\r\n' +
      '--' + boundary + '--\r\n';

    let child;
    try {
      child = spawn(bin, ['-t', '-i']);
    } catch (e) {
      return reject(new Error('sendmail introuvable (' + bin + ') : ' + e.message));
    }
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', e => reject(new Error('sendmail : ' + e.message)));
    child.on('close', code => {
      if (code === 0) resolve({ mode: 'sendmail' });
      else reject(new Error('sendmail code ' + code + (stderr ? ' — ' + stderr.trim() : '')));
    });
    child.stdin.write(headers + body, 'utf8');
    child.stdin.end();
  });
}

/** Envoi via SMTP (nodemailer) */
async function sendViaSmtp({ to, subject, text, html }) {
  const nodemailer = getNodemailer();
  if (!nodemailer) throw new Error('nodemailer non installé');
  const port = parseInt(process.env.SMTP_PORT, 10) || 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: FROM, to, subject, text, html,
    ...(REPLY_TO ? { replyTo: REPLY_TO } : {})
  });
  return { mode: 'smtp' };
}

/**
 * Envoie un e-mail. Tente SMTP puis sendmail.
 * Ne lève une erreur que si les deux modes échouent.
 */
async function sendMail({ to, subject, text, html }) {
  if (!to) throw new Error('Destinataire manquant');
  const erreurs = [];
  if (smtpConfigured() && getNodemailer()) {
    try { return await sendViaSmtp({ to, subject, text, html }); }
    catch (e) { erreurs.push('SMTP : ' + e.message); }
  }
  try { return await sendViaSendmail({ to, subject, text, html }); }
  catch (e) { erreurs.push('sendmail : ' + e.message); }
  throw new Error(erreurs.join(' | '));
}

/** Diagnostic : quels modes d'envoi sont disponibles ? */
function mailerStatus() {
  const fs = require('fs');
  const bin = process.env.SENDMAIL_PATH || '/usr/sbin/sendmail';
  return {
    from: FROM,
    smtp_configure: smtpConfigured(),
    nodemailer_installe: !!getNodemailer(),
    sendmail_present: fs.existsSync(bin),
    sendmail_path: bin,
    public_base_url: process.env.PUBLIC_BASE_URL || '(non défini)'
  };
}

// ============================================================
// GABARIT — e-mail d'activation de compte patient
// ============================================================
function activationEmail({ prenom, lien, heures }) {
  const bonjour = prenom ? `Bonjour ${prenom},` : 'Bonjour,';
  const subject = 'Activation de votre espace Marfan APA';

  const text =
`${bonjour}

Un espace personnel vient d'être créé pour vous sur la plateforme Marfan APA,
dans le cadre de votre suivi en activité physique adaptée.

Pour l'activer et choisir votre mot de passe, ouvrez ce lien :
${lien}

Ce lien est personnel, utilisable une seule fois, et valable ${heures} heures.

Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message :
aucun compte ne sera activé sans votre action.

L'équipe Marfan APA
Ce message est automatique, merci de ne pas y répondre.`;

  const html =
`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; background:#f1f5f9; padding:24px;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 4px 18px rgba(11,21,48,0.10);">
    <div style="background:linear-gradient(135deg,#0891b2,#06b6d4); padding:26px 28px; color:#ffffff;">
      <div style="font-size:12px; letter-spacing:1.4px; text-transform:uppercase; opacity:.9;">Marfan APA</div>
      <div style="font-size:20px; font-weight:700; margin-top:4px;">Activation de votre espace</div>
    </div>
    <div style="padding:26px 28px; color:#0b1530; font-size:14.5px; line-height:1.6;">
      <p style="margin:0 0 14px;">${bonjour}</p>
      <p style="margin:0 0 14px;">Un espace personnel vient d'être créé pour vous dans le cadre de votre suivi en activité physique adaptée.</p>
      <p style="margin:0 0 22px;">Pour l'activer et choisir votre mot de passe, cliquez sur le bouton ci-dessous.</p>
      <p style="margin:0 0 22px; text-align:center;">
        <a href="${lien}" style="display:inline-block; padding:14px 30px; background:linear-gradient(135deg,#0891b2,#06b6d4); color:#ffffff; text-decoration:none; border-radius:10px; font-weight:700; font-size:15px;">Activer mon espace</a>
      </p>
      <p style="margin:0 0 14px; font-size:13px; color:#475569;">
        Ce lien est <strong>personnel</strong>, utilisable <strong>une seule fois</strong>, et valable <strong>${heures} heures</strong>.
      </p>
      <p style="margin:0 0 14px; font-size:12.5px; color:#64748b;">
        Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br>
        <span style="word-break:break-all; color:#0891b2;">${lien}</span>
      </p>
      <p style="margin:18px 0 0; padding-top:16px; border-top:1px solid #e2e8f0; font-size:12.5px; color:#64748b;">
        Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun compte ne sera activé sans votre action.
      </p>
    </div>
    <div style="padding:14px 28px 20px; background:#f8fafc; color:#94a3b8; font-size:11.5px; text-align:center;">
      Message automatique — merci de ne pas y répondre.
    </div>
  </div>
</div>`;

  return { subject, text, html };
}

module.exports = { sendMail, mailerStatus, activationEmail };
