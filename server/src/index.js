import bcrypt from 'bcryptjs';
import { createApp } from './app.js';
import { config } from './config.js';
import { get } from './db/index.js';
import { ADMIN_ACCOUNT } from './db/riesta.js';
import { recoverStuckPayments } from './services/payments/index.js';
import './services/payments/mpesa.js';
import { startScheduler } from './services/scheduler.js';

const app = createApp();

async function warnIfDefaultAdminPassword() {
  if (config.env !== 'production') return;
  try {
    const admin = get('SELECT password_hash FROM users WHERE email = ?', [ADMIN_ACCOUNT.email]);
    if (admin && (await bcrypt.compare(ADMIN_ACCOUNT.password, admin.password_hash))) {
      console.error(
        '  [security] WARNING: the admin account still uses the default seed password. ' +
          'Change it (Profile -> Change password) before serving production traffic.'
      );
    }
  } catch {
    /* users table may not exist yet on a brand-new database */
  }
}

app.listen(config.port, () => {
  console.log(`\n  Smart Rentals API running on http://localhost:${config.port}`);
  console.log(`  Environment: ${config.env}`);
  try {
    const recovered = recoverStuckPayments();
    if (recovered) console.log(`  Recovered ${recovered} stuck payment(s)`);
  } catch (err) {
    console.error('  Payment recovery failed:', err.message);
  }
  startScheduler();
  warnIfDefaultAdminPassword();
});
