import type { CompletionModule as CompletionModuleType, ProgressState } from '../types';
import { RichText } from '../components/RichText';

export function CompletionModule({
  module,
  progress,
}: {
  module: CompletionModuleType;
  progress: ProgressState;
}) {
  return (
    <article>
      <header className="mb-6 text-center">
        <p className="font-heading text-xs uppercase tracking-widest text-brand-primary">
          Course complete
        </p>
        <h2 className="mt-2 font-display text-4xl font-bold">{module.title}</h2>
      </header>

      <RichText html={module.html} className="mx-auto" />

      {progress.finalScore !== undefined && (
        <div className="mx-auto mt-8 max-w-md rounded-card border border-border bg-card p-6 text-center shadow-glow-soft">
          <p className="font-heading text-xs uppercase tracking-widest text-muted-foreground">
            Preliminary score
          </p>
          <p className="mt-2 font-display text-5xl font-black text-brand-primary">
            {progress.finalScore}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Final rubric score will arrive after instructor review.
          </p>
        </div>
      )}
    </article>
  );
}
