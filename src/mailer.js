import nodemailer from "nodemailer";
import "dotenv/config";

if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.warn("[mailer] WARNING: SMTP_HOST, SMTP_USER o SMTP_PASS no están definidos");
}

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false },
  connectionTimeout: 10_000,  // 10s para conectar al SMTP
  greetingTimeout:  10_000,  // 10s para el saludo SMTP
  socketTimeout:    30_000,  // 30s de inactividad en el socket
});
