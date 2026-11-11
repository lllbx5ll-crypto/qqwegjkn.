/** A manual badge overrides subscription status. A paid account never receives blue automatically. */
export function badgeKind(user, now=Date.now()) {
 if (!user || typeof user !== 'object') return null;
 if (user.badgeType === 'blue' || user.badgeType === 'white') return user.badgeType;
 if (user.badgeType === 'none') return null;
 if (user.verified === true || user.role === 'owner') return 'blue'; // old verified accounts
 const level = user.activePlan !== undefined ? user.activePlan : user.plan;
 if (!['plus','premium','pro'].includes(level)) return null;
 if (user.activePlan !== undefined) return 'white'; // active plan calculated by API
 const end = Date.parse(user.planEndsAt || '');
 const start = user.planStartsAt ? Date.parse(user.planStartsAt) : 0;
 return Number.isFinite(end) && end > now && (!start || (Number.isFinite(start) && start <= now)) ? 'white' : null;
}
