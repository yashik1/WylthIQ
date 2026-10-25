import { isDatabaseConfigured } from "../db";
import { getEntitlement, hasAccess } from "../billing/entitlement";

/** The signed-in reader who may use the journal, or null. The same test the journal's own actions make. */
export async function journalReader(): Promise<{ userId: string } | null> {
  if (!isDatabaseConfigured()) return null;
  const entitlement = await getEntitlement();
  if (!hasAccess(entitlement) || !entitlement.userId) return null;
  return { userId: entitlement.userId };
}
