import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Download,
  Film,
  Flag,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  Send,
  ShieldCheck,
  SkipForward,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import {
  getGetProjectQueryKey,
  getGetProjectReviewQueryKey,
  useAttachProjectMedia,
  useExportProject,
  useGetProjectReview,
  useRequestUploadUrl,
  useRetryProjectProcessing,
  useUpdateBeatDecision,
} from "@workspace/api-client-react";
import type {
  DecisionInputAction,
  DescriptionCandidate,
  Project,
  VisualBeat,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";

function timecode(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function stateTone(state: string) {
  if (state === "approved" || state === "human_edited") return "text-primary";
  if (state === "needs_human") return "text-accent";
  return "text-muted-foreground";
}

function BeatRow({
  beat,
  active,
  onClick,
}: {
  beat: VisualBeat;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`focus-ring grid w-full grid-cols-[62px_1fr_10px] gap-3 border-b border-border px-4 py-3 text-left transition-colors ${active ? "bg-primary/10" : "hover:bg-muted/60"}`}
      data-testid={`button-beat-${beat.beatId}`}
    >
      <span className="font-mono text-[10px] text-muted-foreground">
        {timecode(beat.start)}
      </span>
      <span>
        <span className="line-clamp-2 text-xs leading-5">{beat.summary}</span>
        <span
          className={`mt-1 block text-[10px] font-mono uppercase tracking-[.12em] ${stateTone(beat.state)}`}
        >
          {beat.state.replaceAll("_", " ")}
        </span>
      </span>
      <span
        className={`mt-1 h-2 w-2 rounded-full ${beat.state === "approved" || beat.state === "human_edited" ? "bg-primary" : beat.state === "needs_human" ? "bg-accent" : "bg-border"}`}
      />
    </button>
  );
}

function EvidenceFrame({ src, index }: { src: string; index: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure
      className="relative aspect-video overflow-hidden bg-secondary"
      data-testid={`frame-evidence-${index}`}
    >
      {failed ? (
        <p className="grid h-full place-items-center p-3 text-center text-xs text-muted-foreground">
          Evidence image unavailable
        </p>
      ) : (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="focus-ring block h-full"
        >
          <img
            src={src}
            alt={`Extracted visual evidence, frame ${index + 1}. Open full image.`}
            loading="lazy"
            className="h-full w-full object-contain"
            onError={() => setFailed(true)}
          />
        </a>
      )}
      <figcaption className="absolute bottom-2 left-2 bg-foreground/90 px-1.5 py-1 font-mono text-[10px] text-background">
        Frame {index + 1}
      </figcaption>
    </figure>
  );
}

function EvidencePlayer({
  project,
  beat,
}: {
  project: Project;
  beat?: VisualBeat;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (videoRef.current && beat) {
      videoRef.current.pause();
      videoRef.current.currentTime = beat.start;
    }
  }, [beat?.beatId, beat?.start]);
  return (
    <div className="border-b border-border">
      {project.mediaObjectPath ? (
        <video
          ref={videoRef}
          src={`/api/storage${project.mediaObjectPath}`}
          controls
          preload="metadata"
          aria-label="Source film, synchronized to selected visual beat"
          className="aspect-video w-full bg-black"
          onLoadedMetadata={() => {
            if (videoRef.current && beat)
              videoRef.current.currentTime = beat.start;
          }}
          onError={() => setError(true)}
          data-testid="video-source-media"
        />
      ) : (
        <div className="grid aspect-video place-items-center bg-secondary p-8 text-center">
          <div>
            <Film className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-3 font-semibold">
              {project.projectId === "demo-project"
                ? "Illustrative review workspace"
                : "Your film belongs here"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {project.projectId === "demo-project"
                ? "Sample decisions demonstrate the workflow. Start your own project to analyze a real film."
                : "Attach a source video below to extract evidence and generate narration."}
            </p>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="p-3 text-sm text-destructive">
          Source playback failed. Check your session and reload the project.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-secondary/30 px-5 py-3">
        <p className="text-xs text-muted-foreground">
          Selecting a beat seeks the source film to its evidence.
        </p>
        <span className="font-mono text-xs">
          {beat
            ? `${timecode(beat.start)} → ${timecode(beat.end)}`
            : "Awaiting analysis"}
        </span>
      </div>
    </div>
  );
}

function NarrationPreview({
  projectId,
  candidate,
}: {
  projectId: string;
  candidate: DescriptionCandidate;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="border-t border-border px-5 py-4">
      <p className="mb-2 text-xs font-semibold">
        Listen to the measured narration
      </p>
      <audio
        controls
        preload="none"
        src={`/api/projects/${projectId}/candidates/${candidate.candidateId}/audio`}
        aria-label="Candidate narration preview"
        className="w-full"
        onError={() => setFailed(true)}
      />
      {failed && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Narration audio could not be loaded. Refresh the workspace and try
          again.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {candidate.ttsDuration.toFixed(2)} seconds rendered ·{" "}
        {candidate.availableDuration.toFixed(2)} seconds available
      </p>
    </div>
  );
}

function StageRail({
  stages,
}: {
  stages: { name: string; label: string; status: string }[];
}) {
  return (
    <div className="min-w-0 flex-1 overflow-x-auto">
      <div className="flex min-w-max items-center gap-1">
        {stages.map((stage, index) => (
          <div key={stage.name} className="flex min-w-max items-center gap-2">
            <div
              className={`grid h-6 w-6 place-items-center rounded-full border ${stage.status === "complete" ? "border-primary bg-primary text-primary-foreground" : stage.status === "active" ? "border-accent text-accent" : stage.status === "failed" ? "border-destructive text-destructive" : "border-border text-muted-foreground"}`}
            >
              {stage.status === "complete" ? (
                <Check className="h-3 w-3" />
              ) : stage.status === "failed" ? (
                <X className="h-3 w-3" />
              ) : (
                <span className="font-mono text-[9px]">{index + 1}</span>
              )}
            </div>
            <span
              className={`text-[10px] uppercase tracking-[.1em] ${stage.status === "active" ? "font-semibold text-foreground" : "text-muted-foreground"}`}
            >
              {stage.label}
            </span>
            {index < stages.length - 1 && (
              <div className="mx-1 h-px w-6 bg-border" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  selected,
  onSelect,
}: {
  candidate: DescriptionCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`focus-ring w-full border p-4 text-left transition-all ${selected ? "border-primary bg-primary/5 shadow-[4px_4px_0_hsl(var(--primary)/.14)]" : "border-border bg-card hover:border-primary/50"}`}
      data-testid={`button-candidate-${candidate.candidateId}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">
          Attempt {candidate.attempt} · {candidate.fitStatus}
        </span>
        <span
          className={`font-mono text-[10px] ${candidate.fitStatus === "pass" ? "text-primary" : "text-accent"}`}
        >
          {candidate.ttsDuration.toFixed(1)}s /{" "}
          {candidate.availableDuration.toFixed(1)}s
        </span>
      </div>
      <p className="mt-3 text-sm leading-6">{candidate.text}</p>
      {candidate.languageFlags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {candidate.languageFlags.map((flag) => (
            <span
              key={flag}
              className="border border-accent/30 bg-accent/10 px-1.5 py-1 text-[10px] text-accent"
            >
              {flag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function MediaAssetCard({
  project,
  projectId,
  onAttached,
}: {
  project: Project;
  projectId: string;
  onAttached: () => void;
}) {
  const { isAuthenticated, login } = useAuth();
  const requestUpload = useRequestUploadUrl();
  const attachMedia = useAttachProjectMedia();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    const isMov = /\.(mov|qt)$/i.test(file.name);
    const contentType = file.type.startsWith("video/")
      ? file.type
      : isMov
        ? "video/quicktime"
        : "";
    if (!contentType) {
      setStatus(
        "Choose a video file. MOV, MP4, M4V, and WebM are supported.",
      );
      return;
    }
    if (file.size <= 0) {
      setStatus("The selected video is empty.");
      return;
    }
    if (file.size > 1024 * 1024 * 1024) {
      setStatus(
        `This video is ${(file.size / 1024 / 1024).toFixed(1)} MB. Sema accepts source videos up to 1 GB. Compress or trim it, then try again.`,
      );
      return;
    }
    setUploading(true);
    setStatus("Preparing upload…");
    try {
      const duration = await new Promise<number>((resolve) => {
        const video = document.createElement("video");
        const url = URL.createObjectURL(file);
        video.preload = "metadata";
        video.onloadedmetadata = () => {
          URL.revokeObjectURL(url);
          resolve(Number.isFinite(video.duration) ? video.duration : 0);
        };
        video.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(0);
        };
        video.src = url;
      });
      const uploadTarget = await requestUpload.mutateAsync({
        data: { name: file.name, size: file.size, contentType },
      });
      const response = await fetch(uploadTarget.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!response.ok) {
        throw new Error(
          `Storage rejected the upload (HTTP ${response.status}). Try again.`,
        );
      }
      await attachMedia.mutateAsync({
        projectId,
        data: {
          objectPath: uploadTarget.objectPath,
          name: file.name,
          size: file.size,
          contentType,
          duration,
        },
      });
      setStatus(
        "Source attached. Analysis is running; results will appear automatically.",
      );
      onAttached();
    } catch (error) {
      const apiMessage =
        error &&
        typeof error === "object" &&
        "data" in error &&
        error.data &&
        typeof error.data === "object" &&
        "error" in error.data &&
        typeof error.data.error === "string"
          ? error.data.error
          : null;
      setStatus(
        apiMessage ??
          (error instanceof Error
            ? error.message
            : "Source upload failed. Try again."),
      );
    } finally {
      setUploading(false);
    }
  };

  if (project.mediaObjectPath) {
    return (
      <section className="mt-5 border border-border bg-card p-4 lg:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">
              Source media
            </p>
            <p className="mt-1 text-sm font-semibold">
              {project.mediaFileName}
            </p>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">
            {timecode(project.duration)}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Playback is private to the signed-in project owner.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-5 border border-dashed border-border bg-card p-5">
      <p className="font-mono text-[10px] uppercase tracking-[.16em] text-accent">
        Source media required
      </p>
      <h2 className="mt-2 font-display text-xl font-semibold">
        Attach the film before evidence review
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        Upload a short video to analyze visual evidence, protect spoken
        dialogue, and render timed narration for your review.
      </p>
      {!isAuthenticated ? (
        <button
          onClick={login}
          className="focus-ring mt-4 bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"
          data-testid="button-login-for-media"
        >
          Log in to attach source
        </button>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="video/*,.mov,.qt"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
            data-testid="input-source-video"
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="focus-ring mt-4 bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            data-testid="button-attach-source"
          >
            {uploading ? "Uploading…" : "Choose source video"}
          </button>
        </>
      )}
      {status && (
        <p
          className="mt-3 text-xs text-muted-foreground"
          role="status"
          data-testid="status-media-upload"
        >
          {status}
        </p>
      )}
    </section>
  );
}

function ProcessingEvidence({
  projectId,
  processing,
}: {
  projectId: string;
  processing: boolean;
}) {
  const { data, isError } = useQuery<{
    events: {
      eventId: string;
      stage: string;
      event: string;
      createdAt: string;
      details: Record<string, string | number | boolean>;
    }[];
    protectedIntervals: { start: number; end: number }[];
  }>({
    queryKey: ["processing-evidence", projectId],
    queryFn: async () => {
      const response = await fetch(
        `/api/projects/${projectId}/processing-trace`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Trace unavailable");
      return response.json();
    },
    refetchInterval: processing ? 2000 : false,
  });
  return (
    <details className="mt-5 border border-border bg-card p-5">
      <summary className="focus-ring cursor-pointer font-semibold">
        Processing evidence & protected dialogue
      </summary>
      {isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Processing evidence could not be loaded.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            {data?.events.length ?? 0} recorded execution events ·{" "}
            {data?.protectedIntervals.length ?? 0} protected dialogue intervals
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data?.protectedIntervals.map((interval, index) => (
              <span
                key={index}
                className="border border-accent/30 px-2 py-1 font-mono text-xs"
              >
                {timecode(interval.start)}–{timecode(interval.end)} · dialogue
              </span>
            ))}
          </div>
          <ol className="mt-4 max-h-80 space-y-3 overflow-y-auto">
            {data?.events.map((event) => (
              <li
                key={event.eventId}
                className="border-l-2 border-primary/30 pl-3 text-xs"
              >
                <p className="font-semibold">
                  {event.stage.replaceAll("_", " ")} ·{" "}
                  {event.event.replaceAll("_", " ")}
                </p>
                <time className="text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString()}
                </time>
                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  {Object.entries(event.details).map(([key, value]) => (
                    <div key={key}>
                      <dt className="inline">{key.replaceAll("_", " ")}: </dt>
                      <dd className="inline break-all">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ol>
        </>
      )}
    </details>
  );
}

function ExportDownloads({ projectId }: { projectId: string }) {
  const files = [
    "sema-narration.wav",
    "sema-ad.webvtt",
    "sema-ad.txt",
    "sema-decision-ledger.json",
    "sema-production-summary.txt",
  ];
  return (
    <section className="mt-5 border border-primary/30 bg-primary/5 p-5">
      <p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">
        Authorized export
      </p>
      <h2 className="mt-2 font-display text-xl font-semibold">
        Download the production files
      </h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {files.map((file) => (
          <a
            key={file}
            href={`/api/projects/${projectId}/export/${file}`}
            download
            className="focus-ring border border-primary/40 bg-card px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10"
          >
            {file}
          </a>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        The isolated narration WAV places approved speech at its verified time.
        Keep it alongside the original soundtrack when mixing.
      </p>
    </section>
  );
}

export function Review() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const {
    data: workspace,
    isLoading,
    isError,
    refetch,
  } = useGetProjectReview(projectId, {
    query: {
      queryKey: getGetProjectReviewQueryKey(projectId),
      refetchInterval: (query) =>
        query.state.data?.project.status === "processing" ? 2000 : false,
    },
  });
  const updateDecision = useUpdateBeatDecision();
  const retryProcessing = useRetryProjectProcessing();
  const exportProject = useExportProject();
  const [activeBeatId, setActiveBeatId] = useState("");
  const { user } = useAuth();
  const reviewer = user?.firstName || "Signed-in reviewer";
  const isDemo = projectId === "demo-project";
  const [editedText, setEditedText] = useState<string | null>(null);
  const [showStages, setShowStages] = useState(false);
  const [notice, setNotice] = useState("");
  const [exportReady, setExportReady] = useState(false);
  const beat = useMemo(
    () =>
      workspace?.beats.find(
        (item) => item.beatId === (activeBeatId || workspace.beats[0]?.beatId),
      ),
    [workspace, activeBeatId],
  );
  const candidates = useMemo(
    () =>
      workspace?.candidates.filter(
        (candidate) => candidate.beatId === beat?.beatId,
      ) ?? [],
    [workspace, beat],
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const selectedCandidate =
    candidates.find(
      (candidate) => candidate.candidateId === selectedCandidateId,
    ) ?? candidates[0];
  const activeDecision = workspace?.decisions.find(
    (decision) => decision.beatId === beat?.beatId,
  );
  const chooseBeat = (id: string) => {
    setActiveBeatId(id);
    setSelectedCandidateId("");
    setEditedText(null);
    setNotice("");
  };
  const decide = (action: DecisionInputAction) => {
    if (!beat || isDemo) return;
    updateDecision.mutate(
      {
        projectId,
        beatId: beat.beatId,
        data: {
          action,
          reviewer: reviewer.trim(),
          candidateId: selectedCandidate?.candidateId,
          finalText: editedText?.trim() ?? selectedCandidate?.text,
        },
      },
      {
        onSuccess: () => {
          setExportReady(false);
          setEditedText(null);
          setNotice(
            action === "approve" || action === "human_edited_approve"
              ? "Decision authorized for export."
              : "Decision recorded.",
          );
          queryClient.invalidateQueries({
            queryKey: getGetProjectReviewQueryKey(projectId),
          });
          queryClient.invalidateQueries({
            queryKey: getGetProjectQueryKey(projectId),
          });
        },
        onError: () => {
          setNotice(
            "Approval could not complete. The narration must render successfully and fit outside protected dialogue. Review the wording and retry.",
          );
        },
      },
    );
  };
  const retry = () =>
    retryProcessing.mutate(
      { projectId, data: { stage: workspace?.process.currentStage } },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: getGetProjectReviewQueryKey(projectId),
          }),
        onError: () =>
          setNotice(
            "Processing could not restart. Check the provider setup and try again.",
          ),
      },
    );
  const exportBundle = () =>
    exportProject.mutate(
      { projectId },
      {
        onSuccess: (bundle) => {
          setExportReady(true);
          setNotice(
            `${bundle.approvedCount} approved descriptions packaged. Your timed narration WAV and review records are ready.`,
          );
          queryClient.invalidateQueries({
            queryKey: getGetProjectReviewQueryKey(projectId),
          });
          queryClient.invalidateQueries({
            queryKey: getGetProjectQueryKey(projectId),
          });
        },
        onError: () =>
          setNotice(
            "Export could not be verified. Review the approved narration and try again.",
          ),
      },
    );
  if (isLoading)
    return (
      <div className="min-h-[100dvh] bg-background p-6">
        <div className="mx-auto max-w-[1500px]">
          <div className="skeleton h-10 w-64" />
          <div className="mt-8 grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)_300px] xl:grid-cols-[265px_minmax(0,1fr)_380px]">
            <div className="skeleton h-[600px]" />
            <div className="skeleton h-[600px]" />
            <div className="skeleton h-[600px]" />
          </div>
        </div>
      </div>
    );
  if (isError || !workspace)
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-background p-6">
        <div className="max-w-md border border-destructive/30 bg-card p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
          <h1 className="mt-4 font-display text-2xl font-semibold">
            Review workspace unavailable
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The project may still be processing, or this link has expired.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <button
              onClick={() => refetch()}
              className="focus-ring bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
              data-testid="button-retry-workspace"
            >
              Retry workspace
            </button>
            <Link
              href="/"
              className="focus-ring border border-border px-4 py-2.5 text-sm font-semibold"
              data-testid="link-back-from-error"
            >
              Back to projects
            </Link>
          </div>
        </div>
      </div>
    );
  const processFailed = workspace.process.status === "failed";
  return (
    <div className="film-grain min-h-[100dvh] bg-background">
      {isDemo && (
        <div
          role="status"
          className="border-b border-accent/30 bg-accent/10 px-5 py-3 text-center text-sm"
        >
          Sample workspace · illustrative evidence and timings · read-only.
          Create a project to process your own film.
        </div>
      )}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              href="/"
              aria-label="Back to projects"
              className="focus-ring shrink-0 text-muted-foreground hover:text-foreground"
              data-testid="link-back-projects"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="h-5 w-px shrink-0 bg-border" />
            <div className="min-w-0">
              <p className="truncate font-mono text-[10px] uppercase tracking-[.15em] text-primary">
                {workspace.project.projectId} / review
              </p>
              <h1 className="truncate font-display text-lg font-semibold">
                {workspace.project.title}
              </h1>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <StageRail stages={workspace.process.stages} />
            <button
              onClick={() => setShowStages(!showStages)}
              className="focus-ring shrink-0 p-1 text-muted-foreground lg:hidden"
              aria-label="Toggle process stages"
              data-testid="button-toggle-stages"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-xs text-muted-foreground md:inline">
              Describer: {workspace.project.describerName}
            </span>
            <button
              onClick={exportBundle}
              disabled={
                isDemo ||
                exportProject.isPending ||
                workspace.decisions.filter(
                  (decision) => decision.exportAuthorized,
                ).length === 0
              }
              className="focus-ring flex items-center gap-2 bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="button-export-project"
            >
              {exportProject.isPending ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}{" "}
              Export authorized
            </button>
          </div>
        </div>
        {showStages && (
          <div className="border-t border-border px-4 py-3 lg:hidden">
            <StageRail stages={workspace.process.stages} />
          </div>
        )}
      </header>
      {!isDemo && !workspace.project.mediaObjectPath && (
        <div
          role="status"
          data-testid="status-awaiting-media"
          className="border-b border-accent/30 bg-accent/10 p-3 text-center text-sm"
        >
          Upload your film below to begin analysis
        </div>
      )}
      {workspace.project.mediaObjectPath &&
        workspace.project.status === "processing" && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 border-b border-primary/30 bg-primary/5 p-3 text-sm"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" /> Analyzing your film
          · {workspace.process.currentStage.replaceAll("_", " ")} · this
          workspace updates automatically
        </div>
        )}
      {processFailed && (
        <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2.5">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Processing stopped at{" "}
              {workspace.process.currentStage}.
            </span>
            <button
              onClick={retry}
              disabled={isDemo || retryProcessing.isPending}
              className="focus-ring flex items-center gap-2 border border-destructive/30 px-2.5 py-1.5 font-semibold text-destructive"
              data-testid="button-retry-processing"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Retry stage
            </button>
          </div>
        </div>
      )}
      <main className="mx-auto max-w-[1500px] p-4 lg:p-6">
        <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)_300px] xl:grid-cols-[265px_minmax(0,1fr)_380px]">
          <aside className="border border-border bg-card lg:max-h-[calc(100dvh-130px)] lg:overflow-y-auto">
            <div className="border-b border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                    Visual beats
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {workspace.beats.length} moments /{" "}
                    {workspace.decisions.length} decided
                  </p>
                </div>
                <Film className="h-4 w-4 text-primary" />
              </div>
              <div className="mt-4 h-1 bg-secondary">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${workspace.project.progress}%` }}
                />
              </div>
            </div>
            <div>
              {workspace.beats.map((item) => (
                <BeatRow
                  key={item.beatId}
                  beat={item}
                  active={item.beatId === beat?.beatId}
                  onClick={() => chooseBeat(item.beatId)}
                />
              ))}
            </div>
          </aside>
          <section className="min-w-0 border border-border bg-card">
            <EvidencePlayer project={workspace.project} beat={beat} />
            <div className="p-5 lg:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">
                    Beat {beat?.beatId}
                  </p>
                  <h2 className="mt-2 max-w-2xl font-display text-2xl font-semibold leading-tight tracking-[-.03em]">
                    {beat?.summary}
                  </h2>
                </div>
                <span
                  className={`border border-current px-2 py-1 font-mono text-[10px] uppercase tracking-[.13em] ${stateTone(beat?.state ?? "")}`}
                >
                  {beat?.state.replaceAll("_", " ")}
                </span>
              </div>
              <div className="mt-6 grid gap-5 border-y border-border py-5 sm:grid-cols-2">
                <div>
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">
                    <Flag className="h-3.5 w-3.5 text-accent" /> Why it matters
                  </p>
                  <p className="mt-2 text-sm leading-6">{beat?.reason}</p>
                </div>
                <div>
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">
                    <Circle className="h-3.5 w-3.5 text-primary" /> Observed
                    evidence
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {beat?.characters.map((item) => (
                      <span
                        key={item}
                        className="bg-secondary px-2 py-1 text-xs"
                      >
                        {item}
                      </span>
                    ))}
                    {beat?.objects.map((item) => (
                      <span
                        key={item}
                        className="bg-secondary px-2 py-1 text-xs"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Evidence
                    frames
                  </p>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {beat?.evidenceFrames.length ?? 0} frames
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {!isDemo &&
                    beat?.evidenceFrames.map((src, index) => (
                      <EvidenceFrame
                        key={`${src}-${index}`}
                        src={src}
                        index={index}
                      />
                    ))}
                </div>
                {isDemo && (
                  <p className="text-xs text-muted-foreground">
                    Sample evidence is illustrative. Extracted frames appear
                    here for your own film.
                  </p>
                )}
              </div>
            </div>
          </section>
          <aside className="border border-border bg-card">
            <div className="border-b border-border p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[.18em] text-accent">
                    Human gate
                  </p>
                  <h2 className="mt-1 font-display text-xl font-semibold">
                    Candidate review
                  </h2>
                </div>
                <LockKeyhole className="h-5 w-5 text-primary" />
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Candidates are suggestions only. Authorization is a human
                action.
              </p>
            </div>
            <div className="space-y-3 p-4">
              {candidates.length > 0 ? (
                candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.candidateId}
                    candidate={candidate}
                    selected={
                      candidate.candidateId ===
                      (selectedCandidate?.candidateId ?? "")
                    }
                    onSelect={() => {
                      setSelectedCandidateId(candidate.candidateId);
                      setEditedText(candidate.text);
                    }}
                  />
                ))
              ) : (
                <div className="border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No candidate is available yet. Processing will populate this
                  panel, or you can record an intentional omission.
                </div>
              )}
            </div>
            {!isDemo && selectedCandidate?.fitStatus === "pass" && (
              <NarrationPreview
                key={`${selectedCandidate.candidateId}-${selectedCandidate.attempt}`}
                projectId={projectId}
                candidate={selectedCandidate}
              />
            )}
            <div className="border-t border-border p-5">
              <label className="block text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">
                Final wording{" "}
                <textarea
                  readOnly={isDemo}
                  value={editedText ?? selectedCandidate?.text ?? ""}
                  onChange={(event) => setEditedText(event.target.value)}
                  rows={4}
                  className="focus-ring mt-2 w-full resize-y border border-input bg-background p-3 text-sm leading-5"
                  placeholder="Choose a candidate or write the authorized description."
                  data-testid="textarea-final-wording"
                />
              </label>
              <label className="mt-4 block text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">
                Reviewer
                <input
                  value={reviewer}
                  readOnly
                  className="focus-ring mt-2 w-full border border-input bg-background px-3 py-2 text-sm font-normal"
                  data-testid="input-reviewer"
                />
              </label>
              {notice && (
                <p
                  className="mt-4 flex items-center gap-2 bg-primary/10 p-2.5 text-xs text-primary"
                  role="status"
                  data-testid="status-decision-notice"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {notice}
                </p>
              )}
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  onClick={() => decide("approve")}
                  disabled={
                    isDemo ||
                    updateDecision.isPending ||
                    !selectedCandidate ||
                    selectedCandidate.fitStatus !== "pass" ||
                    (editedText !== null &&
                      editedText.trim() !== selectedCandidate.text)
                  }
                  className="focus-ring col-span-2 flex items-center justify-center gap-2 bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-40"
                  data-testid="button-approve-description"
                >
                  {updateDecision.isPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}{" "}
                  Approve for export
                </button>
                <button
                  onClick={() => decide("human_edited_approve")}
                  disabled={
                    isDemo ||
                    updateDecision.isPending ||
                    !editedText?.trim() ||
                    !selectedCandidate
                  }
                  className="focus-ring flex items-center justify-center gap-2 border border-primary px-3 py-2.5 text-xs font-semibold text-primary disabled:opacity-40"
                  data-testid="button-approve-edited"
                >
                  <Send className="h-3.5 w-3.5" /> Render & approve edit
                </button>
                <button
                  onClick={() => decide("reject")}
                  disabled={isDemo || updateDecision.isPending}
                  className="focus-ring flex items-center justify-center gap-2 border border-border px-3 py-2.5 text-xs font-semibold hover:border-destructive hover:text-destructive"
                  data-testid="button-reject-description"
                >
                  <X className="h-3.5 w-3.5" /> Reject
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => decide("left_undescribed")}
                  disabled={isDemo || updateDecision.isPending}
                  className="focus-ring flex items-center justify-center gap-1.5 border border-border px-2 py-2 text-[10px] text-muted-foreground"
                  data-testid="button-leave-undescribed"
                >
                  <SkipForward className="h-3.5 w-3.5" /> Leave undescribed
                </button>
                <button
                  onClick={() => decide("no_safe_placement")}
                  disabled={isDemo || updateDecision.isPending}
                  className="focus-ring flex items-center justify-center gap-1.5 border border-border px-2 py-2 text-[10px] text-muted-foreground"
                  data-testid="button-no-safe-placement"
                >
                  <Clock3 className="h-3.5 w-3.5" /> No safe placement
                </button>
              </div>
            </div>
            <div className="border-t border-border bg-secondary/30 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <UserRound className="h-3.5 w-3.5 text-primary" />{" "}
                {activeDecision
                  ? `Last decision by ${activeDecision.reviewer}`
                  : "Awaiting human decision"}
              </div>
              {activeDecision && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {activeDecision.action.replaceAll("_", " ")} ·{" "}
                  {new Date(activeDecision.updatedAt).toLocaleString()}
                </p>
              )}
            </div>
          </aside>
        </div>
        {!isDemo && (
          <MediaAssetCard
            project={workspace.project}
            projectId={projectId}
            onAttached={() => {
              queryClient.invalidateQueries({
                queryKey: getGetProjectReviewQueryKey(projectId),
              });
              queryClient.invalidateQueries({
                queryKey: getGetProjectQueryKey(projectId),
              });
            }}
          />
        )}
        {!isDemo && (
          <ProcessingEvidence
            projectId={projectId}
            processing={
              Boolean(workspace.project.mediaObjectPath) &&
              workspace.project.status === "processing"
            }
          />
        )}
        {(exportReady || workspace.project.status === "exported") && (
          <ExportDownloads projectId={projectId} />
        )}
      </main>
    </div>
  );
}
