import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CourseManifest, ChallengeState, ProgressState } from './types';
import { ScormSession } from './scorm/api';
import { PlayerShell } from './components/PlayerShell';
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

export function App({ course }: { course: CourseManifest }) {
  const sessionRef = useRef<ScormSession | null>(null);
  const [progress, setProgress] = useState<ProgressState>(() => ({ ...INITIAL_PROGRESS }));
  const [studentId, setStudentId] = useState<string>('');

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

  return (
    <PlayerShell
      course={course}
      mode={course.brandMode}
      currentModuleId={currentModule.id}
      completedModuleIds={progress.completedModuleIds}
      onSelectModule={goTo}
      onPrev={() => goRelative(-1)}
      onNext={() => goRelative(1)}
    >
      {renderModule()}
    </PlayerShell>
  );
}
