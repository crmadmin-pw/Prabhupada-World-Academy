declare module 'nodemailer' {
  interface SendMailOptions {
    from?: string;
    to?: string;
    subject?: string;
    html?: string;
    text?: string;
  }

  interface Transporter {
    sendMail(options: SendMailOptions): Promise<{ messageId?: string }>;
  }

  interface TransportOptions {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  }

  const nodemailer: {
    createTransport(options: TransportOptions): Transporter;
  };

  export default nodemailer;
}
