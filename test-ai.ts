import 'dotenv/config';
import { generateIncidentSummary } from './src/worker/ai.js';
import { db, closeDb } from './src/db/client.js';
import { incidents, pings } from './src/db/schema.js';
import { eq, and, gte } from 'drizzle-orm';

const incidentId = Number(process.argv[2]);

if (!incidentId) {
  console.error('Usage: pnpm tsx test-ai.ts <incidentId>');
  process.exit(1);
}

async function main() {
  console.log(`\n🔍 Looking up incident ${incidentId}...\n`);

  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (!incident) {
    console.error(`❌ Incident ${incidentId} not found`);
    process.exit(1);
  }

  console.log('Incident details:');
  console.log(`  URL ID:     ${incident.urlId}`);
  console.log(`  Status:     ${incident.status}`);
  console.log(`  Started:    ${incident.startedAt}`);
  console.log(`  Ended:      ${incident.endedAt || '(still open)'}`);
  console.log(`  AI summary: ${incident.aiSummary ? '(exists)' : '(none)'}`);
  console.log();

  // Count pings during the incident
  const start = new Date(incident.startedAt);
  const allPings = await db
    .select()
    .from(pings)
    .where(and(eq(pings.urlId, incident.urlId), gte(pings.checkedAt, start)));

  console.log(`📊 Found ${allPings.length} pings since incident started`);

  if (allPings.length === 0) {
    console.error('\n❌ No pings found. Gemini has no data to summarize.');
    await closeDb();
    process.exit(1);
  }

  console.log('\n🤖 Calling Gemini...\n');

  const startTime = Date.now();
  await generateIncidentSummary(incidentId);
  const elapsed = Date.now() - startTime;

  const [updated] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  console.log(`\n⏱️  Total time: ${elapsed}ms`);

  if (updated.aiSummary) {
    console.log('\n✅ AI Summary generated:\n');
    console.log('─'.repeat(60));
    console.log(updated.aiSummary);
    console.log('─'.repeat(60));
    console.log(`\nPrompt version: ${updated.promptVersion}`);
    console.log(`Generated at:   ${updated.aiGeneratedAt}`);
  } else {
    console.error('\n❌ No summary generated. Check logs above.');
  }

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});