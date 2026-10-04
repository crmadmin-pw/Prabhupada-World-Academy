import { z } from 'zod';
import { AppError, BvGroupMembers, BvQuizzes, BvQuizSubmissions, createEndpoint } from '@/lib/backend-sdk';
import {
  canManageQuizContent,
  findScopedQuizGroup,
  getQuizGroupsForUser,
  canTurnPwQuizOnForGroup,
  isPwQuizContentManager,
  legacyQuizMatchesGroup,
  pwQuizEnabledForGroup,
  quizGroupAliases,
  quizRefValues,
  resolveQuizDepartment,
} from '@/lib/bvQuizAccess';

function submissionMatchesGroup(submission: any, group: any, memberships: any[]): boolean {
  const groupAliases = quizGroupAliases(group);
  if (quizRefValues([submission.group, submission.groupId]).some(reference => groupAliases.has(reference))) return true;

  const submissionUsers = new Set(quizRefValues([submission.user, submission.userId]));
  return memberships.some(membership => {
    const memberUsers = quizRefValues([membership.user, membership.userId, membership.memberId]);
    if (!memberUsers.some(reference => submissionUsers.has(reference))) return false;
    return quizRefValues([membership.group, membership.groupId]).some(reference => groupAliases.has(reference));
  });
}

export default createEndpoint({
  description: 'Get authorized quizzes with submission counts',
  authenticated: true,
  inputSchema: z.object({
    department: z.enum(['FOLK', 'PW']).optional(),
    groupId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    if (input.department === 'PW') return listPwQuizzes(context.user, input.groupId);

    const canManageContent = canManageQuizContent(context.user, 'FOLK');
    if (!canManageContent) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Quiz management access is required' });
    }

    const scopedGroups = await getQuizGroupsForUser(context.user, 'FOLK', { readOnly: true });
    const selectedGroup = input.groupId ? findScopedQuizGroup(scopedGroups, input.groupId) : null;
    if (input.groupId && !selectedGroup) {
      throw new AppError({ code: 'FORBIDDEN', message: 'You can view quizzes only for authorized reading groups' });
    }
    if (!input.groupId) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'A reading group is required' });
    }

    const [{ records: allQuizzes }, { records: allMemberships }] = await Promise.all([
      BvQuizzes.findAll({ limit: 500 }),
      BvGroupMembers.findAll({
        limit: 5000,
        fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'],
      }).catch(() => ({ records: [] })),
    ]);

    const departmentPairs = await Promise.all(allQuizzes.map(async quiz => ({
      quiz,
      department: await resolveQuizDepartment(quiz, 'FOLK'),
    })));
    const quizzes = departmentPairs
      .filter(pair => pair.department === 'FOLK')
      .map(pair => pair.quiz)
      .filter(quiz => canManageContent || quiz.isActive === true)
      .filter(quiz => !!selectedGroup && legacyQuizMatchesGroup(quiz, selectedGroup.record));

    const quizIds = quizzes.map(quiz => quiz.id);
    const submissionBatches: any[][] = [];
    for (let index = 0; index < quizIds.length; index += 30) {
      const { records } = await BvQuizSubmissions.findAll({
        filters: { quiz: { in: quizIds.slice(index, index + 30) } },
        limit: 5000,
        fields: ['id', 'quiz', 'user', 'userId', 'group', 'groupId', 'score', 'totalQuestions', 'percentage', 'submittedAt'],
      });
      submissionBatches.push(records);
    }
    const allSubmissions = submissionBatches.flat();
    const visibleSubmissions = selectedGroup
      ? allSubmissions.filter(submission => submissionMatchesGroup(submission, selectedGroup.record, allMemberships))
      : allSubmissions;

    const myAliases = new Set(quizRefValues([context.user.id, context.user.userId, context.user.uid, context.user.email]));
    const mySubmissionByQuiz = new Map<string, any>();
    const countByQuiz = new Map<string, number>();
    for (const submission of visibleSubmissions) {
      const quizId = quizRefValues(submission.quiz)[0];
      if (!quizId) continue;
      countByQuiz.set(quizId, (countByQuiz.get(quizId) || 0) + 1);
      if (quizRefValues([submission.user, submission.userId]).some(reference => myAliases.has(reference))) {
        mySubmissionByQuiz.set(quizId, submission);
      }
    }

    const result = quizzes
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .map(quiz => {
        let questions: any[] = [];
        try { questions = JSON.parse(quiz.questionsJson || '[]'); } catch {}
        const normalizedQuizId = String(quiz.id).toLowerCase();
        const mySubmission = mySubmissionByQuiz.get(normalizedQuizId);
        return {
          id: quiz.id,
          title: quiz.quizTitle || '',
          description: quiz.description || '',
          department: 'FOLK',
          isActive: quiz.isActive === true,
          isActiveForGroup: quiz.isActive === true,
          activeGroupCount: 0,
          questionCount: questions.length,
          quizDate: quiz.quizDate || '',
          createdAt: quiz.createdAt || '',
          updatedAt: quiz.updatedAt || '',
          submissionCount: countByQuiz.get(normalizedQuizId) || 0,
          mySubmission: mySubmission ? {
            id: mySubmission.id,
            score: mySubmission.score ?? 0,
            totalQuestions: mySubmission.totalQuestions ?? 0,
            percentage: mySubmission.percentage ?? 0,
            submittedAt: mySubmission.submittedAt || '',
          } : null,
        };
      });

    return {
      quizzes: result,
      groups: [] as { id: string; groupName: string }[],
      permissions: {
        canManageContent,
        canToggleGroups: false,
        canViewAllGroups: false,
      },
    };
  },
});

