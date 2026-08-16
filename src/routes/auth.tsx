import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { BrandLogo } from "@/components/admin/BrandLogo";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { title: "Sign in | NUR GOODS Platform" },

      {
        name: "description",
        content:
          "Sign in to the NUR GOODS intelligence and automation platform to access the internal admin console.",
      },
      { property: "og:title", content: "Sign in | NUR GOODS Platform" },
      {
        property: "og:description",
        content: "Secure access to the NUR GOODS internal operations console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/control" });
    });
  }, [navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/control" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }



  async function handleGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Google sign-in failed");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/control" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <BrandLogo size={44} className="mb-3" />
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Internal access to the NUR GOODS platform console.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              Sign in
            </Button>
          </form>
          <Button variant="outline" className="w-full" onClick={handleGoogle}>
            Continue with Google
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Access is limited to approved NUR GOODS team accounts. Contact support@nurgoods.com if
            you need access.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
