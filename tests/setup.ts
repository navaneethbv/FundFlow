import { config } from "dotenv";

// Load local env for tests (encryption key, Supabase keys for integration).
config({ path: ".env.local" });
