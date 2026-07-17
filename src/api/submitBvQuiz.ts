import { z } from 'zod';
import { createEndpoint, BvQuizzes, BvQuizSubmissions, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Submit answers for a BV quiz and get the result',
  authenticated: true,
  inputSchema: z.object({
    quizId: z.string(),
    answers: z.array(z.object({
      questionId: z.string(),
      selected: z.array(z.number()),
    })),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    // Check if already submitted
    const existing = await BvQuizSubmissions.findOne({
      filters: { user: context.user.id, quiz: input.quizId },
    });
    if (existing) throw new ZiteError({ code: 'CONFLICT', message: 'Already submitted this quiz' });

    const quiz = await BvQuizzes.findOne({ id: input.quizId });
    if (!quiz) throw new ZiteError({ code: 'NOT_FOUND', message: 'Quiz not found' });

    let questions: any[] = [];
    try { questions = JSON.parse(quiz.questionsJson || '[]'); } catch {}

    // Score calculation
    let score = 0;
    const results = questions.map((q: any) => {
      const answer = input.answers.find(a => a.questionId === q.id);
      const selected = answer?.selected || [];
      const correct = q.correctAnswers as number[];

      // For single: exact match; for multiple: all correct selected, none wrong
      const isCorrect = q.type === 'single'
        ? selected.length === 1 && selected[0] === correct[0]
        : selected.length === correct.length &&
          selected.every((s: number) => correct.includes(s)) &&
          correct.every((c: number) => selected.includes(c));

      if (isCorrect) score++;

      return {
        questionId: q.id,
        selected,
        correct,
        isCorrect,
        explanation: q.explanation || '',
      };
    });

    const total = questions.length;
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

    await BvQuizSubmissions.create({
      record: {
        user: context.user.id,
        quiz: input.quizId,
        score,
        totalQuestions: total,
        percentage,
        submittedAt: new Date().toISOString(),
        answersJson: JSON.stringify(input.answers),
      },
    });

    return { score, total, percentage, results };
  },
});
