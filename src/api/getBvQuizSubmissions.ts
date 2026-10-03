import { z } from 'zod';
import { AppError, BvGroupMembers, BvQuizzes, BvQuizSubmissions, createEndpoint, Users } from '@/lib/backend-sdk';
import {
  canManageQuizContent,
  canReadFolkQuizResults,
  findScopedQuizGroup,
  getQuizGroupsForUser,
  isPwQuizContentManager,
  isPwQuizFacilitator,
  legacyQuizMatchesGroup,
  quizGroupAliases,
  quizRefValues,
  resolveQuizDepartment,
} from '@/lib/bvQuizAccess';

function submissionMatchesGroup(submission: any, group: any, memberships: any[]): boolean {
  const groupAliases = quizGroupAliases(group);
  if (quizRefValues([submission.group, submission.groupId]).some(reference => groupAliases.has(reference))) return true;
  const userAliases = new Set(quizRefValues([submission.user, submission.userId]));
  return memberships.some(membership =>
    quizRefValues([membership.user, membership.userId, membership.memberId]).some(reference => userAliases.has(reference)) &&
    quizRefValues([membership.group, membership.groupId]).some(reference => groupAliases.has(reference))
  );
}

function answerIsCorrect(question: any, selected: number[]): boolean {
  const correct = Array.isArray(question.correctAnswers) ? question.correctAnswers : [];
  return question.type === 'single'
    ? selected.length === 1 && selected[0] === correct[0]
    : selected.length === correct.length &&
      selected.every(answer => correct.includes(answer)) &&
      correct.every((answer: number) => selected.includes(answer));
}

