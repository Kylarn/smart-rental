import { dispatchSms } from './index.js';
import { formatKes, monthLabel, formatDate } from '../../utils/helpers.js';
import { config } from '../../config.js';

export const smsEvents = {
  rentDue({ userId, leaseId, propertyId = null, period, amount, dueDate, dedupeKey }) {
    return dispatchSms('rent_due', {
      userId,
      propertyId,
      message: `Smart Rentals: rent of ${formatKes(amount)} for ${monthLabel(period) || period} is due on ${formatDate(dueDate) || dueDate}. Pay via the tenant portal to avoid arrears.`,
      relatedEntity: 'lease',
      relatedId: leaseId,
      dedupeKey,
    });
  },
  rentOverdue({ userId, leaseId, propertyId = null, amount, months, dedupeKey }) {
    return dispatchSms('rent_overdue', {
      userId,
      propertyId,
      message: `Smart Rentals: your rent account is in arrears by ${formatKes(amount)} (${months} month${months === 1 ? '' : 's'}). Please clear your balance.`,
      relatedEntity: 'lease',
      relatedId: leaseId,
      dedupeKey,
    });
  },
  paymentReceived({ userId, paymentId, propertyId = null, amount, periodLabel, receipt }) {
    return dispatchSms('payment_received', {
      userId,
      propertyId,
      message: `Smart Rentals: payment of ${formatKes(amount)}${periodLabel ? ` for ${periodLabel}` : ''} received. Receipt ${receipt}. Thank you.`,
      relatedEntity: 'payment',
      relatedId: paymentId,
      dedupeKey: `sms-payment-${paymentId}`,
    });
  },
  billCreated({ userId, billId, propertyId, category, periodLabel, amount }) {
    return dispatchSms('utility_bill', {
      userId,
      propertyId,
      message: `Smart Rentals: new ${String(category).toLowerCase()} bill of ${formatKes(amount)} for ${periodLabel}. View and settle it in your portal.`,
      relatedEntity: 'utility_bill',
      relatedId: billId,
      dedupeKey: `sms-bill-${billId}`,
    });
  },
  billPaid({ userId, billId, propertyId, category, periodLabel, amount }) {
    return dispatchSms('utility_bill_paid', {
      userId,
      propertyId,
      message: `Smart Rentals: your ${String(category).toLowerCase()} bill of ${formatKes(amount)} for ${periodLabel} has been settled.`,
      relatedEntity: 'utility_bill',
      relatedId: billId,
      dedupeKey: `sms-bill-paid-${billId}`,
    });
  },
  announcement({ userId, announcementId, propertyId, title }) {
    return dispatchSms('announcement', {
      userId,
      propertyId,
      message: `Smart Rentals announcement: ${title}. Open the tenant portal for details.`,
      relatedEntity: 'announcement',
      relatedId: announcementId,
      dedupeKey: `sms-ann-${announcementId}-${userId}`,
    });
  },
  maintenanceUpdate({ userId, requestId, propertyId, title, status }) {
    return dispatchSms('maintenance', {
      userId,
      propertyId,
      message: `Smart Rentals: your maintenance request "${title}" is now ${String(status).replace(/_/g, ' ')}.`,
      relatedEntity: 'maintenance',
      relatedId: requestId,
      dedupeKey: `sms-maint-${requestId}-${status}`,
    });
  },
  serviceInterruption({ userId, propertyId, title, body, dedupeKey }) {
    return dispatchSms('service_interruption', {
      userId,
      propertyId,
      message: `Smart Rentals notice: ${title}. ${body}`.slice(0, 300),
      relatedEntity: 'announcement',
      dedupeKey,
    });
  },
  accountActivation({ userId, url, propertyName, dedupeKey }) {
    return dispatchSms('account_activation', {
      userId,
      message: `Smart Rentals: activate your tenant account${propertyName ? ` for ${propertyName}` : ''} using this secure link (valid for ${config.activationTtlHours} hours): ${url}`,
      relatedEntity: 'user',
      relatedId: userId,
      dedupeKey,
    });
  },
};
