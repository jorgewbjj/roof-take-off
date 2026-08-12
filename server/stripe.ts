import Stripe from "stripe";
import type { Request, Response } from "express";
import * as db from "./db";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export function assertStripeConfigured(): Stripe {
  if (!stripe) throw new Error("Stripe is not configured. Update Settings → Payment before enabling billing.");
  return stripe;
}

type CheckoutInput = {
  origin: string;
  organizationId: number;
  planId: number;
  userId: number;
  customerEmail: string | null;
  customerName: string | null;
};

export async function createSubscriptionCheckout(input: CheckoutInput) {
  const stripeClient = assertStripeConfigured();
  const plan = await db.getSubscriptionPlanById(input.planId);
  if (!plan || !plan.isActive || plan.isSystemPlan || !plan.stripePriceId) {
    throw new Error("That subscription plan is not available for checkout.");
  }
  const existing = await db.getOrganizationSubscription(input.organizationId);
  const metadata = {
    organization_id: String(input.organizationId),
    plan_id: String(plan.id),
    user_id: String(input.userId),
    customer_email: input.customerEmail ?? "",
    customer_name: input.customerName ?? "",
  };
  const session = await stripeClient.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    customer: existing?.subscription.stripeCustomerId ?? undefined,
    customer_email: existing?.subscription.stripeCustomerId ? undefined : input.customerEmail ?? undefined,
    client_reference_id: String(input.userId),
    metadata,
    subscription_data: { metadata },
    allow_promotion_codes: true,
    success_url: `${input.origin}/billing?success=1`,
    cancel_url: `${input.origin}/billing?canceled=1`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return { url: session.url };
}

export async function createCustomerBillingPortal(origin: string, organizationId: number) {
  const stripeClient = assertStripeConfigured();
  const existing = await db.getOrganizationSubscription(organizationId);
  const customerId = existing?.subscription.stripeCustomerId;
  if (!customerId) throw new Error("No Stripe billing account exists for this workspace yet.");
  const session = await stripeClient.billingPortal.sessions.create({ customer: customerId, return_url: `${origin}/billing` });
  return { url: session.url };
}

export async function createOrUpdateStripePlanCatalogEntry(input: {
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  billingInterval: "month" | "year";
  existingStripeProductId?: string | null;
}) {
  if (input.priceCents <= 0) return { stripeProductId: null, stripePriceId: null };
  const stripeClient = assertStripeConfigured();
  const product = input.existingStripeProductId
    ? await stripeClient.products.update(input.existingStripeProductId, { name: input.name, description: input.description ?? undefined })
    : await stripeClient.products.create({ name: input.name, description: input.description ?? undefined });
  const price = await stripeClient.prices.create({
    product: product.id,
    currency: input.currency,
    unit_amount: input.priceCents,
    recurring: { interval: input.billingInterval },
  });
  return { stripeProductId: product.id, stripePriceId: price.id };
}

function normalizeStripeStatus(status: Stripe.Subscription.Status) {
  if (["trialing", "active", "past_due", "canceled", "unpaid", "incomplete", "paused"].includes(status)) {
    return status as "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete" | "paused";
  }
  return "incomplete" as const;
}

async function syncStripeSubscription(subscription: Stripe.Subscription, organizationId?: number) {
  const resolvedOrganizationId = organizationId ?? Number(subscription.metadata.organization_id);
  if (!Number.isSafeInteger(resolvedOrganizationId) || resolvedOrganizationId <= 0) return;
  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) return;
  const plan = await db.getActiveSubscriptionPlanByStripePriceId(priceId);
  if (!plan) return;
  const subscriptionItem = subscription.items.data[0];
  await db.updateOrganizationSubscriptionByOrganization(resolvedOrganizationId, {
    planId: plan.id,
    provider: "stripe",
    stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
    status: normalizeStripeStatus(subscription.status),
    currentPeriodStart: new Date((subscriptionItem?.current_period_start ?? subscription.created) * 1000),
    currentPeriodEnd: new Date((subscriptionItem?.current_period_end ?? subscription.created) * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
  });
}

export async function handleStripeWebhook(req: Request, res: Response) {
  if (!stripe || !stripeWebhookSecret) return res.status(503).json({ error: "Stripe webhook is not configured." });
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") return res.status(400).json({ error: "Missing Stripe signature." });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);
  } catch (error) {
    console.warn("[Stripe] Webhook signature verification failed", String(error));
    return res.status(400).json({ error: "Invalid Stripe signature." });
  }

  if (event.id.startsWith("evt_test_")) {
    console.log("[Stripe] Test event detected, returning verification response");
    return res.json({ verified: true });
  }

  const firstDelivery = await db.recordBillingWebhookEvent("stripe", event.id, event.type);
  if (!firstDelivery) return res.json({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const organizationId = Number(session.metadata?.organization_id);
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (subscriptionId && Number.isSafeInteger(organizationId)) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await syncStripeSubscription(subscription, organizationId);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncStripeSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }
    return res.json({ received: true });
  } catch (error) {
    console.error("[Stripe] Webhook processing failed", { eventId: event.id, eventType: event.type, error: String(error) });
    return res.status(500).json({ error: "Webhook processing failed." });
  }
}
