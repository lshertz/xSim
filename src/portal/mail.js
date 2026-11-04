// Delivery of setup and password-reset links.
//
// MAIL_MODE (wrangler.jsonc vars) decides how links reach people:
//   "manual"     (default) nothing is emailed; the admin sees the link once and sends it personally.
//   "cloudflare" the link is emailed through the MAILER send_email binding (Cloudflare Email Service).
//                Sending to arbitrary recipients requires the Workers Paid plan. See DEPLOY.md.
// In both modes the link is shown to the admin if the email could not be sent.

const COPY = {
  en: {
    setup: {
      subject: "Your xSim portal access",
      body: (name, link, days) =>
        `Hello ${name},\n\nAn account has been created for you on the xSim client portal.\n\nOpen this link to choose a password and set up two-factor authentication:\n${link}\n\nThe link can be used once and expires in ${days} days.\n\nxSim\nhello@xsim.dev`,
    },
    reset: {
      subject: "Your xSim portal password has been reset",
      body: (name, link, days) =>
        `Hello ${name},\n\nYour password for the xSim client portal has been reset by an administrator, and two-factor authentication has been turned off for your account.\n\nOpen this link to choose a new password and set up two-factor authentication again:\n${link}\n\nThe link can be used once and expires in ${days} days. If you did not expect this, reply to this email.\n\nxSim\nhello@xsim.dev`,
    },
  },
  he: {
    setup: {
      subject: "הגישה שלכם לפורטל xSim",
      body: (name, link, days) =>
        `שלום ${name},\n\nנפתח עבורכם חשבון בפורטל הלקוחות של xSim.\n\nפתחו את הקישור כדי לבחור סיסמה ולהגדיר אימות דו-שלבי:\n${link}\n\nהקישור מיועד לשימוש חד-פעמי ותקף ${days} ימים.\n\nxSim\nhello@xsim.dev`,
    },
    reset: {
      subject: "הסיסמה שלכם לפורטל xSim אופסה",
      body: (name, link, days) =>
        `שלום ${name},\n\nמנהל מערכת איפס את הסיסמה שלכם לפורטל הלקוחות של xSim, והאימות הדו-שלבי בחשבון בוטל.\n\nפתחו את הקישור כדי לבחור סיסמה חדשה ולהגדיר שוב אימות דו-שלבי:\n${link}\n\nהקישור מיועד לשימוש חד-פעמי ותקף ${days} ימים. אם לא ציפיתם להודעה הזו, השיבו למייל.\n\nxSim\nhello@xsim.dev`,
    },
  },
};

export async function deliverLink(env, user, purpose, link, days) {
  const mode = env.MAIL_MODE || "manual";
  if (mode !== "cloudflare" || !env.MAILER) return { emailed: false, link };
  const c = (COPY[user.lang] || COPY.en)[purpose];
  try {
    await env.MAILER.send({
      from: { email: env.PORTAL_FROM || "portal@xsim.dev", name: "xSim" },
      replyTo: { email: env.REPLY_TO || "hello@xsim.dev", name: "xSim" },
      to: user.email,
      subject: c.subject,
      text: c.body(user.name, link, days),
    });
    return { emailed: true };
  } catch (err) {
    console.error("portal email failed", err && (err.code || err.message));
    return { emailed: false, link, emailError: true };
  }
}
