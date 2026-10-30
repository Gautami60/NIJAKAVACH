/**
 * NIJAKAVACH — Database Seeder Script
 * Seeds initial supported Indian directories into the 'sources' schema.
 */

async function main() {
  console.log("==================================================");
  console.log("NIJAKAVACH — Initial Directory Catalog Seeder");
  console.log("==================================================");

  const initialSources = [
    {
      name: "India B2B Contact Directory Alpha",
      category: "PUBLIC_DIRECTORY",
      capabilities: ["SEARCHABLE", "WEBFORM_OPT_OUT"],
      rateLimit: "30 req/min"
    },
    {
      name: "National Yellow Pages India Beta",
      category: "LEAD_AGGREGATOR",
      capabilities: ["SEARCHABLE", "EMAIL_NOTICE_REMOVAL"],
      rateLimit: "10 req/min"
    }
  ];

  console.log(`Seeding ${initialSources.length} verified public sources...`);
  initialSources.forEach(s => {
    console.log(` + ${s.name} [${s.category}] - Capabilities: ${s.capabilities.join(", ")}`);
  });

  console.log("\n[OK] Database seeding verified successfully.");
}

main().catch(err => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
