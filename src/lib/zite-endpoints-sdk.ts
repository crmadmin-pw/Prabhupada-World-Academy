// ══════════════════════════════════════════════════════════════════════════════
// zite-endpoints-sdk.ts — Auto-generated client-side SDK for calling API routes.
// ══════════════════════════════════════════════════════════════════════════════

async function invokeEndpoint(name: string, input: any): Promise<any> {
  // Retrieve Firebase ID Token (auth header)
  let idToken = '';
  try {
    // Get auth token from global window or auth cache if set
    idToken = (window as any).__firebase_id_token || '';
  } catch {
    // ignore on server-side
  }

  const res = await fetch(`/api/run/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'API request failed');
  }
  return res.json();
}

import type acceptSwap_Type from '../api/acceptSwap';
type acceptSwap_Input = Parameters<typeof acceptSwap_Type.execute>[0]['input'];
type acceptSwap_Output = ReturnType<typeof acceptSwap_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof acceptSwap_Type.execute>;
export const acceptSwap = (input: acceptSwap_Input): Promise<acceptSwap_Output> => invokeEndpoint('acceptSwap', input);
export type AcceptSwapOutputType = acceptSwap_Output;
export type AcceptSwapInputType = acceptSwap_Input;

import type addGroupMember_Type from '../api/addGroupMember';
type addGroupMember_Input = Parameters<typeof addGroupMember_Type.execute>[0]['input'];
type addGroupMember_Output = ReturnType<typeof addGroupMember_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof addGroupMember_Type.execute>;
export const addGroupMember = (input: addGroupMember_Input): Promise<addGroupMember_Output> => invokeEndpoint('addGroupMember', input);
export type AddGroupMemberOutputType = addGroupMember_Output;
export type AddGroupMemberInputType = addGroupMember_Input;

import type addMySkill_Type from '../api/addMySkill';
type addMySkill_Input = Parameters<typeof addMySkill_Type.execute>[0]['input'];
type addMySkill_Output = ReturnType<typeof addMySkill_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof addMySkill_Type.execute>;
export const addMySkill = (input: addMySkill_Input): Promise<addMySkill_Output> => invokeEndpoint('addMySkill', input);
export type AddMySkillOutputType = addMySkill_Output;
export type AddMySkillInputType = addMySkill_Input;

import type addRentPayment_Type from '../api/addRentPayment';
type addRentPayment_Input = Parameters<typeof addRentPayment_Type.execute>[0]['input'];
type addRentPayment_Output = ReturnType<typeof addRentPayment_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof addRentPayment_Type.execute>;
export const addRentPayment = (input: addRentPayment_Input): Promise<addRentPayment_Output> => invokeEndpoint('addRentPayment', input);
export type AddRentPaymentOutputType = addRentPayment_Output;
export type AddRentPaymentInputType = addRentPayment_Input;

import type addTrip_Type from '../api/addTrip';
type addTrip_Input = Parameters<typeof addTrip_Type.execute>[0]['input'];
type addTrip_Output = ReturnType<typeof addTrip_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof addTrip_Type.execute>;
export const addTrip = (input: addTrip_Input): Promise<addTrip_Output> => invokeEndpoint('addTrip', input);
export type AddTripOutputType = addTrip_Output;
export type AddTripInputType = addTrip_Input;

import type approveAshrayUpgrade_Type from '../api/approveAshrayUpgrade';
type approveAshrayUpgrade_Input = Parameters<typeof approveAshrayUpgrade_Type.execute>[0]['input'];
type approveAshrayUpgrade_Output = ReturnType<typeof approveAshrayUpgrade_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof approveAshrayUpgrade_Type.execute>;
export const approveAshrayUpgrade = (input: approveAshrayUpgrade_Input): Promise<approveAshrayUpgrade_Output> => invokeEndpoint('approveAshrayUpgrade', input);
export type ApproveAshrayUpgradeOutputType = approveAshrayUpgrade_Output;
export type ApproveAshrayUpgradeInputType = approveAshrayUpgrade_Input;

import type approveBvJoinRequest_Type from '../api/approveBvJoinRequest';
type approveBvJoinRequest_Input = Parameters<typeof approveBvJoinRequest_Type.execute>[0]['input'];
type approveBvJoinRequest_Output = ReturnType<typeof approveBvJoinRequest_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof approveBvJoinRequest_Type.execute>;
export const approveBvJoinRequest = (input: approveBvJoinRequest_Input): Promise<approveBvJoinRequest_Output> => invokeEndpoint('approveBvJoinRequest', input);
export type ApproveBvJoinRequestOutputType = approveBvJoinRequest_Output;
export type ApproveBvJoinRequestInputType = approveBvJoinRequest_Input;

import type approveGuideTransfer_Type from '../api/approveGuideTransfer';
type approveGuideTransfer_Input = Parameters<typeof approveGuideTransfer_Type.execute>[0]['input'];
type approveGuideTransfer_Output = ReturnType<typeof approveGuideTransfer_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof approveGuideTransfer_Type.execute>;
export const approveGuideTransfer = (input: approveGuideTransfer_Input): Promise<approveGuideTransfer_Output> => invokeEndpoint('approveGuideTransfer', input);
export type ApproveGuideTransferOutputType = approveGuideTransfer_Output;
export type ApproveGuideTransferInputType = approveGuideTransfer_Input;

import type approveRentCorrection_Type from '../api/approveRentCorrection';
type approveRentCorrection_Input = Parameters<typeof approveRentCorrection_Type.execute>[0]['input'];
type approveRentCorrection_Output = ReturnType<typeof approveRentCorrection_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof approveRentCorrection_Type.execute>;
export const approveRentCorrection = (input: approveRentCorrection_Input): Promise<approveRentCorrection_Output> => invokeEndpoint('approveRentCorrection', input);
export type ApproveRentCorrectionOutputType = approveRentCorrection_Output;
export type ApproveRentCorrectionInputType = approveRentCorrection_Input;

import type approveResidencyTransfer_Type from '../api/approveResidencyTransfer';
type approveResidencyTransfer_Input = Parameters<typeof approveResidencyTransfer_Type.execute>[0]['input'];
type approveResidencyTransfer_Output = ReturnType<typeof approveResidencyTransfer_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof approveResidencyTransfer_Type.execute>;
export const approveResidencyTransfer = (input: approveResidencyTransfer_Input): Promise<approveResidencyTransfer_Output> => invokeEndpoint('approveResidencyTransfer', input);
export type ApproveResidencyTransferOutputType = approveResidencyTransfer_Output;
export type ApproveResidencyTransferInputType = approveResidencyTransfer_Input;

import type approveTripCorrection_Type from '../api/approveTripCorrection';
type approveTripCorrection_Input = Parameters<typeof approveTripCorrection_Type.execute>[0]['input'];
type approveTripCorrection_Output = ReturnType<typeof approveTripCorrection_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof approveTripCorrection_Type.execute>;
export const approveTripCorrection = (input: approveTripCorrection_Input): Promise<approveTripCorrection_Output> => invokeEndpoint('approveTripCorrection', input);
export type ApproveTripCorrectionOutputType = approveTripCorrection_Output;
export type ApproveTripCorrectionInputType = approveTripCorrection_Input;

import type approveUnavailability_Type from '../api/approveUnavailability';
type approveUnavailability_Input = Parameters<typeof approveUnavailability_Type.execute>[0]['input'];
type approveUnavailability_Output = ReturnType<typeof approveUnavailability_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof approveUnavailability_Type.execute>;
export const approveUnavailability = (input: approveUnavailability_Input): Promise<approveUnavailability_Output> => invokeEndpoint('approveUnavailability', input);
export type ApproveUnavailabilityOutputType = approveUnavailability_Output;
export type ApproveUnavailabilityInputType = approveUnavailability_Input;

import type approveUser_Type from '../api/approveUser';
type approveUser_Input = Parameters<typeof approveUser_Type.execute>[0]['input'];
type approveUser_Output = ReturnType<typeof approveUser_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof approveUser_Type.execute>;
export const approveUser = (input: approveUser_Input): Promise<approveUser_Output> => invokeEndpoint('approveUser', input);
export type ApproveUserOutputType = approveUser_Output;
export type ApproveUserInputType = approveUser_Input;

import type archiveSadhanaData_Type from '../api/archiveSadhanaData';
type archiveSadhanaData_Input = Parameters<typeof archiveSadhanaData_Type.execute>[0]['input'];
type archiveSadhanaData_Output = ReturnType<typeof archiveSadhanaData_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof archiveSadhanaData_Type.execute>;
export const archiveSadhanaData = (input: archiveSadhanaData_Input): Promise<archiveSadhanaData_Output> => invokeEndpoint('archiveSadhanaData', input);
export type ArchiveSadhanaDataOutputType = archiveSadhanaData_Output;
export type ArchiveSadhanaDataInputType = archiveSadhanaData_Input;

import type assignGuide_Type from '../api/assignGuide';
type assignGuide_Input = Parameters<typeof assignGuide_Type.execute>[0]['input'];
type assignGuide_Output = ReturnType<typeof assignGuide_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof assignGuide_Type.execute>;
export const assignGuide = (input: assignGuide_Input): Promise<assignGuide_Output> => invokeEndpoint('assignGuide', input);
export type AssignGuideOutputType = assignGuide_Output;
export type AssignGuideInputType = assignGuide_Input;

import type assignScholarStatus_Type from '../api/assignScholarStatus';
type assignScholarStatus_Input = Parameters<typeof assignScholarStatus_Type.execute>[0]['input'];
type assignScholarStatus_Output = ReturnType<typeof assignScholarStatus_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof assignScholarStatus_Type.execute>;
export const assignScholarStatus = (input: assignScholarStatus_Input): Promise<assignScholarStatus_Output> => invokeEndpoint('assignScholarStatus', input);
export type AssignScholarStatusOutputType = assignScholarStatus_Output;
export type AssignScholarStatusInputType = assignScholarStatus_Input;

import type autoGenerateAllocation_Type from '../api/autoGenerateAllocation';
type autoGenerateAllocation_Input = Parameters<typeof autoGenerateAllocation_Type.execute>[0]['input'];
type autoGenerateAllocation_Output = ReturnType<typeof autoGenerateAllocation_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof autoGenerateAllocation_Type.execute>;
export const autoGenerateAllocation = (input: autoGenerateAllocation_Input): Promise<autoGenerateAllocation_Output> => invokeEndpoint('autoGenerateAllocation', input);
export type AutoGenerateAllocationOutputType = autoGenerateAllocation_Output;
export type AutoGenerateAllocationInputType = autoGenerateAllocation_Input;

import type backfillSessionMatrix_Type from '../api/backfillSessionMatrix';
type backfillSessionMatrix_Input = Parameters<typeof backfillSessionMatrix_Type.execute>[0]['input'];
type backfillSessionMatrix_Output = ReturnType<typeof backfillSessionMatrix_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof backfillSessionMatrix_Type.execute>;
export const backfillSessionMatrix = (input: backfillSessionMatrix_Input): Promise<backfillSessionMatrix_Output> => invokeEndpoint('backfillSessionMatrix', input);
export type BackfillSessionMatrixOutputType = backfillSessionMatrix_Output;
export type BackfillSessionMatrixInputType = backfillSessionMatrix_Input;

import type bulkAddGroupMembers_Type from '../api/bulkAddGroupMembers';
type bulkAddGroupMembers_Input = Parameters<typeof bulkAddGroupMembers_Type.execute>[0]['input'];
type bulkAddGroupMembers_Output = ReturnType<typeof bulkAddGroupMembers_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof bulkAddGroupMembers_Type.execute>;
export const bulkAddGroupMembers = (input: bulkAddGroupMembers_Input): Promise<bulkAddGroupMembers_Output> => invokeEndpoint('bulkAddGroupMembers', input);
export type BulkAddGroupMembersOutputType = bulkAddGroupMembers_Output;
export type BulkAddGroupMembersInputType = bulkAddGroupMembers_Input;

import type bulkSubmitAvailability_Type from '../api/bulkSubmitAvailability';
type bulkSubmitAvailability_Input = Parameters<typeof bulkSubmitAvailability_Type.execute>[0]['input'];
type bulkSubmitAvailability_Output = ReturnType<typeof bulkSubmitAvailability_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof bulkSubmitAvailability_Type.execute>;
export const bulkSubmitAvailability = (input: bulkSubmitAvailability_Input): Promise<bulkSubmitAvailability_Output> => invokeEndpoint('bulkSubmitAvailability', input);
export type BulkSubmitAvailabilityOutputType = bulkSubmitAvailability_Output;
export type BulkSubmitAvailabilityInputType = bulkSubmitAvailability_Input;

import type bulkTagMangoEnroll_Type from '../api/bulkTagMangoEnroll';
type bulkTagMangoEnroll_Input = Parameters<typeof bulkTagMangoEnroll_Type.execute>[0]['input'];
type bulkTagMangoEnroll_Output = ReturnType<typeof bulkTagMangoEnroll_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof bulkTagMangoEnroll_Type.execute>;
export const bulkTagMangoEnroll = (input: bulkTagMangoEnroll_Input): Promise<bulkTagMangoEnroll_Output> => invokeEndpoint('bulkTagMangoEnroll', input);
export type BulkTagMangoEnrollOutputType = bulkTagMangoEnroll_Output;
export type BulkTagMangoEnrollInputType = bulkTagMangoEnroll_Input;

import type bulkUpdateUserFlags_Type from '../api/bulkUpdateUserFlags';
type bulkUpdateUserFlags_Input = Parameters<typeof bulkUpdateUserFlags_Type.execute>[0]['input'];
type bulkUpdateUserFlags_Output = ReturnType<typeof bulkUpdateUserFlags_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof bulkUpdateUserFlags_Type.execute>;
export const bulkUpdateUserFlags = (input: bulkUpdateUserFlags_Input): Promise<bulkUpdateUserFlags_Output> => invokeEndpoint('bulkUpdateUserFlags', input);
export type BulkUpdateUserFlagsOutputType = bulkUpdateUserFlags_Output;
export type BulkUpdateUserFlagsInputType = bulkUpdateUserFlags_Input;

import type checkAllocationPublished_Type from '../api/checkAllocationPublished';
type checkAllocationPublished_Input = Parameters<typeof checkAllocationPublished_Type.execute>[0]['input'];
type checkAllocationPublished_Output = ReturnType<typeof checkAllocationPublished_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof checkAllocationPublished_Type.execute>;
export const checkAllocationPublished = (input: checkAllocationPublished_Input): Promise<checkAllocationPublished_Output> => invokeEndpoint('checkAllocationPublished', input);
export type CheckAllocationPublishedOutputType = checkAllocationPublished_Output;
export type CheckAllocationPublishedInputType = checkAllocationPublished_Input;

import type checkAndMarkOverdue_Type from '../api/checkAndMarkOverdue';
type checkAndMarkOverdue_Input = Parameters<typeof checkAndMarkOverdue_Type.execute>[0]['input'];
type checkAndMarkOverdue_Output = ReturnType<typeof checkAndMarkOverdue_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof checkAndMarkOverdue_Type.execute>;
export const checkAndMarkOverdue = (input: checkAndMarkOverdue_Input): Promise<checkAndMarkOverdue_Output> => invokeEndpoint('checkAndMarkOverdue', input);
export type CheckAndMarkOverdueOutputType = checkAndMarkOverdue_Output;
export type CheckAndMarkOverdueInputType = checkAndMarkOverdue_Input;

import type checkEmailStatus_Type from '../api/checkEmailStatus';
type checkEmailStatus_Input = any;
type checkEmailStatus_Output = any;
export const checkEmailStatus = (input: { email: string }): Promise<{ exists: boolean; role?: string }> => invokeEndpoint('checkEmailStatus', input);
export type CheckEmailStatusOutputType = checkEmailStatus_Output;
export type CheckEmailStatusInputType = checkEmailStatus_Input;

import type checkGuideEmail_Type from '../api/checkGuideEmail';
type checkGuideEmail_Input = Parameters<typeof checkGuideEmail_Type.execute>[0]['input'];
type checkGuideEmail_Output = ReturnType<typeof checkGuideEmail_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof checkGuideEmail_Type.execute>;
export const checkGuideEmail = (input: checkGuideEmail_Input): Promise<checkGuideEmail_Output> => invokeEndpoint('checkGuideEmail', input);
export type CheckGuideEmailOutputType = checkGuideEmail_Output;
export type CheckGuideEmailInputType = checkGuideEmail_Input;

import type conductBvSession_Type from '../api/conductBvSession';
type conductBvSession_Input = Parameters<typeof conductBvSession_Type.execute>[0]['input'];
type conductBvSession_Output = ReturnType<typeof conductBvSession_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof conductBvSession_Type.execute>;
export const conductBvSession = (input: conductBvSession_Input): Promise<conductBvSession_Output> => invokeEndpoint('conductBvSession', input);
export type ConductBvSessionOutputType = conductBvSession_Output;
export type ConductBvSessionInputType = conductBvSession_Input;

import type copyLastWeekAllocation_Type from '../api/copyLastWeekAllocation';
type copyLastWeekAllocation_Input = Parameters<typeof copyLastWeekAllocation_Type.execute>[0]['input'];
type copyLastWeekAllocation_Output = ReturnType<typeof copyLastWeekAllocation_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof copyLastWeekAllocation_Type.execute>;
export const copyLastWeekAllocation = (input: copyLastWeekAllocation_Input): Promise<copyLastWeekAllocation_Output> => invokeEndpoint('copyLastWeekAllocation', input);
export type CopyLastWeekAllocationOutputType = copyLastWeekAllocation_Output;
export type CopyLastWeekAllocationInputType = copyLastWeekAllocation_Input;

import type courseCompleted10_Type from '../api/courseCompleted10';
type courseCompleted10_Input = Parameters<typeof courseCompleted10_Type.execute>[0]['input'];
type courseCompleted10_Output = ReturnType<typeof courseCompleted10_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof courseCompleted10_Type.execute>;
export const courseCompleted10 = (input: courseCompleted10_Input): Promise<courseCompleted10_Output> => invokeEndpoint('courseCompleted10', input);
export type CourseCompleted10OutputType = courseCompleted10_Output;
export type CourseCompleted10InputType = courseCompleted10_Input;

import type courseCompleted100_Type from '../api/courseCompleted100';
type courseCompleted100_Input = Parameters<typeof courseCompleted100_Type.execute>[0]['input'];
type courseCompleted100_Output = ReturnType<typeof courseCompleted100_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof courseCompleted100_Type.execute>;
export const courseCompleted100 = (input: courseCompleted100_Input): Promise<courseCompleted100_Output> => invokeEndpoint('courseCompleted100', input);
export type CourseCompleted100OutputType = courseCompleted100_Output;
export type CourseCompleted100InputType = courseCompleted100_Input;

import type courseCompleted50_Type from '../api/courseCompleted50';
type courseCompleted50_Input = Parameters<typeof courseCompleted50_Type.execute>[0]['input'];
type courseCompleted50_Output = ReturnType<typeof courseCompleted50_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof courseCompleted50_Type.execute>;
export const courseCompleted50 = (input: courseCompleted50_Input): Promise<courseCompleted50_Output> => invokeEndpoint('courseCompleted50', input);
export type CourseCompleted50OutputType = courseCompleted50_Output;
export type CourseCompleted50InputType = courseCompleted50_Input;

import type createAllocation_Type from '../api/createAllocation';
type createAllocation_Input = Parameters<typeof createAllocation_Type.execute>[0]['input'];
type createAllocation_Output = ReturnType<typeof createAllocation_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof createAllocation_Type.execute>;
export const createAllocation = (input: createAllocation_Input): Promise<createAllocation_Output> => invokeEndpoint('createAllocation', input);
export type CreateAllocationOutputType = createAllocation_Output;
export type CreateAllocationInputType = createAllocation_Input;

import type createAttendanceEvent_Type from '../api/createAttendanceEvent';
type createAttendanceEvent_Input = Parameters<typeof createAttendanceEvent_Type.execute>[0]['input'];
type createAttendanceEvent_Output = ReturnType<typeof createAttendanceEvent_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof createAttendanceEvent_Type.execute>;
export const createAttendanceEvent = (input: createAttendanceEvent_Input): Promise<createAttendanceEvent_Output> => invokeEndpoint('createAttendanceEvent', input);
export type CreateAttendanceEventOutputType = createAttendanceEvent_Output;
export type CreateAttendanceEventInputType = createAttendanceEvent_Input;

import type createAttendanceSession_Type from '../api/createAttendanceSession';
type createAttendanceSession_Input = Parameters<typeof createAttendanceSession_Type.execute>[0]['input'];
type createAttendanceSession_Output = ReturnType<typeof createAttendanceSession_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof createAttendanceSession_Type.execute>;
export const createAttendanceSession = (input: createAttendanceSession_Input): Promise<createAttendanceSession_Output> => invokeEndpoint('createAttendanceSession', input);
export type CreateAttendanceSessionOutputType = createAttendanceSession_Output;
export type CreateAttendanceSessionInputType = createAttendanceSession_Input;

import type createBvGroup_Type from '../api/createBvGroup';
type createBvGroup_Input = Parameters<typeof createBvGroup_Type.execute>[0]['input'];
type createBvGroup_Output = ReturnType<typeof createBvGroup_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof createBvGroup_Type.execute>;
export const createBvGroup = (input: createBvGroup_Input): Promise<createBvGroup_Output> => invokeEndpoint('createBvGroup', input);
export type CreateBvGroupOutputType = createBvGroup_Output;
export type CreateBvGroupInputType = createBvGroup_Input;

import type createBvQuiz_Type from '../api/createBvQuiz';
type createBvQuiz_Input = Parameters<typeof createBvQuiz_Type.execute>[0]['input'];
type createBvQuiz_Output = ReturnType<typeof createBvQuiz_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof createBvQuiz_Type.execute>;
export const createBvQuiz = (input: createBvQuiz_Input): Promise<createBvQuiz_Output> => invokeEndpoint('createBvQuiz', input);
export type CreateBvQuizOutputType = createBvQuiz_Output;
export type CreateBvQuizInputType = createBvQuiz_Input;

import type createGroup_Type from '../api/createGroup';
type createGroup_Input = Parameters<typeof createGroup_Type.execute>[0]['input'];
type createGroup_Output = ReturnType<typeof createGroup_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof createGroup_Type.execute>;
export const createGroup = (input: createGroup_Input): Promise<createGroup_Output> => invokeEndpoint('createGroup', input);
export type CreateGroupOutputType = createGroup_Output;
export type CreateGroupInputType = createGroup_Input;

import type createGroupForBvsl_Type from '../api/createGroupForBvsl';
type createGroupForBvsl_Input = Parameters<typeof createGroupForBvsl_Type.execute>[0]['input'];
type createGroupForBvsl_Output = ReturnType<typeof createGroupForBvsl_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof createGroupForBvsl_Type.execute>;
export const createGroupForBvsl = (input: createGroupForBvsl_Input): Promise<createGroupForBvsl_Output> => invokeEndpoint('createGroupForBvsl', input);
export type CreateGroupForBvslOutputType = createGroupForBvsl_Output;
export type CreateGroupForBvslInputType = createGroupForBvsl_Input;

import type createResidency_Type from '../api/createResidency';
type createResidency_Input = Parameters<typeof createResidency_Type.execute>[0]['input'];
type createResidency_Output = ReturnType<typeof createResidency_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof createResidency_Type.execute>;
export const createResidency = (input: createResidency_Input): Promise<createResidency_Output> => invokeEndpoint('createResidency', input);
export type CreateResidencyOutputType = createResidency_Output;
export type CreateResidencyInputType = createResidency_Input;

import type createService_Type from '../api/createService';
type createService_Input = Parameters<typeof createService_Type.execute>[0]['input'];
type createService_Output = ReturnType<typeof createService_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof createService_Type.execute>;
export const createService = (input: createService_Input): Promise<createService_Output> => invokeEndpoint('createService', input);
export type CreateServiceOutputType = createService_Output;
export type CreateServiceInputType = createService_Input;

import type deleteAccount_Type from '../api/deleteAccount';
type deleteAccount_Input = Parameters<typeof deleteAccount_Type.execute>[0]['input'];
type deleteAccount_Output = ReturnType<typeof deleteAccount_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof deleteAccount_Type.execute>;
export const deleteAccount = (input: deleteAccount_Input): Promise<deleteAccount_Output> => invokeEndpoint('deleteAccount', input);
export type DeleteAccountOutputType = deleteAccount_Output;
export type DeleteAccountInputType = deleteAccount_Input;

import type deleteBvGroup_Type from '../api/deleteBvGroup';
type deleteBvGroup_Input = Parameters<typeof deleteBvGroup_Type.execute>[0]['input'];
type deleteBvGroup_Output = ReturnType<typeof deleteBvGroup_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof deleteBvGroup_Type.execute>;
export const deleteBvGroup = (input: deleteBvGroup_Input): Promise<deleteBvGroup_Output> => invokeEndpoint('deleteBvGroup', input);
export type DeleteBvGroupOutputType = deleteBvGroup_Output;
export type DeleteBvGroupInputType = deleteBvGroup_Input;

import type deleteBvQuiz_Type from '../api/deleteBvQuiz';
type deleteBvQuiz_Input = Parameters<typeof deleteBvQuiz_Type.execute>[0]['input'];
type deleteBvQuiz_Output = ReturnType<typeof deleteBvQuiz_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof deleteBvQuiz_Type.execute>;
export const deleteBvQuiz = (input: deleteBvQuiz_Input): Promise<deleteBvQuiz_Output> => invokeEndpoint('deleteBvQuiz', input);
export type DeleteBvQuizOutputType = deleteBvQuiz_Output;
export type DeleteBvQuizInputType = deleteBvQuiz_Input;

import type deleteOneToOneMeeting_Type from '../api/deleteOneToOneMeeting';
type deleteOneToOneMeeting_Input = Parameters<typeof deleteOneToOneMeeting_Type.execute>[0]['input'];
type deleteOneToOneMeeting_Output = ReturnType<typeof deleteOneToOneMeeting_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof deleteOneToOneMeeting_Type.execute>;
export const deleteOneToOneMeeting = (input: deleteOneToOneMeeting_Input): Promise<deleteOneToOneMeeting_Output> => invokeEndpoint('deleteOneToOneMeeting', input);
export type DeleteOneToOneMeetingOutputType = deleteOneToOneMeeting_Output;
export type DeleteOneToOneMeetingInputType = deleteOneToOneMeeting_Input;

import type deleteService_Type from '../api/deleteService';
type deleteService_Input = Parameters<typeof deleteService_Type.execute>[0]['input'];
type deleteService_Output = ReturnType<typeof deleteService_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof deleteService_Type.execute>;
export const deleteService = (input: deleteService_Input): Promise<deleteService_Output> => invokeEndpoint('deleteService', input);
export type DeleteServiceOutputType = deleteService_Output;
export type DeleteServiceInputType = deleteService_Input;

import type exportRentPayments_Type from '../api/exportRentPayments';
type exportRentPayments_Input = Parameters<typeof exportRentPayments_Type.execute>[0]['input'];
type exportRentPayments_Output = ReturnType<typeof exportRentPayments_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof exportRentPayments_Type.execute>;
export const exportRentPayments = (input: exportRentPayments_Input): Promise<exportRentPayments_Output> => invokeEndpoint('exportRentPayments', input);
export type ExportRentPaymentsOutputType = exportRentPayments_Output;
export type ExportRentPaymentsInputType = exportRentPayments_Input;

import type exportServiceAllocation_Type from '../api/exportServiceAllocation';
type exportServiceAllocation_Input = Parameters<typeof exportServiceAllocation_Type.execute>[0]['input'];
type exportServiceAllocation_Output = ReturnType<typeof exportServiceAllocation_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof exportServiceAllocation_Type.execute>;
export const exportServiceAllocation = (input: exportServiceAllocation_Input): Promise<exportServiceAllocation_Output> => invokeEndpoint('exportServiceAllocation', input);
export type ExportServiceAllocationOutputType = exportServiceAllocation_Output;
export type ExportServiceAllocationInputType = exportServiceAllocation_Input;

import type exportTrips_Type from '../api/exportTrips';
type exportTrips_Input = Parameters<typeof exportTrips_Type.execute>[0]['input'];
type exportTrips_Output = ReturnType<typeof exportTrips_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof exportTrips_Type.execute>;
export const exportTrips = (input: exportTrips_Input): Promise<exportTrips_Output> => invokeEndpoint('exportTrips', input);
export type ExportTripsOutputType = exportTrips_Output;
export type ExportTripsInputType = exportTrips_Input;

import type exportUserData_Type from '../api/exportUserData';
type exportUserData_Input = Parameters<typeof exportUserData_Type.execute>[0]['input'];
type exportUserData_Output = ReturnType<typeof exportUserData_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof exportUserData_Type.execute>;
export const exportUserData = (input: exportUserData_Input): Promise<exportUserData_Output> => invokeEndpoint('exportUserData', input);
export type ExportUserDataOutputType = exportUserData_Output;
export type ExportUserDataInputType = exportUserData_Input;

import type fixGuideIds_Type from '../api/fixGuideIds';
type fixGuideIds_Input = Parameters<typeof fixGuideIds_Type.execute>[0]['input'];
type fixGuideIds_Output = ReturnType<typeof fixGuideIds_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof fixGuideIds_Type.execute>;
export const fixGuideIds = (input: fixGuideIds_Input): Promise<fixGuideIds_Output> => invokeEndpoint('fixGuideIds', input);
export type FixGuideIdsOutputType = fixGuideIds_Output;
export type FixGuideIdsInputType = fixGuideIds_Input;

import type getAllBvGroups_Type from '../api/getAllBvGroups';
type getAllBvGroups_Input = Parameters<typeof getAllBvGroups_Type.execute>[0]['input'];
type getAllBvGroups_Output = ReturnType<typeof getAllBvGroups_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getAllBvGroups_Type.execute>;
export const getAllBvGroups = (input: getAllBvGroups_Input): Promise<getAllBvGroups_Output> => invokeEndpoint('getAllBvGroups', input);
export type GetAllBvGroupsOutputType = getAllBvGroups_Output;
export type GetAllBvGroupsInputType = getAllBvGroups_Input;

import type getAllBvGroupsAdmin_Type from '../api/getAllBvGroupsAdmin';
type getAllBvGroupsAdmin_Input = Parameters<typeof getAllBvGroupsAdmin_Type.execute>[0]['input'];
type getAllBvGroupsAdmin_Output = ReturnType<typeof getAllBvGroupsAdmin_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getAllBvGroupsAdmin_Type.execute>;
export const getAllBvGroupsAdmin = (input: getAllBvGroupsAdmin_Input): Promise<getAllBvGroupsAdmin_Output> => invokeEndpoint('getAllBvGroupsAdmin', input);
export type GetAllBvGroupsAdminOutputType = getAllBvGroupsAdmin_Output;
export type GetAllBvGroupsAdminInputType = getAllBvGroupsAdmin_Input;

import type getAllResidencies_Type from '../api/getAllResidencies';
type getAllResidencies_Input = Parameters<typeof getAllResidencies_Type.execute>[0]['input'];
type getAllResidencies_Output = ReturnType<typeof getAllResidencies_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getAllResidencies_Type.execute>;
export const getAllResidencies = (input: getAllResidencies_Input): Promise<getAllResidencies_Output> => invokeEndpoint('getAllResidencies', input);
export type GetAllResidenciesOutputType = getAllResidencies_Output;
export type GetAllResidenciesInputType = getAllResidencies_Input;

import type getAllResidenciesWithStats_Type from '../api/getAllResidenciesWithStats';
type getAllResidenciesWithStats_Input = Parameters<typeof getAllResidenciesWithStats_Type.execute>[0]['input'];
type getAllResidenciesWithStats_Output = ReturnType<typeof getAllResidenciesWithStats_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getAllResidenciesWithStats_Type.execute>;
export const getAllResidenciesWithStats = (input: getAllResidenciesWithStats_Input): Promise<getAllResidenciesWithStats_Output> => invokeEndpoint('getAllResidenciesWithStats', input);
export type GetAllResidenciesWithStatsOutputType = getAllResidenciesWithStats_Output;
export type GetAllResidenciesWithStatsInputType = getAllResidenciesWithStats_Input;

import type getAllocationBoard_Type from '../api/getAllocationBoard';
type getAllocationBoard_Input = Parameters<typeof getAllocationBoard_Type.execute>[0]['input'];
type getAllocationBoard_Output = ReturnType<typeof getAllocationBoard_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getAllocationBoard_Type.execute>;
export const getAllocationBoard = (input: getAllocationBoard_Input): Promise<getAllocationBoard_Output> => invokeEndpoint('getAllocationBoard', input);
export type GetAllocationBoardOutputType = getAllocationBoard_Output;
export type GetAllocationBoardInputType = getAllocationBoard_Input;

import type getArchiveStats_Type from '../api/getArchiveStats';
type getArchiveStats_Input = Parameters<typeof getArchiveStats_Type.execute>[0]['input'];
type getArchiveStats_Output = ReturnType<typeof getArchiveStats_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getArchiveStats_Type.execute>;
export const getArchiveStats = (input: getArchiveStats_Input): Promise<getArchiveStats_Output> => invokeEndpoint('getArchiveStats', input);
export type GetArchiveStatsOutputType = getArchiveStats_Output;
export type GetArchiveStatsInputType = getArchiveStats_Input;

import type getAshrayChecklist_Type from '../api/getAshrayChecklist';
type getAshrayChecklist_Input = Parameters<typeof getAshrayChecklist_Type.execute>[0]['input'];
type getAshrayChecklist_Output = ReturnType<typeof getAshrayChecklist_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getAshrayChecklist_Type.execute>;
export const getAshrayChecklist = (input: getAshrayChecklist_Input): Promise<getAshrayChecklist_Output> => invokeEndpoint('getAshrayChecklist', input);
export type GetAshrayChecklistOutputType = getAshrayChecklist_Output;
export type GetAshrayChecklistInputType = getAshrayChecklist_Input;

import type getAshrayUpgradePath_Type from '../api/getAshrayUpgradePath';
type getAshrayUpgradePath_Input = Parameters<typeof getAshrayUpgradePath_Type.execute>[0]['input'];
type getAshrayUpgradePath_Output = ReturnType<typeof getAshrayUpgradePath_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getAshrayUpgradePath_Type.execute>;
export const getAshrayUpgradePath = (input: getAshrayUpgradePath_Input): Promise<getAshrayUpgradePath_Output> => invokeEndpoint('getAshrayUpgradePath', input);
export type GetAshrayUpgradePathOutputType = getAshrayUpgradePath_Output;
export type GetAshrayUpgradePathInputType = getAshrayUpgradePath_Input;

import type getAttendanceDashboard_Type from '../api/getAttendanceDashboard';
type getAttendanceDashboard_Input = Parameters<typeof getAttendanceDashboard_Type.execute>[0]['input'];
type getAttendanceDashboard_Output = ReturnType<typeof getAttendanceDashboard_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getAttendanceDashboard_Type.execute>;
export const getAttendanceDashboard = (input: getAttendanceDashboard_Input): Promise<getAttendanceDashboard_Output> => invokeEndpoint('getAttendanceDashboard', input);
export type GetAttendanceDashboardOutputType = getAttendanceDashboard_Output;
export type GetAttendanceDashboardInputType = getAttendanceDashboard_Input;

import type getAttendanceEventsAdmin_Type from '../api/getAttendanceEventsAdmin';
type getAttendanceEventsAdmin_Input = Parameters<typeof getAttendanceEventsAdmin_Type.execute>[0]['input'];
type getAttendanceEventsAdmin_Output = ReturnType<typeof getAttendanceEventsAdmin_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getAttendanceEventsAdmin_Type.execute>;
export const getAttendanceEventsAdmin = (input: getAttendanceEventsAdmin_Input): Promise<getAttendanceEventsAdmin_Output> => invokeEndpoint('getAttendanceEventsAdmin', input);
export type GetAttendanceEventsAdminOutputType = getAttendanceEventsAdmin_Output;
export type GetAttendanceEventsAdminInputType = getAttendanceEventsAdmin_Input;

import type getAttendanceForDate_Type from '../api/getAttendanceForDate';
type getAttendanceForDate_Input = Parameters<typeof getAttendanceForDate_Type.execute>[0]['input'];
type getAttendanceForDate_Output = ReturnType<typeof getAttendanceForDate_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getAttendanceForDate_Type.execute>;
export const getAttendanceForDate = (input: getAttendanceForDate_Input): Promise<getAttendanceForDate_Output> => invokeEndpoint('getAttendanceForDate', input);
export type GetAttendanceForDateOutputType = getAttendanceForDate_Output;
export type GetAttendanceForDateInputType = getAttendanceForDate_Input;

import type getAvailabilityOverview_Type from '../api/getAvailabilityOverview';
type getAvailabilityOverview_Input = Parameters<typeof getAvailabilityOverview_Type.execute>[0]['input'];
type getAvailabilityOverview_Output = ReturnType<typeof getAvailabilityOverview_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getAvailabilityOverview_Type.execute>;
export const getAvailabilityOverview = (input: getAvailabilityOverview_Input): Promise<getAvailabilityOverview_Output> => invokeEndpoint('getAvailabilityOverview', input);
export type GetAvailabilityOverviewOutputType = getAvailabilityOverview_Output;
export type GetAvailabilityOverviewInputType = getAvailabilityOverview_Input;

import type getAvailableSkills_Type from '../api/getAvailableSkills';
type getAvailableSkills_Input = Parameters<typeof getAvailableSkills_Type.execute>[0]['input'];
type getAvailableSkills_Output = ReturnType<typeof getAvailableSkills_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getAvailableSkills_Type.execute>;
export const getAvailableSkills = (input: getAvailableSkills_Input): Promise<getAvailableSkills_Output> => invokeEndpoint('getAvailableSkills', input);
export type GetAvailableSkillsOutputType = getAvailableSkills_Output;
export type GetAvailableSkillsInputType = getAvailableSkills_Input;

import type getBvAdminTable_Type from '../api/getBvAdminTable';
type getBvAdminTable_Input = Parameters<typeof getBvAdminTable_Type.execute>[0]['input'];
type getBvAdminTable_Output = ReturnType<typeof getBvAdminTable_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvAdminTable_Type.execute>;
export const getBvAdminTable = (input: getBvAdminTable_Input): Promise<getBvAdminTable_Output> => invokeEndpoint('getBvAdminTable', input);
export type GetBvAdminTableOutputType = getBvAdminTable_Output;
export type GetBvAdminTableInputType = getBvAdminTable_Input;

import type getBvAttendance_Type from '../api/getBvAttendance';
type getBvAttendance_Input = Parameters<typeof getBvAttendance_Type.execute>[0]['input'];
type getBvAttendance_Output = ReturnType<typeof getBvAttendance_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvAttendance_Type.execute>;
export const getBvAttendance = (input: getBvAttendance_Input): Promise<getBvAttendance_Output> => invokeEndpoint('getBvAttendance', input);
export type GetBvAttendanceOutputType = getBvAttendance_Output;
export type GetBvAttendanceInputType = getBvAttendance_Input;

import type getBvAttendanceMatrix_Type from '../api/getBvAttendanceMatrix';
type getBvAttendanceMatrix_Input = Parameters<typeof getBvAttendanceMatrix_Type.execute>[0]['input'];
type getBvAttendanceMatrix_Output = ReturnType<typeof getBvAttendanceMatrix_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvAttendanceMatrix_Type.execute>;
export const getBvAttendanceMatrix = (input: getBvAttendanceMatrix_Input): Promise<getBvAttendanceMatrix_Output> => invokeEndpoint('getBvAttendanceMatrix', input);
export type GetBvAttendanceMatrixOutputType = getBvAttendanceMatrix_Output;
export type GetBvAttendanceMatrixInputType = getBvAttendanceMatrix_Input;

import type getBvGroupDetail_Type from '../api/getBvGroupDetail';
type getBvGroupDetail_Input = Parameters<typeof getBvGroupDetail_Type.execute>[0]['input'];
type getBvGroupDetail_Output = ReturnType<typeof getBvGroupDetail_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvGroupDetail_Type.execute>;
export const getBvGroupDetail = (input: getBvGroupDetail_Input): Promise<getBvGroupDetail_Output> => invokeEndpoint('getBvGroupDetail', input);
export type GetBvGroupDetailOutputType = getBvGroupDetail_Output;
export type GetBvGroupDetailInputType = getBvGroupDetail_Input;

import type getBvGroupSadhanaMonitor_Type from '../api/getBvGroupSadhanaMonitor';
type getBvGroupSadhanaMonitor_Input = Parameters<typeof getBvGroupSadhanaMonitor_Type.execute>[0]['input'];
type getBvGroupSadhanaMonitor_Output = ReturnType<typeof getBvGroupSadhanaMonitor_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvGroupSadhanaMonitor_Type.execute>;
export const getBvGroupSadhanaMonitor = (input: getBvGroupSadhanaMonitor_Input): Promise<getBvGroupSadhanaMonitor_Output> => invokeEndpoint('getBvGroupSadhanaMonitor', input);
export type GetBvGroupSadhanaMonitorOutputType = getBvGroupSadhanaMonitor_Output;
export type GetBvGroupSadhanaMonitorInputType = getBvGroupSadhanaMonitor_Input;

import type getBvMentorData_Type from '../api/getBvMentorData';
type getBvMentorData_Input = Parameters<typeof getBvMentorData_Type.execute>[0]['input'];
type getBvMentorData_Output = ReturnType<typeof getBvMentorData_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvMentorData_Type.execute>;
export const getBvMentorData = (input: getBvMentorData_Input): Promise<getBvMentorData_Output> => invokeEndpoint('getBvMentorData', input);
export type GetBvMentorDataOutputType = getBvMentorData_Output;
export type GetBvMentorDataInputType = getBvMentorData_Input;

import type getBvMissingSadhana_Type from '../api/getBvMissingSadhana';
type getBvMissingSadhana_Input = Parameters<typeof getBvMissingSadhana_Type.execute>[0]['input'];
type getBvMissingSadhana_Output = ReturnType<typeof getBvMissingSadhana_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvMissingSadhana_Type.execute>;
export const getBvMissingSadhana = (input: getBvMissingSadhana_Input): Promise<getBvMissingSadhana_Output> => invokeEndpoint('getBvMissingSadhana', input);
export type GetBvMissingSadhanaOutputType = getBvMissingSadhana_Output;
export type GetBvMissingSadhanaInputType = getBvMissingSadhana_Input;

import type getBvPreachingEntry_Type from '../api/getBvPreachingEntry';
type getBvPreachingEntry_Input = Parameters<typeof getBvPreachingEntry_Type.execute>[0]['input'];
type getBvPreachingEntry_Output = ReturnType<typeof getBvPreachingEntry_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvPreachingEntry_Type.execute>;
export const getBvPreachingEntry = (input: getBvPreachingEntry_Input): Promise<getBvPreachingEntry_Output> => invokeEndpoint('getBvPreachingEntry', input);
export type GetBvPreachingEntryOutputType = getBvPreachingEntry_Output;
export type GetBvPreachingEntryInputType = getBvPreachingEntry_Input;

import type getBvPreachingReport_Type from '../api/getBvPreachingReport';
type getBvPreachingReport_Input = Parameters<typeof getBvPreachingReport_Type.execute>[0]['input'];
type getBvPreachingReport_Output = ReturnType<typeof getBvPreachingReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvPreachingReport_Type.execute>;
export const getBvPreachingReport = (input: getBvPreachingReport_Input): Promise<getBvPreachingReport_Output> => invokeEndpoint('getBvPreachingReport', input);
export type GetBvPreachingReportOutputType = getBvPreachingReport_Output;
export type GetBvPreachingReportInputType = getBvPreachingReport_Input;

import type getBvQuizDetail_Type from '../api/getBvQuizDetail';
type getBvQuizDetail_Input = Parameters<typeof getBvQuizDetail_Type.execute>[0]['input'];
type getBvQuizDetail_Output = ReturnType<typeof getBvQuizDetail_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvQuizDetail_Type.execute>;
export const getBvQuizDetail = (input: getBvQuizDetail_Input): Promise<getBvQuizDetail_Output> => invokeEndpoint('getBvQuizDetail', input);
export type GetBvQuizDetailOutputType = getBvQuizDetail_Output;
export type GetBvQuizDetailInputType = getBvQuizDetail_Input;

import type getBvQuizSubmissions_Type from '../api/getBvQuizSubmissions';
type getBvQuizSubmissions_Input = Parameters<typeof getBvQuizSubmissions_Type.execute>[0]['input'];
type getBvQuizSubmissions_Output = ReturnType<typeof getBvQuizSubmissions_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvQuizSubmissions_Type.execute>;
export const getBvQuizSubmissions = (input: getBvQuizSubmissions_Input): Promise<getBvQuizSubmissions_Output> => invokeEndpoint('getBvQuizSubmissions', input);
export type GetBvQuizSubmissionsOutputType = getBvQuizSubmissions_Output;
export type GetBvQuizSubmissionsInputType = getBvQuizSubmissions_Input;

import type getBvQuizzes_Type from '../api/getBvQuizzes';
type getBvQuizzes_Input = Parameters<typeof getBvQuizzes_Type.execute>[0]['input'];
type getBvQuizzes_Output = ReturnType<typeof getBvQuizzes_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvQuizzes_Type.execute>;
export const getBvQuizzes = (input: getBvQuizzes_Input): Promise<getBvQuizzes_Output> => invokeEndpoint('getBvQuizzes', input);
export type GetBvQuizzesOutputType = getBvQuizzes_Output;
export type GetBvQuizzesInputType = getBvQuizzes_Input;

import type getBvSessionMatrix_Type from '../api/getBvSessionMatrix';
type getBvSessionMatrix_Input = Parameters<typeof getBvSessionMatrix_Type.execute>[0]['input'];
type getBvSessionMatrix_Output = ReturnType<typeof getBvSessionMatrix_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvSessionMatrix_Type.execute>;
export const getBvSessionMatrix = (input: getBvSessionMatrix_Input): Promise<getBvSessionMatrix_Output> => invokeEndpoint('getBvSessionMatrix', input);
export type GetBvSessionMatrixOutputType = getBvSessionMatrix_Output;
export type GetBvSessionMatrixInputType = getBvSessionMatrix_Input;

import type getBvSessionReport_Type from '../api/getBvSessionReport';
type getBvSessionReport_Input = Parameters<typeof getBvSessionReport_Type.execute>[0]['input'];
type getBvSessionReport_Output = ReturnType<typeof getBvSessionReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvSessionReport_Type.execute>;
export const getBvSessionReport = (input: getBvSessionReport_Input): Promise<getBvSessionReport_Output> => invokeEndpoint('getBvSessionReport', input);
export type GetBvSessionReportOutputType = getBvSessionReport_Output;
export type GetBvSessionReportInputType = getBvSessionReport_Input;

import type getBvStats_Type from '../api/getBvStats';
type getBvStats_Input = Parameters<typeof getBvStats_Type.execute>[0]['input'];
type getBvStats_Output = ReturnType<typeof getBvStats_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvStats_Type.execute>;
export const getBvStats = (input: getBvStats_Input): Promise<getBvStats_Output> => invokeEndpoint('getBvStats', input);
export type GetBvStatsOutputType = getBvStats_Output;
export type GetBvStatsInputType = getBvStats_Input;

import type getBvslBooksSummary_Type from '../api/getBvslBooksSummary';
type getBvslBooksSummary_Input = Parameters<typeof getBvslBooksSummary_Type.execute>[0]['input'];
type getBvslBooksSummary_Output = ReturnType<typeof getBvslBooksSummary_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvslBooksSummary_Type.execute>;
export const getBvslBooksSummary = (input: getBvslBooksSummary_Input): Promise<getBvslBooksSummary_Output> => invokeEndpoint('getBvslBooksSummary', input);
export type GetBvslBooksSummaryOutputType = getBvslBooksSummary_Output;
export type GetBvslBooksSummaryInputType = getBvslBooksSummary_Input;

import type getBvslGroups_Type from '../api/getBvslGroups';
type getBvslGroups_Input = Parameters<typeof getBvslGroups_Type.execute>[0]['input'];
type getBvslGroups_Output = ReturnType<typeof getBvslGroups_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvslGroups_Type.execute>;
export const getBvslGroups = (input: getBvslGroups_Input): Promise<getBvslGroups_Output> => invokeEndpoint('getBvslGroups', input);
export type GetBvslGroupsOutputType = getBvslGroups_Output;
export type GetBvslGroupsInputType = getBvslGroups_Input;

import type getBvslMembers_Type from '../api/getBvslMembers';
type getBvslMembers_Input = Parameters<typeof getBvslMembers_Type.execute>[0]['input'];
type getBvslMembers_Output = ReturnType<typeof getBvslMembers_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvslMembers_Type.execute>;
export const getBvslMembers = (input: getBvslMembers_Input): Promise<getBvslMembers_Output> => invokeEndpoint('getBvslMembers', input);
export type GetBvslMembersOutputType = getBvslMembers_Output;
export type GetBvslMembersInputType = getBvslMembers_Input;

import type getBvslOneToOneData_Type from '../api/getBvslOneToOneData';
type getBvslOneToOneData_Input = Parameters<typeof getBvslOneToOneData_Type.execute>[0]['input'];
type getBvslOneToOneData_Output = ReturnType<typeof getBvslOneToOneData_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvslOneToOneData_Type.execute>;
export const getBvslOneToOneData = (input: getBvslOneToOneData_Input): Promise<getBvslOneToOneData_Output> => invokeEndpoint('getBvslOneToOneData', input);
export type GetBvslOneToOneDataOutputType = getBvslOneToOneData_Output;
export type GetBvslOneToOneDataInputType = getBvslOneToOneData_Input;

import type getBvslOwnReport_Type from '../api/getBvslOwnReport';
type getBvslOwnReport_Input = Parameters<typeof getBvslOwnReport_Type.execute>[0]['input'];
type getBvslOwnReport_Output = ReturnType<typeof getBvslOwnReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvslOwnReport_Type.execute>;
export const getBvslOwnReport = (input: getBvslOwnReport_Input): Promise<getBvslOwnReport_Output> => invokeEndpoint('getBvslOwnReport', input);
export type GetBvslOwnReportOutputType = getBvslOwnReport_Output;
export type GetBvslOwnReportInputType = getBvslOwnReport_Input;

import type getBvslSadhanaReport_Type from '../api/getBvslSadhanaReport';
type getBvslSadhanaReport_Input = Parameters<typeof getBvslSadhanaReport_Type.execute>[0]['input'];
type getBvslSadhanaReport_Output = ReturnType<typeof getBvslSadhanaReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvslSadhanaReport_Type.execute>;
export const getBvslSadhanaReport = (input: getBvslSadhanaReport_Input): Promise<getBvslSadhanaReport_Output> => invokeEndpoint('getBvslSadhanaReport', input);
export type GetBvslSadhanaReportOutputType = getBvslSadhanaReport_Output;
export type GetBvslSadhanaReportInputType = getBvslSadhanaReport_Input;

import type getBvslWeeklyPlan_Type from '../api/getBvslWeeklyPlan';
type getBvslWeeklyPlan_Input = Parameters<typeof getBvslWeeklyPlan_Type.execute>[0]['input'];
type getBvslWeeklyPlan_Output = ReturnType<typeof getBvslWeeklyPlan_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getBvslWeeklyPlan_Type.execute>;
export const getBvslWeeklyPlan = (input: getBvslWeeklyPlan_Input): Promise<getBvslWeeklyPlan_Output> => invokeEndpoint('getBvslWeeklyPlan', input);
export type GetBvslWeeklyPlanOutputType = getBvslWeeklyPlan_Output;
export type GetBvslWeeklyPlanInputType = getBvslWeeklyPlan_Input;

import type getChallengeDashboard_Type from '../api/getChallengeDashboard';
type getChallengeDashboard_Input = Parameters<typeof getChallengeDashboard_Type.execute>[0]['input'];
type getChallengeDashboard_Output = ReturnType<typeof getChallengeDashboard_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getChallengeDashboard_Type.execute>;
export const getChallengeDashboard = (input: getChallengeDashboard_Input): Promise<getChallengeDashboard_Output> => invokeEndpoint('getChallengeDashboard', input);
export type GetChallengeDashboardOutputType = getChallengeDashboard_Output;
export type GetChallengeDashboardInputType = getChallengeDashboard_Input;

import type getCleanlinessAnalytics_Type from '../api/getCleanlinessAnalytics';
type getCleanlinessAnalytics_Input = Parameters<typeof getCleanlinessAnalytics_Type.execute>[0]['input'];
type getCleanlinessAnalytics_Output = ReturnType<typeof getCleanlinessAnalytics_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getCleanlinessAnalytics_Type.execute>;
export const getCleanlinessAnalytics = (input: getCleanlinessAnalytics_Input): Promise<getCleanlinessAnalytics_Output> => invokeEndpoint('getCleanlinessAnalytics', input);
export type GetCleanlinessAnalyticsOutputType = getCleanlinessAnalytics_Output;
export type GetCleanlinessAnalyticsInputType = getCleanlinessAnalytics_Input;

import type getCleanlinessForSadhana_Type from '../api/getCleanlinessForSadhana';
type getCleanlinessForSadhana_Input = Parameters<typeof getCleanlinessForSadhana_Type.execute>[0]['input'];
type getCleanlinessForSadhana_Output = ReturnType<typeof getCleanlinessForSadhana_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getCleanlinessForSadhana_Type.execute>;
export const getCleanlinessForSadhana = (input: getCleanlinessForSadhana_Input): Promise<getCleanlinessForSadhana_Output> => invokeEndpoint('getCleanlinessForSadhana', input);
export type GetCleanlinessForSadhanaOutputType = getCleanlinessForSadhana_Output;
export type GetCleanlinessForSadhanaInputType = getCleanlinessForSadhana_Input;

import type getCleanlinessInspections_Type from '../api/getCleanlinessInspections';
type getCleanlinessInspections_Input = Parameters<typeof getCleanlinessInspections_Type.execute>[0]['input'];
type getCleanlinessInspections_Output = ReturnType<typeof getCleanlinessInspections_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getCleanlinessInspections_Type.execute>;
export const getCleanlinessInspections = (input: getCleanlinessInspections_Input): Promise<getCleanlinessInspections_Output> => invokeEndpoint('getCleanlinessInspections', input);
export type GetCleanlinessInspectionsOutputType = getCleanlinessInspections_Output;
export type GetCleanlinessInspectionsInputType = getCleanlinessInspections_Input;

import type getCleanlinessReviews_Type from '../api/getCleanlinessReviews';
type getCleanlinessReviews_Input = Parameters<typeof getCleanlinessReviews_Type.execute>[0]['input'];
type getCleanlinessReviews_Output = ReturnType<typeof getCleanlinessReviews_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getCleanlinessReviews_Type.execute>;
export const getCleanlinessReviews = (input: getCleanlinessReviews_Input): Promise<getCleanlinessReviews_Output> => invokeEndpoint('getCleanlinessReviews', input);
export type GetCleanlinessReviewsOutputType = getCleanlinessReviews_Output;
export type GetCleanlinessReviewsInputType = getCleanlinessReviews_Input;

import type getCleanlinessRooms_Type from '../api/getCleanlinessRooms';
type getCleanlinessRooms_Input = Parameters<typeof getCleanlinessRooms_Type.execute>[0]['input'];
type getCleanlinessRooms_Output = ReturnType<typeof getCleanlinessRooms_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getCleanlinessRooms_Type.execute>;
export const getCleanlinessRooms = (input: getCleanlinessRooms_Input): Promise<getCleanlinessRooms_Output> => invokeEndpoint('getCleanlinessRooms', input);
export type GetCleanlinessRoomsOutputType = getCleanlinessRooms_Output;
export type GetCleanlinessRoomsInputType = getCleanlinessRooms_Input;

import type getCrossPreachingDrilldown_Type from '../api/getCrossPreachingDrilldown';
type getCrossPreachingDrilldown_Input = Parameters<typeof getCrossPreachingDrilldown_Type.execute>[0]['input'];
type getCrossPreachingDrilldown_Output = ReturnType<typeof getCrossPreachingDrilldown_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getCrossPreachingDrilldown_Type.execute>;
export const getCrossPreachingDrilldown = (input: getCrossPreachingDrilldown_Input): Promise<getCrossPreachingDrilldown_Output> => invokeEndpoint('getCrossPreachingDrilldown', input);
export type GetCrossPreachingDrilldownOutputType = getCrossPreachingDrilldown_Output;
export type GetCrossPreachingDrilldownInputType = getCrossPreachingDrilldown_Input;

import type getCrossPreachingReport_Type from '../api/getCrossPreachingReport';
type getCrossPreachingReport_Input = Parameters<typeof getCrossPreachingReport_Type.execute>[0]['input'];
type getCrossPreachingReport_Output = ReturnType<typeof getCrossPreachingReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getCrossPreachingReport_Type.execute>;
export const getCrossPreachingReport = (input: getCrossPreachingReport_Input): Promise<getCrossPreachingReport_Output> => invokeEndpoint('getCrossPreachingReport', input);
export type GetCrossPreachingReportOutputType = getCrossPreachingReport_Output;
export type GetCrossPreachingReportInputType = getCrossPreachingReport_Input;

import type getCurrentGuide_Type from '../api/getCurrentGuide';
type getCurrentGuide_Input = Parameters<typeof getCurrentGuide_Type.execute>[0]['input'];
type getCurrentGuide_Output = ReturnType<typeof getCurrentGuide_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getCurrentGuide_Type.execute>;
export const getCurrentGuide = (input: getCurrentGuide_Input): Promise<getCurrentGuide_Output> => invokeEndpoint('getCurrentGuide', input);
export type GetCurrentGuideOutputType = getCurrentGuide_Output;
export type GetCurrentGuideInputType = getCurrentGuide_Input;

import type getEligibleMembersForBvGroup_Type from '../api/getEligibleMembersForBvGroup';
type getEligibleMembersForBvGroup_Input = Parameters<typeof getEligibleMembersForBvGroup_Type.execute>[0]['input'];
type getEligibleMembersForBvGroup_Output = ReturnType<typeof getEligibleMembersForBvGroup_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getEligibleMembersForBvGroup_Type.execute>;
export const getEligibleMembersForBvGroup = (input: getEligibleMembersForBvGroup_Input): Promise<getEligibleMembersForBvGroup_Output> => invokeEndpoint('getEligibleMembersForBvGroup', input);
export type GetEligibleMembersForBvGroupOutputType = getEligibleMembersForBvGroup_Output;
export type GetEligibleMembersForBvGroupInputType = getEligibleMembersForBvGroup_Input;

import type getEntryDetail_Type from '../api/getEntryDetail';
type getEntryDetail_Input = Parameters<typeof getEntryDetail_Type.execute>[0]['input'];
type getEntryDetail_Output = ReturnType<typeof getEntryDetail_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getEntryDetail_Type.execute>;
export const getEntryDetail = (input: getEntryDetail_Input): Promise<getEntryDetail_Output> => invokeEndpoint('getEntryDetail', input);
export type GetEntryDetailOutputType = getEntryDetail_Output;
export type GetEntryDetailInputType = getEntryDetail_Input;

import type getExistingEntry_Type from '../api/getExistingEntry';
type getExistingEntry_Input = Parameters<typeof getExistingEntry_Type.execute>[0]['input'];
type getExistingEntry_Output = ReturnType<typeof getExistingEntry_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getExistingEntry_Type.execute>;
export const getExistingEntry = (input: getExistingEntry_Input): Promise<getExistingEntry_Output> => invokeEndpoint('getExistingEntry', input);
export type GetExistingEntryOutputType = getExistingEntry_Output;
export type GetExistingEntryInputType = getExistingEntry_Input;

import type getFieldsForUser_Type from '../api/getFieldsForUser';
type getFieldsForUser_Input = Parameters<typeof getFieldsForUser_Type.execute>[0]['input'];
type getFieldsForUser_Output = ReturnType<typeof getFieldsForUser_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getFieldsForUser_Type.execute>;
export const getFieldsForUser = (input: getFieldsForUser_Input): Promise<getFieldsForUser_Output> => invokeEndpoint('getFieldsForUser', input);
export type GetFieldsForUserOutputType = getFieldsForUser_Output;
export type GetFieldsForUserInputType = getFieldsForUser_Input;

import type getFolkSadhanaReport_Type from '../api/getFolkSadhanaReport';
type getFolkSadhanaReport_Input = Parameters<typeof getFolkSadhanaReport_Type.execute>[0]['input'];
type getFolkSadhanaReport_Output = ReturnType<typeof getFolkSadhanaReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getFolkSadhanaReport_Type.execute>;
export const getFolkSadhanaReport = (input: getFolkSadhanaReport_Input): Promise<getFolkSadhanaReport_Output> => invokeEndpoint('getFolkSadhanaReport', input);
export type GetFolkSadhanaReportOutputType = getFolkSadhanaReport_Output;
export type GetFolkSadhanaReportInputType = getFolkSadhanaReport_Input;

import type getGroupMembers_Type from '../api/getGroupMembers';
type getGroupMembers_Input = Parameters<typeof getGroupMembers_Type.execute>[0]['input'];
type getGroupMembers_Output = ReturnType<typeof getGroupMembers_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getGroupMembers_Type.execute>;
export const getGroupMembers = (input: getGroupMembers_Input): Promise<getGroupMembers_Output> => invokeEndpoint('getGroupMembers', input);
export type GetGroupMembersOutputType = getGroupMembers_Output;
export type GetGroupMembersInputType = getGroupMembers_Input;

import type getGuideAttendanceReport_Type from '../api/getGuideAttendanceReport';
type getGuideAttendanceReport_Input = Parameters<typeof getGuideAttendanceReport_Type.execute>[0]['input'];
type getGuideAttendanceReport_Output = ReturnType<typeof getGuideAttendanceReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getGuideAttendanceReport_Type.execute>;
export const getGuideAttendanceReport = (input: getGuideAttendanceReport_Input): Promise<getGuideAttendanceReport_Output> => invokeEndpoint('getGuideAttendanceReport', input);
export type GetGuideAttendanceReportOutputType = getGuideAttendanceReport_Output;
export type GetGuideAttendanceReportInputType = getGuideAttendanceReport_Input;

import type getGuideDetailedReport_Type from '../api/getGuideDetailedReport';
type getGuideDetailedReport_Input = Parameters<typeof getGuideDetailedReport_Type.execute>[0]['input'];
type getGuideDetailedReport_Output = ReturnType<typeof getGuideDetailedReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getGuideDetailedReport_Type.execute>;
export const getGuideDetailedReport = (input: getGuideDetailedReport_Input): Promise<getGuideDetailedReport_Output> => invokeEndpoint('getGuideDetailedReport', input);
export type GetGuideDetailedReportOutputType = getGuideDetailedReport_Output;
export type GetGuideDetailedReportInputType = getGuideDetailedReport_Input;

import type getGuideGroupStats_Type from '../api/getGuideGroupStats';
type getGuideGroupStats_Input = Parameters<typeof getGuideGroupStats_Type.execute>[0]['input'];
type getGuideGroupStats_Output = ReturnType<typeof getGuideGroupStats_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getGuideGroupStats_Type.execute>;
export const getGuideGroupStats = (input: getGuideGroupStats_Input): Promise<getGuideGroupStats_Output> => invokeEndpoint('getGuideGroupStats', input);
export type GetGuideGroupStatsOutputType = getGuideGroupStats_Output;
export type GetGuideGroupStatsInputType = getGuideGroupStats_Input;

import type getGuideGroups_Type from '../api/getGuideGroups';
type getGuideGroups_Input = Parameters<typeof getGuideGroups_Type.execute>[0]['input'];
type getGuideGroups_Output = ReturnType<typeof getGuideGroups_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getGuideGroups_Type.execute>;
export const getGuideGroups = (input: getGuideGroups_Input): Promise<getGuideGroups_Output> => invokeEndpoint('getGuideGroups', input);
export type GetGuideGroupsOutputType = getGuideGroups_Output;
export type GetGuideGroupsInputType = getGuideGroups_Input;

import type getGuideMetrics_Type from '../api/getGuideMetrics';
type getGuideMetrics_Input = Parameters<typeof getGuideMetrics_Type.execute>[0]['input'];
type getGuideMetrics_Output = ReturnType<typeof getGuideMetrics_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getGuideMetrics_Type.execute>;
export const getGuideMetrics = (input: getGuideMetrics_Input): Promise<getGuideMetrics_Output> => invokeEndpoint('getGuideMetrics', input);
export type GetGuideMetricsOutputType = getGuideMetrics_Output;
export type GetGuideMetricsInputType = getGuideMetrics_Input;

import type getGuideRentTripsOverview_Type from '../api/getGuideRentTripsOverview';
type getGuideRentTripsOverview_Input = Parameters<typeof getGuideRentTripsOverview_Type.execute>[0]['input'];
type getGuideRentTripsOverview_Output = ReturnType<typeof getGuideRentTripsOverview_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getGuideRentTripsOverview_Type.execute>;
export const getGuideRentTripsOverview = (input: getGuideRentTripsOverview_Input): Promise<getGuideRentTripsOverview_Output> => invokeEndpoint('getGuideRentTripsOverview', input);
export type GetGuideRentTripsOverviewOutputType = getGuideRentTripsOverview_Output;
export type GetGuideRentTripsOverviewInputType = getGuideRentTripsOverview_Input;

import type getGuideRequests_Type from '../api/getGuideRequests';
type getGuideRequests_Input = Parameters<typeof getGuideRequests_Type.execute>[0]['input'];
type getGuideRequests_Output = ReturnType<typeof getGuideRequests_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getGuideRequests_Type.execute>;
export const getGuideRequests = (input: getGuideRequests_Input): Promise<getGuideRequests_Output> => invokeEndpoint('getGuideRequests', input);
export type GetGuideRequestsOutputType = getGuideRequests_Output;
export type GetGuideRequestsInputType = getGuideRequests_Input;

import type getGuideUsers_Type from '../api/getGuideUsers';
type getGuideUsers_Input = Parameters<typeof getGuideUsers_Type.execute>[0]['input'];
type getGuideUsers_Output = ReturnType<typeof getGuideUsers_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getGuideUsers_Type.execute>;
export const getGuideUsers = (input: getGuideUsers_Input): Promise<getGuideUsers_Output> => invokeEndpoint('getGuideUsers', input);
export type GetGuideUsersOutputType = getGuideUsers_Output;
export type GetGuideUsersInputType = getGuideUsers_Input;

import type getGuides_Type from '../api/getGuides';
type getGuides_Input = Parameters<typeof getGuides_Type.execute>[0]['input'];
type getGuides_Output = ReturnType<typeof getGuides_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getGuides_Type.execute>;
export const getGuides = (input: getGuides_Input): Promise<getGuides_Output> => invokeEndpoint('getGuides', input);
export type GetGuidesOutputType = getGuides_Output;
export type GetGuidesInputType = getGuides_Input;

import type getJigyasaTracker_Type from '../api/getJigyasaTracker';
type getJigyasaTracker_Input = Parameters<typeof getJigyasaTracker_Type.execute>[0]['input'];
type getJigyasaTracker_Output = ReturnType<typeof getJigyasaTracker_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getJigyasaTracker_Type.execute>;
export const getJigyasaTracker = (input: getJigyasaTracker_Input): Promise<getJigyasaTracker_Output> => invokeEndpoint('getJigyasaTracker', input);
export type GetJigyasaTrackerOutputType = getJigyasaTracker_Output;
export type GetJigyasaTrackerInputType = getJigyasaTracker_Input;

import type getMentorMembers_Type from '../api/getMentorMembers';
type getMentorMembers_Input = Parameters<typeof getMentorMembers_Type.execute>[0]['input'];
type getMentorMembers_Output = ReturnType<typeof getMentorMembers_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getMentorMembers_Type.execute>;
export const getMentorMembers = (input: getMentorMembers_Input): Promise<getMentorMembers_Output> => invokeEndpoint('getMentorMembers', input);
export type GetMentorMembersOutputType = getMentorMembers_Output;
export type GetMentorMembersInputType = getMentorMembers_Input;

import type getMissingSadhanaReport_Type from '../api/getMissingSadhanaReport';
type getMissingSadhanaReport_Input = Parameters<typeof getMissingSadhanaReport_Type.execute>[0]['input'];
type getMissingSadhanaReport_Output = ReturnType<typeof getMissingSadhanaReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getMissingSadhanaReport_Type.execute>;
export const getMissingSadhanaReport = (input: getMissingSadhanaReport_Input): Promise<getMissingSadhanaReport_Output> => invokeEndpoint('getMissingSadhanaReport', input);
export type GetMissingSadhanaReportOutputType = getMissingSadhanaReport_Output;
export type GetMissingSadhanaReportInputType = getMissingSadhanaReport_Input;

import type getMyAvailability_Type from '../api/getMyAvailability';
type getMyAvailability_Input = Parameters<typeof getMyAvailability_Type.execute>[0]['input'];
type getMyAvailability_Output = ReturnType<typeof getMyAvailability_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getMyAvailability_Type.execute>;
export const getMyAvailability = (input: getMyAvailability_Input): Promise<getMyAvailability_Output> => invokeEndpoint('getMyAvailability', input);
export type GetMyAvailabilityOutputType = getMyAvailability_Output;
export type GetMyAvailabilityInputType = getMyAvailability_Input;

import type getMyBvQuizSubmissions_Type from '../api/getMyBvQuizSubmissions';
type getMyBvQuizSubmissions_Input = Parameters<typeof getMyBvQuizSubmissions_Type.execute>[0]['input'];
type getMyBvQuizSubmissions_Output = ReturnType<typeof getMyBvQuizSubmissions_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getMyBvQuizSubmissions_Type.execute>;
export const getMyBvQuizSubmissions = (input: getMyBvQuizSubmissions_Input): Promise<getMyBvQuizSubmissions_Output> => invokeEndpoint('getMyBvQuizSubmissions', input);
export type GetMyBvQuizSubmissionsOutputType = getMyBvQuizSubmissions_Output;
export type GetMyBvQuizSubmissionsInputType = getMyBvQuizSubmissions_Input;

import type getMyGuideOneToOne_Type from '../api/getMyGuideOneToOne';
type getMyGuideOneToOne_Input = Parameters<typeof getMyGuideOneToOne_Type.execute>[0]['input'];
type getMyGuideOneToOne_Output = ReturnType<typeof getMyGuideOneToOne_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getMyGuideOneToOne_Type.execute>;
export const getMyGuideOneToOne = (input: getMyGuideOneToOne_Input): Promise<getMyGuideOneToOne_Output> => invokeEndpoint('getMyGuideOneToOne', input);
export type GetMyGuideOneToOneOutputType = getMyGuideOneToOne_Output;
export type GetMyGuideOneToOneInputType = getMyGuideOneToOne_Input;

import type getMyJigyasaRegistrations_Type from '../api/getMyJigyasaRegistrations';
type getMyJigyasaRegistrations_Input = Parameters<typeof getMyJigyasaRegistrations_Type.execute>[0]['input'];
type getMyJigyasaRegistrations_Output = ReturnType<typeof getMyJigyasaRegistrations_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getMyJigyasaRegistrations_Type.execute>;
export const getMyJigyasaRegistrations = (input: getMyJigyasaRegistrations_Input): Promise<getMyJigyasaRegistrations_Output> => invokeEndpoint('getMyJigyasaRegistrations', input);
export type GetMyJigyasaRegistrationsOutputType = getMyJigyasaRegistrations_Output;
export type GetMyJigyasaRegistrationsInputType = getMyJigyasaRegistrations_Input;

import type getOneToOneContext_Type from '../api/getOneToOneContext';
type getOneToOneContext_Input = Parameters<typeof getOneToOneContext_Type.execute>[0]['input'];
type getOneToOneContext_Output = ReturnType<typeof getOneToOneContext_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getOneToOneContext_Type.execute>;
export const getOneToOneContext = (input: getOneToOneContext_Input): Promise<getOneToOneContext_Output> => invokeEndpoint('getOneToOneContext', input);
export type GetOneToOneContextOutputType = getOneToOneContext_Output;
export type GetOneToOneContextInputType = getOneToOneContext_Input;

import type getOneToOneMeetings_Type from '../api/getOneToOneMeetings';
type getOneToOneMeetings_Input = Parameters<typeof getOneToOneMeetings_Type.execute>[0]['input'];
type getOneToOneMeetings_Output = ReturnType<typeof getOneToOneMeetings_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getOneToOneMeetings_Type.execute>;
export const getOneToOneMeetings = (input: getOneToOneMeetings_Input): Promise<getOneToOneMeetings_Output> => invokeEndpoint('getOneToOneMeetings', input);
export type GetOneToOneMeetingsOutputType = getOneToOneMeetings_Output;
export type GetOneToOneMeetingsInputType = getOneToOneMeetings_Input;

import type getOpenSwaps_Type from '../api/getOpenSwaps';
type getOpenSwaps_Input = Parameters<typeof getOpenSwaps_Type.execute>[0]['input'];
type getOpenSwaps_Output = ReturnType<typeof getOpenSwaps_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getOpenSwaps_Type.execute>;
export const getOpenSwaps = (input: getOpenSwaps_Input): Promise<getOpenSwaps_Output> => invokeEndpoint('getOpenSwaps', input);
export type GetOpenSwapsOutputType = getOpenSwaps_Output;
export type GetOpenSwapsInputType = getOpenSwaps_Input;

import type getPendingApprovals_Type from '../api/getPendingApprovals';
type getPendingApprovals_Input = Parameters<typeof getPendingApprovals_Type.execute>[0]['input'];
type getPendingApprovals_Output = ReturnType<typeof getPendingApprovals_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getPendingApprovals_Type.execute>;
export const getPendingApprovals = (input: getPendingApprovals_Input): Promise<getPendingApprovals_Output> => invokeEndpoint('getPendingApprovals', input);
export type GetPendingApprovalsOutputType = getPendingApprovals_Output;
export type GetPendingApprovalsInputType = getPendingApprovals_Input;

import type getPendingBvJoinRequests_Type from '../api/getPendingBvJoinRequests';
type getPendingBvJoinRequests_Input = Parameters<typeof getPendingBvJoinRequests_Type.execute>[0]['input'];
type getPendingBvJoinRequests_Output = ReturnType<typeof getPendingBvJoinRequests_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getPendingBvJoinRequests_Type.execute>;
export const getPendingBvJoinRequests = (input: getPendingBvJoinRequests_Input): Promise<getPendingBvJoinRequests_Output> => invokeEndpoint('getPendingBvJoinRequests', input);
export type GetPendingBvJoinRequestsOutputType = getPendingBvJoinRequests_Output;
export type GetPendingBvJoinRequestsInputType = getPendingBvJoinRequests_Input;

import type getPipelineReport_Type from '../api/getPipelineReport';
type getPipelineReport_Input = Parameters<typeof getPipelineReport_Type.execute>[0]['input'];
type getPipelineReport_Output = ReturnType<typeof getPipelineReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getPipelineReport_Type.execute>;
export const getPipelineReport = (input: getPipelineReport_Input): Promise<getPipelineReport_Output> => invokeEndpoint('getPipelineReport', input);
export type GetPipelineReportOutputType = getPipelineReport_Output;
export type GetPipelineReportInputType = getPipelineReport_Input;

import type getPreachingDataReport_Type from '../api/getPreachingDataReport';
type getPreachingDataReport_Input = Parameters<typeof getPreachingDataReport_Type.execute>[0]['input'];
type getPreachingDataReport_Output = ReturnType<typeof getPreachingDataReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getPreachingDataReport_Type.execute>;
export const getPreachingDataReport = (input: getPreachingDataReport_Input): Promise<getPreachingDataReport_Output> => invokeEndpoint('getPreachingDataReport', input);
export type GetPreachingDataReportOutputType = getPreachingDataReport_Output;
export type GetPreachingDataReportInputType = getPreachingDataReport_Input;

import type getPreachingDrilldown_Type from '../api/getPreachingDrilldown';
type getPreachingDrilldown_Input = Parameters<typeof getPreachingDrilldown_Type.execute>[0]['input'];
type getPreachingDrilldown_Output = ReturnType<typeof getPreachingDrilldown_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getPreachingDrilldown_Type.execute>;
export const getPreachingDrilldown = (input: getPreachingDrilldown_Input): Promise<getPreachingDrilldown_Output> => invokeEndpoint('getPreachingDrilldown', input);
export type GetPreachingDrilldownOutputType = getPreachingDrilldown_Output;
export type GetPreachingDrilldownInputType = getPreachingDrilldown_Input;

import type getPushSubscriptionStats_Type from '../api/getPushSubscriptionStats';
type getPushSubscriptionStats_Input = Parameters<typeof getPushSubscriptionStats_Type.execute>[0]['input'];
type getPushSubscriptionStats_Output = ReturnType<typeof getPushSubscriptionStats_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getPushSubscriptionStats_Type.execute>;
export const getPushSubscriptionStats = (input: getPushSubscriptionStats_Input): Promise<getPushSubscriptionStats_Output> => invokeEndpoint('getPushSubscriptionStats', input);
export type GetPushSubscriptionStatsOutputType = getPushSubscriptionStats_Output;
export type GetPushSubscriptionStatsInputType = getPushSubscriptionStats_Input;

import type getResidenciesForGuide_Type from '../api/getResidenciesForGuide';
type getResidenciesForGuide_Input = Parameters<typeof getResidenciesForGuide_Type.execute>[0]['input'];
type getResidenciesForGuide_Output = ReturnType<typeof getResidenciesForGuide_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getResidenciesForGuide_Type.execute>;
export const getResidenciesForGuide = (input: getResidenciesForGuide_Input): Promise<getResidenciesForGuide_Output> => invokeEndpoint('getResidenciesForGuide', input);
export type GetResidenciesForGuideOutputType = getResidenciesForGuide_Output;
export type GetResidenciesForGuideInputType = getResidenciesForGuide_Input;

import type getResidencyTransferRequests_Type from '../api/getResidencyTransferRequests';
type getResidencyTransferRequests_Input = Parameters<typeof getResidencyTransferRequests_Type.execute>[0]['input'];
type getResidencyTransferRequests_Output = ReturnType<typeof getResidencyTransferRequests_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getResidencyTransferRequests_Type.execute>;
export const getResidencyTransferRequests = (input: getResidencyTransferRequests_Input): Promise<getResidencyTransferRequests_Output> => invokeEndpoint('getResidencyTransferRequests', input);
export type GetResidencyTransferRequestsOutputType = getResidencyTransferRequests_Output;
export type GetResidencyTransferRequestsInputType = getResidencyTransferRequests_Input;

import type getResidentsForAllocation_Type from '../api/getResidentsForAllocation';
type getResidentsForAllocation_Input = Parameters<typeof getResidentsForAllocation_Type.execute>[0]['input'];
type getResidentsForAllocation_Output = ReturnType<typeof getResidentsForAllocation_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getResidentsForAllocation_Type.execute>;
export const getResidentsForAllocation = (input: getResidentsForAllocation_Input): Promise<getResidentsForAllocation_Output> => invokeEndpoint('getResidentsForAllocation', input);
export type GetResidentsForAllocationOutputType = getResidentsForAllocation_Output;
export type GetResidentsForAllocationInputType = getResidentsForAllocation_Input;

import type getSadhanaFormData_Type from '../api/getSadhanaFormData';
type getSadhanaFormData_Input = Parameters<typeof getSadhanaFormData_Type.execute>[0]['input'];
type getSadhanaFormData_Output = ReturnType<typeof getSadhanaFormData_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getSadhanaFormData_Type.execute>;
export const getSadhanaFormData = (input: getSadhanaFormData_Input): Promise<getSadhanaFormData_Output> => invokeEndpoint('getSadhanaFormData', input);
export type GetSadhanaFormDataOutputType = getSadhanaFormData_Output;
export type GetSadhanaFormDataInputType = getSadhanaFormData_Input;

import type getSadhanaLeaderboard_Type from '../api/getSadhanaLeaderboard';
type getSadhanaLeaderboard_Input = Parameters<typeof getSadhanaLeaderboard_Type.execute>[0]['input'];
type getSadhanaLeaderboard_Output = ReturnType<typeof getSadhanaLeaderboard_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getSadhanaLeaderboard_Type.execute>;
export const getSadhanaLeaderboard = (input: getSadhanaLeaderboard_Input): Promise<getSadhanaLeaderboard_Output> => invokeEndpoint('getSadhanaLeaderboard', input);
export type GetSadhanaLeaderboardOutputType = getSadhanaLeaderboard_Output;
export type GetSadhanaLeaderboardInputType = getSadhanaLeaderboard_Input;

import type getSadhanaStats_Type from '../api/getSadhanaStats';
type getSadhanaStats_Input = Parameters<typeof getSadhanaStats_Type.execute>[0]['input'];
type getSadhanaStats_Output = ReturnType<typeof getSadhanaStats_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getSadhanaStats_Type.execute>;
export const getSadhanaStats = (input: getSadhanaStats_Input): Promise<getSadhanaStats_Output> => invokeEndpoint('getSadhanaStats', input);
export type GetSadhanaStatsOutputType = getSadhanaStats_Output;
export type GetSadhanaStatsInputType = getSadhanaStats_Input;

import type getScoresDrilldown_Type from '../api/getScoresDrilldown';
type getScoresDrilldown_Input = Parameters<typeof getScoresDrilldown_Type.execute>[0]['input'];
type getScoresDrilldown_Output = ReturnType<typeof getScoresDrilldown_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getScoresDrilldown_Type.execute>;
export const getScoresDrilldown = (input: getScoresDrilldown_Input): Promise<getScoresDrilldown_Output> => invokeEndpoint('getScoresDrilldown', input);
export type GetScoresDrilldownOutputType = getScoresDrilldown_Output;
export type GetScoresDrilldownInputType = getScoresDrilldown_Input;

import type getScoresReport_Type from '../api/getScoresReport';
type getScoresReport_Input = Parameters<typeof getScoresReport_Type.execute>[0]['input'];
type getScoresReport_Output = ReturnType<typeof getScoresReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getScoresReport_Type.execute>;
export const getScoresReport = (input: getScoresReport_Input): Promise<getScoresReport_Output> => invokeEndpoint('getScoresReport', input);
export type GetScoresReportOutputType = getScoresReport_Output;
export type GetScoresReportInputType = getScoresReport_Input;

import type getServiceAnalytics_Type from '../api/getServiceAnalytics';
type getServiceAnalytics_Input = Parameters<typeof getServiceAnalytics_Type.execute>[0]['input'];
type getServiceAnalytics_Output = ReturnType<typeof getServiceAnalytics_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getServiceAnalytics_Type.execute>;
export const getServiceAnalytics = (input: getServiceAnalytics_Input): Promise<getServiceAnalytics_Output> => invokeEndpoint('getServiceAnalytics', input);
export type GetServiceAnalyticsOutputType = getServiceAnalytics_Output;
export type GetServiceAnalyticsInputType = getServiceAnalytics_Input;

import type getServiceCalendar_Type from '../api/getServiceCalendar';
type getServiceCalendar_Input = Parameters<typeof getServiceCalendar_Type.execute>[0]['input'];
type getServiceCalendar_Output = ReturnType<typeof getServiceCalendar_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getServiceCalendar_Type.execute>;
export const getServiceCalendar = (input: getServiceCalendar_Input): Promise<getServiceCalendar_Output> => invokeEndpoint('getServiceCalendar', input);
export type GetServiceCalendarOutputType = getServiceCalendar_Output;
export type GetServiceCalendarInputType = getServiceCalendar_Input;

import type getServiceLeaderboard_Type from '../api/getServiceLeaderboard';
type getServiceLeaderboard_Input = Parameters<typeof getServiceLeaderboard_Type.execute>[0]['input'];
type getServiceLeaderboard_Output = ReturnType<typeof getServiceLeaderboard_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getServiceLeaderboard_Type.execute>;
export const getServiceLeaderboard = (input: getServiceLeaderboard_Input): Promise<getServiceLeaderboard_Output> => invokeEndpoint('getServiceLeaderboard', input);
export type GetServiceLeaderboardOutputType = getServiceLeaderboard_Output;
export type GetServiceLeaderboardInputType = getServiceLeaderboard_Input;

import type getServicePreferences_Type from '../api/getServicePreferences';
type getServicePreferences_Input = Parameters<typeof getServicePreferences_Type.execute>[0]['input'];
type getServicePreferences_Output = ReturnType<typeof getServicePreferences_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getServicePreferences_Type.execute>;
export const getServicePreferences = (input: getServicePreferences_Input): Promise<getServicePreferences_Output> => invokeEndpoint('getServicePreferences', input);
export type GetServicePreferencesOutputType = getServicePreferences_Output;
export type GetServicePreferencesInputType = getServicePreferences_Input;

import type getServiceProfile_Type from '../api/getServiceProfile';
type getServiceProfile_Input = Parameters<typeof getServiceProfile_Type.execute>[0]['input'];
type getServiceProfile_Output = ReturnType<typeof getServiceProfile_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getServiceProfile_Type.execute>;
export const getServiceProfile = (input: getServiceProfile_Input): Promise<getServiceProfile_Output> => invokeEndpoint('getServiceProfile', input);
export type GetServiceProfileOutputType = getServiceProfile_Output;
export type GetServiceProfileInputType = getServiceProfile_Input;

import type getServiceRatingsForDate_Type from '../api/getServiceRatingsForDate';
type getServiceRatingsForDate_Input = Parameters<typeof getServiceRatingsForDate_Type.execute>[0]['input'];
type getServiceRatingsForDate_Output = ReturnType<typeof getServiceRatingsForDate_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getServiceRatingsForDate_Type.execute>;
export const getServiceRatingsForDate = (input: getServiceRatingsForDate_Input): Promise<getServiceRatingsForDate_Output> => invokeEndpoint('getServiceRatingsForDate', input);
export type GetServiceRatingsForDateOutputType = getServiceRatingsForDate_Output;
export type GetServiceRatingsForDateInputType = getServiceRatingsForDate_Input;

import type getServiceRotation_Type from '../api/getServiceRotation';
type getServiceRotation_Input = Parameters<typeof getServiceRotation_Type.execute>[0]['input'];
type getServiceRotation_Output = ReturnType<typeof getServiceRotation_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getServiceRotation_Type.execute>;
export const getServiceRotation = (input: getServiceRotation_Input): Promise<getServiceRotation_Output> => invokeEndpoint('getServiceRotation', input);
export type GetServiceRotationOutputType = getServiceRotation_Output;
export type GetServiceRotationInputType = getServiceRotation_Input;

import type getServices_Type from '../api/getServices';
type getServices_Input = Parameters<typeof getServices_Type.execute>[0]['input'];
type getServices_Output = ReturnType<typeof getServices_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getServices_Type.execute>;
export const getServices = (input: getServices_Input): Promise<getServices_Output> => invokeEndpoint('getServices', input);
export type GetServicesOutputType = getServices_Output;
export type GetServicesInputType = getServices_Input;

import type getSessionByToken_Type from '../api/getSessionByToken';
type getSessionByToken_Input = Parameters<typeof getSessionByToken_Type.execute>[0]['input'];
type getSessionByToken_Output = ReturnType<typeof getSessionByToken_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getSessionByToken_Type.execute>;
export const getSessionByToken = (input: getSessionByToken_Input): Promise<getSessionByToken_Output> => invokeEndpoint('getSessionByToken', input);
export type GetSessionByTokenOutputType = getSessionByToken_Output;
export type GetSessionByTokenInputType = getSessionByToken_Input;

import type getSuperBvAnalytics_Type from '../api/getSuperBvAnalytics';
type getSuperBvAnalytics_Input = Parameters<typeof getSuperBvAnalytics_Type.execute>[0]['input'];
type getSuperBvAnalytics_Output = ReturnType<typeof getSuperBvAnalytics_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getSuperBvAnalytics_Type.execute>;
export const getSuperBvAnalytics = (input: getSuperBvAnalytics_Input): Promise<getSuperBvAnalytics_Output> => invokeEndpoint('getSuperBvAnalytics', input);
export type GetSuperBvAnalyticsOutputType = getSuperBvAnalytics_Output;
export type GetSuperBvAnalyticsInputType = getSuperBvAnalytics_Input;

import type getSuperGuideAttendanceReport_Type from '../api/getSuperGuideAttendanceReport';
type getSuperGuideAttendanceReport_Input = Parameters<typeof getSuperGuideAttendanceReport_Type.execute>[0]['input'];
type getSuperGuideAttendanceReport_Output = ReturnType<typeof getSuperGuideAttendanceReport_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getSuperGuideAttendanceReport_Type.execute>;
export const getSuperGuideAttendanceReport = (input: getSuperGuideAttendanceReport_Input): Promise<getSuperGuideAttendanceReport_Output> => invokeEndpoint('getSuperGuideAttendanceReport', input);
export type GetSuperGuideAttendanceReportOutputType = getSuperGuideAttendanceReport_Output;
export type GetSuperGuideAttendanceReportInputType = getSuperGuideAttendanceReport_Input;

import type getSuperGuideBvStats_Type from '../api/getSuperGuideBvStats';
type getSuperGuideBvStats_Input = Parameters<typeof getSuperGuideBvStats_Type.execute>[0]['input'];
type getSuperGuideBvStats_Output = ReturnType<typeof getSuperGuideBvStats_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getSuperGuideBvStats_Type.execute>;
export const getSuperGuideBvStats = (input: getSuperGuideBvStats_Input): Promise<getSuperGuideBvStats_Output> => invokeEndpoint('getSuperGuideBvStats', input);
export type GetSuperGuideBvStatsOutputType = getSuperGuideBvStats_Output;
export type GetSuperGuideBvStatsInputType = getSuperGuideBvStats_Input;

import type getTagMangoConfig_Type from '../api/getTagMangoConfig';
type getTagMangoConfig_Input = Parameters<typeof getTagMangoConfig_Type.execute>[0]['input'];
type getTagMangoConfig_Output = ReturnType<typeof getTagMangoConfig_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getTagMangoConfig_Type.execute>;
export const getTagMangoConfig = (input: getTagMangoConfig_Input): Promise<getTagMangoConfig_Output> => invokeEndpoint('getTagMangoConfig', input);
export type GetTagMangoConfigOutputType = getTagMangoConfig_Output;
export type GetTagMangoConfigInputType = getTagMangoConfig_Input;

import type getTagMangoSyncLog_Type from '../api/getTagMangoSyncLog';
type getTagMangoSyncLog_Input = Parameters<typeof getTagMangoSyncLog_Type.execute>[0]['input'];
type getTagMangoSyncLog_Output = ReturnType<typeof getTagMangoSyncLog_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getTagMangoSyncLog_Type.execute>;
export const getTagMangoSyncLog = (input: getTagMangoSyncLog_Input): Promise<getTagMangoSyncLog_Output> => invokeEndpoint('getTagMangoSyncLog', input);
export type GetTagMangoSyncLogOutputType = getTagMangoSyncLog_Output;
export type GetTagMangoSyncLogInputType = getTagMangoSyncLog_Input;

import type getTodayServiceBoard_Type from '../api/getTodayServiceBoard';
type getTodayServiceBoard_Input = Parameters<typeof getTodayServiceBoard_Type.execute>[0]['input'];
type getTodayServiceBoard_Output = ReturnType<typeof getTodayServiceBoard_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getTodayServiceBoard_Type.execute>;
export const getTodayServiceBoard = (input: getTodayServiceBoard_Input): Promise<getTodayServiceBoard_Output> => invokeEndpoint('getTodayServiceBoard', input);
export type GetTodayServiceBoardOutputType = getTodayServiceBoard_Output;
export type GetTodayServiceBoardInputType = getTodayServiceBoard_Input;

import type getUnavailabilityRequests_Type from '../api/getUnavailabilityRequests';
type getUnavailabilityRequests_Input = Parameters<typeof getUnavailabilityRequests_Type.execute>[0]['input'];
type getUnavailabilityRequests_Output = ReturnType<typeof getUnavailabilityRequests_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getUnavailabilityRequests_Type.execute>;
export const getUnavailabilityRequests = (input: getUnavailabilityRequests_Input): Promise<getUnavailabilityRequests_Output> => invokeEndpoint('getUnavailabilityRequests', input);
export type GetUnavailabilityRequestsOutputType = getUnavailabilityRequests_Output;
export type GetUnavailabilityRequestsInputType = getUnavailabilityRequests_Input;

import type getUserAttendanceCalendar_Type from '../api/getUserAttendanceCalendar';
type getUserAttendanceCalendar_Input = Parameters<typeof getUserAttendanceCalendar_Type.execute>[0]['input'];
type getUserAttendanceCalendar_Output = ReturnType<typeof getUserAttendanceCalendar_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getUserAttendanceCalendar_Type.execute>;
export const getUserAttendanceCalendar = (input: getUserAttendanceCalendar_Input): Promise<getUserAttendanceCalendar_Output> => invokeEndpoint('getUserAttendanceCalendar', input);
export type GetUserAttendanceCalendarOutputType = getUserAttendanceCalendar_Output;
export type GetUserAttendanceCalendarInputType = getUserAttendanceCalendar_Input;

import type getUserBvStatus_Type from '../api/getUserBvStatus';
type getUserBvStatus_Input = Parameters<typeof getUserBvStatus_Type.execute>[0]['input'];
type getUserBvStatus_Output = ReturnType<typeof getUserBvStatus_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getUserBvStatus_Type.execute>;
export const getUserBvStatus = (input: getUserBvStatus_Input): Promise<getUserBvStatus_Output> => invokeEndpoint('getUserBvStatus', input);
export type GetUserBvStatusOutputType = getUserBvStatus_Output;
export type GetUserBvStatusInputType = getUserBvStatus_Input;

import type getUserCleanlinessCalendar_Type from '../api/getUserCleanlinessCalendar';
type getUserCleanlinessCalendar_Input = Parameters<typeof getUserCleanlinessCalendar_Type.execute>[0]['input'];
type getUserCleanlinessCalendar_Output = ReturnType<typeof getUserCleanlinessCalendar_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getUserCleanlinessCalendar_Type.execute>;
export const getUserCleanlinessCalendar = (input: getUserCleanlinessCalendar_Input): Promise<getUserCleanlinessCalendar_Output> => invokeEndpoint('getUserCleanlinessCalendar', input);
export type GetUserCleanlinessCalendarOutputType = getUserCleanlinessCalendar_Output;
export type GetUserCleanlinessCalendarInputType = getUserCleanlinessCalendar_Input;

import type getUserCrmData_Type from '../api/getUserCrmData';
type getUserCrmData_Input = Parameters<typeof getUserCrmData_Type.execute>[0]['input'];
type getUserCrmData_Output = ReturnType<typeof getUserCrmData_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getUserCrmData_Type.execute>;
export const getUserCrmData = (input: getUserCrmData_Input): Promise<getUserCrmData_Output> => invokeEndpoint('getUserCrmData', input);
export type GetUserCrmDataOutputType = getUserCrmData_Output;
export type GetUserCrmDataInputType = getUserCrmData_Input;

import type getUserDashboardData_Type from '../api/getUserDashboardData';
type getUserDashboardData_Input = Parameters<typeof getUserDashboardData_Type.execute>[0]['input'];
type getUserDashboardData_Output = ReturnType<typeof getUserDashboardData_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getUserDashboardData_Type.execute>;
export const getUserDashboardData = (input: getUserDashboardData_Input): Promise<getUserDashboardData_Output> => invokeEndpoint('getUserDashboardData', input);
export type GetUserDashboardDataOutputType = getUserDashboardData_Output;
export type GetUserDashboardDataInputType = getUserDashboardData_Input;

import type getUserDetailForGuide_Type from '../api/getUserDetailForGuide';
type getUserDetailForGuide_Input = Parameters<typeof getUserDetailForGuide_Type.execute>[0]['input'];
type getUserDetailForGuide_Output = ReturnType<typeof getUserDetailForGuide_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getUserDetailForGuide_Type.execute>;
export const getUserDetailForGuide = (input: getUserDetailForGuide_Input): Promise<getUserDetailForGuide_Output> => invokeEndpoint('getUserDetailForGuide', input);
export type GetUserDetailForGuideOutputType = getUserDetailForGuide_Output;
export type GetUserDetailForGuideInputType = getUserDetailForGuide_Input;

import type getUserHistory_Type from '../api/getUserHistory';
type getUserHistory_Input = Parameters<typeof getUserHistory_Type.execute>[0]['input'];
type getUserHistory_Output = ReturnType<typeof getUserHistory_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getUserHistory_Type.execute>;
export const getUserHistory = (input: getUserHistory_Input): Promise<getUserHistory_Output> => invokeEndpoint('getUserHistory', input);
export type GetUserHistoryOutputType = getUserHistory_Output;
export type GetUserHistoryInputType = getUserHistory_Input;

import type getUserMetrics_Type from '../api/getUserMetrics';
type getUserMetrics_Input = Parameters<typeof getUserMetrics_Type.execute>[0]['input'];
type getUserMetrics_Output = ReturnType<typeof getUserMetrics_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getUserMetrics_Type.execute>;
export const getUserMetrics = (input: getUserMetrics_Input): Promise<getUserMetrics_Output> => invokeEndpoint('getUserMetrics', input);
export type GetUserMetricsOutputType = getUserMetrics_Output;
export type GetUserMetricsInputType = getUserMetrics_Input;

import type getUserProfile_Type from '../api/getUserProfile';
type getUserProfile_Input = Parameters<typeof getUserProfile_Type.execute>[0]['input'];
type getUserProfile_Output = ReturnType<typeof getUserProfile_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getUserProfile_Type.execute>;
export const getUserProfile = (input: getUserProfile_Input): Promise<getUserProfile_Output> => invokeEndpoint('getUserProfile', input);
export type GetUserProfileOutputType = getUserProfile_Output;
export type GetUserProfileInputType = getUserProfile_Input;

import type getUserProgressStats_Type from '../api/getUserProgressStats';
type getUserProgressStats_Input = Parameters<typeof getUserProgressStats_Type.execute>[0]['input'];
type getUserProgressStats_Output = ReturnType<typeof getUserProgressStats_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getUserProgressStats_Type.execute>;
export const getUserProgressStats = (input: getUserProgressStats_Input): Promise<getUserProgressStats_Output> => invokeEndpoint('getUserProgressStats', input);
export type GetUserProgressStatsOutputType = getUserProgressStats_Output;
export type GetUserProgressStatsInputType = getUserProgressStats_Input;

import type getUserSkills_Type from '../api/getUserSkills';
type getUserSkills_Input = Parameters<typeof getUserSkills_Type.execute>[0]['input'];
type getUserSkills_Output = ReturnType<typeof getUserSkills_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getUserSkills_Type.execute>;
export const getUserSkills = (input: getUserSkills_Input): Promise<getUserSkills_Output> => invokeEndpoint('getUserSkills', input);
export type GetUserSkillsOutputType = getUserSkills_Output;
export type GetUserSkillsInputType = getUserSkills_Input;

import type getVapidPublicKey_Type from '../api/getVapidPublicKey';
type getVapidPublicKey_Input = Parameters<typeof getVapidPublicKey_Type.execute>[0]['input'];
type getVapidPublicKey_Output = ReturnType<typeof getVapidPublicKey_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getVapidPublicKey_Type.execute>;
export const getVapidPublicKey = (input: getVapidPublicKey_Input): Promise<getVapidPublicKey_Output> => invokeEndpoint('getVapidPublicKey', input);
export type GetVapidPublicKeyOutputType = getVapidPublicKey_Output;
export type GetVapidPublicKeyInputType = getVapidPublicKey_Input;

import type getWeeklySchedule_Type from '../api/getWeeklySchedule';
type getWeeklySchedule_Input = Parameters<typeof getWeeklySchedule_Type.execute>[0]['input'];
type getWeeklySchedule_Output = ReturnType<typeof getWeeklySchedule_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof getWeeklySchedule_Type.execute>;
export const getWeeklySchedule = (input: getWeeklySchedule_Input): Promise<getWeeklySchedule_Output> => invokeEndpoint('getWeeklySchedule', input);
export type GetWeeklyScheduleOutputType = getWeeklySchedule_Output;
export type GetWeeklyScheduleInputType = getWeeklySchedule_Input;

import type importRentPayments_Type from '../api/importRentPayments';
type importRentPayments_Input = Parameters<typeof importRentPayments_Type.execute>[0]['input'];
type importRentPayments_Output = ReturnType<typeof importRentPayments_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof importRentPayments_Type.execute>;
export const importRentPayments = (input: importRentPayments_Input): Promise<importRentPayments_Output> => invokeEndpoint('importRentPayments', input);
export type ImportRentPaymentsOutputType = importRentPayments_Output;
export type ImportRentPaymentsInputType = importRentPayments_Input;

import type importServiceAllocation_Type from '../api/importServiceAllocation';
type importServiceAllocation_Input = Parameters<typeof importServiceAllocation_Type.execute>[0]['input'];
type importServiceAllocation_Output = ReturnType<typeof importServiceAllocation_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof importServiceAllocation_Type.execute>;
export const importServiceAllocation = (input: importServiceAllocation_Input): Promise<importServiceAllocation_Output> => invokeEndpoint('importServiceAllocation', input);
export type ImportServiceAllocationOutputType = importServiceAllocation_Output;
export type ImportServiceAllocationInputType = importServiceAllocation_Input;

import type importTrips_Type from '../api/importTrips';
type importTrips_Input = Parameters<typeof importTrips_Type.execute>[0]['input'];
type importTrips_Output = ReturnType<typeof importTrips_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof importTrips_Type.execute>;
export const importTrips = (input: importTrips_Input): Promise<importTrips_Output> => invokeEndpoint('importTrips', input);
export type ImportTripsOutputType = importTrips_Output;
export type ImportTripsInputType = importTrips_Input;

import type invalidateSadhanaFieldsCache_Type from '../api/invalidateSadhanaFieldsCache';
type invalidateSadhanaFieldsCache_Input = Parameters<typeof invalidateSadhanaFieldsCache_Type.execute>[0]['input'];
type invalidateSadhanaFieldsCache_Output = ReturnType<typeof invalidateSadhanaFieldsCache_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof invalidateSadhanaFieldsCache_Type.execute>;
export const invalidateSadhanaFieldsCache = (input: invalidateSadhanaFieldsCache_Input): Promise<invalidateSadhanaFieldsCache_Output> => invokeEndpoint('invalidateSadhanaFieldsCache', input);
export type InvalidateSadhanaFieldsCacheOutputType = invalidateSadhanaFieldsCache_Output;
export type InvalidateSadhanaFieldsCacheInputType = invalidateSadhanaFieldsCache_Input;

import type joinBvGroupByToken_Type from '../api/joinBvGroupByToken';
type joinBvGroupByToken_Input = Parameters<typeof joinBvGroupByToken_Type.execute>[0]['input'];
type joinBvGroupByToken_Output = ReturnType<typeof joinBvGroupByToken_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof joinBvGroupByToken_Type.execute>;
export const joinBvGroupByToken = (input: joinBvGroupByToken_Input): Promise<joinBvGroupByToken_Output> => invokeEndpoint('joinBvGroupByToken', input);
export type JoinBvGroupByTokenOutputType = joinBvGroupByToken_Output;
export type JoinBvGroupByTokenInputType = joinBvGroupByToken_Input;

import type joinGroupByToken_Type from '../api/joinGroupByToken';
type joinGroupByToken_Input = Parameters<typeof joinGroupByToken_Type.execute>[0]['input'];
type joinGroupByToken_Output = ReturnType<typeof joinGroupByToken_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof joinGroupByToken_Type.execute>;
export const joinGroupByToken = (input: joinGroupByToken_Input): Promise<joinGroupByToken_Output> => invokeEndpoint('joinGroupByToken', input);
export type JoinGroupByTokenOutputType = joinGroupByToken_Output;
export type JoinGroupByTokenInputType = joinGroupByToken_Input;

import type joinSessionChallenge_Type from '../api/joinSessionChallenge';
type joinSessionChallenge_Input = Parameters<typeof joinSessionChallenge_Type.execute>[0]['input'];
type joinSessionChallenge_Output = ReturnType<typeof joinSessionChallenge_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof joinSessionChallenge_Type.execute>;
export const joinSessionChallenge = (input: joinSessionChallenge_Input): Promise<joinSessionChallenge_Output> => invokeEndpoint('joinSessionChallenge', input);
export type JoinSessionChallengeOutputType = joinSessionChallenge_Output;
export type JoinSessionChallengeInputType = joinSessionChallenge_Input;

import type leaveBvGroup_Type from '../api/leaveBvGroup';
type leaveBvGroup_Input = Parameters<typeof leaveBvGroup_Type.execute>[0]['input'];
type leaveBvGroup_Output = ReturnType<typeof leaveBvGroup_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof leaveBvGroup_Type.execute>;
export const leaveBvGroup = (input: leaveBvGroup_Input): Promise<leaveBvGroup_Output> => invokeEndpoint('leaveBvGroup', input);
export type LeaveBvGroupOutputType = leaveBvGroup_Output;
export type LeaveBvGroupInputType = leaveBvGroup_Input;

import type leaveResidency_Type from '../api/leaveResidency';
type leaveResidency_Input = Parameters<typeof leaveResidency_Type.execute>[0]['input'];
type leaveResidency_Output = ReturnType<typeof leaveResidency_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof leaveResidency_Type.execute>;
export const leaveResidency = (input: leaveResidency_Input): Promise<leaveResidency_Output> => invokeEndpoint('leaveResidency', input);
export type LeaveResidencyOutputType = leaveResidency_Output;
export type LeaveResidencyInputType = leaveResidency_Input;

import type logOneToOneMeeting_Type from '../api/logOneToOneMeeting';
type logOneToOneMeeting_Input = Parameters<typeof logOneToOneMeeting_Type.execute>[0]['input'];
type logOneToOneMeeting_Output = ReturnType<typeof logOneToOneMeeting_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof logOneToOneMeeting_Type.execute>;
export const logOneToOneMeeting = (input: logOneToOneMeeting_Input): Promise<logOneToOneMeeting_Output> => invokeEndpoint('logOneToOneMeeting', input);
export type LogOneToOneMeetingOutputType = logOneToOneMeeting_Output;
export type LogOneToOneMeetingInputType = logOneToOneMeeting_Input;

import type lookupPhone_Type from '../api/lookupPhone';
type lookupPhone_Input = Parameters<typeof lookupPhone_Type.execute>[0]['input'];
type lookupPhone_Output = ReturnType<typeof lookupPhone_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof lookupPhone_Type.execute>;
export const lookupPhone = (input: lookupPhone_Input): Promise<lookupPhone_Output> => invokeEndpoint('lookupPhone', input);
export type LookupPhoneOutputType = lookupPhone_Output;
export type LookupPhoneInputType = lookupPhone_Input;

import type manageAttendanceVolunteers_Type from '../api/manageAttendanceVolunteers';
type manageAttendanceVolunteers_Input = Parameters<typeof manageAttendanceVolunteers_Type.execute>[0]['input'];
type manageAttendanceVolunteers_Output = ReturnType<typeof manageAttendanceVolunteers_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof manageAttendanceVolunteers_Type.execute>;
export const manageAttendanceVolunteers = (input: manageAttendanceVolunteers_Input): Promise<manageAttendanceVolunteers_Output> => invokeEndpoint('manageAttendanceVolunteers', input);
export type ManageAttendanceVolunteersOutputType = manageAttendanceVolunteers_Output;
export type ManageAttendanceVolunteersInputType = manageAttendanceVolunteers_Input;

import type manageCatalogSkill_Type from '../api/manageCatalogSkill';
type manageCatalogSkill_Input = Parameters<typeof manageCatalogSkill_Type.execute>[0]['input'];
type manageCatalogSkill_Output = ReturnType<typeof manageCatalogSkill_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof manageCatalogSkill_Type.execute>;
export const manageCatalogSkill = (input: manageCatalogSkill_Input): Promise<manageCatalogSkill_Output> => invokeEndpoint('manageCatalogSkill', input);
export type ManageCatalogSkillOutputType = manageCatalogSkill_Output;
export type ManageCatalogSkillInputType = manageCatalogSkill_Input;

import type manageCleanlinessRoom_Type from '../api/manageCleanlinessRoom';
type manageCleanlinessRoom_Input = Parameters<typeof manageCleanlinessRoom_Type.execute>[0]['input'];
type manageCleanlinessRoom_Output = ReturnType<typeof manageCleanlinessRoom_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof manageCleanlinessRoom_Type.execute>;
export const manageCleanlinessRoom = (input: manageCleanlinessRoom_Input): Promise<manageCleanlinessRoom_Output> => invokeEndpoint('manageCleanlinessRoom', input);
export type ManageCleanlinessRoomOutputType = manageCleanlinessRoom_Output;
export type ManageCleanlinessRoomInputType = manageCleanlinessRoom_Input;

import type markBvAttendance_Type from '../api/markBvAttendance';
type markBvAttendance_Input = Parameters<typeof markBvAttendance_Type.execute>[0]['input'];
type markBvAttendance_Output = ReturnType<typeof markBvAttendance_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof markBvAttendance_Type.execute>;
export const markBvAttendance = (input: markBvAttendance_Input): Promise<markBvAttendance_Output> => invokeEndpoint('markBvAttendance', input);
export type MarkBvAttendanceOutputType = markBvAttendance_Output;
export type MarkBvAttendanceInputType = markBvAttendance_Input;

import type markCourseComplete_Type from '../api/markCourseComplete';
type markCourseComplete_Input = Parameters<typeof markCourseComplete_Type.execute>[0]['input'];
type markCourseComplete_Output = ReturnType<typeof markCourseComplete_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof markCourseComplete_Type.execute>;
export const markCourseComplete = (input: markCourseComplete_Input): Promise<markCourseComplete_Output> => invokeEndpoint('markCourseComplete', input);
export type MarkCourseCompleteOutputType = markCourseComplete_Output;
export type MarkCourseCompleteInputType = markCourseComplete_Input;

import type markServiceDone_Type from '../api/markServiceDone';
type markServiceDone_Input = Parameters<typeof markServiceDone_Type.execute>[0]['input'];
type markServiceDone_Output = ReturnType<typeof markServiceDone_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof markServiceDone_Type.execute>;
export const markServiceDone = (input: markServiceDone_Input): Promise<markServiceDone_Output> => invokeEndpoint('markServiceDone', input);
export type MarkServiceDoneOutputType = markServiceDone_Output;
export type MarkServiceDoneInputType = markServiceDone_Input;

import type markSessionAttendance_Type from '../api/markSessionAttendance';
type markSessionAttendance_Input = Parameters<typeof markSessionAttendance_Type.execute>[0]['input'];
type markSessionAttendance_Output = ReturnType<typeof markSessionAttendance_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof markSessionAttendance_Type.execute>;
export const markSessionAttendance = (input: markSessionAttendance_Input): Promise<markSessionAttendance_Output> => invokeEndpoint('markSessionAttendance', input);
export type MarkSessionAttendanceOutputType = markSessionAttendance_Output;
export type MarkSessionAttendanceInputType = markSessionAttendance_Input;

import type openApiSpec_Type from '../api/openApiSpec';
type openApiSpec_Input = Parameters<typeof openApiSpec_Type.execute>[0]['input'];
type openApiSpec_Output = ReturnType<typeof openApiSpec_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof openApiSpec_Type.execute>;
export const openApiSpec = (input: openApiSpec_Input): Promise<openApiSpec_Output> => invokeEndpoint('openApiSpec', input);
export type OpenApiSpecOutputType = openApiSpec_Output;
export type OpenApiSpecInputType = openApiSpec_Input;

import type processJigyasaAttendance_Type from '../api/processJigyasaAttendance';
type processJigyasaAttendance_Input = Parameters<typeof processJigyasaAttendance_Type.execute>[0]['input'];
type processJigyasaAttendance_Output = ReturnType<typeof processJigyasaAttendance_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof processJigyasaAttendance_Type.execute>;
export const processJigyasaAttendance = (input: processJigyasaAttendance_Input): Promise<processJigyasaAttendance_Output> => invokeEndpoint('processJigyasaAttendance', input);
export type ProcessJigyasaAttendanceOutputType = processJigyasaAttendance_Output;
export type ProcessJigyasaAttendanceInputType = processJigyasaAttendance_Input;

import type processJigyasaRegistration_Type from '../api/processJigyasaRegistration';
type processJigyasaRegistration_Input = Parameters<typeof processJigyasaRegistration_Type.execute>[0]['input'];
type processJigyasaRegistration_Output = ReturnType<typeof processJigyasaRegistration_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof processJigyasaRegistration_Type.execute>;
export const processJigyasaRegistration = (input: processJigyasaRegistration_Input): Promise<processJigyasaRegistration_Output> => invokeEndpoint('processJigyasaRegistration', input);
export type ProcessJigyasaRegistrationOutputType = processJigyasaRegistration_Output;
export type ProcessJigyasaRegistrationInputType = processJigyasaRegistration_Input;

import type publishAllocation_Type from '../api/publishAllocation';
type publishAllocation_Input = Parameters<typeof publishAllocation_Type.execute>[0]['input'];
type publishAllocation_Output = ReturnType<typeof publishAllocation_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof publishAllocation_Type.execute>;
export const publishAllocation = (input: publishAllocation_Input): Promise<publishAllocation_Output> => invokeEndpoint('publishAllocation', input);
export type PublishAllocationOutputType = publishAllocation_Output;
export type PublishAllocationInputType = publishAllocation_Input;

import type recalculateScoresForDate_Type from '../api/recalculateScoresForDate';
type recalculateScoresForDate_Input = Parameters<typeof recalculateScoresForDate_Type.execute>[0]['input'];
type recalculateScoresForDate_Output = ReturnType<typeof recalculateScoresForDate_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof recalculateScoresForDate_Type.execute>;
export const recalculateScoresForDate = (input: recalculateScoresForDate_Input): Promise<recalculateScoresForDate_Output> => invokeEndpoint('recalculateScoresForDate', input);
export type RecalculateScoresForDateOutputType = recalculateScoresForDate_Output;
export type RecalculateScoresForDateInputType = recalculateScoresForDate_Input;

import type registerAndAttend_Type from '../api/registerAndAttend';
type registerAndAttend_Input = Parameters<typeof registerAndAttend_Type.execute>[0]['input'];
type registerAndAttend_Output = ReturnType<typeof registerAndAttend_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof registerAndAttend_Type.execute>;
export const registerAndAttend = (input: registerAndAttend_Input): Promise<registerAndAttend_Output> => invokeEndpoint('registerAndAttend', input);
export type RegisterAndAttendOutputType = registerAndAttend_Output;
export type RegisterAndAttendInputType = registerAndAttend_Input;

import type registerTagMangoWebhook_Type from '../api/registerTagMangoWebhook';
type registerTagMangoWebhook_Input = Parameters<typeof registerTagMangoWebhook_Type.execute>[0]['input'];
type registerTagMangoWebhook_Output = ReturnType<typeof registerTagMangoWebhook_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof registerTagMangoWebhook_Type.execute>;
export const registerTagMangoWebhook = (input: registerTagMangoWebhook_Input): Promise<registerTagMangoWebhook_Output> => invokeEndpoint('registerTagMangoWebhook', input);
export type RegisterTagMangoWebhookOutputType = registerTagMangoWebhook_Output;
export type RegisterTagMangoWebhookInputType = registerTagMangoWebhook_Input;

import type registerUser_Type from '../api/registerUser';
type registerUser_Input = Parameters<typeof registerUser_Type.execute>[0]['input'];
type registerUser_Output = ReturnType<typeof registerUser_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof registerUser_Type.execute>;
export const registerUser = (input: registerUser_Input): Promise<registerUser_Output> => invokeEndpoint('registerUser', input);
export type RegisterUserOutputType = registerUser_Output;
export type RegisterUserInputType = registerUser_Input;

import type rejectSwap_Type from '../api/rejectSwap';
type rejectSwap_Input = Parameters<typeof rejectSwap_Type.execute>[0]['input'];
type rejectSwap_Output = ReturnType<typeof rejectSwap_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof rejectSwap_Type.execute>;
export const rejectSwap = (input: rejectSwap_Input): Promise<rejectSwap_Output> => invokeEndpoint('rejectSwap', input);
export type RejectSwapOutputType = rejectSwap_Output;
export type RejectSwapInputType = rejectSwap_Input;

import type rejectUser_Type from '../api/rejectUser';
type rejectUser_Input = Parameters<typeof rejectUser_Type.execute>[0]['input'];
type rejectUser_Output = ReturnType<typeof rejectUser_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof rejectUser_Type.execute>;
export const rejectUser = (input: rejectUser_Input): Promise<rejectUser_Output> => invokeEndpoint('rejectUser', input);
export type RejectUserOutputType = rejectUser_Output;
export type RejectUserInputType = rejectUser_Input;

import type releaseServiceAllocation_Type from '../api/releaseServiceAllocation';
type releaseServiceAllocation_Input = Parameters<typeof releaseServiceAllocation_Type.execute>[0]['input'];
type releaseServiceAllocation_Output = ReturnType<typeof releaseServiceAllocation_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof releaseServiceAllocation_Type.execute>;
export const releaseServiceAllocation = (input: releaseServiceAllocation_Input): Promise<releaseServiceAllocation_Output> => invokeEndpoint('releaseServiceAllocation', input);
export type ReleaseServiceAllocationOutputType = releaseServiceAllocation_Output;
export type ReleaseServiceAllocationInputType = releaseServiceAllocation_Input;

import type removeBvGroupMember_Type from '../api/removeBvGroupMember';
type removeBvGroupMember_Input = Parameters<typeof removeBvGroupMember_Type.execute>[0]['input'];
type removeBvGroupMember_Output = ReturnType<typeof removeBvGroupMember_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof removeBvGroupMember_Type.execute>;
export const removeBvGroupMember = (input: removeBvGroupMember_Input): Promise<removeBvGroupMember_Output> => invokeEndpoint('removeBvGroupMember', input);
export type RemoveBvGroupMemberOutputType = removeBvGroupMember_Output;
export type RemoveBvGroupMemberInputType = removeBvGroupMember_Input;

import type removeGroupMember_Type from '../api/removeGroupMember';
type removeGroupMember_Input = Parameters<typeof removeGroupMember_Type.execute>[0]['input'];
type removeGroupMember_Output = ReturnType<typeof removeGroupMember_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof removeGroupMember_Type.execute>;
export const removeGroupMember = (input: removeGroupMember_Input): Promise<removeGroupMember_Output> => invokeEndpoint('removeGroupMember', input);
export type RemoveGroupMemberOutputType = removeGroupMember_Output;
export type RemoveGroupMemberInputType = removeGroupMember_Input;

import type removeMySkill_Type from '../api/removeMySkill';
type removeMySkill_Input = Parameters<typeof removeMySkill_Type.execute>[0]['input'];
type removeMySkill_Output = ReturnType<typeof removeMySkill_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof removeMySkill_Type.execute>;
export const removeMySkill = (input: removeMySkill_Input): Promise<removeMySkill_Output> => invokeEndpoint('removeMySkill', input);
export type RemoveMySkillOutputType = removeMySkill_Output;
export type RemoveMySkillInputType = removeMySkill_Input;

import type removeUserSkill_Type from '../api/removeUserSkill';
type removeUserSkill_Input = Parameters<typeof removeUserSkill_Type.execute>[0]['input'];
type removeUserSkill_Output = ReturnType<typeof removeUserSkill_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof removeUserSkill_Type.execute>;
export const removeUserSkill = (input: removeUserSkill_Input): Promise<removeUserSkill_Output> => invokeEndpoint('removeUserSkill', input);
export type RemoveUserSkillOutputType = removeUserSkill_Output;
export type RemoveUserSkillInputType = removeUserSkill_Input;

import type requestAshrayUpgrade_Type from '../api/requestAshrayUpgrade';
type requestAshrayUpgrade_Input = Parameters<typeof requestAshrayUpgrade_Type.execute>[0]['input'];
type requestAshrayUpgrade_Output = ReturnType<typeof requestAshrayUpgrade_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof requestAshrayUpgrade_Type.execute>;
export const requestAshrayUpgrade = (input: requestAshrayUpgrade_Input): Promise<requestAshrayUpgrade_Output> => invokeEndpoint('requestAshrayUpgrade', input);
export type RequestAshrayUpgradeOutputType = requestAshrayUpgrade_Output;
export type RequestAshrayUpgradeInputType = requestAshrayUpgrade_Input;

import type requestCleanlinessReview_Type from '../api/requestCleanlinessReview';
type requestCleanlinessReview_Input = Parameters<typeof requestCleanlinessReview_Type.execute>[0]['input'];
type requestCleanlinessReview_Output = ReturnType<typeof requestCleanlinessReview_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof requestCleanlinessReview_Type.execute>;
export const requestCleanlinessReview = (input: requestCleanlinessReview_Input): Promise<requestCleanlinessReview_Output> => invokeEndpoint('requestCleanlinessReview', input);
export type RequestCleanlinessReviewOutputType = requestCleanlinessReview_Output;
export type RequestCleanlinessReviewInputType = requestCleanlinessReview_Input;

import type requestGuideTransfer_Type from '../api/requestGuideTransfer';
type requestGuideTransfer_Input = Parameters<typeof requestGuideTransfer_Type.execute>[0]['input'];
type requestGuideTransfer_Output = ReturnType<typeof requestGuideTransfer_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof requestGuideTransfer_Type.execute>;
export const requestGuideTransfer = (input: requestGuideTransfer_Input): Promise<requestGuideTransfer_Output> => invokeEndpoint('requestGuideTransfer', input);
export type RequestGuideTransferOutputType = requestGuideTransfer_Output;
export type RequestGuideTransferInputType = requestGuideTransfer_Input;

import type requestJoinBvGroup_Type from '../api/requestJoinBvGroup';
type requestJoinBvGroup_Input = Parameters<typeof requestJoinBvGroup_Type.execute>[0]['input'];
type requestJoinBvGroup_Output = ReturnType<typeof requestJoinBvGroup_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof requestJoinBvGroup_Type.execute>;
export const requestJoinBvGroup = (input: requestJoinBvGroup_Input): Promise<requestJoinBvGroup_Output> => invokeEndpoint('requestJoinBvGroup', input);
export type RequestJoinBvGroupOutputType = requestJoinBvGroup_Output;
export type RequestJoinBvGroupInputType = requestJoinBvGroup_Input;

import type requestRentCorrection_Type from '../api/requestRentCorrection';
type requestRentCorrection_Input = Parameters<typeof requestRentCorrection_Type.execute>[0]['input'];
type requestRentCorrection_Output = ReturnType<typeof requestRentCorrection_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof requestRentCorrection_Type.execute>;
export const requestRentCorrection = (input: requestRentCorrection_Input): Promise<requestRentCorrection_Output> => invokeEndpoint('requestRentCorrection', input);
export type RequestRentCorrectionOutputType = requestRentCorrection_Output;
export type RequestRentCorrectionInputType = requestRentCorrection_Input;

import type requestResidencyTransfer_Type from '../api/requestResidencyTransfer';
type requestResidencyTransfer_Input = Parameters<typeof requestResidencyTransfer_Type.execute>[0]['input'];
type requestResidencyTransfer_Output = ReturnType<typeof requestResidencyTransfer_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof requestResidencyTransfer_Type.execute>;
export const requestResidencyTransfer = (input: requestResidencyTransfer_Input): Promise<requestResidencyTransfer_Output> => invokeEndpoint('requestResidencyTransfer', input);
export type RequestResidencyTransferOutputType = requestResidencyTransfer_Output;
export type RequestResidencyTransferInputType = requestResidencyTransfer_Input;

import type requestServiceSwap_Type from '../api/requestServiceSwap';
type requestServiceSwap_Input = Parameters<typeof requestServiceSwap_Type.execute>[0]['input'];
type requestServiceSwap_Output = ReturnType<typeof requestServiceSwap_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof requestServiceSwap_Type.execute>;
export const requestServiceSwap = (input: requestServiceSwap_Input): Promise<requestServiceSwap_Output> => invokeEndpoint('requestServiceSwap', input);
export type RequestServiceSwapOutputType = requestServiceSwap_Output;
export type RequestServiceSwapInputType = requestServiceSwap_Input;

import type requestTripCorrection_Type from '../api/requestTripCorrection';
type requestTripCorrection_Input = Parameters<typeof requestTripCorrection_Type.execute>[0]['input'];
type requestTripCorrection_Output = ReturnType<typeof requestTripCorrection_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof requestTripCorrection_Type.execute>;
export const requestTripCorrection = (input: requestTripCorrection_Input): Promise<requestTripCorrection_Output> => invokeEndpoint('requestTripCorrection', input);
export type RequestTripCorrectionOutputType = requestTripCorrection_Output;
export type RequestTripCorrectionInputType = requestTripCorrection_Input;

import type requestUnavailability_Type from '../api/requestUnavailability';
type requestUnavailability_Input = Parameters<typeof requestUnavailability_Type.execute>[0]['input'];
type requestUnavailability_Output = ReturnType<typeof requestUnavailability_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof requestUnavailability_Type.execute>;
export const requestUnavailability = (input: requestUnavailability_Input): Promise<requestUnavailability_Output> => invokeEndpoint('requestUnavailability', input);
export type RequestUnavailabilityOutputType = requestUnavailability_Output;
export type RequestUnavailabilityInputType = requestUnavailability_Input;

import type resolveCleanlinessReview_Type from '../api/resolveCleanlinessReview';
type resolveCleanlinessReview_Input = Parameters<typeof resolveCleanlinessReview_Type.execute>[0]['input'];
type resolveCleanlinessReview_Output = ReturnType<typeof resolveCleanlinessReview_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof resolveCleanlinessReview_Type.execute>;
export const resolveCleanlinessReview = (input: resolveCleanlinessReview_Input): Promise<resolveCleanlinessReview_Output> => invokeEndpoint('resolveCleanlinessReview', input);
export type ResolveCleanlinessReviewOutputType = resolveCleanlinessReview_Output;
export type ResolveCleanlinessReviewInputType = resolveCleanlinessReview_Input;

import type resolveGuideLogin_Type from '../api/resolveGuideLogin';
type resolveGuideLogin_Input = Parameters<typeof resolveGuideLogin_Type.execute>[0]['input'];
type resolveGuideLogin_Output = ReturnType<typeof resolveGuideLogin_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof resolveGuideLogin_Type.execute>;
export const resolveGuideLogin = (input: resolveGuideLogin_Input): Promise<resolveGuideLogin_Output> => invokeEndpoint('resolveGuideLogin', input);
export type ResolveGuideLoginOutputType = resolveGuideLogin_Output;
export type ResolveGuideLoginInputType = resolveGuideLogin_Input;

import type resolveUserLogin_Type from '../api/resolveUserLogin';
type resolveUserLogin_Input = Parameters<typeof resolveUserLogin_Type.execute>[0]['input'];
type resolveUserLogin_Output = ReturnType<typeof resolveUserLogin_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof resolveUserLogin_Type.execute>;
export const resolveUserLogin = (input: resolveUserLogin_Input): Promise<resolveUserLogin_Output> => invokeEndpoint('resolveUserLogin', input);
export type ResolveUserLoginOutputType = resolveUserLogin_Output;
export type ResolveUserLoginInputType = resolveUserLogin_Input;

import type retryTagMangoEnrollment_Type from '../api/retryTagMangoEnrollment';
type retryTagMangoEnrollment_Input = Parameters<typeof retryTagMangoEnrollment_Type.execute>[0]['input'];
type retryTagMangoEnrollment_Output = ReturnType<typeof retryTagMangoEnrollment_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof retryTagMangoEnrollment_Type.execute>;
export const retryTagMangoEnrollment = (input: retryTagMangoEnrollment_Input): Promise<retryTagMangoEnrollment_Output> => invokeEndpoint('retryTagMangoEnrollment', input);
export type RetryTagMangoEnrollmentOutputType = retryTagMangoEnrollment_Output;
export type RetryTagMangoEnrollmentInputType = retryTagMangoEnrollment_Input;

import type revoketagmangoaccess_Type from '../api/revoketagmangoaccess';
type revoketagmangoaccess_Input = Parameters<typeof revoketagmangoaccess_Type.execute>[0]['input'];
type revoketagmangoaccess_Output = ReturnType<typeof revoketagmangoaccess_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof revoketagmangoaccess_Type.execute>;
export const revoketagmangoaccess = (input: revoketagmangoaccess_Input): Promise<revoketagmangoaccess_Output> => invokeEndpoint('revoketagmangoaccess', input);
export type RevoketagmangoaccessOutputType = revoketagmangoaccess_Output;
export type RevoketagmangoaccessInputType = revoketagmangoaccess_Input;

import type sadhanaStatus_Type from '../api/sadhanaStatus';
type sadhanaStatus_Input = Parameters<typeof sadhanaStatus_Type.execute>[0]['input'];
type sadhanaStatus_Output = ReturnType<typeof sadhanaStatus_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof sadhanaStatus_Type.execute>;
export const sadhanaStatus = (input: sadhanaStatus_Input): Promise<sadhanaStatus_Output> => invokeEndpoint('sadhanaStatus', input);
export type SadhanaStatusOutputType = sadhanaStatus_Output;
export type SadhanaStatusInputType = sadhanaStatus_Input;

import type saveAshrayChecklist_Type from '../api/saveAshrayChecklist';
type saveAshrayChecklist_Input = Parameters<typeof saveAshrayChecklist_Type.execute>[0]['input'];
type saveAshrayChecklist_Output = ReturnType<typeof saveAshrayChecklist_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof saveAshrayChecklist_Type.execute>;
export const saveAshrayChecklist = (input: saveAshrayChecklist_Input): Promise<saveAshrayChecklist_Output> => invokeEndpoint('saveAshrayChecklist', input);
export type SaveAshrayChecklistOutputType = saveAshrayChecklist_Output;
export type SaveAshrayChecklistInputType = saveAshrayChecklist_Input;

import type saveBvslOneToOneLink_Type from '../api/saveBvslOneToOneLink';
type saveBvslOneToOneLink_Input = Parameters<typeof saveBvslOneToOneLink_Type.execute>[0]['input'];
type saveBvslOneToOneLink_Output = ReturnType<typeof saveBvslOneToOneLink_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof saveBvslOneToOneLink_Type.execute>;
export const saveBvslOneToOneLink = (input: saveBvslOneToOneLink_Input): Promise<saveBvslOneToOneLink_Output> => invokeEndpoint('saveBvslOneToOneLink', input);
export type SaveBvslOneToOneLinkOutputType = saveBvslOneToOneLink_Output;
export type SaveBvslOneToOneLinkInputType = saveBvslOneToOneLink_Input;

import type saveBvslWeeklyPlan_Type from '../api/saveBvslWeeklyPlan';
type saveBvslWeeklyPlan_Input = Parameters<typeof saveBvslWeeklyPlan_Type.execute>[0]['input'];
type saveBvslWeeklyPlan_Output = ReturnType<typeof saveBvslWeeklyPlan_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof saveBvslWeeklyPlan_Type.execute>;
export const saveBvslWeeklyPlan = (input: saveBvslWeeklyPlan_Input): Promise<saveBvslWeeklyPlan_Output> => invokeEndpoint('saveBvslWeeklyPlan', input);
export type SaveBvslWeeklyPlanOutputType = saveBvslWeeklyPlan_Output;
export type SaveBvslWeeklyPlanInputType = saveBvslWeeklyPlan_Input;

import type saveGuideOneToOneLink_Type from '../api/saveGuideOneToOneLink';
type saveGuideOneToOneLink_Input = Parameters<typeof saveGuideOneToOneLink_Type.execute>[0]['input'];
type saveGuideOneToOneLink_Output = ReturnType<typeof saveGuideOneToOneLink_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof saveGuideOneToOneLink_Type.execute>;
export const saveGuideOneToOneLink = (input: saveGuideOneToOneLink_Input): Promise<saveGuideOneToOneLink_Output> => invokeEndpoint('saveGuideOneToOneLink', input);
export type SaveGuideOneToOneLinkOutputType = saveGuideOneToOneLink_Output;
export type SaveGuideOneToOneLinkInputType = saveGuideOneToOneLink_Input;

import type saveOneToOneEligibility_Type from '../api/saveOneToOneEligibility';
type saveOneToOneEligibility_Input = Parameters<typeof saveOneToOneEligibility_Type.execute>[0]['input'];
type saveOneToOneEligibility_Output = ReturnType<typeof saveOneToOneEligibility_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof saveOneToOneEligibility_Type.execute>;
export const saveOneToOneEligibility = (input: saveOneToOneEligibility_Input): Promise<saveOneToOneEligibility_Output> => invokeEndpoint('saveOneToOneEligibility', input);
export type SaveOneToOneEligibilityOutputType = saveOneToOneEligibility_Output;
export type SaveOneToOneEligibilityInputType = saveOneToOneEligibility_Input;

import type savePreachingGoals_Type from '../api/savePreachingGoals';
type savePreachingGoals_Input = Parameters<typeof savePreachingGoals_Type.execute>[0]['input'];
type savePreachingGoals_Output = ReturnType<typeof savePreachingGoals_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof savePreachingGoals_Type.execute>;
export const savePreachingGoals = (input: savePreachingGoals_Input): Promise<savePreachingGoals_Output> => invokeEndpoint('savePreachingGoals', input);
export type SavePreachingGoalsOutputType = savePreachingGoals_Output;
export type SavePreachingGoalsInputType = savePreachingGoals_Input;

import type saveServicePreferences_Type from '../api/saveServicePreferences';
type saveServicePreferences_Input = Parameters<typeof saveServicePreferences_Type.execute>[0]['input'];
type saveServicePreferences_Output = ReturnType<typeof saveServicePreferences_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof saveServicePreferences_Type.execute>;
export const saveServicePreferences = (input: saveServicePreferences_Input): Promise<saveServicePreferences_Output> => invokeEndpoint('saveServicePreferences', input);
export type SaveServicePreferencesOutputType = saveServicePreferences_Output;
export type SaveServicePreferencesInputType = saveServicePreferences_Input;

import type saveTagMangoConfig_Type from '../api/saveTagMangoConfig';
type saveTagMangoConfig_Input = Parameters<typeof saveTagMangoConfig_Type.execute>[0]['input'];
type saveTagMangoConfig_Output = ReturnType<typeof saveTagMangoConfig_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof saveTagMangoConfig_Type.execute>;
export const saveTagMangoConfig = (input: saveTagMangoConfig_Input): Promise<saveTagMangoConfig_Output> => invokeEndpoint('saveTagMangoConfig', input);
export type SaveTagMangoConfigOutputType = saveTagMangoConfig_Output;
export type SaveTagMangoConfigInputType = saveTagMangoConfig_Input;

import type seedData_Type from '../api/seedData';
type seedData_Input = Parameters<typeof seedData_Type.execute>[0]['input'];
type seedData_Output = ReturnType<typeof seedData_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof seedData_Type.execute>;
export const seedData = (input: seedData_Input): Promise<seedData_Output> => invokeEndpoint('seedData', input);
export type SeedDataOutputType = seedData_Output;
export type SeedDataInputType = seedData_Input;

import type seedUsers_Type from '../api/seedUsers';
type seedUsers_Input = Parameters<typeof seedUsers_Type.execute>[0]['input'];
type seedUsers_Output = ReturnType<typeof seedUsers_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof seedUsers_Type.execute>;
export const seedUsers = (input: seedUsers_Input): Promise<seedUsers_Output> => invokeEndpoint('seedUsers', input);
export type SeedUsersOutputType = seedUsers_Output;
export type SeedUsersInputType = seedUsers_Input;

import type seedWeeklyAllocations_Type from '../api/seedWeeklyAllocations';
type seedWeeklyAllocations_Input = Parameters<typeof seedWeeklyAllocations_Type.execute>[0]['input'];
type seedWeeklyAllocations_Output = ReturnType<typeof seedWeeklyAllocations_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof seedWeeklyAllocations_Type.execute>;
export const seedWeeklyAllocations = (input: seedWeeklyAllocations_Input): Promise<seedWeeklyAllocations_Output> => invokeEndpoint('seedWeeklyAllocations', input);
export type SeedWeeklyAllocationsOutputType = seedWeeklyAllocations_Output;
export type SeedWeeklyAllocationsInputType = seedWeeklyAllocations_Input;

import type selfAllocate_Type from '../api/selfAllocate';
type selfAllocate_Input = Parameters<typeof selfAllocate_Type.execute>[0]['input'];
type selfAllocate_Output = ReturnType<typeof selfAllocate_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof selfAllocate_Type.execute>;
export const selfAllocate = (input: selfAllocate_Input): Promise<selfAllocate_Output> => invokeEndpoint('selfAllocate', input);
export type SelfAllocateOutputType = selfAllocate_Output;
export type SelfAllocateInputType = selfAllocate_Input;

import type sendPushNotifications_Type from '../api/sendPushNotifications';
type sendPushNotifications_Input = Parameters<typeof sendPushNotifications_Type.execute>[0]['input'];
type sendPushNotifications_Output = ReturnType<typeof sendPushNotifications_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof sendPushNotifications_Type.execute>;
export const sendPushNotifications = (input: sendPushNotifications_Input): Promise<sendPushNotifications_Output> => invokeEndpoint('sendPushNotifications', input);
export type SendPushNotificationsOutputType = sendPushNotifications_Output;
export type SendPushNotificationsInputType = sendPushNotifications_Input;

import type sendSadhanaReminders_Type from '../api/sendSadhanaReminders';
type sendSadhanaReminders_Input = Parameters<typeof sendSadhanaReminders_Type.execute>[0]['input'];
type sendSadhanaReminders_Output = ReturnType<typeof sendSadhanaReminders_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof sendSadhanaReminders_Type.execute>;
export const sendSadhanaReminders = (input: sendSadhanaReminders_Input): Promise<sendSadhanaReminders_Output> => invokeEndpoint('sendSadhanaReminders', input);
export type SendSadhanaRemindersOutputType = sendSadhanaReminders_Output;
export type SendSadhanaRemindersInputType = sendSadhanaReminders_Input;

import type sendServiceReminders_Type from '../api/sendServiceReminders';
type sendServiceReminders_Input = Parameters<typeof sendServiceReminders_Type.execute>[0]['input'];
type sendServiceReminders_Output = ReturnType<typeof sendServiceReminders_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof sendServiceReminders_Type.execute>;
export const sendServiceReminders = (input: sendServiceReminders_Input): Promise<sendServiceReminders_Output> => invokeEndpoint('sendServiceReminders', input);
export type SendServiceRemindersOutputType = sendServiceReminders_Output;
export type SendServiceRemindersInputType = sendServiceReminders_Input;

import type setAshrayLevel_Type from '../api/setAshrayLevel';
type setAshrayLevel_Input = Parameters<typeof setAshrayLevel_Type.execute>[0]['input'];
type setAshrayLevel_Output = ReturnType<typeof setAshrayLevel_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof setAshrayLevel_Type.execute>;
export const setAshrayLevel = (input: setAshrayLevel_Input): Promise<setAshrayLevel_Output> => invokeEndpoint('setAshrayLevel', input);
export type SetAshrayLevelOutputType = setAshrayLevel_Output;
export type SetAshrayLevelInputType = setAshrayLevel_Input;

import type setFolkCenter_Type from '../api/setFolkCenter';
type setFolkCenter_Input = Parameters<typeof setFolkCenter_Type.execute>[0]['input'];
type setFolkCenter_Output = ReturnType<typeof setFolkCenter_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof setFolkCenter_Type.execute>;
export const setFolkCenter = (input: setFolkCenter_Input): Promise<setFolkCenter_Output> => invokeEndpoint('setFolkCenter', input);
export type SetFolkCenterOutputType = setFolkCenter_Output;
export type SetFolkCenterInputType = setFolkCenter_Input;

import type setTemporaryResidency_Type from '../api/setTemporaryResidency';
type setTemporaryResidency_Input = Parameters<typeof setTemporaryResidency_Type.execute>[0]['input'];
type setTemporaryResidency_Output = ReturnType<typeof setTemporaryResidency_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof setTemporaryResidency_Type.execute>;
export const setTemporaryResidency = (input: setTemporaryResidency_Input): Promise<setTemporaryResidency_Output> => invokeEndpoint('setTemporaryResidency', input);
export type SetTemporaryResidencyOutputType = setTemporaryResidency_Output;
export type SetTemporaryResidencyInputType = setTemporaryResidency_Input;

import type submitAvailability_Type from '../api/submitAvailability';
type submitAvailability_Input = Parameters<typeof submitAvailability_Type.execute>[0]['input'];
type submitAvailability_Output = ReturnType<typeof submitAvailability_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof submitAvailability_Type.execute>;
export const submitAvailability = (input: submitAvailability_Input): Promise<submitAvailability_Output> => invokeEndpoint('submitAvailability', input);
export type SubmitAvailabilityOutputType = submitAvailability_Output;
export type SubmitAvailabilityInputType = submitAvailability_Input;

import type submitBvQuiz_Type from '../api/submitBvQuiz';
type submitBvQuiz_Input = Parameters<typeof submitBvQuiz_Type.execute>[0]['input'];
type submitBvQuiz_Output = ReturnType<typeof submitBvQuiz_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof submitBvQuiz_Type.execute>;
export const submitBvQuiz = (input: submitBvQuiz_Input): Promise<submitBvQuiz_Output> => invokeEndpoint('submitBvQuiz', input);
export type SubmitBvQuizOutputType = submitBvQuiz_Output;
export type SubmitBvQuizInputType = submitBvQuiz_Input;

import type submitCleanlinessInspection_Type from '../api/submitCleanlinessInspection';
type submitCleanlinessInspection_Input = Parameters<typeof submitCleanlinessInspection_Type.execute>[0]['input'];
type submitCleanlinessInspection_Output = ReturnType<typeof submitCleanlinessInspection_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof submitCleanlinessInspection_Type.execute>;
export const submitCleanlinessInspection = (input: submitCleanlinessInspection_Input): Promise<submitCleanlinessInspection_Output> => invokeEndpoint('submitCleanlinessInspection', input);
export type SubmitCleanlinessInspectionOutputType = submitCleanlinessInspection_Output;
export type SubmitCleanlinessInspectionInputType = submitCleanlinessInspection_Input;

import type submitSadhana_Type from '../api/submitSadhana';
type submitSadhana_Input = Parameters<typeof submitSadhana_Type.execute>[0]['input'];
type submitSadhana_Output = ReturnType<typeof submitSadhana_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof submitSadhana_Type.execute>;
export const submitSadhana = (input: submitSadhana_Input): Promise<submitSadhana_Output> => invokeEndpoint('submitSadhana', input);
export type SubmitSadhanaOutputType = submitSadhana_Output;
export type SubmitSadhanaInputType = submitSadhana_Input;

import type submitServiceRating_Type from '../api/submitServiceRating';
type submitServiceRating_Input = Parameters<typeof submitServiceRating_Type.execute>[0]['input'];
type submitServiceRating_Output = ReturnType<typeof submitServiceRating_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof submitServiceRating_Type.execute>;
export const submitServiceRating = (input: submitServiceRating_Input): Promise<submitServiceRating_Output> => invokeEndpoint('submitServiceRating', input);
export type SubmitServiceRatingOutputType = submitServiceRating_Output;
export type SubmitServiceRatingInputType = submitServiceRating_Input;

import type subscribePush_Type from '../api/subscribePush';
type subscribePush_Input = Parameters<typeof subscribePush_Type.execute>[0]['input'];
type subscribePush_Output = ReturnType<typeof subscribePush_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof subscribePush_Type.execute>;
export const subscribePush = (input: subscribePush_Input): Promise<subscribePush_Output> => invokeEndpoint('subscribePush', input);
export type SubscribePushOutputType = subscribePush_Output;
export type SubscribePushInputType = subscribePush_Input;

import type tagMangoWebhook_Type from '../api/tagMangoWebhook';
type tagMangoWebhook_Input = Parameters<typeof tagMangoWebhook_Type.execute>[0]['input'];
type tagMangoWebhook_Output = ReturnType<typeof tagMangoWebhook_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof tagMangoWebhook_Type.execute>;
export const tagMangoWebhook = (input: tagMangoWebhook_Input): Promise<tagMangoWebhook_Output> => invokeEndpoint('tagMangoWebhook', input);
export type TagMangoWebhookOutputType = tagMangoWebhook_Output;
export type TagMangoWebhookInputType = tagMangoWebhook_Input;

import type tagUserAsB_Type from '../api/tagUserAsB';
type tagUserAsB_Input = Parameters<typeof tagUserAsB_Type.execute>[0]['input'];
type tagUserAsB_Output = ReturnType<typeof tagUserAsB_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof tagUserAsB_Type.execute>;
export const tagUserAsB = (input: tagUserAsB_Input): Promise<tagUserAsB_Output> => invokeEndpoint('tagUserAsB', input);
export type TagUserAsBOutputType = tagUserAsB_Output;
export type TagUserAsBInputType = tagUserAsB_Input;

import type tagUserAsBvMentor_Type from '../api/tagUserAsBvMentor';
type tagUserAsBvMentor_Input = Parameters<typeof tagUserAsBvMentor_Type.execute>[0]['input'];
type tagUserAsBvMentor_Output = ReturnType<typeof tagUserAsBvMentor_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof tagUserAsBvMentor_Type.execute>;
export const tagUserAsBvMentor = (input: tagUserAsBvMentor_Input): Promise<tagUserAsBvMentor_Output> => invokeEndpoint('tagUserAsBvMentor', input);
export type TagUserAsBvMentorOutputType = tagUserAsBvMentor_Output;
export type TagUserAsBvMentorInputType = tagUserAsBvMentor_Input;

import type tagUserAsBvsl_Type from '../api/tagUserAsBvsl';
type tagUserAsBvsl_Input = Parameters<typeof tagUserAsBvsl_Type.execute>[0]['input'];
type tagUserAsBvsl_Output = ReturnType<typeof tagUserAsBvsl_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof tagUserAsBvsl_Type.execute>;
export const tagUserAsBvsl = (input: tagUserAsBvsl_Input): Promise<tagUserAsBvsl_Output> => invokeEndpoint('tagUserAsBvsl', input);
export type TagUserAsBvslOutputType = tagUserAsBvsl_Output;
export type TagUserAsBvslInputType = tagUserAsBvsl_Input;

import type tagUserAsFolkLead_Type from '../api/tagUserAsFolkLead';
type tagUserAsFolkLead_Input = Parameters<typeof tagUserAsFolkLead_Type.execute>[0]['input'];
type tagUserAsFolkLead_Output = ReturnType<typeof tagUserAsFolkLead_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof tagUserAsFolkLead_Type.execute>;
export const tagUserAsFolkLead = (input: tagUserAsFolkLead_Input): Promise<tagUserAsFolkLead_Output> => invokeEndpoint('tagUserAsFolkLead', input);
export type TagUserAsFolkLeadOutputType = tagUserAsFolkLead_Output;
export type TagUserAsFolkLeadInputType = tagUserAsFolkLead_Input;

import type acknowledgeRoleChange_Type from '../api/acknowledgeRoleChange';
type acknowledgeRoleChange_Input = Parameters<typeof acknowledgeRoleChange_Type.execute>[0]['input'];
type acknowledgeRoleChange_Output = ReturnType<typeof acknowledgeRoleChange_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof acknowledgeRoleChange_Type.execute>;
export const acknowledgeRoleChange = (input: acknowledgeRoleChange_Input): Promise<acknowledgeRoleChange_Output> => invokeEndpoint('acknowledgeRoleChange', input);
export type AcknowledgeRoleChangeOutputType = acknowledgeRoleChange_Output;
export type AcknowledgeRoleChangeInputType = acknowledgeRoleChange_Input;

import type tagUserAsSadhanaMentor_Type from '../api/tagUserAsSadhanaMentor';
type tagUserAsSadhanaMentor_Input = Parameters<typeof tagUserAsSadhanaMentor_Type.execute>[0]['input'];
type tagUserAsSadhanaMentor_Output = ReturnType<typeof tagUserAsSadhanaMentor_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof tagUserAsSadhanaMentor_Type.execute>;
export const tagUserAsSadhanaMentor = (input: tagUserAsSadhanaMentor_Input): Promise<tagUserAsSadhanaMentor_Output> => invokeEndpoint('tagUserAsSadhanaMentor', input);
export type TagUserAsSadhanaMentorOutputType = tagUserAsSadhanaMentor_Output;
export type TagUserAsSadhanaMentorInputType = tagUserAsSadhanaMentor_Input;

import type tagUserAsServiceAllocator_Type from '../api/tagUserAsServiceAllocator';
type tagUserAsServiceAllocator_Input = Parameters<typeof tagUserAsServiceAllocator_Type.execute>[0]['input'];
type tagUserAsServiceAllocator_Output = ReturnType<typeof tagUserAsServiceAllocator_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof tagUserAsServiceAllocator_Type.execute>;
export const tagUserAsServiceAllocator = (input: tagUserAsServiceAllocator_Input): Promise<tagUserAsServiceAllocator_Output> => invokeEndpoint('tagUserAsServiceAllocator', input);
export type TagUserAsServiceAllocatorOutputType = tagUserAsServiceAllocator_Output;
export type TagUserAsServiceAllocatorInputType = tagUserAsServiceAllocator_Input;

import type tagUserAsTripCoordinator_Type from '../api/tagUserAsTripCoordinator';
type tagUserAsTripCoordinator_Input = Parameters<typeof tagUserAsTripCoordinator_Type.execute>[0]['input'];
type tagUserAsTripCoordinator_Output = ReturnType<typeof tagUserAsTripCoordinator_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof tagUserAsTripCoordinator_Type.execute>;
export const tagUserAsTripCoordinator = (input: tagUserAsTripCoordinator_Input): Promise<tagUserAsTripCoordinator_Output> => invokeEndpoint('tagUserAsTripCoordinator', input);
export type TagUserAsTripCoordinatorOutputType = tagUserAsTripCoordinator_Output;
export type TagUserAsTripCoordinatorInputType = tagUserAsTripCoordinator_Input;

import type tagUserSkill_Type from '../api/tagUserSkill';
type tagUserSkill_Input = Parameters<typeof tagUserSkill_Type.execute>[0]['input'];
type tagUserSkill_Output = ReturnType<typeof tagUserSkill_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof tagUserSkill_Type.execute>;
export const tagUserSkill = (input: tagUserSkill_Input): Promise<tagUserSkill_Output> => invokeEndpoint('tagUserSkill', input);
export type TagUserSkillOutputType = tagUserSkill_Output;
export type TagUserSkillInputType = tagUserSkill_Input;

import type testTagMangoConnection_Type from '../api/testTagMangoConnection';
type testTagMangoConnection_Input = Parameters<typeof testTagMangoConnection_Type.execute>[0]['input'];
type testTagMangoConnection_Output = ReturnType<typeof testTagMangoConnection_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof testTagMangoConnection_Type.execute>;
export const testTagMangoConnection = (input: testTagMangoConnection_Input): Promise<testTagMangoConnection_Output> => invokeEndpoint('testTagMangoConnection', input);
export type TestTagMangoConnectionOutputType = testTagMangoConnection_Output;
export type TestTagMangoConnectionInputType = testTagMangoConnection_Input;

import type toggleCleanlinessEnabled_Type from '../api/toggleCleanlinessEnabled';
type toggleCleanlinessEnabled_Input = Parameters<typeof toggleCleanlinessEnabled_Type.execute>[0]['input'];
type toggleCleanlinessEnabled_Output = ReturnType<typeof toggleCleanlinessEnabled_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof toggleCleanlinessEnabled_Type.execute>;
export const toggleCleanlinessEnabled = (input: toggleCleanlinessEnabled_Input): Promise<toggleCleanlinessEnabled_Output> => invokeEndpoint('toggleCleanlinessEnabled', input);
export type ToggleCleanlinessEnabledOutputType = toggleCleanlinessEnabled_Output;
export type ToggleCleanlinessEnabledInputType = toggleCleanlinessEnabled_Input;

import type toggleCleanlinessManager_Type from '../api/toggleCleanlinessManager';
type toggleCleanlinessManager_Input = Parameters<typeof toggleCleanlinessManager_Type.execute>[0]['input'];
type toggleCleanlinessManager_Output = ReturnType<typeof toggleCleanlinessManager_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof toggleCleanlinessManager_Type.execute>;
export const toggleCleanlinessManager = (input: toggleCleanlinessManager_Input): Promise<toggleCleanlinessManager_Output> => invokeEndpoint('toggleCleanlinessManager', input);
export type ToggleCleanlinessManagerOutputType = toggleCleanlinessManager_Output;
export type ToggleCleanlinessManagerInputType = toggleCleanlinessManager_Input;

import type triggerSadhanaReminders_Type from '../api/triggerSadhanaReminders';
type triggerSadhanaReminders_Input = Parameters<typeof triggerSadhanaReminders_Type.execute>[0]['input'];
type triggerSadhanaReminders_Output = ReturnType<typeof triggerSadhanaReminders_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof triggerSadhanaReminders_Type.execute>;
export const triggerSadhanaReminders = (input: triggerSadhanaReminders_Input): Promise<triggerSadhanaReminders_Output> => invokeEndpoint('triggerSadhanaReminders', input);
export type TriggerSadhanaRemindersOutputType = triggerSadhanaReminders_Output;
export type TriggerSadhanaRemindersInputType = triggerSadhanaReminders_Input;

import type unsubscribePush_Type from '../api/unsubscribePush';
type unsubscribePush_Input = Parameters<typeof unsubscribePush_Type.execute>[0]['input'];
type unsubscribePush_Output = ReturnType<typeof unsubscribePush_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof unsubscribePush_Type.execute>;
export const unsubscribePush = (input: unsubscribePush_Input): Promise<unsubscribePush_Output> => invokeEndpoint('unsubscribePush', input);
export type UnsubscribePushOutputType = unsubscribePush_Output;
export type UnsubscribePushInputType = unsubscribePush_Input;

import type updateAllocation_Type from '../api/updateAllocation';
type updateAllocation_Input = Parameters<typeof updateAllocation_Type.execute>[0]['input'];
type updateAllocation_Output = ReturnType<typeof updateAllocation_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof updateAllocation_Type.execute>;
export const updateAllocation = (input: updateAllocation_Input): Promise<updateAllocation_Output> => invokeEndpoint('updateAllocation', input);
export type UpdateAllocationOutputType = updateAllocation_Output;
export type UpdateAllocationInputType = updateAllocation_Input;

import type updateBvGroup_Type from '../api/updateBvGroup';
type updateBvGroup_Input = Parameters<typeof updateBvGroup_Type.execute>[0]['input'];
type updateBvGroup_Output = ReturnType<typeof updateBvGroup_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof updateBvGroup_Type.execute>;
export const updateBvGroup = (input: updateBvGroup_Input): Promise<updateBvGroup_Output> => invokeEndpoint('updateBvGroup', input);
export type UpdateBvGroupOutputType = updateBvGroup_Output;
export type UpdateBvGroupInputType = updateBvGroup_Input;

import type updateChecklistProgress_Type from '../api/updateChecklistProgress';
type updateChecklistProgress_Input = Parameters<typeof updateChecklistProgress_Type.execute>[0]['input'];
type updateChecklistProgress_Output = ReturnType<typeof updateChecklistProgress_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof updateChecklistProgress_Type.execute>;
export const updateChecklistProgress = (input: updateChecklistProgress_Input): Promise<updateChecklistProgress_Output> => invokeEndpoint('updateChecklistProgress', input);
export type UpdateChecklistProgressOutputType = updateChecklistProgress_Output;
export type UpdateChecklistProgressInputType = updateChecklistProgress_Input;

import type updateLastLogin_Type from '../api/updateLastLogin';
type updateLastLogin_Input = Parameters<typeof updateLastLogin_Type.execute>[0]['input'];
type updateLastLogin_Output = ReturnType<typeof updateLastLogin_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof updateLastLogin_Type.execute>;
export const updateLastLogin = (input: updateLastLogin_Input): Promise<updateLastLogin_Output> => invokeEndpoint('updateLastLogin', input);
export type UpdateLastLoginOutputType = updateLastLogin_Output;
export type UpdateLastLoginInputType = updateLastLogin_Input;

import type updateRentPayment_Type from '../api/updateRentPayment';
type updateRentPayment_Input = Parameters<typeof updateRentPayment_Type.execute>[0]['input'];
type updateRentPayment_Output = ReturnType<typeof updateRentPayment_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof updateRentPayment_Type.execute>;
export const updateRentPayment = (input: updateRentPayment_Input): Promise<updateRentPayment_Output> => invokeEndpoint('updateRentPayment', input);
export type UpdateRentPaymentOutputType = updateRentPayment_Output;
export type UpdateRentPaymentInputType = updateRentPayment_Input;

import type updateService_Type from '../api/updateService';
type updateService_Input = Parameters<typeof updateService_Type.execute>[0]['input'];
type updateService_Output = ReturnType<typeof updateService_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof updateService_Type.execute>;
export const updateService = (input: updateService_Input): Promise<updateService_Output> => invokeEndpoint('updateService', input);
export type UpdateServiceOutputType = updateService_Output;
export type UpdateServiceInputType = updateService_Input;

import type updateTrip_Type from '../api/updateTrip';
type updateTrip_Input = Parameters<typeof updateTrip_Type.execute>[0]['input'];
type updateTrip_Output = ReturnType<typeof updateTrip_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof updateTrip_Type.execute>;
export const updateTrip = (input: updateTrip_Input): Promise<updateTrip_Output> => invokeEndpoint('updateTrip', input);
export type UpdateTripOutputType = updateTrip_Output;
export type UpdateTripInputType = updateTrip_Input;

import type updateUserProfile_Type from '../api/updateUserProfile';
type updateUserProfile_Input = Parameters<typeof updateUserProfile_Type.execute>[0]['input'];
type updateUserProfile_Output = ReturnType<typeof updateUserProfile_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof updateUserProfile_Type.execute>;
export const updateUserProfile = (input: updateUserProfile_Input): Promise<updateUserProfile_Output> => invokeEndpoint('updateUserProfile', input);
export type UpdateUserProfileOutputType = updateUserProfile_Output;
export type UpdateUserProfileInputType = updateUserProfile_Input;

import type updateUserResidency_Type from '../api/updateUserResidency';
type updateUserResidency_Input = Parameters<typeof updateUserResidency_Type.execute>[0]['input'];
type updateUserResidency_Output = ReturnType<typeof updateUserResidency_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof updateUserResidency_Type.execute>;
export const updateUserResidency = (input: updateUserResidency_Input): Promise<updateUserResidency_Output> => invokeEndpoint('updateUserResidency', input);
export type UpdateUserResidencyOutputType = updateUserResidency_Output;
export type UpdateUserResidencyInputType = updateUserResidency_Input;

import type updateUserStatus_Type from '../api/updateUserStatus';
type updateUserStatus_Input = Parameters<typeof updateUserStatus_Type.execute>[0]['input'];
type updateUserStatus_Output = ReturnType<typeof updateUserStatus_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof updateUserStatus_Type.execute>;
export const updateUserStatus = (input: updateUserStatus_Input): Promise<updateUserStatus_Output> => invokeEndpoint('updateUserStatus', input);
export type UpdateUserStatusOutputType = updateUserStatus_Output;
export type UpdateUserStatusInputType = updateUserStatus_Input;

import type rejectBvRegistration_Type from '../api/rejectBvRegistration';
type rejectBvRegistration_Input = Parameters<typeof rejectBvRegistration_Type.execute>[0]['input'];
type rejectBvRegistration_Output = ReturnType<typeof rejectBvRegistration_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof rejectBvRegistration_Type.execute>;
export const rejectBvRegistration = (input: rejectBvRegistration_Input): Promise<rejectBvRegistration_Output> => invokeEndpoint('rejectBvRegistration', input);
export type RejectBvRegistrationOutputType = rejectBvRegistration_Output;
export type RejectBvRegistrationInputType = rejectBvRegistration_Input;

import type acknowledgeBvRejectionNotice_Type from '../api/acknowledgeBvRejectionNotice';
type acknowledgeBvRejectionNotice_Input = Parameters<typeof acknowledgeBvRejectionNotice_Type.execute>[0]['input'];
type acknowledgeBvRejectionNotice_Output = ReturnType<typeof acknowledgeBvRejectionNotice_Type.execute> extends Promise<infer R> ? R : ReturnType<typeof acknowledgeBvRejectionNotice_Type.execute>;
export const acknowledgeBvRejectionNotice = (input: acknowledgeBvRejectionNotice_Input): Promise<acknowledgeBvRejectionNotice_Output> => invokeEndpoint('acknowledgeBvRejectionNotice', input);
export type AcknowledgeBvRejectionNoticeOutputType = acknowledgeBvRejectionNotice_Output;
export type AcknowledgeBvRejectionNoticeInputType = acknowledgeBvRejectionNotice_Input;

export const getPendingBvRegistrations = (input: any): Promise<any> => invokeEndpoint('getPendingBvRegistrations', input);
export const approveAndAssignBvMember = (input: any): Promise<any> => invokeEndpoint('approveAndAssignBvMember', input);
export const assignBvRole = (input: any): Promise<any> => invokeEndpoint('assignBvRole', input);
export const getBvSupervisorOverview = (input: any): Promise<any> => invokeEndpoint('getBvSupervisorOverview', input);
export const registerBvMember = (input: any): Promise<any> => invokeEndpoint('registerBvMember', input);
export const tagUserAsBvAdmin = (input: any): Promise<any> => invokeEndpoint('tagUserAsBvAdmin', input);
export const tagUserAsBvFacilitator = (input: any): Promise<any> => invokeEndpoint('tagUserAsBvFacilitator', input);
export const tagUserAsBvSubFacilitator = (input: any): Promise<any> => invokeEndpoint('tagUserAsBvSubFacilitator', input);
export const tagUserAsBvSupervisor = (input: any): Promise<any> => invokeEndpoint('tagUserAsBvSupervisor', input);
export const acknowledgeBvRoleNotice = (input: any): Promise<any> => invokeEndpoint('acknowledgeBvRoleNotice', input);
