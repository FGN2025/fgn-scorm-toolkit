import { useMemo, useState } from 'react';
import type { QuizModule as QuizModuleType, QuizQuestion } from '../types';

/**
 * Knowledge-gate quiz. Scenario-based questions, configurable pass
 * threshold (default 80% per FGN brand of curriculum). Unlimited
 * retakes, no timer, open notes — matches the curriculum reference.
 */
export function QuizModule({
  module,
  onComplete,
}: {
  module: QuizModuleType;
  onComplete: (score: number, passed: boolean) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, Set<string>>>({});
  const [submitted, setSubmitted] = useState(false);

  const result = useMemo(() => {
    if (!submitted) return null;
    return scoreQuiz(module, answers);
  }, [submitted, module, answers]);

  const passThreshold = module.passThreshold;

  function toggleChoice(questionId: string, choiceId: string, exclusive: boolean) {
    setAnswers((prev) => {
      const set = new Set(prev[questionId] ?? []);
      if (exclusive) {
        set.clear();
        set.add(choiceId);
      } else if (set.has(choiceId)) {
        set.delete(choiceId);
      } else {
        set.add(choiceId);
      }
      return { ...prev, [questionId]: set };
    });
  }

  function handleSubmit() {
    setSubmitted(true);
    const r = scoreQuiz(module, answers);
    onComplete(r.score, r.score >= passThreshold);
  }

  function handleRetake() {
    setAnswers({});
    setSubmitted(false);
  }

  return (
    <article>
      <header className="mb-6">
        <p className="font-heading text-xs uppercase tracking-widest text-muted-foreground">
          Knowledge gate
        </p>
        <h2 className="mt-2 font-display text-3xl font-bold">{module.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {module.questions.length} questions · pass at {passThreshold}% · unlimited retakes
        </p>
      </header>

      <ol className="space-y-6">
        {module.questions.map((q, idx) => (
          <li
            key={q.id}
            className="rounded-card border border-border bg-card p-5 shadow-glow-soft"
          >
            <p className="mb-4 font-medium">
              <span className="text-muted-foreground">{idx + 1}.</span> {q.prompt}
            </p>
            <div className="space-y-2">
              {q.choices.map((c) => {
                const exclusive = q.type !== 'multi-choice';
                const checked = answers[q.id]?.has(c.id) ?? false;
                const showCorrectness = submitted;
                const isCorrect = c.correct;
                const stateClass = showCorrectness
                  ? isCorrect
                    ? 'border-brand-primary bg-brand-primary/10'
                    : checked
                      ? 'border-destructive bg-destructive/10'
                      : 'border-border'
                  : checked
                    ? 'border-brand-primary bg-brand-primary/5'
                    : 'border-border hover:border-muted-foreground';
                return (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition ${stateClass}`}
                  >
                    <input
                      type={exclusive ? 'radio' : 'checkbox'}
                      name={q.id}
                      checked={checked}
                      disabled={submitted}
                      onChange={() => toggleChoice(q.id, c.id, exclusive)}
                      className="mt-1"
                    />
                    <span className="flex-1">{c.label}</span>
                  </label>
                );
              })}
            </div>
            {submitted && q.explanation && (
              <p className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                <strong className="text-foreground">Why: </strong>
                {q.explanation}
              </p>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-8 flex items-center justify-between gap-4">
        {result ? (
          <div className="flex-1">
            <p className="font-heading text-lg font-semibold">
              Score: <span className="text-brand-primary">{result.score}%</span>
              {result.score >= passThreshold ? (
                <span className="ml-3 text-brand-primary">✓ Passed</span>
              ) : (
                <span className="ml-3 text-destructive">Did not pass — retake to continue</span>
              )}
            </p>
          </div>
        ) : (
          <p className="flex-1 text-sm text-muted-foreground">
            Answer every question, then submit to see your score.
          </p>
        )}

        {submitted ? (
          <button
            type="button"
            onClick={handleRetake}
            className="rounded-button border border-border bg-secondary px-4 py-2 font-heading text-sm font-medium tracking-wide text-secondary-foreground hover:bg-muted"
          >
            Retake
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={Object.keys(answers).length < module.questions.length}
            className="rounded-button bg-primary px-6 py-3 font-heading text-base font-medium tracking-wide text-primary-foreground shadow-glow-cta transition disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90"
          >
            Submit
          </button>
        )}
      </div>
    </article>
  );
}

function scoreQuiz(
  module: QuizModuleType,
  answers: Record<string, Set<string>>,
): { score: number; correct: number; total: number } {
  let correct = 0;
  for (const q of module.questions) {
    if (isQuestionCorrect(q, answers[q.id])) correct += 1;
  }
  const total = module.questions.length;
  const score = total > 0 ? Math.round((correct / total) * 100) : 0;
  return { score, correct, total };
}

function isQuestionCorrect(q: QuizQuestion, picked: Set<string> | undefined): boolean {
  if (!picked) return false;
  const correctIds = new Set(q.choices.filter((c) => c.correct).map((c) => c.id));
  if (picked.size !== correctIds.size) return false;
  for (const id of picked) {
    if (!correctIds.has(id)) return false;
  }
  return true;
}