export default createEndpoint({
  description: 'Get group-scoped quiz submissions and question analytics',
  authenticated: true,
  inputSchema: z.object({
    quizId: z.string().min(1),
    department: z.enum(['FOLK', 'PW']).optional(),
    groupId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    const quiz = await BvQuizzes.findOne({ id: input.quizId });
    if (!quiz) throw new AppError({ code: 'NOT_FOUND', message: 'Quiz not found' });

    const department = await resolveQuizDepartment(quiz, input.department || 'FOLK');
    if (department === 'PW') {
      const canManageContent = isPwQuizContentManager(context.user);
      if (!canManageContent && !isPwQuizFacilitator(context.user)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'You do not have access to these quiz results' });
      }
      const scopedGroups = await getQuizGroupsForUser(context.user, 'PW', { readOnly: true });
      const selectedGroup = input.groupId ? findScopedQuizGroup(scopedGroups, input.groupId) : null;
      if (input.groupId && !selectedGroup) {
        throw new AppError({ code: 'FORBIDDEN', message: 'You can view results only for your reading groups' });
      }
      if (!canManageContent && !selectedGroup && scopedGroups.length === 0) {
        throw new AppError({ code: 'FORBIDDEN', message: 'You can view results only for your reading groups' });
      }
      const visibleGroups = selectedGroup ? [selectedGroup] : scopedGroups;
      return buildQuizSubmissionReport(quiz, visibleGroups, scopedGroups);
    }
    if (department !== 'FOLK') {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only FOLK quiz results are available' });
    }

    const canManageContent = canManageQuizContent(context.user, 'FOLK');
    const canReadFolkSupervisorGroups = canReadFolkQuizResults(context.user);
    if (!canManageContent && !canReadFolkSupervisorGroups) {
      throw new AppError({ code: 'FORBIDDEN', message: 'You do not have access to these quiz results' });
    }

    const scopedGroups = await getQuizGroupsForUser(context.user, 'FOLK', { readOnly: true });
    let selectedGroup = input.groupId ? findScopedQuizGroup(scopedGroups, input.groupId) : null;
    if (!selectedGroup) selectedGroup = findScopedQuizGroup(scopedGroups, quiz.group);
    if (input.groupId && !selectedGroup) {
      throw new AppError({ code: 'FORBIDDEN', message: 'You can view results only for authorized reading groups' });
    }
    if (!selectedGroup) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'A reading group is required to view results' });
    }
    if (selectedGroup && quizRefValues(quiz.group).length > 0 && !legacyQuizMatchesGroup(quiz, selectedGroup.record)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'This quiz does not belong to the selected reading group' });
    }

    const [{ records: submissions }, { records: memberships }, { records: users }] = await Promise.all([
      BvQuizSubmissions.findAll({ filters: { quiz: input.quizId }, limit: 5000 }),
      BvGroupMembers.findAll({
        limit: 5000,
        fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'],
      }).catch(() => ({ records: [] })),
      Users.findAll({
        limit: 5000,
        fields: ['id', 'userId', 'email', 'fullName', 'name'],
      }).catch(() => ({ records: [] })),
    ]);
    const visibleSubmissions = selectedGroup
      ? submissions.filter(submission => submissionMatchesGroup(submission, selectedGroup!.record, memberships))
      : submissions;

    const userByAlias = new Map<string, any>();
    for (const user of users) {
      for (const alias of quizRefValues([user.id, user.userId, user.email, user.fullName, user.name])) {
        userByAlias.set(alias, user);
      }
    }
    const groupByAlias = new Map<string, typeof scopedGroups[0]>();
    for (const group of scopedGroups) {
      for (const alias of quizGroupAliases(group.record)) groupByAlias.set(alias, group);
    }

    const normalizedSubmissions = visibleSubmissions
      .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')))
      .map(submission => {
        const user = quizRefValues([submission.user, submission.userId])
          .map(alias => userByAlias.get(alias))
          .find(Boolean);
        const submissionGroup = quizRefValues([submission.group, submission.groupId])
          .map(alias => groupByAlias.get(alias))
          .find(Boolean) || selectedGroup;
        return {
          id: submission.id,
          userId: user?.userId || submission.userId || submission.user || '',
          userName: user?.fullName || user?.name || 'Unknown',
          groupId: submissionGroup?.id || submission.group || '',
          groupName: submissionGroup?.groupName || 'Reading Group',
          score: submission.score ?? 0,
          totalQuestions: submission.totalQuestions ?? 0,
          percentage: submission.percentage ?? 0,
          submittedAt: submission.submittedAt || '',
          answersJson: submission.answersJson || '[]',
        };
      });

    let questions: any[] = [];
    try { questions = JSON.parse(quiz.questionsJson || '[]'); } catch {}
    const questionAnalytics = questions.map((question: any) => {
      const optionCounts = (Array.isArray(question.options) ? question.options : []).map(() => 0);
      let responses = 0;
      let correctResponses = 0;
      for (const submission of normalizedSubmissions) {
        let answers: any[] = [];
        try { answers = JSON.parse(submission.answersJson || '[]'); } catch {}
        const selected = answers.find(answer => answer.questionId === question.id)?.selected;
        if (!Array.isArray(selected)) continue;
        responses += 1;
        if (answerIsCorrect(question, selected)) correctResponses += 1;
        for (const optionIndex of selected) {
          if (Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex < optionCounts.length) {
            optionCounts[optionIndex] += 1;
          }
        }
      }
      return {
        questionId: question.id,
        questionText: question.text || '',
        options: Array.isArray(question.options) ? question.options : [],
        responses,
        correctResponses,
        correctPercentage: responses ? Math.round((correctResponses / responses) * 100) : 0,
        optionCounts,
      };
    });

    const publicSubmissions = normalizedSubmissions.map(({ answersJson: _answersJson, ...submission }) => submission);
    const averagePercentage = publicSubmissions.length
      ? Math.round(publicSubmissions.reduce((sum, submission) => sum + submission.percentage, 0) / publicSubmissions.length)
      : 0;

    return {
      submissions: publicSubmissions,
      analytics: {
        totalSubmissions: publicSubmissions.length,
        averagePercentage,
        passingCount: publicSubmissions.filter(submission => submission.percentage >= 70).length,
        questionAnalytics,
      },
    };
  },
});

