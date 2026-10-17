function isBlockedEitherWay(db, userA, userB) {
  const row = db
    .prepare(
      `SELECT 1 FROM blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
       LIMIT 1`,
    )
    .get(userA, userB, userB, userA);
  return !!row;
}

module.exports = { isBlockedEitherWay };
