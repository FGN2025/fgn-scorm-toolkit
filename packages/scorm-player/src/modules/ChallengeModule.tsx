import { useEffect, useState } from 'react';
import type {
  ChallengeModule as ChallengeModuleType,
  ChallengeState,
  ChallengeTask,
} from '../types';
import { RichText } from '../components/RichText';

/**
 * Renders the challenge preview (task list snapshotted from play.fgn.gg
 * at export time), the deep-link launcher with a launch token, and a
 * polling loop that watches for evidence submission status to come back.
 *
 * Source of truth for task completion is play.fgn.gg — the SCORM Player
 * never tries to track per-task state itself. Tasks are shown as a
 * preview so the learner understands the scope before launching.
 *
 * Phase 1.2 v0: launch-token endpoint integration is stubbed — the
 * button opens the challenge URL with a synthetic token appended, and
 * polling is wired but tolerant of the bridge not being live yet.
 * Phase 1.3 lands the real bridge edge function on play.fgn.gg.
 */

const GAME_LABEL: Record<NonNullable<ChallengeModuleType['game']>, string> = {
  ATS: 'American Truck Simulator',
  Farming_Sim: 'Farming Simulator 25',
  Construction_Sim: 'Construction Simulator',
  Mechanic_Sim: 'Car Mechanic Simulator 2021',
  Roadcraft: 'Roadcraft',
  // Fiber_Tech is the FGN/FBA OpTIC Path simulation pathway, not a
  // third-party game — the header references the credential framework
  // rather than a game vendor.
  Fiber_Tech: 'OpTIC Path Simulation',
};

