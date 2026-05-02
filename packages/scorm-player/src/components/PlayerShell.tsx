import { useMemo } from 'react';
import type { BrandMode } from '@fgn/brand-tokens';
import type { CourseManifest, CourseModule } from '../types';
import { Wordmark } from './Wordmark';

/**
 * Top-level layout for a SCORM Player session.
 * Header (logo + course title) | Sidebar (TOC) | Main pane (current module) | Footer (progress + nav)
 */
export function PlayerShell({
  course,
  mode,
  currentModuleId,
  completedModuleIds,
  onSelectModule,
  onPrev,
  onNext,
  children,
}: {
  course: CourseManifest;
  mode: BrandMode;
  currentModuleId: string;
  completedModuleIds: string[];
  onSelectModule: (id: string) => void;
  onPrev: () => void;
  onNext: () => void;
  children: React.ReactNode;
}) {
  const completedCount = completedModuleIds.length;
  const totalCount = course.modules.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const currentIndex = useMemo(
    () => course.modules.findIndex((m) => m.id === currentModuleId),
    [course.modules, currentModuleId],
  );
  const canPrev = currentIndex > 0;
  const canNext = currentIndex < course.modules.length - 1;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b border-border bg-card px-6 py-4">
        <Wordmark mode={mode} />
        <div className="h-6 w-px bg-border" />
        <h1 className="font-heading text-lg font-semibold tracking-wide">{course.title}</h1>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside
          className="w-72 shrink-0 overflow-y-auto border-r border-border bg-sidebar p-4"
          aria-label="Course outline"
        >
          <ol className="space-y-1">
            {course.modules.map((module, idx) => (
              <TocItem
                key={module.id}
                module={module}
                index={idx}
                active={module.id === currentModuleId}
                completed={completedModuleIds.includes(module.id)}
                onSelect={() => onSelectModule(module.id)}
              />
            ))}
          </ol>
        </aside>

        <main className="flex-1 overflow-y-auto p-8" tabIndex={-1}>
          <div className="mx-auto max-w-3xl">{children}</div>
        </main>
      </div>

      <footer className="border-t border-border bg-card px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {completedCount} of {totalCount} complete
              </span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-brand-primary transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onPrev}
            disabled={!canPrev}
            className="rounded-button border border-border bg-secondary px-4 py-2 font-heading text-sm font-medium tracking-wide text-secondary-foreground transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-muted"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canNext}
            className="rounded-button bg-primary px-4 py-2 font-heading text-sm font-medium tracking-wide text-primary-foreground shadow-glow-cta transition disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90"
          >
            Next
          </button>
        </div>
      </footer>
    </div>
  );
}

function TocItem({
  module,
  index,
  active,
  completed,
  onSelect,
}: {
  module: CourseModule;
  index: number;
  active: boolean;
  completed: boolean;
  onSelect: () => void;
}) {
  const stateClass = active
    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
    : 'hover:bg-sidebar-accent/60 text-sidebar-foreground';

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${stateClass}`}
        aria-current={active ? 'step' : undefined}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-heading text-xs ${
            completed
              ? 'bg-brand-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          }`}
          aria-hidden
        >
          {completed ? '✓' : index + 1}
        </span>
        <span className="flex-1">
          <span className="block font-medium">{module.title}</span>
          <span className="block text-xs uppercase tracking-wider text-muted-foreground">
            {module.type}
          </span>
        </span>
      </button>
    </li>
  );
}
