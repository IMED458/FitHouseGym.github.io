'use strict';

/**
 * Membership activation.
 *
 * These rules mirror the browser app (assets/js/app.js:
 * `getMembershipPaymentSelection` / `addMonthsPreserveDay` / `setToEndOfDay`)
 * so a Flitt-paid membership is indistinguishable from a cash one.
 *
 * Note on renewals: the existing app resets the period from "now" on renewal and
 * does NOT roll over unused days. That behaviour is reproduced here deliberately —
 * changing it would silently alter cash renewals' semantics too.
 */

/** Mirror of app.js addMonthsPreserveDay. */
function addMonthsPreserveDay(date, months = 1) {
  const source = new Date(date);
  const day = source.getDate();
  const target = new Date(source);
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

/** Mirror of app.js setToEndOfDay. */
function setToEndOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Computes the subscription window for a plan, matching the app's rules. */
function computeSubscriptionPeriod(plan, startDate = new Date()) {
  const start = new Date(startDate);
  const durationDays = Number(plan.durationDays) || 30;

  let end;
  if (durationDays === 1) {
    end = setToEndOfDay(start);
  } else if (durationDays % 30 === 0) {
    end = setToEndOfDay(addMonthsPreserveDay(start, Math.round(durationDays / 30)));
  } else {
    const raw = new Date(start);
    raw.setDate(raw.getDate() + durationDays);
    end = setToEndOfDay(raw);
  }

  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

/**
 * Builds the member document patch for an activation/renewal.
 * Pure function — the caller persists it inside a transaction.
 */
function buildMembershipUpdate({ plan, priceGel, isRenewal, now = new Date() }) {
  const { startDate, endDate } = computeSubscriptionPeriod(plan, now);

  return {
    status: 'active',
    subscriptionType: plan.type,
    subscriptionPrice: priceGel,
    subscriptionStartDate: startDate,
    subscriptionEndDate: endDate,
    remainingVisits: plan.remainingVisits === null ? null : Number(plan.remainingVisits),
    lastMembershipPaymentMethod: 'FLITT',
    lastMembershipHandledByRole: 'system',
    lastMembershipHandledByFullName: 'Flitt (ონლაინ გადახდა)',
    lastMembershipActionAt: now.toISOString(),
    lastMembershipAction: isRenewal ? 'membership_renewal' : 'membership_registration',
  };
}

/**
 * Builds the finance transaction record, matching the shape written by
 * app.js `recordMembershipTransaction` so existing reports pick it up unchanged.
 * Amount is stored in whole GEL, as the rest of the finance module expects.
 */
function buildTransactionRecord({ member, plan, priceGel, isRenewal, orderId, now = new Date() }) {
  const type = isRenewal ? 'membership_renewal' : 'membership_registration';
  return {
    type,
    category: 'membership',
    amount: priceGel,
    memberId: member.id,
    memberName: `${member.firstName || ''} ${member.lastName || ''}`.trim(),
    personalId: member.personalId || '',
    subscriptionType: plan.type,
    subscriptionName: plan.name,
    paymentMethod: 'FLITT',
    note: `Flitt ონლაინ გადახდა • ${orderId}`,
    actorUserId: null,
    actorUsername: null,
    actorFullName: 'Flitt (ონლაინ გადახდა)',
    actorRole: 'system',
    description: isRenewal
      ? `აბონემენტის განახლება: ${plan.name}`
      : `ახალი აბონემენტი: ${plan.name}`,
    createdAt: now.toISOString(),
  };
}

export {
  addMonthsPreserveDay,
  setToEndOfDay,
  computeSubscriptionPeriod,
  buildMembershipUpdate,
  buildTransactionRecord,
};
