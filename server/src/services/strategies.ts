import { db } from "@quantdesk/db";
import { strategyCatalog } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";

export async function listStrategies(engine?: string) {
	if (engine) {
		return db.select().from(strategyCatalog).where(eq(strategyCatalog.engine, engine));
	}
	return db.select().from(strategyCatalog);
}
