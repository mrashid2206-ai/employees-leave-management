// Run this after deployment to hash all employee passwords
// Usage: DATABASE_URL=your_url node scripts/hash-passwords.js

const bcrypt = require('bcryptjs')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  const hash = await bcrypt.hash('123456', 10)
  const result = await pool.query('UPDATE employees SET password_hash = $1 WHERE password_hash LIKE $2', [hash, '$2a$10$placeholder%'])
  console.log(`Updated ${result.rowCount} employee passwords to bcrypt hash`)
  console.log('Default password for all employees: 123456')
  await pool.end()
}

main().catch(console.error)