export function ChallengeModule({
  module,
  studentId,
  launchTokenEndpoint,
  state,
  onStateChange,
  onComplete,
}: {
  module: ChallengeModuleType;
  studentId: string;
  launchTokenEndpoint: string | undefined;
  state: ChallengeState | undefined;
  onStateChange: (next: ChallengeState) => void;
  onComplete: (preliminaryScore?: number) => void;
}) {
  const [polling, setPolling] = useState(false);
  const status = state?.status ?? 'pending';

  async function handleLaunch() {
    let token = state?.launchToken;
    if (!token && launchTokenEndpoint) {
      token = await mintLaunchToken(launchTokenEndpoint, {
        challengeId: module.challengeId,
        scormStudentId: studentId,
      });
    }
    if (!token) {
      // Local/preview mode — generate a synthetic token that round-trips locally.
      token = `preview-${crypto.randomUUID()}`;
    }
    onStateChange({
      ...(state ?? { status: 'pending' }),
      launchToken: token,
      status: 'launched',
    });

    const launchUrl = appendLaunchToken(module.challengeUrl, token);
    window.open(launchUrl, '_blank', 'noopener,noreferrer');
    setPolling(true);
  }

  useEffect(() => {
    if (!polling || !launchTokenEndpoint || !state?.launchToken) return;
    // Capture the token in a local so TS can keep the narrowing inside the
    // async closure below (exactOptionalPropertyTypes is strict about it).
    const activeToken = state.launchToken;
    let cancelled = false;
    const interval = window.setInterval(async () => {
      const result = await checkLaunchToken(launchTokenEndpoint, activeToken);
      if (cancelled || !result) return;
      if (result.status === 'completed') {
        const next: ChallengeState = {
          launchToken: activeToken,
          status: 'completed',
          ...(result.preliminaryScore !== undefined
            ? { preliminaryScore: result.preliminaryScore }
            : {}),
        };
        onStateChange(next);
        onComplete(result.preliminaryScore);
        setPolling(false);
        window.clearInterval(interval);
      } else if (result.status === 'failed') {
        onStateChange({
          launchToken: activeToken,
          status: 'failed',
        });
        setPolling(false);
        window.clearInterval(interval);
      }
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [polling, launchTokenEndpoint, state?.launchToken, onComplete, onStateChange]);

  const gameLabel = module.game ? GAME_LABEL[module.game] : 'play.fgn.gg';

  return (
    <article>
      <header className="mb-6">
        <p className="font-heading text-xs uppercase tracking-widest text-muted-foreground">
          Challenge · {gameLabel}
          {module.credentialFramework ? ` · ${module.credentialFramework}` : ''}
        </p>
        <h2 className="mt-2 font-display text-3xl font-bold">{module.title}</h2>
      </header>

      {module.preLaunchHtml && <RichText html={module.preLaunchHtml} className="mb-6" />}

      <section className="mb-6">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          What you'll do ({module.tasks.length} task{module.tasks.length === 1 ? '' : 's'})
        </h3>
        <ol className="mt-3 space-y-3">
          {module.tasks.map((task, idx) => (
            <TaskPreview key={task.id} task={task} index={idx} />
          ))}
        </ol>
      </section>

      <div className="rounded-card border border-border bg-card p-6 shadow-glow-soft">
        <p className="mb-4 text-foreground/90">
          The challenge runs on play.fgn.gg. Click below to launch — evidence upload and rubric
          scoring happen there. When you submit your evidence, return here to continue.
        </p>

        {status === 'pending' && (
          <button
            type="button"
            onClick={handleLaunch}
            className="rounded-button bg-primary px-6 py-3 font-heading text-base font-medium tracking-wide text-primary-foreground shadow-glow-cta transition hover:opacity-90"
          >
            Launch challenge in play.fgn.gg
          </button>
        )}

        {status === 'launched' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Challenge launched in a new tab. Waiting for evidence submission…
            </p>
            <button
              type="button"
              onClick={() => onComplete(state?.preliminaryScore)}
              className="rounded-button border border-border bg-secondary px-4 py-2 font-heading text-sm font-medium tracking-wide text-secondary-foreground hover:bg-muted"
            >
              I've submitted evidence — continue
            </button>
          </div>
        )}

        {status === 'completed' && (
          <p className="text-sm font-medium text-brand-primary">
            ✓ Evidence submitted
            {state?.preliminaryScore !== undefined &&
              ` — preliminary score ${state.preliminaryScore}`}
          </p>
        )}

        {status === 'failed' && (
          <p className="text-sm font-medium text-destructive">
            Challenge attempt did not pass. You can relaunch and try again.
          </p>
        )}
      </div>
    </article>
  );
}

function TaskPreview({ task, index }: { task: ChallengeTask; index: number }) {
  const annotationBadge =
    task.mechanicType === 'annotation' ? (
      <span
        className="ml-2 rounded-full bg-brand-secondary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-secondary"
        title="Uses the FGN annotation model — game environment as visual backdrop, written annotation proves real-world understanding."
      >
        annotation
      </span>
    ) : null;

  return (
    <li className="rounded-card border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-heading text-xs font-semibold text-muted-foreground">
          {index + 1}
        </span>
        <div className="flex-1">
          <p className="font-heading text-base font-semibold tracking-wide">
            {task.title}
            {annotationBadge}
          </p>
          <p className="mt-1 text-sm text-foreground/85">{task.description}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider text-foreground/70">
              Evidence:
            </span>{' '}
            {task.evidenceSpec}
          </p>
        </div>
      </div>
    </li>
  );
}

function appendLaunchToken(url: string, token: string): string {
  const u = new URL(url, window.location.origin);
  u.searchParams.set('fgnLaunchToken', token);
  return u.toString();
}

async function mintLaunchToken(
  endpoint: string,
  payload: { challengeId: string; scormStudentId: string },
): Promise<string | undefined> {
  try {
    const res = await fetch(`${endpoint}/mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { token?: string };
    return data.token;
  } catch {
    return undefined;
  }
}

async function checkLaunchToken(
  endpoint: string,
  token: string,
): Promise<{ status: string; preliminaryScore?: number } | null> {
  try {
    const res = await fetch(`${endpoint}/status?token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    return (await res.json()) as { status: string; preliminaryScore?: number };
  } catch {
    return null;
  }
}
