import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Plus, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function PlatformAdmin() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data: plans } = trpc.platformAdmin.subscriptionPlans.useQuery(undefined, { enabled: !!user?.isPlatformOwner });
  const [form, setForm] = useState({ code: "", name: "", priceCents: "9900", maxProjects: "", maxSeats: "" });
  const createPlan = trpc.platformAdmin.createSubscriptionPlan.useMutation({ onSuccess: async () => { await utils.platformAdmin.subscriptionPlans.invalidate(); setForm({ code: "", name: "", priceCents: "9900", maxProjects: "", maxSeats: "" }); toast.success("Subscription plan created."); }, onError: error => toast.error(error.message) });
  if (loading || !user) return null;
  if (!user.isPlatformOwner) return <div className="grid min-h-dvh place-items-center"><Card><CardContent className="p-8">Platform owner access is required.</CardContent></Card></div>;
  const submit = (event: FormEvent) => { event.preventDefault(); createPlan.mutate({ code: form.code, name: form.name, priceCents: Number(form.priceCents), maxProjects: form.maxProjects ? Number(form.maxProjects) : null, maxSeats: form.maxSeats ? Number(form.maxSeats) : null }); };
  return <div className="min-h-dvh bg-background"><header className="border-b"><div className="container flex items-center gap-3 py-4"><Button variant="ghost" size="icon" onClick={() => setLocation("/projects")}><ArrowLeft className="h-4 w-4" /></Button><ShieldCheck className="h-5 w-5 text-primary" /><h1 className="text-xl font-semibold">Platform administration</h1></div></header><main className="container grid max-w-5xl gap-6 py-8 lg:grid-cols-[.85fr_1.15fr]"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" />Create subscription plan</CardTitle></CardHeader><CardContent><form className="space-y-3" onSubmit={submit}><div className="space-y-1"><Label>Internal code</Label><Input placeholder="pro-monthly" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toLowerCase() })} required /></div><div className="space-y-1"><Label>Plan name</Label><Input placeholder="Pro" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div><div className="space-y-1"><Label>Monthly price (cents)</Label><Input type="number" min="0" value={form.priceCents} onChange={e => setForm({ ...form, priceCents: e.target.value })} required /></div><div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label>Project limit</Label><Input type="number" min="1" placeholder="Unlimited" value={form.maxProjects} onChange={e => setForm({ ...form, maxProjects: e.target.value })} /></div><div className="space-y-1"><Label>Seat limit</Label><Input type="number" min="1" placeholder="Unlimited" value={form.maxSeats} onChange={e => setForm({ ...form, maxSeats: e.target.value })} /></div></div><Button className="w-full" type="submit" disabled={createPlan.isPending}>{createPlan.isPending ? "Creating…" : "Create plan"}</Button></form></CardContent></Card><Card><CardHeader><CardTitle>Plan catalog</CardTitle></CardHeader><CardContent className="space-y-3">{plans?.map(plan => <div key={plan.id} className="rounded-lg border p-4"><div className="flex items-start justify-between"><div><p className="font-semibold">{plan.name}</p><p className="text-xs text-muted-foreground">{plan.code} · {plan.isSystemPlan ? "System plan" : plan.isActive ? "Active" : "Inactive"}</p></div><p className="font-medium">${(plan.priceCents / 100).toFixed(0)}/{plan.billingInterval}</p></div><p className="mt-2 text-sm text-muted-foreground">{plan.maxProjects ?? "Unlimited"} projects · {plan.maxSeats ?? "Unlimited"} seats · {plan.trialDays} day trial</p></div>)}</CardContent></Card></main></div>;
}
