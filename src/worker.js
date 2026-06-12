import { Worker } from "bullmq";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import handlebars from "handlebars";
import { convert } from "html-to-text";
import { connection } from "./queue.js";
import { transporter } from "./mailer.js";
import { updateStatus } from "./db.js";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "templates");

const templateCache = new Map();

function renderTemplate(template, variables) {
  if (!templateCache.has(template)) {
    const path = join(TEMPLATES_DIR, `${template}.html`);
    if (!existsSync(path)) throw new Error(`Template '${template}' not found`);
    templateCache.set(template, handlebars.compile(readFileSync(path, "utf8")));
  }
  return templateCache.get(template)(variables ?? {});
}

function buildUnsubscribeUrl(email) {
  const base = process.env.UNSUBSCRIBE_BASE_URL;
  if (!base) return null;
  return `${base}?email=${encodeURIComponent(email)}`;
}

const UNSUBSCRIBE_FOOTER = (url) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
  <tbody><tr>
    <td style="padding:15px 20px;text-align:center;font-family:arial,helvetica,sans-serif;font-size:12px;color:#999999;border-top:1px solid #e0e0e0;">
      ¿No deseas recibir más correos?
      <a href="${url}" style="color:#667eea;text-decoration:underline;">Darte de baja aquí</a>
    </td>
  </tr></tbody>
</table>`;

function injectUnsubscribeFooter(html, url) {
  const footer = UNSUBSCRIBE_FOOTER(url);
  if (html.includes("</body>")) {
    return html.replace("</body>", `${footer}\n</body>`);
  }
  return html + footer;
}

const HTML_TO_TEXT_OPTIONS = {
  wordwrap: 130,
  selectors: [
    { selector: "img", format: "skip" },
    { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
    { selector: "h1", options: { uppercase: false } },
    { selector: "h2", options: { uppercase: false } },
    { selector: "h3", options: { uppercase: false } },
  ],
};

export function startWorker() {
  const concurrency = Number(process.env.WORKER_CONCURRENCY) || 5;

  const worker = new Worker(
    "email-queue",
    async (job) => {
      const { to, subject, template, html, variables, jobId } = job.data;

      await updateStatus(jobId, "processing");

      // Resolve HTML: inline takes priority, then file-based template
      let finalHtml = html ?? renderTemplate(template, variables);

      const unsubscribeUrl = buildUnsubscribeUrl(to);
      if (unsubscribeUrl) {
        finalHtml = injectUnsubscribeFooter(finalHtml, unsubscribeUrl);
      }

      const text = convert(finalHtml, HTML_TO_TEXT_OPTIONS);

      const mailOptions = {
        from: process.env.SMTP_FROM,
        to,
        subject,
        html: finalHtml,
        text,
      };

      if (unsubscribeUrl) {
        mailOptions.headers = {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        };
      }

      await transporter.sendMail(mailOptions);

      await updateStatus(jobId, "sent");
    },
    { connection, concurrency }
  );

  worker.on("failed", async (job, err) => {
    if (job && job.attemptsMade >= job.opts.attempts) {
      await updateStatus(job.data.jobId, "failed", err.message);
    }
  });

  console.log(`Worker started (concurrency: ${concurrency})`);
  return worker;
}
