import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CourseManifest,
  ChallengeState,
  ProgressState,
  WorkOrderCheckResult,
} from './types';
import { ScormSession } from './scorm/api';
import { PlayerShell } from './components/PlayerShell';
import { LockedState } from './components/LockedState';
import { BriefingModule } from './modules/BriefingModule';
import { ChallengeModule } from './modules/ChallengeModule';
import { QuizModule } from './modules/QuizModule';
import { MediaModule } from './modules/MediaModule';
import { CompletionModule } from './modules/CompletionModule';

const INITIAL_PROGRESS: ProgressState = {
  currentModuleId: null,
  completedModuleIds: [],
  quizScores: {},
  challengeStates: {},
};

const DEFAULT_BRIDGE_ENDPOINT =
  'https://vfzjfkcwromssjnlrhoo.supabase.co/functions/v1/scorm-launch-status';

type GatingState =
  | { phase: 'checking' }
  | { phase: 'no-gate' } // course has no gatingChallengeId — render normally (legacy / hand-authored)
  | { phase: 'locked'; check: WorkOrderCheckResult }
  | { phase: 'unlocked'; check: WorkOrderCheckResult }
  | { phase: 'check-failed'; reason: string }; // bridge unreachable; fail-open to render content

export function App({ course }: { course: CourseManifest }) {
  const sessionRef = useRef<ScormSession | null>(null);
  const [progress, setProgress] = useState<ProgressState>(() => ({ ...INITIAL_PROGRESS }));
  const [studentId, setStudentId] = useState<string>('');
  const [gating, setGating] = useState<GatingState>({ phase: 'checking' });

  // Bootstrap: open SCORM session, restore suspend_data, set initial module.
  useEffect(() => {
    const session = new ScormSession();
    sessionRef.current = session;
    session.initialize();

    const restored = session.getSuspendData<ProgressState>(INITIAL_PROGRESS);
    const initialModuleId =
      restored.currentModuleId ?? course.modules[0]?.id ?? null;
    setProgress({ ...restored, currentModuleId: initialModuleId });
    setStudentId(session.getStudentId() || 'preview-student');

    session.set('cmi.core.lesson_status', 'incomplete');
    session.commit();

    const finishOnUnload = () => {
      session.commit();
      session.finish();
    };
    window.addEventListener('beforeunload', finishOnUnload);
    return () => {
      window.removeEventListener('beforeunload', finishOnUnload);
      session.commit();
      session.finish();
    };
  }, [course.modules]);

  // Phase 1.5 gating: on load, check whether the learner has completed
  // the prerequisite Work Order on fgn.academy. Fail-open if the bridge
  // is unreachable so the content still renders (LMSs running offline,
  // network blips, etc.).
  useEffect(() => {
    if (!studentId) return;
    if (!course.gatingChallengeId) {
      setGating({ phase: 'no-gate' });
      return;
    }
    let cancelled = false;
    const endpoint = course.bridgeEndpoint ?? DEFAULT_BRIDGE_ENDPOINT;
    void fetch(`${endpoint}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: course.gatingChallengeId,
        scormStudentId: studentId,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as WorkOrderCheckResult;
      })
      .then((check) => {
        if (cancelled) return;
        setGating({
          phase: check.completed ? 'unlocked' : 'locked',
          check,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn(
          '[scorm-player] /check failed; failing open and rendering content unconditionally.',
          err,
        );
        setGating({ phase: 'check-failed', reason: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, course.gatingChallengeId, course.bridgeEndpoint]);

  // Persist progress to suspend_data on every update.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.setSuspendData(progress);
  }, [progress]);

  const currentModule = useMemo(
    () => course.modules.find((m) => m.id === progress.currentModuleId) ?? course.modules[0],
    [course.modules, progress.currentModuleId],
  );

  const completeCurrent = useCallback(
    (extras: Partial<ProgressState> = {}) => {
      setProgress((prev) => {
        const id = prev.currentModuleId;
        if (!id) return prev;
        const completedModuleIds = prev.completedModuleIds.includes(id)
          ? prev.completedModuleIds
          : [...prev.completedModuleIds, id];
        return { ...prev, ...extras, completedModuleIds };
      });
    },
    [],
  );

  const goTo = useCallback((moduleId: string) => {
    setProgress((prev) => ({ ...prev, currentModuleId: moduleId }));
  }, []);

  const goRelative = useCallback(
    (delta: number) => {
      const idx = course.modules.findIndex((m) => m.id === progress.currentModuleId);
      const next = course.modules[idx + delta];
      if (next) goTo(next.id);
    },
    [course.modules, progress.currentModuleId, goTo],
  );

  // When all modules are complete, mark the SCO as completed and write
  // a preliminary score (mean of quiz scores). Final rubric score arrives
  // later via the async writeback path (Phase 5).
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const allDone = course.modules.every((m) => progress.completedModuleIds.includes(m.id));
    if (!allDone) return;

    const quizScoreValues = Object.values(progress.quizScores).map((s) => s.score);
    const preliminary =
      quizScoreValues.length > 0
        ? Math.round(quizScoreValues.reduce((a, b) => a + b, 0) / quizScoreValues.length)
        : undefined;

    if (preliminary !== undefined) {
      session.setScore(preliminary);
    }
    session.setLessonStatus('completed');
    setProgress((prev) =>
      preliminary !== undefined ? { ...prev, finalScore: preliminary } : prev,
    );
  }, [course.modules, progress.completedModuleIds, progress.quizScores]);

  // Auto-mark completion modules as complete the moment they render —
  // reaching the completion screen IS the course-completion event, there's
  // no separate "mark done" interaction. Without this, allDone above never
  // becomes true and the LMS never sees lesson_status='completed'.
  useEffect(() => {
    if (!currentModule || currentModule.type !== 'completion') return;
    setProgress((prev) =>
      prev.completedModuleIds.includes(currentModule.id)
        ? prev
        : {
            ...prev,
            completedModuleIds: [...prev.completedModuleIds, currentModule.id],
          },
    );
  }, [currentModule]);

  if (!currentModule) {
    return <div className="p-8 text-foreground">Course has no modules.</div>;
  }

  // Locked state: gating check completed and the learner doesn't yet
  // have a verified Work Order completion. Render the locked screen
  // instead of the course content.
  if (gating.phase === 'locked') {
    return (
      <LockedState
        mode={course.brandMode}
        courseTitle={course.title}
        studentEmail={studentId}
        challengeId={course.gatingChallengeId ?? ''}
        check={gating.check}
      />
    );
  }

  // Checking phase: brief flash before /check resolves. Show a minimal
  // shell rather than the full UI to avoid flashing locked-state-then-
  // unlocked-state if the bridge is fast.
  if (gating.phase === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <p className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
          Verifying Work Order completion…
        </p>
      </div>
    );
  }

  const renderModule = () => {
    switch (currentModule.type) {
      case 'briefing':
        return (
          <BriefingModule
            module={currentModule}
            onComplete={() => {
              completeCurrent();
              goRelative(1);
            }}
          />
        );
      case 'challenge': {
        const state: ChallengeState | undefined =
          progress.challengeStates[currentModule.id];
        return (
          <ChallengeModule
            module={currentModule}
            studentId={studentId}
            launchTokenEndpoint={course.launchTokenEndpoint}
            state={state}
            onStateChange={(next) =>
              setProgress((prev) => ({
                ...prev,
                challengeStates: { ...prev.challengeStates, [currentModule.id]: next },
              }))
            }
            onComplete={(preliminaryScore) => {
              completeCurrent();
              if (preliminaryScore !== undefined) {
                setProgress((prev) => ({
                  ...prev,
                  challengeStates: {
                    ...prev.challengeStates,
                    [currentModule.id]: {
                      ...(prev.challengeStates[currentModule.id] ?? { status: 'completed' }),
                      preliminaryScore,
                    },
                  },
                }));
              }
              goRelative(1);
            }}
          />
        );
      }
      case 'quiz':
        return (
          <QuizModule
            module={currentModule}
            onComplete={(score, passed) => {
              setProgress((prev) => ({
                ...prev,
                quizScores: {
                  ...prev.quizScores,
                  [currentModule.id]: { score, passed },
                },
              }));
              if (passed) {
                completeCurrent();
                goRelative(1);
              }
            }}
          />
        );
      case 'media':
        return (
          <MediaModule
            module={currentModule}
            onComplete={() => {
              completeCurrent();
              goRelative(1);
            }}
          />
        );
      case 'completion':
        return <CompletionModule module={currentModule} progress={progress} />;
    }
  };

  // Pass the verified-completion badge to the shell when applicable.
  // Shows "✓ Work Order Completed [date]" in the header. Falls back
  // to nothing for legacy/no-gate courses.
  const badge =
    gating.phase === 'unlocked' && gating.check.completed
      ? {
          ...(gating.check.completedAt !== undefined
            ? { completedAt: gating.check.completedAt }
            : {}),
          ...(gating.check.score !== undefined && gating.check.score !== null
            ? { score: gating.check.score }
            : {}),
          ...(gating.check.workOrderTitle !== undefined
            ? { workOrderTitle: gating.check.workOrderTitle }
            : {}),
        }
      : undefined;

  return (
    <PlayerShell
      course={course}
      mode={course.brandMode}
      currentModuleId={currentModule.id}
      completedModuleIds={progress.completedModuleIds}
      onSelectModule={goTo}
      onPrev={() => goRelative(-1)}
      onNext={() => goRelative(1)}
      {...(badge ? { workOrderBadge: badge } : {})}
    >
      {renderModule()}
    </PlayerShell>
  );
}
