import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const connection = await mysql.createConnection(url);

try {
  // Normalize all non-'ft' values to 'ft'
  // This covers: 'm', 'meters', 'feet', NULL, ''
  const [result] = await connection.execute(
    "UPDATE projects SET scaleUnit = 'ft' WHERE scaleUnit != 'ft'"
  );
  console.log(`Updated ${result.affectedRows} project(s) to scaleUnit='ft'`);

  // Verify
  const [after] = await connection.execute(
    "SELECT id, name, scaleUnit FROM projects"
  );
  console.log('All projects after migration:');
  after.forEach(p => console.log(`  [${p.id}] ${p.name}: ${p.scaleUnit}`));

  const nonFt = after.filter(p => p.scaleUnit !== 'ft');
  if (nonFt.length === 0) {
    console.log('✅ All projects now have scaleUnit=ft');
  } else {
    console.log('⚠️ Some projects still have non-ft scaleUnit:', nonFt);
  }
} finally {
  await connection.end();
}
