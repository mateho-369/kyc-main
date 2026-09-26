// Idempotently populate performer Sharegram ownership only from its owning User row.
const { Performer, User } = require('../models');
(async () => {
  let changed = 0, skipped = 0;
  try {
    const rows = await Performer.findAll({ where: { sharegramUserId: null } });
    for (const performer of rows) {
      if (!performer.userId) { skipped++; continue; }
      const owner = await User.findByPk(performer.userId);
      if (!owner?.sharegramUserId) { skipped++; continue; }
      await performer.update({ sharegramUserId: owner.sharegramUserId });
      changed++;
    }
    console.log(`Performer ownership backfill complete: changed=${changed}, skipped=${skipped}`);
  } catch (error) {
    console.error('Performer ownership backfill failed:', error);
    process.exitCode = 1;
  }
})();
