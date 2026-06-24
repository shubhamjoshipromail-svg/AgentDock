// Load .env into process.env before any other module reads it.
// Used by standalone scripts (worker, CLI tools) that don't go through
// Next.js's built-in dotenv loading.
import { config } from "dotenv";

config({ path: ".env" });
