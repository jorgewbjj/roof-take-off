import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { Ruler, Upload, Palette, Save, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect } from "react";

export default function Home() {
  const { isAuthenticated, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isAuthenticated && !loading) {
      setLocation("/projects");
    }
  }, [isAuthenticated, loading, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/30 to-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm">
        <div className="container py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ruler className="w-6 h-6 text-primary" />
            <span className="text-xl font-semibold text-foreground">Roof Plan Measurer</span>
          </div>
          <Button asChild>
            <a href={getLoginUrl()}>Sign In</a>
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <main className="container py-20">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <h1 className="text-5xl md:text-6xl font-bold text-foreground tracking-tight">
            Measure Roof Plans with
            <span className="block text-primary mt-2">Precision & Elegance</span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Upload your PDF roof plans, calibrate the scale, and measure areas with interactive drawing tools. 
            Save your projects in the cloud and access them anytime, anywhere.
          </p>

          <div className="flex items-center justify-center gap-4 pt-4">
            <Button size="lg" asChild className="gap-2">
              <a href={getLoginUrl()}>
                Get Started <ArrowRight className="w-4 h-4" />
              </a>
            </Button>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mt-20 max-w-6xl mx-auto">
          <FeatureCard
            icon={<Upload className="w-8 h-8" />}
            title="PDF Upload"
            description="Upload and render PDF roof plans with high-quality canvas rendering"
          />
          <FeatureCard
            icon={<Ruler className="w-8 h-8" />}
            title="Scale Calibration"
            description="Adjust and calibrate measurements to match your plan's scale accurately"
          />
          <FeatureCard
            icon={<Palette className="w-8 h-8" />}
            title="Color Coding"
            description="Assign custom colors and names to different measured areas for clarity"
          />
          <FeatureCard
            icon={<Save className="w-8 h-8" />}
            title="Cloud Storage"
            description="Save all your projects and measurements securely in the cloud"
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-20">
        <div className="container py-8 text-center text-sm text-muted-foreground">
          <p>© 2024 Roof Plan Measurer. Built with precision and care.</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-3 hover:shadow-lg transition-shadow">
      <div className="text-primary">{icon}</div>
      <h3 className="font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