async function listPwQuizzes(user: any, groupId?: string) {
  const canManageContent = isPwQuizContentManager(user);
  const canToggleGroups = canTurnPwQuizOnForGroup(user);
  if (!canManageContent && !canToggleGroups) {
    throw new AppError({ code: 'FORBIDDEN', message: 'Quiz management access is required' });
  }

  const scopedGroups = await getQuizGroupsForUser(user, 'PW', { readOnly: true });
  const selectedGroup = groupId ? findScopedQuizGroup(scopedGroups, groupId) : null;
  if (groupId && !selectedGroup) {
    throw new AppError({ code: 'FORBIDDEN', message: 'You can view quizzes only for your reading groups' });
  }

  const [{ records: allQuizzes }, { records: allMemberships }] = await Promise.all([
    BvQuizzes.findAll({ limit: 500 }),
    BvGroupMembers.findAll({
      limit: 5000,
      fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'],
    }).catch(() => ({ records: [] })),
  ]);
  const departmentPairs = await Promise.all(allQuizzes.map(async quiz => ({
    quiz,
    department: await resolveQuizDepartment(quiz, 'PW'),
  })));
  const quizzes = departmentPairs
    .filter(pair => pair.department === 'PW')
    .map(pair => pair.quiz)
    .filter(quiz => canManageContent || quiz.isActive !== false);

  const quizIds = quizzes.map(quiz => quiz.id);
  const submissionBatches: any[][] = [];
  for (let index = 0; index < quizIds.length; index += 30) {
    const batch = quizIds.slice(index, index + 30);
    if (batch.length === 0) continue;
    const { records } = await BvQuizSubmissions.findAll({
      filters: { quiz: { in: batch } },
      limit: 5000,
      fields: ['id', 'quiz', 'user', 'userId', 'group', 'groupId', 'score', 'totalQuestions', 'percentage', 'submittedAt'],
    });
    submissionBatches.push(records);
  }
  const visibleGroups = selectedGroup ? [selectedGroup] : scopedGroups;
  const allSubmissions = submissionBatches.flat().filter(submission =>
    visibleGroups.some(group => submissionMatchesGroup(submission, group.record, allMemberships))
  );

  const countByQuiz = new Map<string, number>();
  for (const submission of allSubmissions) {
    const quizId = quizRefValues(submission.quiz)[0];
    if (!quizId) continue;
    countByQuiz.set(quizId, (countByQuiz.get(quizId) || 0) + 1);
  }

  return {
    groups: scopedGroups.map(group => ({ id: group.id, groupName: group.groupName })),
    quizzes: quizzes
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .map(quiz => {
        let questions: any[] = [];
        try { questions = JSON.parse(quiz.questionsJson || '[]'); } catch {}
        const normalizedQuizId = String(quiz.id).toLowerCase();
        return {
          id: quiz.id,
          title: quiz.quizTitle || '',
          description: quiz.description || '',
          department: 'PW',
          isActive: quiz.isActive !== false,
          isActiveForGroup: !!selectedGroup && pwQuizEnabledForGroup(quiz, selectedGroup.record),
          activeGroupCount: visibleGroups.filter(group => pwQuizEnabledForGroup(quiz, group.record)).length,
          questionCount: questions.length,
          quizDate: quiz.quizDate || '',
          createdAt: quiz.createdAt || '',
          updatedAt: quiz.updatedAt || '',
          submissionCount: countByQuiz.get(normalizedQuizId) || 0,
          mySubmission: null,
        };
      }),
    permissions: {
      canManageContent,
      canToggleGroups,
      canViewAllGroups: canManageContent,
    },
  };
}