async function buildQuizSubmissionReport(quiz: any, visibleGroups: { id: string; groupName: string; record: any }[], scopedGroups: { id: string; groupName: string; record: any }[]) {
  const [{ records: submissions }, { records: memberships }, { records: users }] = await Promise.all([
    BvQuizSubmissions.findAll({ filters: { quiz: quiz.id }, limit: 5000 }),
    BvGroupMembers.findAll({
      limit: 5000,
      fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'],
    }).catch(() => ({ records: [] })),
    Users.findAll({
      limit: 5000,
      fields: ['id', 'userId', 'email', 'fullName', 'name'],
    }).catch(() => ({ records: [] })),
  ]);
  const visibleSubmissions = submissions.filter(submission =>
    visibleGroups.some(group => submissionMatchesGroup(submission, group.record, memberships))
  );
  const userByAlias = new Map<string, any>();
  for (const user of users) {
    for (const alias of quizRefValues([user.id, user.userId, user.email, user.fullName, user.name])) {
      userByAlias.set(alias, user);
    }
  }
  const groupByAlias = new Map<string, typeof scopedGroups[0]>();
  for (const group of scopedGroups) {
    for (const alias of quizGroupAliases(group.record)) groupByAlias.set(alias, group);
  }
  const normalizedSubmissions = visibleSubmissions
    .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')))
    .map(submission => {
      const user = quizRefValues([submission.user, submission.userId]).map(alias => userByAlias.get(alias)).find(Boolean);
      const submissionGroup = quizRefValues([submission.group, submission.groupId]).map(alias => groupByAlias.get(alias)).find(Boolean);
      return {
        id: submission.id,
        userId: user?.userId || submission.userId || submission.user || '',
        userName: user?.fullName || user?.name || 'Unknown',
        groupId: submissionGroup?.id || submission.group || '',
        groupName: submissionGroup?.groupName || 'Reading Group',
        score: submission.score ?? 0,
        totalQuestions: submission.totalQuestions ?? 0,
        percentage: submission.percentage ?? 0,
        submittedAt: submission.submittedAt || '',
        answersJson: submission.answersJson || '[]',
      };
    });

  let questions: any[] = [];
  try { questions = JSON.parse(quiz.questionsJson || '[]'); } catch {}
  const questionAnalytics = questions.map((question: any) => {
    const optionCounts = (Array.isArray(question.options) ? question.options : []).map(() => 0);
    let responses = 0;
    let correctResponses = 0;
    for (const submission of normalizedSubmissions) {
      let answers: any[] = [];
      try { answers = JSON.parse(submission.answersJson || '[]'); } catch {}
      const selected = answers.find(answer => answer.questionId === question.id)?.selected;
      if (!Array.isArray(selected)) continue;
      responses += 1;
      if (answerIsCorrect(question, selected)) correctResponses += 1;
      for (const optionIndex of selected) {
        if (Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex < optionCounts.length) {
          optionCounts[optionIndex] += 1;
        }
      }
    }
    return {
      questionId: question.id,
      questionText: question.text || '',
      options: Array.isArray(question.options) ? question.options : [],
      responses,
      correctResponses,
      correctPercentage: responses ? Math.round((correctResponses / responses) * 100) : 0,
      optionCounts,
    };
  });
  const publicSubmissions = normalizedSubmissions.map(({ answersJson: _answersJson, ...submission }) => submission);
  const averagePercentage = publicSubmissions.length
    ? Math.round(publicSubmissions.reduce((sum, submission) => sum + submission.percentage, 0) / publicSubmissions.length)
    : 0;
  return {
    submissions: publicSubmissions,
    analytics: {
      totalSubmissions: publicSubmissions.length,
      averagePercentage,
      passingCount: publicSubmissions.filter(submission => submission.percentage >= 70).length,
      questionAnalytics,
    },
  };
}
