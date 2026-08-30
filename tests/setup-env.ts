import "dotenv/config";

// Route the prisma client (imported by services) to the TEST database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-secret-0123456789abcdef";
process.env.APP_URL = "http://localhost:3000";
process.env.EMAIL_PROVIDER = "mock";
process.env.VIBER_PROVIDER = "mock";
process.env.STORAGE_DIR = "./var/test-storage";
