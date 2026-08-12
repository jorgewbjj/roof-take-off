# SaaS Launch Checklist

## Customer Sign-In

Customers can now create a dedicated workspace with their **name, company name, email address, and password**. The application uses opaque, HTTP-only sessions and does not require a Manus account. Existing owner data has been migrated into the master workspace without changing the project records.

## Stripe Billing

The application contains a master-owner plan catalog, Stripe Checkout, a Stripe customer billing portal, a signature-verified webhook endpoint at `/api/stripe/webhook`, and server-side trial and project-limit enforcement.

Before accepting subscription payments, complete the following steps:

1. Claim the connected Stripe test sandbox at the secure link provided in the project payment settings.
2. Sign in to the application as the platform owner and open **Admin** from the Projects header.
3. Create your first paid plan. The application creates the related Stripe Product and recurring Price, then exposes the plan on the public Pricing page.
4. Open the Billing page from a customer workspace and use Stripe test card `4242 4242 4242 4242` to confirm Checkout and the webhook flow.
5. In Stripe, register the production webhook destination as `https://roofmeasur-mi5dwkfb.manus.space/api/stripe/webhook` and select checkout and subscription lifecycle events.
6. When ready for live billing, complete Stripe’s verification process and update the payment configuration through the project’s payment settings rather than committing keys to source control.

## Email Delivery (Pending)

Core email/password sign-up and login are active. Password-reset, welcome-email, and teammate-invitation delivery remain intentionally inactive until an SMTP sender is configured. When SMTP details are available, add them through the project secrets interface as `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`.

## Recommended Pre-Launch Review

Review the pricing copy, create the plans you intend to sell, test new customer signup in a private browser session, verify project isolation between two trial workspaces, and test billing with Stripe’s sandbox before directing customers to the public sign-up page.
