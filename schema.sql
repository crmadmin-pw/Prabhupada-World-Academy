CREATE TABLE IF NOT EXISTS "AshrayChecklist" (
  id TEXT PRIMARY KEY,
  "checklistDataJson" TEXT,
  "checklistId" NUMERIC,
  "completedItems" NUMERIC,
  "level" TEXT,
  "totalItems" NUMERIC,
  "updatedAt" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "AshrayLevels" (
  id TEXT PRIMARY KEY,
  "acceptKrishnaSpg" TEXT,
  "avoidIntoxicants" TEXT,
  "avoidNonveg" BOOLEAN,
  "avoidOnionGarlic" TEXT,
  "booksToRead" TEXT,
  "chantingMonths" NUMERIC,
  "chantingRoundsRequired" NUMERIC,
  "classFreqPerMonth" NUMERIC,
  "courseSyllabus" TEXT,
  "donationRequired" TEXT,
  "fasting" TEXT,
  "kanthiMala" BOOLEAN,
  "levelName" TEXT,
  "levelOrder" NUMERIC,
  "morningProgram" TEXT,
  "noGambling" BOOLEAN,
  "noIllicitSex" BOOLEAN,
  "oneOnOnePerMonth" NUMERIC,
  "sadhanaScoreMonths" NUMERIC,
  "sadhanaScoreRequired" TEXT,
  "serviceHoursMonth" NUMERIC,
  "spReadingPagesPerMonth" NUMERIC
);

CREATE TABLE IF NOT EXISTS "AshrayUpgradeRequests" (
  id TEXT PRIMARY KEY,
  "createdAt" TEXT,
  "currentLevel" TEXT,
  "reason" TEXT,
  "requestId" TEXT,
  "requestedLevel" TEXT,
  "reviewedAt" TEXT,
  "reviewedBy" TEXT,
  "status" TEXT,
  "userId" TEXT
);

CREATE TABLE IF NOT EXISTS "AttendanceEvents" (
  id TEXT PRIMARY KEY,
  "attendanceParticipants" TEXT,
  "attendanceSessions" TEXT,
  "createdAt" TEXT,
  "createdBy" TEXT,
  "customFields" TEXT,
  "description" TEXT,
  "endDate" TEXT,
  "startDate" TEXT,
  "title" TEXT
);

CREATE TABLE IF NOT EXISTS "AttendanceParticipants" (
  id TEXT PRIMARY KEY,
  "attendanceRecords" TEXT,
  "challengeEnrollments" TEXT,
  "createdAt" TEXT,
  "customData" TEXT,
  "email" TEXT,
  "event" TEXT,
  "name" TEXT,
  "phone" TEXT
);

CREATE TABLE IF NOT EXISTS "AttendanceRecords" (
  id TEXT PRIMARY KEY,
  "createdAt" TEXT,
  "date" TEXT,
  "participant" TEXT,
  "recordNumber" NUMERIC,
  "session" TEXT,
  "source" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "AttendanceSessions" (
  id TEXT PRIMARY KEY,
  "attendanceRecords" TEXT,
  "attendanceVolunteers" TEXT,
  "challengeDays" NUMERIC,
  "challengeDescription" TEXT,
  "challengeEnabled" BOOLEAN,
  "challengeEnrollments" TEXT,
  "challengeImage" TEXT,
  "challengeInstructions" TEXT,
  "challengeTitle" TEXT,
  "createdAt" TEXT,
  "event" TEXT,
  "name" TEXT,
  "shareToken" TEXT
);

CREATE TABLE IF NOT EXISTS "AttendanceVolunteers" (
  id TEXT PRIMARY KEY,
  "createdAt" TEXT,
  "grantedBy" TEXT,
  "session" TEXT,
  "user" TEXT,
  "volunteerNumber" NUMERIC
);

CREATE TABLE IF NOT EXISTS "BvAttendance" (
  id TEXT PRIMARY KEY,
  "attendanceDate" TEXT,
  "attendanceId" NUMERIC,
  "group" TEXT,
  "present" BOOLEAN,
  "session" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "BvGroupMembers" (
  id TEXT PRIMARY KEY,
  "group" TEXT,
  "joinedAt" TEXT,
  "memberId" NUMERIC,
  "role" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "BvGroupRequests" (
  id TEXT PRIMARY KEY,
  "group" TEXT,
  "requestId" NUMERIC,
  "requestedAt" TEXT,
  "status" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "BvGroups" (
  id TEXT PRIMARY KEY,
  "bvAttendance" TEXT,
  "bvGroupMembers" TEXT,
  "bvGroupRequests" TEXT,
  "bvQuizzes" TEXT,
  "bvSessions" TEXT,
  "bvslLeader" TEXT,
  "createdAt" TEXT,
  "description" TEXT,
  "groupId" TEXT,
  "groupName" TEXT,
  "guide" TEXT,
  "isActive" BOOLEAN,
  "joinToken" TEXT,
  "whatsAppLink" TEXT
);

CREATE TABLE IF NOT EXISTS "BvQuizSubmissions" (
  id TEXT PRIMARY KEY,
  "answersJson" TEXT,
  "percentage" NUMERIC,
  "quiz" TEXT,
  "score" NUMERIC,
  "submissionId" NUMERIC,
  "submittedAt" TEXT,
  "totalQuestions" NUMERIC,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "BvQuizzes" (
  id TEXT PRIMARY KEY,
  "bvQuizSubmissions" TEXT,
  "createdAt" TEXT,
  "createdBy" TEXT,
  "description" TEXT,
  "group" TEXT,
  "isActive" BOOLEAN,
  "questionsJson" TEXT,
  "quizDate" TEXT,
  "quizTitle" TEXT
);

CREATE TABLE IF NOT EXISTS "BvSessions" (
  id TEXT PRIMARY KEY,
  "bvAttendance" TEXT,
  "conductedAt" TEXT,
  "group" TEXT,
  "notes" TEXT,
  "sessionDate" TEXT,
  "sessionId" TEXT,
  "topic" TEXT
);

CREATE TABLE IF NOT EXISTS "BvslPreachingEntries" (
  id TEXT PRIMARY KEY,
  "entryDate" TEXT,
  "entryId" TEXT,
  "prBookDistTime" NUMERIC,
  "prBooksDistributed" NUMERIC,
  "prCallingTime" NUMERIC,
  "prContactsCollected" NUMERIC,
  "prOneOnOneTime" NUMERIC,
  "prPlanTime" NUMERIC,
  "prRduaAttendees" NUMERIC,
  "prRduaTime" NUMERIC,
  "prUniqueOneOnOnes" NUMERIC,
  "sadhanaEntry" TEXT,
  "submittedAt" TEXT,
  "totalPreachingMinutes" NUMERIC,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "BvslWeeklyPlans" (
  id TEXT PRIMARY KEY,
  "createdAt" TEXT,
  "friDuration" NUMERIC,
  "friGoal1" TEXT,
  "friGoal2" TEXT,
  "friReason" TEXT,
  "friStatus1" TEXT,
  "friStatus2" TEXT,
  "friSuccess" TEXT,
  "monDuration" NUMERIC,
  "monGoal1" TEXT,
  "monGoal2" TEXT,
  "monReason" TEXT,
  "monStatus1" TEXT,
  "monStatus2" TEXT,
  "monSuccess" TEXT,
  "satDuration" NUMERIC,
  "satGoal1" TEXT,
  "satGoal2" TEXT,
  "satReason" TEXT,
  "satStatus1" TEXT,
  "satStatus2" TEXT,
  "satSuccess" TEXT,
  "sunDuration" NUMERIC,
  "sunGoal1" TEXT,
  "sunGoal2" TEXT,
  "sunReason" TEXT,
  "sunStatus1" TEXT,
  "sunStatus2" TEXT,
  "sunSuccess" TEXT,
  "thuDuration" NUMERIC,
  "thuGoal1" TEXT,
  "thuGoal2" TEXT,
  "thuReason" TEXT,
  "thuStatus1" TEXT,
  "thuStatus2" TEXT,
  "thuSuccess" TEXT,
  "tueDuration" NUMERIC,
  "tueGoal1" TEXT,
  "tueGoal2" TEXT,
  "tueReason" TEXT,
  "tueStatus1" TEXT,
  "tueStatus2" TEXT,
  "tueSuccess" TEXT,
  "user" TEXT,
  "wedDuration" NUMERIC,
  "wedGoal1" TEXT,
  "wedGoal2" TEXT,
  "wedReason" TEXT,
  "wedStatus1" TEXT,
  "wedStatus2" TEXT,
  "wedSuccess" TEXT,
  "weekLabel" TEXT,
  "weekStart" TEXT
);

CREATE TABLE IF NOT EXISTS "ChallengeEnrollments" (
  id TEXT PRIMARY KEY,
  "createdAt" TEXT,
  "currentStreak" NUMERIC,
  "enrollmentNumber" NUMERIC,
  "lastAttendanceDate" TEXT,
  "participant" TEXT,
  "session" TEXT,
  "status" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "CleanlinessInspections" (
  id TEXT PRIMARY KEY,
  "cleanlinessReviewRequests" TEXT,
  "comment" TEXT,
  "createdAt" TEXT,
  "date" TEXT,
  "inspectionId" NUMERIC,
  "inspector" TEXT,
  "photo" TEXT,
  "residency" TEXT,
  "room" TEXT,
  "score" NUMERIC
);

CREATE TABLE IF NOT EXISTS "CleanlinessReviewRequests" (
  id TEXT PRIMARY KEY,
  "createdAt" TEXT,
  "date" TEXT,
  "inspection" TEXT,
  "requestId" NUMERIC,
  "reviewedBy" TEXT,
  "room" TEXT,
  "status" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "CleanlinessRooms" (
  id TEXT PRIMARY KEY,
  "cleanlinessInspections1" TEXT,
  "cleanlinessReviewRequests" TEXT,
  "createdAt" TEXT,
  "occupants" TEXT,
  "residency" TEXT,
  "roomNumber" TEXT
);

CREATE TABLE IF NOT EXISTS "Config" (
  id TEXT PRIMARY KEY,
  "configKey" TEXT,
  "configValue" TEXT,
  "updatedAt" TEXT
);

CREATE TABLE IF NOT EXISTS "FolkResidencies" (
  id TEXT PRIMARY KEY,
  "cleanlinessInspections" TEXT,
  "cleanlinessRooms" TEXT,
  "guides" TEXT,
  "isActive" BOOLEAN,
  "maxCapacity" NUMERIC,
  "monthlyRent" NUMERIC,
  "preachingReportGoals" TEXT,
  "residencyId" TEXT,
  "residencyName" TEXT,
  "residencyTransferRequests" TEXT,
  "residencyTransferRequests1" TEXT,
  "sadhanaFields" TEXT,
  "services" TEXT,
  "users" TEXT,
  "users11" TEXT
);

CREATE TABLE IF NOT EXISTS "GuideTransferRequests" (
  id TEXT PRIMARY KEY,
  "fromGuide" TEXT,
  "notes" TEXT,
  "requestId" NUMERIC,
  "requestedAt" TEXT,
  "resolvedAt" TEXT,
  "status" TEXT,
  "toGuide" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "Guides" (
  id TEXT PRIMARY KEY,
  "abbreviation" TEXT,
  "bvGroups" TEXT,
  "email" TEXT,
  "folkResidencies" TEXT,
  "fullName" TEXT,
  "guideId" TEXT,
  "guideTransferRequests" TEXT,
  "guideTransferRequests1" TEXT,
  "isActive" BOOLEAN,
  "oneToOneLink" TEXT,
  "phone" TEXT,
  "sadhanaFields" TEXT,
  "users" TEXT
);

CREATE TABLE IF NOT EXISTS "JigyasaProcessedFiles" (
  id TEXT PRIMARY KEY,
  "fileName" TEXT,
  "fileType" TEXT,
  "processedAt" TEXT,
  "recordsProcessed" NUMERIC,
  "sessionDate" TEXT
);

CREATE TABLE IF NOT EXISTS "JigyasaRegistrations" (
  id TEXT PRIMARY KEY,
  "affiliateEmail" TEXT,
  "affiliateName" TEXT,
  "affiliatePhone" TEXT,
  "age" TEXT,
  "attendanceMode" TEXT,
  "city" TEXT,
  "email" TEXT,
  "gender" TEXT,
  "jigyasaSessionAttendance" TEXT,
  "mangoName" TEXT,
  "name" TEXT,
  "occupation" TEXT,
  "phone" TEXT,
  "state" TEXT,
  "totalDuration" TEXT,
  "totalSessions" NUMERIC
);

CREATE TABLE IF NOT EXISTS "JigyasaSessionAttendance" (
  id TEXT PRIMARY KEY,
  "durationDisplay" TEXT,
  "durationSeconds" NUMERIC,
  "recordKey" TEXT,
  "registration" TEXT,
  "sessionDate" TEXT
);

CREATE TABLE IF NOT EXISTS "LlpAppointmentSlots" (
  id TEXT PRIMARY KEY,
  "dayOfWeek" TEXT,
  "endTime" TEXT,
  "llpGuide" TEXT,
  "meetingLink" TEXT,
  "slotDurationMinutes" NUMERIC,
  "slotId" NUMERIC,
  "slotType" TEXT,
  "startTime" TEXT
);

CREATE TABLE IF NOT EXISTS "LlpBookings" (
  id TEXT PRIMARY KEY,
  "bookingDate" TEXT,
  "bookingTime" TEXT,
  "createdAt" TEXT,
  "llpGuide" TEXT,
  "llpUser" TEXT,
  "meetingLink" TEXT,
  "status" TEXT,
  "topic" TEXT
);

CREATE TABLE IF NOT EXISTS "LlpBvAttendance" (
  id TEXT PRIMARY KEY,
  "attendanceId" NUMERIC,
  "llpBvSession" TEXT,
  "llpUser" TEXT,
  "present" BOOLEAN
);

CREATE TABLE IF NOT EXISTS "LlpBvGroupMembers" (
  id TEXT PRIMARY KEY,
  "joinedAt" TEXT,
  "llpBvGroup" TEXT,
  "llpUser" TEXT,
  "memberId" NUMERIC,
  "role" TEXT
);

CREATE TABLE IF NOT EXISTS "LlpBvGroups" (
  id TEXT PRIMARY KEY,
  "createdAt" TEXT,
  "groupName" TEXT,
  "joinToken" TEXT,
  "llpBvGroupMembers" TEXT,
  "llpBvSessions" TEXT,
  "llpGuide" TEXT
);

CREATE TABLE IF NOT EXISTS "LlpBvSessions" (
  id TEXT PRIMARY KEY,
  "createdAt" TEXT,
  "llpBvAttendance" TEXT,
  "llpBvGroup" TEXT,
  "notes" TEXT,
  "sessionDate" TEXT,
  "topic" TEXT
);

CREATE TABLE IF NOT EXISTS "LlpFormConfig" (
  id TEXT PRIMARY KEY,
  "configJson" TEXT,
  "guideLabel" TEXT,
  "llpGuide" TEXT,
  "updatedAt" TEXT
);

CREATE TABLE IF NOT EXISTS "LlpGuides" (
  id TEXT PRIMARY KEY,
  "bio" TEXT,
  "createdAt" TEXT,
  "email" TEXT,
  "fullName" TEXT,
  "llpAppointmentSlots" TEXT,
  "llpBookings" TEXT,
  "llpBvGroups" TEXT,
  "llpFormConfig" TEXT,
  "llpServiceTypes" TEXT,
  "llpUsers" TEXT,
  "phone" TEXT,
  "status" TEXT
);

CREATE TABLE IF NOT EXISTS "LlpSadhanaEntries" (
  id TEXT PRIMARY KEY,
  "createdAt" TEXT,
  "entryDate" TEXT,
  "fieldValuesJson" TEXT,
  "llpUser" TEXT,
  "maxScore" NUMERIC,
  "totalScore" NUMERIC
);

CREATE TABLE IF NOT EXISTS "LlpServiceAllocations" (
  id TEXT PRIMARY KEY,
  "allocationDate" TEXT,
  "llpUser" TEXT,
  "serviceType" TEXT,
  "status" TEXT
);

CREATE TABLE IF NOT EXISTS "LlpServiceLog" (
  id TEXT PRIMARY KEY,
  "createdAt" TEXT,
  "durationMinutes" NUMERIC,
  "llpUser" TEXT,
  "logDate" TEXT,
  "notes" TEXT,
  "serviceType" TEXT
);

CREATE TABLE IF NOT EXISTS "LlpServiceTypes" (
  id TEXT PRIMARY KEY,
  "description" TEXT,
  "durationExpectedMinutes" NUMERIC,
  "llpGuide" TEXT,
  "llpServiceAllocations" TEXT,
  "llpServiceLog" TEXT,
  "serviceName" TEXT
);

CREATE TABLE IF NOT EXISTS "LlpUsers" (
  id TEXT PRIMARY KEY,
  "ashrayLevel" TEXT,
  "createdAt" TEXT,
  "currentStreak" NUMERIC,
  "email" TEXT,
  "fullName" TEXT,
  "lastLoginAt" TEXT,
  "lastStreakUpdatedAt" TEXT,
  "llpBookings" TEXT,
  "llpBvAttendance" TEXT,
  "llpBvGroupMembers" TEXT,
  "llpGuide" TEXT,
  "llpSadhanaEntries" TEXT,
  "llpServiceAllocations" TEXT,
  "llpServiceLog" TEXT,
  "phone" TEXT,
  "status" TEXT
);

CREATE TABLE IF NOT EXISTS "OneToOneMeetings" (
  id TEXT PRIMARY KEY,
  "createdAt" TEXT,
  "durationMinutes" NUMERIC,
  "guide" TEXT,
  "meetingDate" TEXT,
  "meetingId" NUMERIC,
  "member" TEXT,
  "notes" TEXT,
  "weekDate" TEXT
);

CREATE TABLE IF NOT EXISTS "PreachingReportGoals" (
  id TEXT PRIMARY KEY,
  "center" TEXT,
  "goalId" NUMERIC,
  "initialValue" NUMERIC,
  "metricName" TEXT,
  "year" NUMERIC,
  "yearlyGoal" NUMERIC
);

CREATE TABLE IF NOT EXISTS "PushSubscriptions" (
  id TEXT PRIMARY KEY,
  "authKey" TEXT,
  "createdAt" TEXT,
  "endpoint" TEXT,
  "p256DhKey" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "RentPayments" (
  id TEXT PRIMARY KEY,
  "amountDue" NUMERIC,
  "amountPaid" NUMERIC,
  "correctionNotes" TEXT,
  "correctionStatus" TEXT,
  "month" TEXT,
  "notes" TEXT,
  "paymentDate" TEXT,
  "paymentId" NUMERIC,
  "proposedAmountDue" NUMERIC,
  "proposedAmountPaid" NUMERIC,
  "status" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "ResidencyTransferRequests" (
  id TEXT PRIMARY KEY,
  "fromResidency" TEXT,
  "notes" TEXT,
  "requestId" NUMERIC,
  "requestedAt" TEXT,
  "resolvedAt" TEXT,
  "status" TEXT,
  "toResidency" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "SadhanaEntries" (
  id TEXT PRIMARY KEY,
  "ashrayLevelUsed" TEXT,
  "booksDistributed" NUMERIC,
  "bvslPreachingEntries" TEXT,
  "cleanlinessPoints" NUMERIC,
  "dailyServicePoints" NUMERIC,
  "entryDate" TEXT,
  "entryId" TEXT,
  "fieldValuesJson" TEXT,
  "flagOs" BOOLEAN,
  "flagSick" BOOLEAN,
  "japaFinishTime" TEXT,
  "japaVisiblePoints" NUMERIC,
  "maNaGvPoints" NUMERIC,
  "maxScore" NUMERIC,
  "nrChantingPoints" NUMERIC,
  "nrChantingRounds" NUMERIC,
  "nrFillingSameDayPoints" NUMERIC,
  "nrHearingMinutes" NUMERIC,
  "nrHearingPoints" NUMERIC,
  "nrReadingMinutes" NUMERIC,
  "nrReadingPoints" NUMERIC,
  "nrSleepTimeRaw" TEXT,
  "nrWakeUpTime" TEXT,
  "preachingMinutes" NUMERIC,
  "quotesTulasiPoints" NUMERIC,
  "reportSendingPoints" NUMERIC,
  "roundsCount" NUMERIC,
  "roundsPoints" NUMERIC,
  "sbPoints" NUMERIC,
  "scorePercent" NUMERIC,
  "sleepMinutes" NUMERIC,
  "sleepQualityPoints" NUMERIC,
  "spReadingMinutes" NUMERIC,
  "spReadingPoints" NUMERIC,
  "studyMinutes" NUMERIC,
  "submittedAt" TEXT,
  "templateMode" TEXT,
  "totalScore" NUMERIC,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "SadhanaFields" (
  id TEXT PRIMARY KEY,
  "contributesToScore" BOOLEAN,
  "criteriaJson" TEXT,
  "displayOrder" NUMERIC,
  "fieldKey" TEXT,
  "fieldLabel" TEXT,
  "fieldType" TEXT,
  "group" TEXT,
  "guide" TEXT,
  "helpText" TEXT,
  "isActive" BOOLEAN,
  "isRequired" BOOLEAN,
  "isResidentForm" BOOLEAN,
  "maxPoints" NUMERIC,
  "maxValue" NUMERIC,
  "minValue" NUMERIC,
  "optionsJson" TEXT,
  "residency" TEXT
);

CREATE TABLE IF NOT EXISTS "SadhanaMonthlySummaries" (
  id TEXT PRIMARY KEY,
  "archivedAt" TEXT,
  "avgRounds" NUMERIC,
  "avgScorePercent" NUMERIC,
  "daysFiled" NUMERIC,
  "entriesArchived" NUMERIC,
  "month" TEXT,
  "osDays" NUMERIC,
  "sickDays" NUMERIC,
  "streakAtMonthEnd" NUMERIC,
  "summaryId" NUMERIC,
  "templateMode" TEXT,
  "totalMaxScore" NUMERIC,
  "totalScore" NUMERIC,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "ServiceAllocations" (
  id TEXT PRIMARY KEY,
  "allocationId" TEXT,
  "backupUser" TEXT,
  "completedAt" TEXT,
  "dayOfWeek" TEXT,
  "isBackup" BOOLEAN,
  "notes" TEXT,
  "service" TEXT,
  "serviceSwaps" TEXT,
  "status" TEXT,
  "unavailabilityRequests" TEXT,
  "user" TEXT,
  "weekDate" TEXT
);

CREATE TABLE IF NOT EXISTS "ServiceAvailability" (
  id TEXT PRIMARY KEY,
  "availabilityId" NUMERIC,
  "availableDaysJson" TEXT,
  "user" TEXT,
  "weekDate" TEXT
);

CREATE TABLE IF NOT EXISTS "ServicePreferences" (
  id TEXT PRIMARY KEY,
  "canDo" BOOLEAN,
  "prefId" NUMERIC,
  "reason" TEXT,
  "serviceId" TEXT,
  "updatedAt" TEXT,
  "userId" TEXT
);

CREATE TABLE IF NOT EXISTS "ServiceRatings" (
  id TEXT PRIMARY KEY,
  "comment" TEXT,
  "raterHash" TEXT,
  "rating" NUMERIC,
  "ratingDate" TEXT,
  "ratingId" NUMERIC,
  "service" TEXT
);

CREATE TABLE IF NOT EXISTS "ServiceSwaps" (
  id TEXT PRIMARY KEY,
  "allocation" TEXT,
  "createdAt" TEXT,
  "fromUser" TEXT,
  "reason" TEXT,
  "status" TEXT,
  "swapId" TEXT,
  "toUser" TEXT
);

CREATE TABLE IF NOT EXISTS "Services" (
  id TEXT PRIMARY KEY,
  "category" TEXT,
  "createdAt" TEXT,
  "description" TEXT,
  "dueOffsetMinutes" NUMERIC,
  "durationMinutes" NUMERIC,
  "isActive" BOOLEAN,
  "peopleNeeded" NUMERIC,
  "requiredSkillsJson" TEXT,
  "residency" TEXT,
  "serviceAllocations" TEXT,
  "serviceId" TEXT,
  "serviceName" TEXT,
  "serviceRatings" TEXT,
  "serviceScope" TEXT,
  "serviceType" TEXT,
  "sortOrder" NUMERIC,
  "timeSlot" TEXT
);

CREATE TABLE IF NOT EXISTS "SkillCatalog" (
  id TEXT PRIMARY KEY,
  "description" TEXT,
  "isActive" BOOLEAN,
  "skillId" TEXT,
  "skillName" TEXT,
  "userSkills" TEXT
);

CREATE TABLE IF NOT EXISTS "TagMangoSyncLog" (
  id TEXT PRIMARY KEY,
  "amountPaid" NUMERIC,
  "courseId" TEXT,
  "currency" TEXT,
  "email" TEXT,
  "mangoName" TEXT,
  "matchedUser" TEXT,
  "name" TEXT,
  "orderId" TEXT,
  "phone" TEXT,
  "rawPayload" TEXT,
  "syncStatus" TEXT,
  "tagMangoUserId" TEXT,
  "timestamp" TEXT
);

CREATE TABLE IF NOT EXISTS "Trips" (
  id TEXT PRIMARY KEY,
  "amountPaid" NUMERIC,
  "correctionNotes" TEXT,
  "correctionStatus" TEXT,
  "destination" TEXT,
  "notes" TEXT,
  "paymentStatus" TEXT,
  "proposedAmountPaid" NUMERIC,
  "proposedTotalAmount" NUMERIC,
  "totalAmount" NUMERIC,
  "tripDate" TEXT,
  "tripName" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "UnavailabilityRequests" (
  id TEXT PRIMARY KEY,
  "createdAt" TEXT,
  "date" TEXT,
  "reason" TEXT,
  "requestId" NUMERIC,
  "reviewedBy" TEXT,
  "serviceAllocation" TEXT,
  "status" TEXT,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "UserSkills" (
  id TEXT PRIMARY KEY,
  "level" TEXT,
  "skill" TEXT,
  "skillId" NUMERIC,
  "user" TEXT
);

CREATE TABLE IF NOT EXISTS "Users" (
  id TEXT PRIMARY KEY,
  "ashrayChecklist" TEXT,
  "ashrayLevel" TEXT,
  "attendanceEvents" TEXT,
  "attendanceRecords" TEXT,
  "attendanceVolunteers" TEXT,
  "attendanceVolunteers1" TEXT,
  "bvAttendance" TEXT,
  "bvGroupMembers" TEXT,
  "bvGroupRequests" TEXT,
  "bvGroups" TEXT,
  "bvMentorGuideId" TEXT,
  "bvQuizSubmissions" TEXT,
  "bvQuizzes" TEXT,
  "bvServiceAllocated" BOOLEAN,
  "bvslPreachingEntries" TEXT,
  "bvslWeeklyPlans" TEXT,
  "challengeEnrollments" TEXT,
  "cleanlinessInspections" TEXT,
  "cleanlinessReviewRequests" TEXT,
  "cleanlinessReviewRequests1" TEXT,
  "cleanlinessRooms" TEXT,
  "createdAt" TEXT,
  "currentStreak" NUMERIC,
  "email" TEXT,
  "enrolledLevel" TEXT,
  "fullName" TEXT,
  "guide" TEXT,
  "guideTransferRequests" TEXT,
  "isB" BOOLEAN,
  "isBvMentor" BOOLEAN,
  "isBvsl" BOOLEAN,
  "isCleanlinessManager" BOOLEAN,
  "isFolkLead" BOOLEAN,
  "isOtherCenter" BOOLEAN,
  "isSadhanaMentor" BOOLEAN,
  "isScholar" BOOLEAN,
  "isServiceAllocator" BOOLEAN,
  "isTripCoordinator" BOOLEAN,
  "lastLoginAt" TEXT,
  "lastStreakUpdatedAt" TEXT,
  "oneToOneDelegate" TEXT,
  "oneToOneEligibility" TEXT,
  "oneToOneLink" TEXT,
  "oneToOneMeetings" TEXT,
  "oneToOneMeetings1" TEXT,
  "phone" TEXT,
  "pushSubscriptions" TEXT,
  "rentPayments" TEXT,
  "residency" TEXT,
  "residencyApproved" BOOLEAN,
  "residencyClaimed" BOOLEAN,
  "residencyJoinDate" TEXT,
  "residencyTransferRequests" TEXT,
  "residentSince" TEXT,
  "role" TEXT,
  "sadhanaEntries" TEXT,
  "sadhanaMonthlySummaries" TEXT,
  "scholarSince" TEXT,
  "serviceAllocations" TEXT,
  "serviceAllocations11" TEXT,
  "serviceAvailability" TEXT,
  "serviceSwaps" TEXT,
  "serviceSwaps1" TEXT,
  "status" TEXT,
  "statusChangedAt" TEXT,
  "tagMangoEnrollmentAttempts" NUMERIC,
  "tagMangoEnrollmentStatus" TEXT,
  "tagMangoError" TEXT,
  "tagMangoLastAttempt" TEXT,
  "tagMangoSyncLog" TEXT,
  "tagMangoUserId" TEXT,
  "temporaryResidency" TEXT,
  "temporaryResidencyEnabled" BOOLEAN,
  "trips" TEXT,
  "unavailabilityRequests" TEXT,
  "unavailabilityRequests1" TEXT,
  "userId" TEXT,
  "userSkills" TEXT
);