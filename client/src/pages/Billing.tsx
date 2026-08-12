import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, CreditCard, ExternalLink } from "lucide-react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

export default function Billing() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();
  const { data: subscription, refetch } = trpc.billing.subscription.useQuery(undefined, { enabled: !!user });
  const { data: plans } = trpc.billing.plans.useQuery();
  const checkout = trpc.billing.checkout.useMutation({ onSuccess: ({ url }) => { window.open(url, "_blank", "noopener,noreferrer"); toast.success("Stripe Checkout opened in a new tab."); }, onError: error => toast.error(error.message) });
  const portal = trpc.billing.portal.useMutation({ onSuccess: ({ url }) => window.open(url, "_blank", "noopener,noreferrer"), onError: error => toast.error(error.message) });
  if (loading || !user) return null;
  const current = subscription?.subscription;
  return <div className="min-h-dvh bg-background"><header className="border-b"><div className="container flex items-center gap-3 py-4"><Button variant="ghost" size="icon" onClick={() => setLocation("/projects")} aria-label="Back to projects"><ArrowLeft className="h-4 w-4" /></Button><div><h1 className="text-xl font-semibold">Billing & subscription</h1><p className="text-sm text-muted-foreground">Manage this workspace’s plan and payment method.</p></div></div></header><main className="container grid max-w-5xl gap-6 py-8 md:grid-cols-[.9fr_1.1fr]"><Card><CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" />Current subscription</CardTitle><CardDescription>Billing is managed securely through Stripe.</CardDescription></CardHeader><CardContent className="space-y-4"><p><span className="text-muted-foreground">Plan: </span><strong>{subscription?.plan.name ?? "Trial"}</strong></p><p><span className="text-muted-foreground">Status: </span><strong className="capitalize">{current?.status ?? "trialing"}</strong></p>{current?.trialEndsAt && <p className="text-sm text-muted-foreground">Trial ends {new Date(current.trialEndsAt).toLocaleDateString()}.</p>}<Button variant="outline" className="gap-2" disabled={portal.isPending || !current?.stripeCustomerId} onClick={() => portal.mutate()}><ExternalLink className="h-4 w-4" />Open billing portal</Button><Button variant="ghost" size="sm" onClick={() => refetch()}>Refresh status</Button></CardContent></Card><div className="space-y-4"><h2 className="text-lg font-semibold">Choose a plan</h2>{plans?.map(plan => <Card key={plan.id}><CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{plan.name}</p><p className="text-sm text-muted-foreground">${(plan.priceCents / 100).toFixed(0)}/{plan.billingInterval} · {plan.maxProjects ?? "Unlimited"} projects · {plan.maxSeats ?? "Unlimited"} seats</p></div><Button disabled={checkout.isPending || !plan.stripePriceId} onClick={() => checkout.mutate({ planId: plan.id })}>{plan.stripePriceId ? "Choose plan" : "Contact us"}</Button></CardContent></Card>)}</div></main></div>;
}
