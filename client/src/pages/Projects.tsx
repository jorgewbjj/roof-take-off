import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { Plus, FileText, Trash2, Loader2, LogOut } from "lucide-react";
import { PDFThumbnail } from "@/components/PDFThumbnail";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Projects() {
  const { user, loading: authLoading, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const { data: projects, isLoading } = trpc.projects.list.useQuery(undefined, {
    enabled: !!user,
  });

  const createMutation = trpc.projects.create.useMutation({
    onSuccess: (data) => {
      utils.projects.list.invalidate();
      setIsDialogOpen(false);
      setProjectName("");
      setPdfFile(null);
      toast.success("Project created successfully");
      setLocation(`/project/${data.id}`);
    },
    onError: (error) => {
      toast.error(`Failed to create project: ${error.message}`);
    },
  });

  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      toast.success("Project deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete project: ${error.message}`);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === "application/pdf") {
      setPdfFile(file);
    } else {
      toast.error("Please select a valid PDF file");
    }
  };

  const handleCreateProject = async () => {
    if (!projectName.trim()) {
      toast.error("Please enter a project name");
      return;
    }
    if (!pdfFile) {
      toast.error("Please select a PDF file");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result?.toString().split(",")[1];
      if (base64Data) {
        createMutation.mutate({
          name: projectName,
          pdfFile: {
            data: base64Data,
            filename: pdfFile.name,
            mimeType: pdfFile.type,
          },
        });
      }
    };
    reader.readAsDataURL(pdfFile);
  };

  if (authLoading) {
    return (
      <div className="min-h-dvh bg-background">
        <header className="border-b border-border bg-card">
          <div className="container py-3 flex items-center justify-between gap-2">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-9 w-24" />
          </div>
        </header>
        <main className="container py-5 md:py-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="p-6 space-y-2">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <div className="px-6 pb-6">
                  <Skeleton className="aspect-video w-full rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>Please sign in to access your projects</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <a href={getLoginUrl()}>Sign In</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container py-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">My Projects</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden sm:inline truncate max-w-[140px]">{user.name || user.email}</span>
            <Button variant="outline" size="sm" onClick={() => logout()} className="gap-2">
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-5 md:py-8 pb-safe">
        <div className="flex items-center justify-between mb-6">
          <p className="text-muted-foreground">
            {projects?.length === 0 ? "No projects yet" : `${projects?.length} project${projects?.length === 1 ? "" : "s"}`}
          </p>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Project</DialogTitle>
                <DialogDescription>Upload a PDF roof plan to get started</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Project Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Main Street Building"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pdf">PDF File</Label>
                  <Input
                    id="pdf"
                    type="file"
                    accept="application/pdf"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                  />
                  {pdfFile && (
                    <p className="text-sm text-muted-foreground">Selected: {pdfFile.name}</p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateProject} disabled={createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create Project
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="p-6 space-y-2">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <div className="px-6 pb-6">
                  <Skeleton className="aspect-video w-full rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : projects?.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <FileText className="w-16 h-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No projects yet</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Create your first project to start measuring roof plans
              </p>
              <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Create Project
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {projects?.map((project) => (
              <Card key={project.id} className="hover:shadow-lg transition-shadow cursor-pointer group">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1" onClick={() => setLocation(`/project/${project.id}`)}>
                      <CardTitle className="text-lg group-hover:text-primary transition-colors">
                        {project.name}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Created {new Date(project.createdAt).toLocaleDateString()}
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Are you sure you want to delete this project?")) {
                          deleteMutation.mutate({ id: project.id });
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent onClick={() => setLocation(`/project/${project.id}`)}>
                  <PDFThumbnail 
                    pdfUrl={project.pdfUrl} 
                    className="aspect-video rounded-md overflow-hidden"
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
