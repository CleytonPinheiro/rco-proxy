export function indexSubmissionsByUser(submissions, target = new Map()) {
    for (const submission of submissions || []) {
        if (submission?.userId) target.set(submission.userId, submission);
    }
    return target;
}

export function calculateSubmissionContribution({
    assignedGrade,
    draftGrade,
    maxPoints,
    excludedByRecovery = false,
    excludedAsLate = false,
}) {
    if (maxPoints === null || maxPoints === undefined || excludedAsLate) {
        return { official: 0, predicted: 0, pending: 0 };
    }

    const limit = Number(maxPoints);
    if (!Number.isFinite(limit) || limit <= 0) {
        return { official: 0, predicted: 0, pending: 0 };
    }

    const officialGrade = assignedGrade ?? null;
    const pendingGrade = draftGrade ?? null;

    if (excludedByRecovery) {
        return {
            official: 0,
            predicted: pendingGrade !== null ? Math.min(Number(pendingGrade), limit) : 0,
            pending: 0,
        };
    }
    if (officialGrade !== null) {
        const official = Math.min(Number(officialGrade), limit);
        return { official, predicted: official, pending: 0 };
    }
    if (pendingGrade !== null) {
        return {
            official: 0,
            predicted: Math.min(Number(pendingGrade), limit),
            pending: 1,
        };
    }
    return { official: 0, predicted: 0, pending: 1 };
}

export function normalizePointsToTarget(points, possiblePoints, targetPoints) {
    const earned = Number(points);
    const possible = Number(possiblePoints);
    const target = Number(targetPoints);
    if (!Number.isFinite(earned) || !Number.isFinite(possible) || !Number.isFinite(target) || possible <= 0) {
        return 0;
    }
    return (earned / possible) * target;
}