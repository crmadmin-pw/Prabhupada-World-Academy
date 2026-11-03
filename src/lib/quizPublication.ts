import { AppError } from '@/lib/backend-sdk';

export function isQuizDraft(quiz: { publicationStatus?: unknown } | null | undefined): boolean {
  return quiz?.publicationStatus === 'draft';
}

export function canReadQuizDraft(quiz: { publicationStatus?: unknown; createdBy?: unknown }, user: { id?: unknown }): boolean {
  return !isQuizDraft(quiz) || (!!user.id && quiz.createdBy === user.id);
}

export function assertQuizDraftOwner(quiz: { publicationStatus?: unknown; createdBy?: unknown }, user: { id?: unknown }): void {
  if (!canReadQuizDraft(quiz, user)) {
    throw new AppError({ code: 'FORBIDDEN', message: 'This quiz draft is private to its creator' });
  }
}
