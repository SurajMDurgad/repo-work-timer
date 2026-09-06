'use strict';
const { formatDuration } = require('./core');

function validateLimit(value) {
  if (!/^\d+(?:\.\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 744) {
    return 'Enter hours from 0 to 744 (for example 20 or 1.5). Use 0 to remove the limit.';
  }
}

function limitState(total, hours) {
  if (!Number.isFinite(hours) || hours <= 0 || hours > 744) return undefined;
  const limit = hours * 3600000;
  const percent = Math.floor(total / limit * 100);
  const severity = total >= limit * 0.95 ? 'error' : total >= limit * 0.8 ? 'warning' : undefined;
  const label = total >= limit ? 'Limit reached' : severity === 'error' ? 'Almost at limit' : severity ? 'Approaching limit' : 'Within limit';
  return {
    severity, percent, label,
    icon: severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : undefined,
    text: `${formatDuration(total)} / ${formatDuration(limit)} · ${percent}%${severity ? ` $(arrow-right) ${label}` : ''}`,
    detail: `Monthly limit: ${formatDuration(limit)} · ${percent}% used\n${total > limit ? `${formatDuration(total - limit)} over limit` : `${formatDuration(limit - total)} remaining`}\nYellow at 80%; red at 95%. Tracking continues at the limit.`
  };
}

module.exports = { validateLimit, limitState };
