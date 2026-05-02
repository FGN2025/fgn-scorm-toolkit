import type { MediaModule as MediaModuleType } from '../types';

export function MediaModule({
  module,
  onComplete,
}: {
  module: MediaModuleType;
  onComplete: () => void;
}) {
  const isVideo = /\.(mp4|webm|mov)$/i.test(module.mediaUrl);
  return (
    <article>
      <header className="mb-6">
        <p className="font-heading text-xs uppercase tracking-widest text-muted-foreground">
          Demonstration
        </p>
        <h2 className="mt-2 font-display text-3xl font-bold">{module.title}</h2>
      </header>

      <div className="overflow-hidden rounded-card border border-border bg-card shadow-glow-soft">
        {isVideo ? (
          <video
            src={module.mediaUrl}
            poster={module.posterUrl ?? ''}
            controls
            className="block w-full"
            onEnded={onComplete}
          >
            <track kind="captions" />
          </video>
        ) : (
          <img src={module.mediaUrl} alt={module.caption ?? module.title} className="block w-full" />
        )}
      </div>

      {module.caption && (
        <p className="mt-3 text-sm text-muted-foreground">{module.caption}</p>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onComplete}
          className="rounded-button bg-primary px-6 py-3 font-heading text-base font-medium tracking-wide text-primary-foreground shadow-glow-cta transition hover:opacity-90"
        >
          Continue
        </button>
      </div>
    </article>
  );
}
