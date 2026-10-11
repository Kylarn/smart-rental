import { createApp } from './app.js';
import { config } from './config.js';
import { recoverStuckPayments } from './services/payments/index.js';
import './services/payments/mpesa.js';
import { startScheduler } from './services/scheduler.js';

const app = createApp();

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
});
