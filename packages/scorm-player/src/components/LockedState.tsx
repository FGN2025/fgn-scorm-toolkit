import type { BrandMode } from '@fgn/brand-tokens';
import type { WorkOrderCheckResult } from '../types';
import { Wordmark } from './Wordmark';

/**
 * Rendered when the SCORM Player loads and the learner has not yet
 * completed the prerequisite Work Order on fgn.academy.
 *
 * Two locked states share the same layout:
 *   - userExists=false  → "Create your FGN passport" CTA
 *   - userExists=true   → "Complete the Work Order on fgn.academy" CTA
 *
 * The Player checks the /scorm-launch-status/check endpoint on load
 * with the learner's cmi.core.student_id (their LMS-supplied email)
 * and the gatingChallengeId from course.json. The response drives this
 * component's contents.
 */
export function LockedState({
  mode,
  courseTitle,
  studentEmail,
  challengeId,
  check,
}: {
  mode: BrandMode;
  courseTitle: string;
  studentEmail: string;
  challengeId: string;
  check: WorkOrderCheckResult;
}) {
  const ctaUrl =
    !check.userExists
      ? buildSignupUrl(studentEmail, challengeId)
      : (check.workOrderUrl ?? buildWorkOrderUrl(challengeId));

  const ctaLabel = !check.userExists
    ? 'Create your FGN passport'
    : 'Complete the Work Order on fgn.academy';

  const heading = !check.userExists
    ? 'FGN passport required'
    : 'Work Order not yet completed';

  const explanation = !check.userExists
    ? `This course is gated on a verified Work Order completion in your FGN Skill Passport. Sign up for fgn.academy with the email your LMS has on file (${studentEmail}), then complete the prerequisite Work Order.`
    : `Before you can access this course, you need to complete the Work Order on fgn.academy${
        check.workOrderTitle ? ` ("${check.workOrderTitle}")` : ''
      }. The Work Order verifies that you've successfully completed the underlying challenge — the same content as this course's prerequisite.`;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b border-border bg-card px-6 py-4">
        <Wordmark mode={mode} />
        <div className="h-6 w-px bg-border" />
        <h1 className="font-heading text-lg font-semibold tracking-wide">{courseTitle}</h1>
        <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <span className="text-base leading-none">🔒</span>
          Locked
        </span>
      </header>

      <main className="flex flex-1 items-center justify-center p-8" tabIndex={-1}>
        <div className="mx-auto max-w-xl rounded-card border border-border bg-card p-8 shadow-glow-soft">
          <p className="font-heading text-xs uppercase tracking-widest text-muted-foreground">
            Prerequisite required
          </p>
          <h2 className="mt-2 font-display text-3xl font-bold">{heading}</h2>
          <p className="mt-4 text-foreground/85">{explanation}</p>

          {!check.userExists && (
            <div className="mt-6 rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">Why this matters: </strong>
                FGN courses build on hands-on Work Order completions, verified by an instructor or
                moderator. Your Skill Passport tracks every credential you earn across the
                ecosystem — gaming entry on play.fgn.gg, skills development here on fgn.academy,
                and certifications on broadbandworkforce.com and beyond.
              </p>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-3">
            <a
              href={ctaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-button bg-primary px-6 py-3 text-center font-heading text-base font-medium tracking-wide text-primary-foreground shadow-glow-cta transition hover:opacity-90"
            >
              {ctaLabel}
            </a>
            <p className="text-center text-xs text-muted-foreground">
              After completing the Work Order, return here and refresh — this course will unlock
              automatically.
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t border-border bg-card px-6 py-3 text-center text-xs text-muted-foreground">
        Signed in as <span className="font-medium text-foreground/80">{studentEmail}</span> via
        your LMS. Course access is gated on Work Order completion.
      </footer>
    </div>
  );
}

function buildSignupUrl(email: string, challengeId: string): string {
  const params = new URLSearchParams({
    email,
    challenge: challengeId,
    from: 'scorm',
  });
  return `https://fgn.academy/signup?${params.toString()}`;
}

function buildWorkOrderUrl(challengeId: string): string {
  // Fallback URL when the bridge didn't return one (e.g. work_order doesn't
  // exist yet — points to fgn.academy's challenge index where the user can
  // start the challenge fresh).
  return `https://fgn.academy/challenges/${challengeId}`;
}
