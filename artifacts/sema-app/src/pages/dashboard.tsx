import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowUpRight,
  Clapperboard,
  FolderPlus,
  HeartPulse,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  getListProjectsQueryKey,
  useCreateProject,
  useHealthCheck,
  useListProjects,
} from "@workspace/api-client-react";
import type { ProjectInput, ProjectSummary } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@workspace/replit-auth-web";

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function statusLabel(status: string) {
  return status.replace("_", " ");
}

function ProgressRail({ progress }: { progress: number }) {
  return (
    <div className="h-1.5 overflow-hidden bg-secondary">
      <div
        className="h-full bg-primary transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const needsReview = project.status === "needs_review";
  return (
    <Link
      href={`/projects/${project.projectId}`}
      className="focus-ring group rise-in block border border-border bg-card p-5 shadow-[0_8px_0_hsl(var(--border)/.28)] transition-transform duration-200 hover:-translate-y-1"
      data-testid={`link-project-${project.projectId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">
            {project.projectId}
          </p>
          <h3 className="font-display text-xl font-semibold tracking-[-.03em]">
            {project.title}
          </h3>
        </div>
        <ArrowUpRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
      <div className="mt-7 flex items-center justify-between text-xs text-muted-foreground">
        <span>{project.describerName}</span>
        <span className={needsReview ? "font-semibold text-accent" : ""}>
          {statusLabel(project.status)}
        </span>
      </div>
      <ProgressRail progress={project.progress} />
      <div className="mt-4 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
        <span>
          {project.resolvedCount}/{project.beatCount} beats resolved
        </span>
        <span>{formatDuration(project.duration)}</span>
      </div>
    </Link>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const createProject = useCreateProject();
  const [, navigate] = useLocation();
  const [form, setForm] = useState<ProjectInput>({
    title: "",
    describerName: "",
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || !form.describerName.trim()) return;
    createProject.mutate(
      {
        data: {
          title: form.title.trim(),
          describerName: form.describerName.trim(),
        },
      },
      {
        onSuccess: (project) => {
          queryClient.invalidateQueries({
            queryKey: getListProjectsQueryKey(),
          });
          onClose();
          navigate(`/projects/${project.projectId}`);
        },
      },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md p-0" data-testid="dialog-new-project">
        <form
          onSubmit={submit}
          className="w-full max-w-md border border-border bg-card p-6 shadow-[12px_12px_0_hsl(var(--primary)/.13)]"
        >
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">
                New reel
              </p>
              <DialogTitle className="mt-2 font-display text-2xl font-semibold">
                Start a project
              </DialogTitle>
              <DialogDescription className="mt-2">
                Next, attach your film to begin evidence analysis.
              </DialogDescription>
            </div>
          </div>
          <label className="mb-4 block text-sm font-medium">
            Project title
            <input
              autoFocus
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
              className="focus-ring mt-2 w-full border border-input bg-background px-3 py-2.5 text-sm"
              placeholder="e.g. The Quiet Season"
              data-testid="input-project-title"
            />
          </label>
          <label className="mb-6 block text-sm font-medium">
            Describer
            <input
              value={form.describerName}
              onChange={(event) =>
                setForm({ ...form, describerName: event.target.value })
              }
              className="focus-ring mt-2 w-full border border-input bg-background px-3 py-2.5 text-sm"
              placeholder="Your name"
              data-testid="input-describer-name"
            />
          </label>
          {createProject.isError && (
            <p
              role="alert"
              className="mb-4 text-xs text-destructive"
              data-testid="status-create-error"
            >
              Could not create this project. Try again.
            </p>
          )}
          <button
            disabled={createProject.isPending}
            type="submit"
            className="focus-ring flex w-full items-center justify-center gap-2 bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            data-testid="button-create-project"
          >
            {createProject.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}{" "}
            Create project
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Dashboard() {
  const {
    data: projects,
    isLoading,
    isError,
    refetch,
  } = useListProjects({
    query: {
      queryKey: getListProjectsQueryKey(),
      refetchInterval: (query) =>
        query.state.data?.some((project) => project.status === "processing")
          ? 3000
          : false,
    },
  });
  const { data: health } = useHealthCheck();
  const { user, isAuthenticated, login, logout } = useAuth();
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () =>
      (projects ?? []).filter(
        (project) =>
          project.title.toLowerCase().includes(search.toLowerCase()) ||
          project.describerName.toLowerCase().includes(search.toLowerCase()),
      ),
    [projects, search],
  );
  const reviewCount = (projects ?? []).filter(
    (project) => project.status === "needs_review",
  ).length;
  return (
    <div className="film-grain min-h-[100dvh] bg-background">
      <header className="border-b border-border bg-card/70">
        <div className="mx-auto flex max-w-[1380px] items-center justify-between px-5 py-4 lg:px-10">
          <Link
            href="/"
            className="focus-ring flex items-center gap-3"
            data-testid="link-brand"
          >
            <span className="grid h-8 w-8 place-items-center bg-primary text-primary-foreground">
              <Clapperboard className="h-4 w-4" />
            </span>
            <span className="font-display text-xl font-bold tracking-[-.06em]">
              sema<span className="text-accent">.</span>
            </span>
          </Link>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden items-center gap-2 sm:flex">
              <span
                className={`h-2 w-2 rounded-full ${health?.status === "ok" ? "bg-primary" : "bg-accent"}`}
              />{" "}
              {health?.status === "ok" ? "System ready" : "Checking system"}
            </span>
            <span className="hidden font-mono uppercase tracking-[.12em] md:inline">
              Editorial workspace
            </span>
            {isAuthenticated ? (
              <button
                onClick={logout}
                className="focus-ring border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:border-primary"
                data-testid="button-log-out"
              >
                {user?.firstName || "Log out"}
              </button>
            ) : (
              <button
                onClick={login}
                className="focus-ring border border-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10"
                data-testid="button-log-in"
              >
                Log in
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1380px] px-5 pb-16 pt-10 lg:px-10 lg:pt-16">
        <section className="grid gap-10 border-b border-border pb-12 lg:grid-cols-[1.2fr_.8fr] lg:items-end">
          <div className="rise-in">
            <p className="font-mono text-[11px] uppercase tracking-[.22em] text-primary">
              Audio description / 01
            </p>
            <h1 className="mt-4 max-w-2xl font-display text-5xl font-semibold leading-[.98] tracking-[-.065em] sm:text-7xl">
              Describe what
              <br />
              <span className="text-primary">the frame proves.</span>
            </h1>
            <p className="mt-6 max-w-lg text-sm leading-6 text-muted-foreground">
              A constraint-governed review desk for independent film. Evidence
              first. Timing honest. The final word stays human.
            </p>
          </div>
          <div className="rise-in delay-2 border-l-2 border-accent pl-5">
            <p className="font-mono text-[11px] uppercase tracking-[.16em] text-muted-foreground">
              This desk
            </p>
            <p className="mt-3 font-display text-2xl leading-tight">
              No prose leaves the room without a reason, a window, and a
              reviewer.
            </p>
            <div className="mt-7 flex gap-8">
              <div>
                <p className="font-mono text-2xl text-primary">
                  {projects?.length ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">projects</p>
              </div>
              <div>
                <p className="font-mono text-2xl text-accent">{reviewCount}</p>
                <p className="text-xs text-muted-foreground">ready to review</p>
              </div>
            </div>
          </div>
        </section>
        <section className="pt-9">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">
                Your slate
              </p>
              <h2 className="mt-1 font-display text-2xl font-semibold">
                Projects
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <label className="relative hidden sm:block">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search projects"
                  className="focus-ring w-56 border border-input bg-card py-2 pl-9 pr-3 text-xs"
                  placeholder="Search slate"
                  data-testid="input-search-projects"
                />
              </label>
              <button
                onClick={() => (isAuthenticated ? setShowNew(true) : login())}
                className="focus-ring flex items-center gap-2 bg-accent px-3.5 py-2.5 text-xs font-bold text-accent-foreground transition-transform hover:-translate-y-0.5"
                data-testid="button-new-project"
              >
                <FolderPlus className="h-4 w-4" />{" "}
                {isAuthenticated ? "New project" : "Log in to create"}
              </button>
            </div>
          </div>
          {isLoading && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3].map((item) => (
                <div key={item} className="skeleton h-48" />
              ))}
            </div>
          )}
          {isError && (
            <div
              className="flex items-center justify-between border border-destructive/30 bg-destructive/5 p-5"
              data-testid="status-projects-error"
            >
              <div>
                <p className="font-semibold">The slate could not be loaded.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your projects are safe. Reconnect and try again.
                </p>
              </div>
              <button
                onClick={() => refetch()}
                className="focus-ring flex items-center gap-2 border border-border bg-card px-3 py-2 text-xs font-semibold"
                data-testid="button-retry-projects"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          )}
          {!isLoading && !isError && filtered.length === 0 && (
            <div
              className="border border-dashed border-border px-6 py-16 text-center"
              data-testid="empty-projects"
            >
              <HeartPulse className="mx-auto h-8 w-8 text-primary" />
              <p className="mt-4 font-display text-xl font-semibold">
                {search ? "No matching projects" : "Your slate is quiet"}
              </p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                {search
                  ? "Try a different title or describer."
                  : "Start with a film and give the work a place to land."}
              </p>
              {!search && (
                <button
                  onClick={() => (isAuthenticated ? setShowNew(true) : login())}
                  className="focus-ring mt-6 bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                  data-testid="button-empty-new-project"
                >
                  {isAuthenticated ? "Start a project" : "Log in to start"}
                </button>
              )}
            </div>
          )}
          {!isLoading && !isError && filtered.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((project) => (
                <ProjectCard key={project.projectId} project={project} />
              ))}
            </div>
          )}
        </section>
      </main>
      {showNew && <NewProjectDialog onClose={() => setShowNew(false)} />}
    </div>
  );
}
