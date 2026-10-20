declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    OUTLOOK_IMPORT_TOKEN?: string;
    OUTLOOK_MAILBOX_MAP?: string;
    BUCKET?: R2Bucket;
  }
}
