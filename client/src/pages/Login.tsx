import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { ArrowRight, Ruler } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

export default function Login() {
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      setLocation("/projects");
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (isAuthenticated && !loading) setLocation("/projects");
  }, [isAuthenticated, loading, setLocation]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ email, password });
  };

  return <AuthLayout title="Welcome back" description="Sign in to your roofing takeoff workspace.">
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="email">Work email</Label><Input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
      <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
      <Button type="submit" className="w-full gap-2" disabled={login.isPending}>{login.isPending ? "Signing in…" : <>Sign in <ArrowRight className="h-4 w-4" /></>}</Button>
    </form>
    <p className="mt-6 text-center text-sm text-muted-foreground">New to Roof Plan Measurer? <Link href="/signup" className="font-medium text-primary hover:underline">Start your 14-day trial</Link></p>
  </AuthLayout>;
}

export function AuthLayout({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="min-h-dvh bg-gradient-to-br from-slate-950 via-slate-900 to-primary/70 px-4 py-8 sm:flex sm:items-center sm:justify-center">
    <Card className="mx-auto w-full max-w-md border-white/10 bg-background/95 shadow-2xl backdrop-blur">
      <CardHeader className="space-y-3 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Ruler className="h-6 w-6" /></div><CardTitle className="text-2xl">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  </div>;
}
