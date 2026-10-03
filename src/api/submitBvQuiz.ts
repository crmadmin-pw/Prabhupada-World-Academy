import { z } from 'zod';
import { createEndpoint, BvQuizzes, BvQuizSubmissions, AppError } from '@/lib/backend-sdk';
import { createHash } from 'crypto';
import { assertQuizParticipantAccess, quizRefValues, quizUserDepartment } from '@/lib/bvQuizAccess';

export default createEndpoint({
  description: 'Submit answers for a BV quiz and get the result',
  authenticated: true,
  inputSchema: z.object({
    quizId: z.string(),
    answers: z.array(z.object({
      questionId: z.string(),
      selected: z.array(z.number().int().nonnegative()),
    })).max(500),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    const userDepartment = quizUserDepartment(context.user);
    if (userDepartment !== 'FOLK' && userDepartment !== 'PW') {
      throw new AppError({ code: 'FORBIDDEN', message: 'Quizzes are not available for this account' });
    }

    const quiz = await BvQuizzes.findOne({ id: input.quizId });
    if (!quiz) throw new AppError({ code: 'NOT_FOUND', message: 'Quiz not found' });
    const access = await assertQuizParticipantAccess(context.user, quiz, userDepartment);

    // Check all identity aliases because older submissions may store a public
    // userId while current records use the Firestore Users document id.
    const { records: quizSubmissions } = await BvQuizSubmissions.findAll({
      filters: { quiz: input.quizId },
      limit: 5000,
      fields: ['id', 'user', 'userId'],
    });
    const userAliases = new Set(quizRefValues([
      context.user.id,
      context.user.userId,
      context.user.uid,
      context.user.email,
      context.user.fullName,
      context.user.name,
    ]));
    const existing = quizSubmissions.find(submission =>
      quizRefValues([submission.user, submission.userId]).some(reference => userAliases.has(reference))
    );
    if (existing) throw new AppError({ code: 'CONFLICT', message: 'Already submitted this quiz' });

    let questions: any[] = [];
    try { questions = JSON.parse(quiz.questionsJson || '[]'); } catch {}
    if (questions.length === 0) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'This quiz has no valid questions' });
    }

    const answerByQuestion = new Map<string, number[]>();
    for (const answer of input.answers) {
      if (answerByQuestion.has(answer.questionId)) {
        throw new AppError({ code: 'BAD_REQUEST', message: 'Each question can be answered only once' });
      }
      answerByQuestion.set(answer.questionId, [...new Set(answer.selected as number[])]);
    }
    if (answerByQuestion.size !== questions.length || questions.some(question => !answerByQuestion.has(question.id))) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'Please answer every question before submitting' });
    }

    // Score calculation
    let score = 0;
    const results = questions.map((q: any) => {
      const selected = answerByQuestion.get(q.id) || [];
      const correct = Array.isArray(q.correctAnswers) ? q.correctAnswers : [];
      const options = Array.isArray(q.options) ? q.options : [];
      if (selected.length === 0 || selected.some(index => index >= options.length)) {
        throw new AppError({ code: 'BAD_REQUEST', message: 'One or more selected answers are invalid' });
      }
      if (q.type === 'single' && selected.length !== 1) {
        throw new AppError({ code: 'BAD_REQUEST', message: 'Single-answer questions accept exactly one option' });
      }

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

    const submissionId = `BVQUIZSUB-${createHash('sha256')
      .update(`${input.quizId}:${context.user.id}`)
      .digest('hex')
      .slice(0, 32)}`;
    await BvQuizSubmissions.create({
      record: {
        id: submissionId,
        submissionId,
        user: context.user.id,
        userId: context.user.userId,
        quiz: input.quizId,
        group: access.group.id,
        groupId: access.group.groupId || access.group.id,
        department: access.department,
        score,
        totalQuestions: total,
        percentage,
        submittedAt: new Date().toISOString(),
        answersJson: JSON.stringify(questions.map(question => ({
          questionId: question.id,
          selected: answerByQuestion.get(question.id) || [],
        }))),
      },
    });

    return { score, total, percentage, results };
  },
});
