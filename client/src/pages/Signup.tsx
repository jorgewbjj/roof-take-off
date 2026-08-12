import { AuthLayout } from "./Login";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { ArrowRight, Check } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

export default function Signup() {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signup = trpc.auth.signup.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      toast.success("Your 14-day trial is ready.");
      setLocation("/projects");
    },
    onError: error => toast.error(error.message),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    signup.mutate({ name, organizationName, email, password });
  };
  return <AuthLayout title="Start your free trial" description="Create a secure workspace. No credit card required for 14 days.">
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="name">Your name</Label><Input id="name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="company">Company name</Label><Input id="company" value={organizationName} onChange={e => setOrganizationName(e.target.value)} required /></div></div>
      <div className="space-y-1.5"><Label htmlFor="signup-email">Work email</Label><Input id="signup-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
      <div className="space-y-1.5"><Label htmlFor="signup-password">Password</Label><Input id="signup-password" type="password" autoComplete="new-password" minLength={12} value={password} onChange={e => setPassword(e.target.value)} required /><p className="text-xs text-muted-foreground">At least 12 characters with upper/lowercase letters and a number.</p></div>
      <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground"><p className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><Check className="h-3.5 w-3.5 text-emerald-600" />14 days free, no card required</p><p>Measure, annotate, export, and organize commercial roof plans from day one.</p></div>
      <Button type="submit" className="w-full gap-2" disabled={signup.isPending}>{signup.isPending ? "Creating workspace…" : <>Create workspace <ArrowRight className="h-4 w-4" /></>}</Button>
    </form>
    <p className="mt-5 text-center text-sm text-muted-foreground">Already have an account? <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link></p>
  </AuthLayout>;
}
