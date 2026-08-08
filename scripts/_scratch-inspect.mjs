import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL.replace(":6543", ":5432");
const sql = postgres(url, { prepare: false });

const [user] = await sql`select id, email from auth.users where id = 'cecdac67-ad1c-4cc3-acbf-3029273dacda'`;
console.log(user);

await sql.end();
