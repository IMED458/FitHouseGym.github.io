'use strict';

/** Internal payment states. */
const STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  PAID: 'paid',
  FAILED: 'failed',
  EXPIRED: 'expired',
  REVERSED: 'reversed',
};

/** Flitt `order_status` -> internal status. */
const PROVIDER_STATUS_MAP = {
  created: STATUS.PENDING,
  processing: STATUS.PROCESSING,
  approved: STATUS.PAID,
  declined: STATUS.FAILED,
  expired: STATUS.EXPIRED,
  reversed: STATUS.REVERSED,
};

/** Terminal states never transition again — the basis of callback idempotency. */
const TERMINAL = new Set([STATUS.PAID, STATUS.FAILED, STATUS.EXPIRED, STATUS.REVERSED]);

function mapProviderStatus(orderStatus) {
  if (typeof orderStatus !== 'string') return null;
  return PROVIDER_STATUS_MAP[orderStatus.trim().toLowerCase()] || null;
}

function isTerminal(status) {
  return TERMINAL.has(status);
}

/** Only an approved payment may activate a membership. */
function grantsMembership(status) {
  return status === STATUS.PAID;
}

export { STATUS, PROVIDER_STATUS_MAP, mapProviderStatus, isTerminal, grantsMembership };
