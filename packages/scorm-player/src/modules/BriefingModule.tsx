import type { BriefingModule as BriefingModuleType } from '../types';
import { RichText } from '../components/RichText';

export function BriefingModule({
  module,
  onComplete,
}: {
  module: BriefingModuleType;
  onComplete: () => void;
}) {
  return (
    <article>
      <header className="mb-6">
        <p className="font-heading text-xs uppercase tracking-widest text-muted-foreground">
          Briefing
        </p>
        <h2 className="mt-2 font-display text-3xl font-bold">{module.title}</h2>
      </header>

      <RichText html={module.html} />

      <div className="mt-10 flex justify-end">
        <button
          type="button"
          onClick={onComplete}
          className="rounded-button bg-primary px-6 py-3 font-heading text-base font-medium tracking-wide text-primary-foreground shadow-glow-cta transition hover:opacity-90"
        >
          Mark as read
        </button>
      </div>
    </article>
  );
}
