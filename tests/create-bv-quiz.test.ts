import assert from 'node:assert/strict';
import test from 'node:test';
import createBvQuiz from '../src/api/createBvQuiz';
import { BvQuizzes } from '../src/lib/app-backend-sdk';

const admin = {
  id: 'PW-QUIZ-SAVE-ADMIN',
  userId: 'PW-QUIZ-SAVE-ADMIN',
  email: 'pw-quiz-save-admin@example.invalid',
  role: 'ADMIN',
  status: 'ACTIVE',
  segment: 'PW',
  isBvAdmin: true,
  isActive: true,
};

const originalQuestions = [{
  id: 'q1',
  text: 'Original question',
  type: 'single' as const,
  options: ['Yes', 'No'],
  correctAnswers: [0],
  explanation: '',
}];

test('updating a quiz stores the edited title and questions', async () => {
  const created = await createBvQuiz.execute({
    input: {
      department: 'PW',
      title: 'Original title',
      description: '',
      questions: originalQuestions,
      quizDate: '2026-04-19',
    },
    context: { user: admin as any },
  });

  try {
    const parsed = createBvQuiz.inputSchema.safeParse({
      quizId: created.quizId,
      department: 'PW',
      title: 'ADSF2',
      description: 'Updated description',
      questions: [{
        id: 'q1',
        text: 'According to the registration given, what controls the mind?',
        type: 'multiple',
        options: ['Intelligence', 'False ego'],
        correctAnswers: ['0', '1'],
        explanation: '',
      }, {
        id: 'blank',
        text: '   ',
        type: 'single',
        options: ['', ''],
        correctAnswers: [],
        explanation: '',
      }],
      quizDate: '2026-04-19',
    });
    assert.equal(parsed.success, false);

    const savedQuestions = [{
      id: 'q1',
      text: 'According to the registration given, what controls the mind?',
      type: 'multiple' as const,
      options: ['Intelligence', 'False ego'],
      correctAnswers: [0, 1],
      explanation: '',
    }];
    const coerced = createBvQuiz.inputSchema.safeParse({
      quizId: created.quizId,
      department: 'PW',
      title: 'ADSF2',
      description: 'Updated description',
      questions: [{
        ...savedQuestions[0],
        correctAnswers: ['0', '1'],
      }],
      quizDate: '2026-04-19',
    });
    assert.equal(coerced.success, true);
    if (!coerced.success) return;

    await createBvQuiz.execute({
      input: coerced.data,
      context: { user: admin as any },
    });

    const stored = await BvQuizzes.findOne({ id: created.quizId });
    assert.equal(stored.quizTitle, 'ADSF2');
    assert.equal(stored.description, 'Updated description');
    assert.equal(stored.department, 'PW');
    const questions = JSON.parse(stored.questionsJson);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].text, savedQuestions[0].text);
    assert.deepEqual(questions[0].correctAnswers, [0, 1]);
    assert.equal(stored.activeGroupIds?.length ?? 0, 0);
  } finally {
    await BvQuizzes.delete({ id: created.quizId });
  }
});
