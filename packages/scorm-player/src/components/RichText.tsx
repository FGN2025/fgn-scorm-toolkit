/**
 * Renders sanitized HTML content in briefing and completion modules.
 *
 * The Course Builder produces sanitized HTML at export time (TipTap ->
 * sanitized HTML pass). The Player trusts that sanitization step and
 * renders directly. We do NOT re-sanitize here — that would either
 * pull in DOMPurify (~25KB) or risk over-stripping. Trust the build.
 *
 * If the package is ever assembled outside the FGN Course Builder
 * pipeline, the input must already be sanitized.
 */
export function RichText({ html, className = '' }: { html: string; className?: string }) {
  return (
    <div
      className={`prose prose-invert max-w-none [&_a]:text-brand-primary ${className}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
